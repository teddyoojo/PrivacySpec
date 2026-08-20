import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import {
  type BaselineComparison,
  compareBaseline,
  createSemanticFindingCandidate,
  type ObservedBaselineFlow,
} from "../baseline/compare.js";
import {
  type BaselineFlow,
  type BaselineFlowCandidate,
  DEFAULT_BASELINE_PATH,
  DEFAULT_LATEST_RUN_PATH,
} from "../baseline/schema.js";
import {
  invalidateLatestRunFile,
  readBaselineFile,
  writeLatestRunFile,
} from "../baseline/write.js";
import type { DataFlow } from "../correlate/model.js";
import { removePrivacySpecReportSync, writePrivacySpecReport } from "../report/json.js";
import {
  createPrivacySpecReport,
  DEFAULT_REPORT_PATH,
  type PrivacySpecRunStatus,
  type TestAttemptCounts,
  type TestAttemptStatus,
} from "../report/model.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import { REPORT_LEVEL_LEGAL_MAPPINGS, RULE_LEGAL_MAPPINGS } from "../rules/legal-map.js";
import type { Finding } from "../rules/model.js";
import {
  isPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "./result.js";

interface PrivacySpecReporterProfiles {
  nis2_2024_2690?: boolean | undefined;
}

export interface PrivacySpecReporterOptions {
  baselinePath?: string | false | undefined;
  failOnNewReviewFindings?: boolean | undefined;
  latestRunPath?: string | false | undefined;
  profiles?: PrivacySpecReporterProfiles | undefined;
  reportPath?: string | false | undefined;
  write?: (message: string) => void;
}

type InformationalDiagnosticCode =
  | "PS_SOURCE_LIMIT_REACHED"
  | "PS_SINK_LIMIT_REACHED"
  | "PS_CORRELATION_LIMIT_REACHED";

interface InformationalDiagnostic {
  code: InformationalDiagnosticCode;
  message: string;
}

const diagnosticCodes = new Set<InformationalDiagnosticCode>([
  "PS_SOURCE_LIMIT_REACHED",
  "PS_SINK_LIMIT_REACHED",
  "PS_CORRELATION_LIMIT_REACHED",
]);
const sinkCollectors = new Set(["network", "console", "storage"]);
const dataCategories = new Set<DataFlow["dataCategory"]>([
  "personal.email",
  "personal.phone",
  "secret.password",
]);
const sourceKinds = new Set<DataFlow["sourceKind"]>(["form-input", "dom-control"]);
const sourceConfidences = new Set<DataFlow["sourceConfidence"]>(["high", "medium", "low"]);
const dataFlowSinkKinds = new Set<DataFlow["sinkKind"]>([
  "request-url",
  "request-body",
  "request-header",
  "external-request",
  "local-storage",
  "session-storage",
  "cookie",
  "console",
]);
const observedSinkKinds = new Set(["network", "console", "storage"]);
const transforms = new Set<DataFlow["transform"]>([
  "EXACT",
  "LOWERCASE",
  "UPPERCASE",
  "URL_ENCODED",
  "BASE64",
  "SHA256",
  "SHA256_NORMALIZED",
]);
const ruleIds = new Set<Finding["ruleId"]>(Object.keys(RULE_DEFINITIONS) as Finding["ruleId"][]);
const findingSeverities = new Set<Finding["severity"]>(["info", "warning", "error", "critical"]);
const findingClassifications = new Set<Finding["classification"]>([
  "technical_failure",
  "review_required",
  "informational",
]);
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 256;
const MAX_RECIPIENT_ORIGIN_LENGTH = 2_048;
const MAX_RECIPIENT_HOST_LENGTH = 255;
const MAX_METHOD_LENGTH = 32;
const MAX_ENDPOINT_LENGTH = 8_192;
const MAX_LOCATION_LENGTH = 1_024;
const MAX_TEST_FILE_LENGTH = 2_048;
const MAX_TEST_TITLE_LENGTH = 2_048;
const MAX_TEST_PROJECT_LENGTH = 512;
const MAX_FINDING_OBSERVATION_LENGTH = 1_024;
const MAX_FINDING_LIMITATIONS = 10;
const MAX_FINDING_LIMITATION_LENGTH = 1_024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const containsUnsafeTerminalCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    ) {
      return true;
    }
  }
  return false;
};

const isBoundedTerminalString = (
  value: unknown,
  maxLength: number,
  allowEmpty = true,
): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  value.length <= maxLength &&
  !containsUnsafeTerminalCharacter(value);

const terminalLabel = (value: unknown, maxLength: number, fallback: string): string =>
  isBoundedTerminalString(value, maxLength, false) ? value : fallback;

const terminalErrorMessage = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : "unknown baseline error";
  return terminalLabel(rawMessage, MAX_FINDING_OBSERVATION_LENGTH, "baseline operation failed");
};

const resolvedDestination = (flow: BaselineFlow): string =>
  flow.recipient === undefined ? "" : ` ${flow.recipient}`;

interface SemanticFindingGroup {
  flow: BaselineFlowCandidate;
  findings: Finding[];
}

const groupSemanticFindings = (findings: readonly Finding[]): SemanticFindingGroup[] => {
  const groups = new Map<string, SemanticFindingGroup>();
  for (const finding of findings) {
    const flow = createSemanticFindingCandidate(finding);
    const existing = groups.get(flow.key);
    if (existing === undefined) {
      groups.set(flow.key, { flow, findings: [finding] });
    } else {
      existing.findings.push(finding);
    }
  }
  return Array.from(groups.values()).sort((left, right) =>
    left.flow.key.localeCompare(right.flow.key),
  );
};

const semanticFindingTests = (findings: readonly Finding[]): string => {
  const titles = Array.from(new Set(findings.map((finding) => finding.flow.test.title))).sort(
    (left, right) => left.localeCompare(right),
  );
  const visible = titles.slice(0, 3);
  const remainder = titles.length - visible.length;
  return `${visible.join(", ")}${remainder > 0 ? `, +${remainder} more` : ""}`;
};

const writeSemanticFinding = (
  write: (message: string) => void,
  observed: Pick<ObservedBaselineFlow, "flow" | "findings">,
  state: "new" | "technical_failure",
): void => {
  const [representative] = observed.findings;
  if (representative === undefined) return;
  const flow = observed.flow;
  const destination =
    flow.recipient === undefined
      ? ""
      : ` ${representative.flow.recipient?.firstParty === true ? "first-party" : "external"} ${flow.recipient}`;
  const request = [flow.endpoint, flow.location].filter(Boolean).join(" :: ");
  const stateLabel = state === "new" ? " [NEW]" : "";
  write(
    `PrivacySpec finding: ${representative.severity.toUpperCase()} ${representative.ruleId} [${representative.classification.toUpperCase()}]${stateLabel} ${representative.title} :: ${flow.dataCategory} -> ${flow.sinkKind}${destination}${request ? ` :: ${request}` : ""} [${flow.transform}] (observations: ${observed.findings.length}; tests: ${semanticFindingTests(observed.findings)})\n`,
  );
};

const isValidDuration = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const hasRunTiming = (
  result: FullResult,
): result is FullResult & { startTime: Date; duration: number } =>
  result.startTime instanceof Date &&
  Number.isFinite(result.startTime.getTime()) &&
  isValidDuration(result.duration);

const createTestAttemptCounts = (): TestAttemptCounts => ({
  total: 0,
  observed: 0,
  passed: 0,
  failed: 0,
  timedOut: 0,
  skipped: 0,
  interrupted: 0,
});

const runStatus = (
  result: FullResult,
  complete: boolean,
  technicalFailures: number,
  newReviewRequired: number,
  integrationErrors: number,
  failOnNewReviewFindings: boolean,
): PrivacySpecRunStatus => {
  if (
    technicalFailures > 0 ||
    integrationErrors > 0 ||
    (failOnNewReviewFindings && newReviewRequired > 0)
  ) {
    return "failed";
  }
  if (result.status !== "passed" || !complete) return "incomplete";
  return newReviewRequired > 0 ? "review" : "passed";
};

const displayPrivacySpecStatus = (status: PrivacySpecRunStatus): string =>
  status === "passed" ? "PASS" : status === "failed" ? "FAIL" : status.toUpperCase();

const displayPlaywrightStatus = (status: FullResult["status"]): string => {
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  if (status === "timedout") return "TIMED_OUT";
  return "INTERRUPTED";
};

const parseDataFlow = (value: unknown): DataFlow | undefined => {
  if (
    !isRecord(value) ||
    value.kind !== "data-flow" ||
    typeof value.dataCategory !== "string" ||
    !dataCategories.has(value.dataCategory as DataFlow["dataCategory"]) ||
    typeof value.sourceKind !== "string" ||
    !sourceKinds.has(value.sourceKind as DataFlow["sourceKind"]) ||
    typeof value.sourceConfidence !== "string" ||
    !sourceConfidences.has(value.sourceConfidence as DataFlow["sourceConfidence"]) ||
    typeof value.sinkKind !== "string" ||
    !dataFlowSinkKinds.has(value.sinkKind as DataFlow["sinkKind"]) ||
    typeof value.transform !== "string" ||
    !transforms.has(value.transform as DataFlow["transform"]) ||
    !isRecord(value.test) ||
    !isBoundedTerminalString(value.test.file, MAX_TEST_FILE_LENGTH, false) ||
    !isBoundedTerminalString(value.test.title, MAX_TEST_TITLE_LENGTH, false) ||
    !isBoundedTerminalString(value.test.project, MAX_TEST_PROJECT_LENGTH)
  ) {
    return undefined;
  }

  if (value.method !== undefined && !isBoundedTerminalString(value.method, MAX_METHOD_LENGTH)) {
    return undefined;
  }
  if (
    value.endpoint !== undefined &&
    !isBoundedTerminalString(value.endpoint, MAX_ENDPOINT_LENGTH)
  ) {
    return undefined;
  }
  if (
    value.location !== undefined &&
    !isBoundedTerminalString(value.location, MAX_LOCATION_LENGTH)
  ) {
    return undefined;
  }

  let recipient: DataFlow["recipient"];
  if (value.recipient !== undefined) {
    if (
      !isRecord(value.recipient) ||
      !isBoundedTerminalString(value.recipient.origin, MAX_RECIPIENT_ORIGIN_LENGTH, false) ||
      !isBoundedTerminalString(value.recipient.host, MAX_RECIPIENT_HOST_LENGTH, false) ||
      typeof value.recipient.firstParty !== "boolean"
    ) {
      return undefined;
    }
    recipient = {
      origin: value.recipient.origin,
      host: value.recipient.host,
      firstParty: value.recipient.firstParty,
    };
  }

  const flow: DataFlow = {
    kind: "data-flow",
    dataCategory: value.dataCategory as DataFlow["dataCategory"],
    sourceKind: value.sourceKind as DataFlow["sourceKind"],
    sourceConfidence: value.sourceConfidence as DataFlow["sourceConfidence"],
    sinkKind: value.sinkKind as DataFlow["sinkKind"],
    transform: value.transform as DataFlow["transform"],
    test: {
      file: value.test.file,
      title: value.test.title,
      project: value.test.project,
    },
  };
  if (recipient !== undefined) flow.recipient = recipient;
  if (typeof value.method === "string") flow.method = value.method;
  if (typeof value.endpoint === "string") flow.endpoint = value.endpoint;
  if (typeof value.location === "string") flow.location = value.location;
  return flow;
};

const parseInformationalDiagnostic = (value: unknown): InformationalDiagnostic | undefined => {
  if (
    !isRecord(value) ||
    value.kind !== "diagnostic" ||
    value.classification !== "informational" ||
    typeof value.code !== "string" ||
    !diagnosticCodes.has(value.code as InformationalDiagnosticCode) ||
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH ||
    value.message.trim() !== value.message ||
    containsUnsafeTerminalCharacter(value.message)
  ) {
    return undefined;
  }
  if (
    value.code === "PS_SINK_LIMIT_REACHED" &&
    (typeof value.collector !== "string" || !sinkCollectors.has(value.collector))
  ) {
    return undefined;
  }
  return {
    code: value.code as InformationalDiagnosticCode,
    message: value.message,
  };
};

const parseFinding = (value: unknown): Finding | undefined => {
  if (
    !isRecord(value) ||
    value.kind !== "finding" ||
    typeof value.ruleId !== "string" ||
    !ruleIds.has(value.ruleId as Finding["ruleId"]) ||
    typeof value.severity !== "string" ||
    !findingSeverities.has(value.severity as Finding["severity"]) ||
    typeof value.classification !== "string" ||
    !findingClassifications.has(value.classification as Finding["classification"]) ||
    typeof value.title !== "string" ||
    value.title !== RULE_DEFINITIONS[value.ruleId as Finding["ruleId"]].title ||
    !isBoundedTerminalString(value.observation, MAX_FINDING_OBSERVATION_LENGTH, false) ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > MAX_FINDING_LIMITATIONS
  ) {
    return undefined;
  }

  const limitations: string[] = [];
  for (const limitation of value.limitations) {
    if (!isBoundedTerminalString(limitation, MAX_FINDING_LIMITATION_LENGTH, false)) {
      return undefined;
    }
    limitations.push(limitation);
  }
  const flow = parseDataFlow(value.flow);
  if (flow === undefined) return undefined;

  return {
    kind: "finding",
    ruleId: value.ruleId as Finding["ruleId"],
    severity: value.severity as Finding["severity"],
    classification: value.classification as Finding["classification"],
    title: value.title,
    observation: value.observation,
    flow,
    limitations,
  };
};

export default class PrivacySpecReporter implements Reporter {
  readonly #write: (message: string) => void;
  readonly #baselinePath: string | false;
  readonly #latestRunPath: string | false;
  readonly #reportPath: string | false;
  readonly #failOnNewReviewFindings: boolean;
  readonly #nis2EvidenceProfile: boolean;
  #observedAttempts = 0;
  #nonPassingAttempts = 0;
  readonly #sourceCounts = new Map<string, number>();
  readonly #sinkCounts = new Map<string, number>();
  readonly #flows = new Map<string, DataFlow>();
  readonly #findings = new Map<string, Finding>();
  readonly #diagnostics = new Map<string, InformationalDiagnostic>();
  readonly #integrationErrors: string[] = [];
  readonly #projectNames = new Set<string>();
  readonly #testCounts = createTestAttemptCounts();
  #cumulativeTestDurationMilliseconds = 0;

  constructor(options: PrivacySpecReporterOptions = {}) {
    this.#write = options.write ?? ((message) => process.stdout.write(message));
    // `write` is an internal test seam; callers that replace terminal output do
    // not persist artifacts unless they also opt into explicit paths.
    this.#baselinePath =
      options.baselinePath ?? (options.write === undefined ? DEFAULT_BASELINE_PATH : false);
    this.#latestRunPath =
      options.latestRunPath ?? (options.write === undefined ? DEFAULT_LATEST_RUN_PATH : false);
    this.#reportPath =
      options.reportPath ?? (options.write === undefined ? DEFAULT_REPORT_PATH : false);
    // New contextual review findings warn by default unless CI policy opts into failure.
    this.#failOnNewReviewFindings = options.failOnNewReviewFindings ?? false;
    this.#nis2EvidenceProfile = options.profiles?.nis2_2024_2690 === true;
  }

  onBegin(config?: FullConfig): void {
    for (const project of config?.projects ?? []) {
      if (isBoundedTerminalString(project.name, MAX_TEST_PROJECT_LENGTH)) {
        this.#projectNames.add(project.name);
      }
    }
    if (this.#latestRunPath !== false) {
      try {
        // Invalidate a previous successful handoff before any test runs. If the
        // process is interrupted, baseline update must never consume stale data.
        invalidateLatestRunFile(this.#latestRunPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#reportPath !== false) {
      try {
        // A process interrupted before onEnd must not leave a prior successful
        // CI report available for artifact upload.
        removePrivacySpecReportSync(this.#reportPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate JSON report (${terminalErrorMessage(error)})`,
        );
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.#testCounts.total += 1;
    if (Object.hasOwn(this.#testCounts, result.status)) {
      this.#testCounts[result.status as TestAttemptStatus] += 1;
    }
    if (isValidDuration(result.duration)) {
      this.#cumulativeTestDurationMilliseconds += result.duration;
    }
    const testTitle = terminalLabel(test.title, MAX_TEST_TITLE_LENGTH, "[unprintable test title]");
    const attachments = result.attachments.filter(
      (attachment) => attachment.name === PRIVACYSPEC_ATTACHMENT_NAME,
    );

    // A skipped, failed, timed-out, or interrupted attempt does not prove the
    // test's full data-flow scope ran. Still parse any attachment for reporting,
    // but never let this run replace the accepted baseline.
    if (result.status !== "passed") this.#nonPassingAttempts += 1;

    // Playwright reports statically skipped tests without starting test-scoped fixtures.
    // No PrivacySpec attachment can exist for an attempt that never executed.
    if (result.status === "skipped" && attachments.length === 0) {
      return;
    }

    if (attachments.length !== 1) {
      this.#integrationErrors.push(
        `${testTitle}: expected one ${PRIVACYSPEC_ATTACHMENT_NAME} attachment, received ${attachments.length}`,
      );
      return;
    }

    const [attachment] = attachments;
    if (
      attachment === undefined ||
      attachment.contentType !== PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE ||
      attachment.body === undefined
    ) {
      this.#integrationErrors.push(`${testTitle}: PrivacySpec attachment is not inline JSON`);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(attachment.body.toString("utf8"));
      if (!isPrivacySpecResult(parsed)) {
        throw new Error("unsupported result schema");
      }
      for (const observation of parsed.observations) {
        if (
          isRecord(observation) &&
          observation.kind === "data-flow" &&
          parseDataFlow(observation) === undefined
        ) {
          throw new Error("invalid data-flow observation");
        }
        if (
          isRecord(observation) &&
          observation.kind === "finding" &&
          parseFinding(observation) === undefined
        ) {
          throw new Error("invalid finding observation");
        }
      }
      for (const observation of parsed.observations) {
        if (isRecord(observation) && observation.kind === "diagnostic") {
          const diagnostic = parseInformationalDiagnostic(observation);
          if (diagnostic !== undefined) {
            const identity = JSON.stringify([diagnostic.code, diagnostic.message]);
            this.#diagnostics.set(identity, diagnostic);
          }
          continue;
        }
        if (isRecord(observation) && observation.kind === "finding") {
          const finding = parseFinding(observation);
          if (finding !== undefined) {
            const identity = JSON.stringify([finding.ruleId, finding.flow]);
            this.#findings.set(identity, finding);
          }
          continue;
        }
        if (isRecord(observation) && observation.kind === "data-flow") {
          const flow = parseDataFlow(observation);
          if (flow !== undefined) {
            const identity = JSON.stringify(flow);
            this.#flows.set(identity, flow);
          }
          continue;
        }
        if (
          isRecord(observation) &&
          observation.kind === "sensitive-source" &&
          typeof observation.category === "string" &&
          dataCategories.has(observation.category as DataFlow["dataCategory"])
        ) {
          this.#sourceCounts.set(
            observation.category,
            (this.#sourceCounts.get(observation.category) ?? 0) + 1,
          );
        }
        if (
          isRecord(observation) &&
          observation.kind === "sink" &&
          typeof observation.sink === "string" &&
          observedSinkKinds.has(observation.sink)
        ) {
          this.#sinkCounts.set(observation.sink, (this.#sinkCounts.get(observation.sink) ?? 0) + 1);
        }
      }
      this.#observedAttempts += 1;
      this.#testCounts.observed += 1;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "unknown parse error";
      const message = terminalLabel(rawMessage, MAX_DIAGNOSTIC_MESSAGE_LENGTH, "parse error");
      this.#integrationErrors.push(`${testTitle}: invalid PrivacySpec attachment (${message})`);
    }
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    const findings = Array.from(this.#findings.values()).sort(
      (left, right) =>
        left.ruleId.localeCompare(right.ruleId) ||
        JSON.stringify(left.flow).localeCompare(JSON.stringify(right.flow)),
    );
    let comparison: BaselineComparison = compareBaseline(findings, undefined);
    let baselineExists = false;

    if (this.#baselinePath !== false) {
      try {
        const baseline = await readBaselineFile(this.#baselinePath);
        baselineExists = baseline !== undefined;
        comparison = compareBaseline(findings, baseline);
      } catch (error) {
        this.#integrationErrors.push(
          `could not read semantic baseline (${terminalErrorMessage(error)})`,
        );
      }
    }

    const runComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      this.#diagnostics.size === 0 &&
      !findings.some((finding) => finding.classification === "technical_failure") &&
      this.#integrationErrors.length === 0;
    if (this.#latestRunPath !== false) {
      try {
        await writeLatestRunFile(this.#latestRunPath, comparison.observed, {
          complete: runComplete,
        });
      } catch (error) {
        this.#integrationErrors.push(
          `could not write latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }

    this.#write(`PrivacySpec observed ${this.#observedAttempts} tests\n`);
    if (this.#sourceCounts.size > 0) {
      const summary = Array.from(this.#sourceCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, count]) => `${category}=${count}`)
        .join(", ");
      this.#write(`PrivacySpec sources: ${summary}\n`);
    }
    if (this.#sinkCounts.size > 0) {
      const summary = Array.from(this.#sinkCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sink, count]) => `${sink}=${count}`)
        .join(", ");
      this.#write(`PrivacySpec sinks: ${summary}\n`);
    }
    if (this.#flows.size > 0) {
      this.#write(`PrivacySpec data flows: ${this.#flows.size}\n`);
    }
    if (this.#diagnostics.size > 0) {
      const diagnostics = Array.from(this.#diagnostics.values()).sort(
        (left, right) =>
          left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
      );
      for (const diagnostic of diagnostics) {
        this.#write(`PrivacySpec informational: ${diagnostic.code}: ${diagnostic.message}\n`);
      }
    }

    const newReviewRequired = comparison.new.length;
    const technicalFindingGroups = groupSemanticFindings(
      findings.filter((finding) => finding.classification === "technical_failure"),
    );
    const technicalFailures = technicalFindingGroups.length;
    const actionableObservations =
      technicalFindingGroups.reduce((count, observed) => count + observed.findings.length, 0) +
      comparison.new.reduce((count, observed) => count + observed.findings.length, 0);

    const finalRunComplete = runComplete && this.#integrationErrors.length === 0;
    let evidenceRunComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      this.#diagnostics.size === 0 &&
      this.#integrationErrors.length === 0;
    let resolved = finalRunComplete ? comparison.resolved : [];
    const effectiveComparison: BaselineComparison = { ...comparison, resolved };
    const timingAvailable = hasRunTiming(result);
    const startedAt = timingAvailable ? result.startTime : new Date();
    const durationMilliseconds = timingAvailable ? result.duration : 0;
    let privacyspecStatus = runStatus(
      result,
      evidenceRunComplete,
      technicalFailures,
      newReviewRequired,
      this.#integrationErrors.length,
      this.#failOnNewReviewFindings,
    );
    let reportWritten = false;

    if (this.#reportPath !== false) {
      const ruleMappings = Array.from(new Set(findings.map((finding) => finding.ruleId)))
        .sort((left, right) => left.localeCompare(right))
        .map((ruleId) => RULE_LEGAL_MAPPINGS[ruleId]);
      const profileMappings = this.#nis2EvidenceProfile
        ? [REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690]
        : [];
      const report = createPrivacySpecReport({
        generatedAt: new Date(startedAt.getTime() + durationMilliseconds).toISOString(),
        startedAt: startedAt.toISOString(),
        playwrightStatus: result.status,
        privacyspecStatus,
        complete: evidenceRunComplete,
        projects: Array.from(this.#projectNames),
        tests: this.#testCounts,
        sourceCounts: this.#sourceCounts,
        sinkCounts: this.#sinkCounts,
        suiteDurationMilliseconds: durationMilliseconds,
        cumulativeTestDurationMilliseconds: this.#cumulativeTestDurationMilliseconds,
        flows: Array.from(this.#flows.values()).sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
        findings,
        comparison: effectiveComparison,
        baselineExists,
        diagnostics: Array.from(this.#diagnostics.values()).sort(
          (left, right) =>
            left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
        ),
        integrationErrors: this.#integrationErrors,
        ruleMappings,
        profileMappings,
      });
      try {
        await writePrivacySpecReport(this.#reportPath, report);
        reportWritten = true;
      } catch (error) {
        this.#integrationErrors.push(
          `could not write JSON report (${terminalErrorMessage(error)})`,
        );
        if (this.#latestRunPath !== false) {
          try {
            invalidateLatestRunFile(this.#latestRunPath);
          } catch (invalidationError) {
            this.#integrationErrors.push(
              `could not invalidate latest-run artifact after report failure (${terminalErrorMessage(invalidationError)})`,
            );
          }
        }
        evidenceRunComplete = false;
        resolved = [];
        privacyspecStatus = "failed";
      }
    }

    if (technicalFailures > 0 || newReviewRequired > 0) {
      this.#write(
        `PrivacySpec semantic findings: ${technicalFailures + newReviewRequired} (technical failures=${technicalFailures}, new review findings=${newReviewRequired}, observations=${actionableObservations})\n`,
      );
    }

    if (baselineExists || comparison.observed.length > 0 || resolved.length > 0) {
      this.#write(
        `PrivacySpec baseline: known=${comparison.known.length}, new=${comparison.new.length}, resolved=${resolved.length}\n`,
      );
    }

    if (this.#nis2EvidenceProfile) {
      const mapping = REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690;
      this.#write(
        `PrivacySpec report profile: ${mapping.profileId} [OPT-IN] [${evidenceRunComplete ? "RUN_COMPLETE" : "RUN_INCOMPLETE"}] ${mapping.title}\n`,
      );
      this.#write(`PrivacySpec evidence observation: ${mapping.observation}\n`);
      for (const relevance of mapping.regulatoryRelevance) {
        this.#write(
          `PrivacySpec EU relevance: ${relevance.instrument} ${relevance.provision} [${relevance.relationship.toUpperCase()}]\n`,
        );
        this.#write(`PrivacySpec relevance rationale: ${relevance.rationale}\n`);
        this.#write(`PrivacySpec applicability: ${relevance.applicabilityCaveat}\n`);
        this.#write(`PrivacySpec primary source: ${relevance.sourceUrl}\n`);
        this.#write(`PrivacySpec mapping reviewed: ${relevance.lastReviewed}\n`);
      }
      for (const limitation of mapping.limitations) {
        this.#write(`PrivacySpec profile limitation: ${limitation}\n`);
      }
      if (!evidenceRunComplete) {
        this.#write(
          "PrivacySpec profile limitation: This run did not complete its observed test scope and must not be treated as complete test-run evidence.\n",
        );
      }
    }

    for (const observed of technicalFindingGroups) {
      writeSemanticFinding(this.#write, observed, "technical_failure");
    }
    for (const observed of comparison.new) {
      writeSemanticFinding(this.#write, observed, "new");
    }
    for (const flow of resolved) {
      const request = [flow.endpoint, flow.location].filter(Boolean).join(" :: ");
      this.#write(
        `PrivacySpec resolved: ${flow.ruleId} ${flow.dataCategory} -> ${flow.sinkKind}${resolvedDestination(flow)}${request ? ` :: ${request}` : ""} [${flow.transform}]\n`,
      );
    }

    if (timingAvailable) {
      const actionableRuleIds = Array.from(
        new Set([
          ...findings
            .filter((finding) => finding.classification === "technical_failure")
            .map((finding) => finding.ruleId),
          ...comparison.new.flatMap(({ findings: observed }) =>
            observed.map((finding) => finding.ruleId),
          ),
        ]),
      ).sort((left, right) => left.localeCompare(right));
      for (const ruleId of actionableRuleIds) {
        const mapping = RULE_LEGAL_MAPPINGS[ruleId];
        const controls = mapping.technicalControls
          .map(
            (control) =>
              `${control.framework} ${control.version} ${control.control} [${control.relationship.toUpperCase()}]`,
          )
          .join(", ");
        const relevance = mapping.regulatoryRelevance
          .map(
            (entry) =>
              `${entry.instrument} ${entry.provision} [${entry.relationship.toUpperCase()}]`,
          )
          .join(", ");
        const sources = Array.from(
          new Set([
            ...mapping.technicalControls.map((control) => control.sourceUrl),
            ...mapping.regulatoryRelevance.map((entry) => entry.sourceUrl),
          ]),
        ).join(", ");
        this.#write(`PrivacySpec technical relevance ${ruleId}: ${controls}\n`);
        this.#write(`PrivacySpec EU relevance ${ruleId}: ${relevance}\n`);
        this.#write(`PrivacySpec authoritative sources ${ruleId}: ${sources}\n`);
      }
      this.#write(
        `PrivacySpec performance: suite=${Math.round(durationMilliseconds)}ms, cumulative test duration=${Math.round(this.#cumulativeTestDurationMilliseconds)}ms\n`,
      );
      if (reportWritten && this.#reportPath !== false) {
        this.#write(
          `PrivacySpec JSON report: ${terminalLabel(this.#reportPath, MAX_ENDPOINT_LENGTH, "[unprintable report path]")} (schema v1)\n`,
        );
      }
    }

    for (const error of this.#integrationErrors) {
      this.#write(`PrivacySpec integration error: ${error}\n`);
    }
    if (timingAvailable) {
      this.#write(
        `PrivacySpec result: ${displayPrivacySpecStatus(privacyspecStatus)} (functional tests=${displayPlaywrightStatus(result.status)}, technical failures=${technicalFailures}, new review findings=${newReviewRequired})\n`,
      );
    }

    if (privacyspecStatus !== "failed") return undefined;
    return { status: "failed" };
  }
}
