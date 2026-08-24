import { isAbsolute, join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import {
  leastCompleteDependencyCoverage,
  mergeDependencyInventory,
  sortedDependencyInventory,
} from "../analyzers/dependency/aggregate.js";
import {
  DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
  DEPENDENCY_ATTACHMENT_NAME,
  invalidateDependencyLatestRunFile,
  parseDependencyAttachment,
  readDependencyBaselineFile,
  removeDependencyReportSync,
  writeDependencyLatestRunFile,
  writeDependencyReport,
} from "../analyzers/dependency/artifact.js";
import { compareDependencyBaseline } from "../analyzers/dependency/baseline.js";
import {
  DEFAULT_DEPENDENCY_BASELINE_PATH,
  DEFAULT_DEPENDENCY_LATEST_RUN_PATH,
  DEFAULT_DEPENDENCY_REPORT_PATH,
  DEPENDENCY_REPORT_SCHEMA_VERSION,
  type DependencyCoverageStatus,
  type DependencyDiagnostic,
  type DependencyReport,
  type RuntimeDependencyInventoryEntry,
} from "../analyzers/dependency/model.js";
import {
  leastCompleteRuntimeFailureCoverage,
  mergeRuntimeFailureInventory,
  sortedRuntimeFailureInventory,
} from "../analyzers/runtime-failure/aggregate.js";
import {
  invalidateRuntimeFailureLatestRunFile,
  parseRuntimeFailureAttachment,
  RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
  RUNTIME_FAILURE_ATTACHMENT_NAME,
  readRuntimeFailureBaselineFile,
  removeRuntimeFailureReportSync,
  writeRuntimeFailureLatestRunFile,
  writeRuntimeFailureReport,
} from "../analyzers/runtime-failure/artifact.js";
import { compareRuntimeFailureBaseline } from "../analyzers/runtime-failure/baseline.js";
import {
  DEFAULT_RUNTIME_FAILURE_BASELINE_PATH,
  DEFAULT_RUNTIME_FAILURE_LATEST_RUN_PATH,
  DEFAULT_RUNTIME_FAILURE_REPORT_PATH,
  RUNTIME_FAILURE_SCHEMA_VERSION,
  type RuntimeFailureCoverageStatus,
  type RuntimeFailureDiagnostic,
  type RuntimeFailureInventoryEntry,
  type RuntimeFailureReport,
} from "../analyzers/runtime-failure/model.js";
import {
  leastCompleteSecurityCoverage,
  mergeSecurityInventory,
  sortedSecurityInventory,
} from "../analyzers/security/aggregate.js";
import {
  invalidateSecurityLatestRunFile,
  parseSecurityAttachment,
  readSecurityBaselineFile,
  removeSecurityReportSync,
  SECURITY_ATTACHMENT_CONTENT_TYPE,
  SECURITY_ATTACHMENT_NAME,
  writeSecurityLatestRunFile,
  writeSecurityReport,
} from "../analyzers/security/artifact.js";
import { compareSecurityBaseline } from "../analyzers/security/baseline.js";
import { SECURITY_TECHNICAL_CONTROLS } from "../analyzers/security/mappings.js";
import {
  DEFAULT_SECURITY_BASELINE_PATH,
  DEFAULT_SECURITY_LATEST_RUN_PATH,
  DEFAULT_SECURITY_REPORT_PATH,
  SECURITY_SCHEMA_VERSION,
  type SecurityCoverageStatus,
  type SecurityDiagnostic,
  type SecurityPostureInventoryEntry,
  type SecurityReport,
} from "../analyzers/security/model.js";
import {
  type BaselineChangeReason,
  type BaselineComparison,
  classifyBaselineChange,
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
  classifierConfigurationForBaseline,
  invalidateLatestRunFile,
  readBaselineFile,
  writeLatestRunFile,
} from "../baseline/write.js";
import { compareCanonicalStrings } from "../canonical-order.js";
import type { DataFlow } from "../correlate/model.js";
import {
  BUILTIN_ONLY_CLASSIFIER_CONFIGURATION,
  type ClassifierConfigurationState,
  classifierConfigurationsEqual,
  UNAVAILABLE_CLASSIFIER_CONFIGURATION,
} from "../discovery/classifier-configuration.js";
import type { ResponseJsonCoverage } from "../discovery/response-json.js";
import { isDataCategory } from "../discovery/source-model.js";
import type { NetworkObservationCoverage } from "../observe/network.js";
import { removePrivacySpecReportSync, writePrivacySpecReport } from "../report/json.js";
import {
  type APIRequestReportCoverage,
  type BrowserEngineReportCoverage,
  createPrivacySpecReport,
  DEFAULT_REPORT_PATH,
  type FirstPartyJsonResponseReportCoverage,
  type NetworkObservationReportCoverage,
  type ObservationCoverageDiagnostic,
  type ObservationCoverageReport,
  type PlaywrightInstrumentationReportCoverage,
  type PrivacySpecRunStatus,
  REPORT_SCHEMA_VERSION,
  type TestAttemptCounts,
  type TestAttemptStatus,
} from "../report/model.js";
import { renderSecondaryCoverageSummary } from "../report/terminal.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import { REPORT_LEVEL_LEGAL_MAPPINGS, RULE_LEGAL_MAPPINGS } from "../rules/legal-map.js";
import type { Finding } from "../rules/model.js";
import { isRunScopeIdentifier, writePrivacySpecRunPart } from "../run-scope/artifact.js";
import {
  DEFAULT_RUN_PARTS_DIRECTORY,
  MAX_RUN_PARTS,
  type PrivacySpecRunScopeOptions,
  type ResolvedPrivacySpecRunScope,
  RUN_PART_SCHEMA_VERSION,
} from "../run-scope/model.js";
import type { TestDataObservation } from "../testdata/model.js";
import { parseTestDataAttachment } from "../testdata/validate.js";
import type { PlaywrightObservationCounters } from "./coverage.js";
import type { APIRequestCoverage, BrowserEngineCoverage } from "./experimental-coverage.js";
import {
  ATTACHMENT_SCHEMA_VERSION,
  ATTACHMENT_SCHEMA_VERSION_V3,
  ATTACHMENT_SCHEMA_VERSION_V4,
  getPrivacySpecResultValidationError,
  type PlaywrightInstrumentationCoverage,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
  parsePrivacySpecResult,
} from "./result.js";

interface PrivacySpecReporterProfiles {
  nis2_2024_2690?: boolean | undefined;
}

interface DependencyReporterOptions {
  baselinePath?: string | false | undefined;
  latestRunPath?: string | false | undefined;
  reportPath?: string | false | undefined;
}

interface SecurityReporterOptions {
  baselinePath?: string | false | undefined;
  latestRunPath?: string | false | undefined;
  reportPath?: string | false | undefined;
}

interface RuntimeFailureReporterOptions {
  baselinePath?: string | false | undefined;
  latestRunPath?: string | false | undefined;
  reportPath?: string | false | undefined;
}

export interface PrivacySpecReporterOptions {
  baselinePath?: string | false | undefined;
  failOnNewReviewFindings?: boolean | undefined;
  latestRunPath?: string | false | undefined;
  profiles?: PrivacySpecReporterProfiles | undefined;
  reportPath?: string | false | undefined;
  dependencies?: DependencyReporterOptions | undefined;
  security?: SecurityReporterOptions | undefined;
  runtimeFailures?: RuntimeFailureReporterOptions | undefined;
  runScope?: PrivacySpecRunScopeOptions | undefined;
  write?: (message: string) => void;
}

type InformationalDiagnosticCode =
  | "PS_ANALYZER_PRIVACY_FAILED"
  | "PS_OBSERVER_FINALIZATION_FAILED"
  | "PS_OBSERVER_FINALIZATION_TIMEOUT"
  | "PS_SOURCE_LIMIT_REACHED"
  | "PS_CUSTOM_SOURCE_AMBIGUOUS"
  | "PS_SINK_LIMIT_REACHED"
  | "PS_CORRELATION_LIMIT_REACHED";

interface InformationalDiagnostic {
  code: InformationalDiagnosticCode;
  message: string;
}

const diagnosticCodes = new Set<InformationalDiagnosticCode>([
  "PS_ANALYZER_PRIVACY_FAILED",
  "PS_OBSERVER_FINALIZATION_FAILED",
  "PS_OBSERVER_FINALIZATION_TIMEOUT",
  "PS_SOURCE_LIMIT_REACHED",
  "PS_CUSTOM_SOURCE_AMBIGUOUS",
  "PS_SINK_LIMIT_REACHED",
  "PS_CORRELATION_LIMIT_REACHED",
]);
const sinkCollectors = new Set(["network", "console", "storage"]);
const sourceKinds = new Set<DataFlow["sourceKind"]>(["form-input", "dom-control", "response-json"]);
const sourceConfidences = new Set<DataFlow["sourceConfidence"]>(["high", "medium", "low"]);
const requestSurfaces = new Set<DataFlow["requestSurface"]>(["browser", "api-request"]);
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
const MAX_TERMINAL_FINDINGS_PER_MODULE = 20;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

const hasNonNegativeCounts = <Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Record<Key, number> =>
  isRecord(value) &&
  hasExactKeys(value, keys) &&
  keys.every((key) => isNonNegativeInteger(value[key]));

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
  key: string;
  flow: BaselineFlowCandidate;
  findings: Finding[];
}

const groupSemanticFindings = (findings: readonly Finding[]): SemanticFindingGroup[] => {
  const groups = new Map<string, SemanticFindingGroup>();
  for (const finding of findings) {
    const flow = createSemanticFindingCandidate(finding);
    const key = JSON.stringify([flow.key, finding.flow.requestSurface ?? "browser"]);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { key, flow, findings: [finding] });
    } else {
      existing.findings.push(finding);
    }
  }
  return Array.from(groups.values()).sort((left, right) => left.key.localeCompare(right.key));
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
  state: "new" | "not_baseline_eligible" | "technical_failure",
  changeReason?: BaselineChangeReason | undefined,
): void => {
  const [representative] = observed.findings;
  if (representative === undefined) return;
  const flow = observed.flow;
  const destination =
    flow.recipient === undefined
      ? ""
      : ` ${representative.flow.recipient?.firstParty === true ? "first-party" : "external"} ${flow.recipient}`;
  const request = [flow.endpoint, flow.location].filter(Boolean).join(" :: ");
  const stateLabel =
    state === "new"
      ? " [NEW]"
      : state === "not_baseline_eligible"
        ? " [NOT_BASELINE_ELIGIBLE]"
        : "";
  const changeLabel = changeReason === undefined ? "" : ` [CHANGE=${changeReason}]`;
  const requestSurfaceLabel =
    representative.flow.requestSurface === "api-request" ? " [surface=api-request]" : "";
  write(
    `PrivacySpec finding: ${representative.severity.toUpperCase()} ${representative.ruleId} [${representative.classification.toUpperCase()}]${stateLabel}${changeLabel}${requestSurfaceLabel} ${representative.title} :: ${flow.dataCategory} -> ${flow.sinkKind}${destination}${request ? ` :: ${request}` : ""} [${flow.transform}] (observations: ${observed.findings.length}; tests: ${semanticFindingTests(observed.findings)})\n`,
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
    !isDataCategory(value.dataCategory) ||
    typeof value.sourceKind !== "string" ||
    !sourceKinds.has(value.sourceKind as DataFlow["sourceKind"]) ||
    typeof value.sourceConfidence !== "string" ||
    !sourceConfidences.has(value.sourceConfidence as DataFlow["sourceConfidence"]) ||
    (value.requestSurface !== undefined &&
      (typeof value.requestSurface !== "string" ||
        !requestSurfaces.has(value.requestSurface as DataFlow["requestSurface"]))) ||
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

  let sourceProvenance: DataFlow["sourceProvenance"];
  if (value.sourceProvenance !== undefined) {
    if (
      !isRecord(value.sourceProvenance) ||
      !hasExactKeys(value.sourceProvenance, ["origin", "endpoint", "location"]) ||
      !isBoundedTerminalString(value.sourceProvenance.origin, MAX_RECIPIENT_ORIGIN_LENGTH, false) ||
      !isBoundedTerminalString(value.sourceProvenance.endpoint, MAX_ENDPOINT_LENGTH, false) ||
      !isBoundedTerminalString(value.sourceProvenance.location, MAX_LOCATION_LENGTH, false)
    ) {
      return undefined;
    }
    try {
      if (new URL(value.sourceProvenance.origin).origin !== value.sourceProvenance.origin) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    sourceProvenance = {
      origin: value.sourceProvenance.origin,
      endpoint: value.sourceProvenance.endpoint,
      location: value.sourceProvenance.location,
    };
  }
  if ((value.sourceKind === "response-json") !== (sourceProvenance !== undefined)) {
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
    requestSurface: (value.requestSurface as DataFlow["requestSurface"] | undefined) ?? "browser",
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
  if (sourceProvenance !== undefined) flow.sourceProvenance = sourceProvenance;
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

const responseCountKeys = ["seen", "firstParty", "json", "parsed", "withSources"] as const;
const responseSkipKeys = [
  "unknownLength",
  "oversized",
  "aggregateLimit",
  "workLimit",
  "bodyReadError",
  "invalidJson",
  "traversalLimit",
  "sourceLimit",
] as const;

const parseResponseJsonCoverage = (value: unknown): ResponseJsonCoverage | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "enabled",
      "responses",
      "retainedBytes",
      "discoveredSources",
      "skipped",
    ]) ||
    typeof value.enabled !== "boolean" ||
    !hasNonNegativeCounts(value.responses, responseCountKeys) ||
    !isNonNegativeInteger(value.retainedBytes) ||
    !isRecord(value.discoveredSources) ||
    !hasExactKeys(value.discoveredSources, ["total", "byCategory"]) ||
    !isNonNegativeInteger(value.discoveredSources.total) ||
    !isRecord(value.discoveredSources.byCategory) ||
    !hasExactKeys(value.discoveredSources.byCategory, ["personal.email", "personal.phone"]) ||
    !isNonNegativeInteger(value.discoveredSources.byCategory["personal.email"]) ||
    !isNonNegativeInteger(value.discoveredSources.byCategory["personal.phone"]) ||
    !hasNonNegativeCounts(value.skipped, responseSkipKeys)
  ) {
    return undefined;
  }

  const responses = value.responses as unknown as ResponseJsonCoverage["responses"];
  const discoveredSources =
    value.discoveredSources as unknown as ResponseJsonCoverage["discoveredSources"];
  const skipped = value.skipped as unknown as ResponseJsonCoverage["skipped"];
  if (
    responses.firstParty > responses.seen ||
    responses.json > responses.firstParty ||
    responses.parsed > responses.json ||
    responses.withSources > responses.parsed ||
    discoveredSources.total !==
      discoveredSources.byCategory["personal.email"] +
        discoveredSources.byCategory["personal.phone"]
  ) {
    return undefined;
  }
  if (
    !value.enabled &&
    (Object.values(responses).some((count) => count !== 0) ||
      value.retainedBytes !== 0 ||
      discoveredSources.total !== 0 ||
      Object.values(skipped).some((count) => count !== 0))
  ) {
    return undefined;
  }
  return {
    enabled: value.enabled,
    responses: { ...responses },
    retainedBytes: value.retainedBytes,
    discoveredSources: {
      total: discoveredSources.total,
      byCategory: { ...discoveredSources.byCategory },
    },
    skipped: { ...skipped },
  };
};

const createReportResponseCoverage = (): FirstPartyJsonResponseReportCoverage => ({
  experimental: true,
  tests: { enabled: 0, disabled: 0, unavailable: 0 },
  responses: { seen: 0, firstParty: 0, json: 0, parsed: 0, withSources: 0 },
  retainedBytes: 0,
  discoveredSources: {
    total: 0,
    byName: { "personal.email": 0, "personal.phone": 0 },
  },
  skipped: {
    unknownLength: 0,
    oversized: 0,
    aggregateLimit: 0,
    workLimit: 0,
    bodyReadError: 0,
    invalidJson: 0,
    traversalLimit: 0,
    sourceLimit: 0,
  },
});

const addResponseCoverage = (
  target: FirstPartyJsonResponseReportCoverage,
  coverage: ResponseJsonCoverage,
): void => {
  target.tests[coverage.enabled ? "enabled" : "disabled"] += 1;
  for (const key of responseCountKeys) target.responses[key] += coverage.responses[key];
  target.retainedBytes += coverage.retainedBytes;
  target.discoveredSources.total += coverage.discoveredSources.total;
  target.discoveredSources.byName["personal.email"] =
    (target.discoveredSources.byName["personal.email"] ?? 0) +
    coverage.discoveredSources.byCategory["personal.email"];
  target.discoveredSources.byName["personal.phone"] =
    (target.discoveredSources.byName["personal.phone"] ?? 0) +
    coverage.discoveredSources.byCategory["personal.phone"];
  for (const key of responseSkipKeys) target.skipped[key] += coverage.skipped[key];
};

const parsePlaywrightCoverage = (value: unknown): PlaywrightInstrumentationCoverage | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["applicationContexts", "pages"]) ||
    (value.applicationContexts !== 0 && value.applicationContexts !== 1) ||
    !isNonNegativeInteger(value.pages) ||
    (value.applicationContexts === 0) !== (value.pages === 0)
  ) {
    return undefined;
  }
  return {
    applicationContexts: value.applicationContexts,
    pages: value.pages,
  };
};

const createReportPlaywrightCoverage = (): PlaywrightInstrumentationReportCoverage => ({
  tests: { compatible: 0, incompatible: 0, unavailable: 0 },
  applicationContexts: 0,
  pages: 0,
});

const parseNetworkCoverage = (value: unknown): NetworkObservationCoverage | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["requests"]) ||
    !hasNonNegativeCounts(value.requests, ["seen", "accepted", "filteredLowValueStatic"])
  ) {
    return undefined;
  }
  const requests = value.requests as NetworkObservationCoverage["requests"];
  if (requests.accepted + requests.filteredLowValueStatic > requests.seen) return undefined;
  return { requests: { ...requests } };
};

const createReportNetworkCoverage = (): NetworkObservationReportCoverage => ({
  requests: { seen: 0, accepted: 0, filteredLowValueStatic: 0 },
});

const browserCapabilityNames = [
  "init-scripts",
  "events",
  "teardown-fallback",
  "network",
  "console",
  "storage",
  "cookies",
  "response-headers",
  "page-errors",
] as const;
const capabilityStates = new Set(["complete", "partial", "incomplete", "unsupported", "disabled"]);
const capabilityRank = {
  complete: 0,
  disabled: 1,
  partial: 2,
  incomplete: 3,
  unsupported: 4,
} as const;
const supportRank = { supported: 0, experimental: 1, unsupported: 2 } as const;

const parseBrowserEngineCoverage = (value: unknown): BrowserEngineCoverage | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["engine", "support", "experimental", "capabilities"]) ||
    !["chromium", "firefox", "webkit"].includes(String(value.engine)) ||
    !["supported", "experimental", "unsupported"].includes(String(value.support)) ||
    typeof value.experimental !== "boolean" ||
    !isRecord(value.capabilities) ||
    !hasExactKeys(value.capabilities, browserCapabilityNames) ||
    !browserCapabilityNames.every((name) =>
      capabilityStates.has(String((value.capabilities as Record<string, unknown>)[name])),
    )
  ) {
    return undefined;
  }
  const engine = value.engine as BrowserEngineCoverage["engine"];
  const support = value.support as BrowserEngineCoverage["support"];
  if (
    (engine === "chromium" && (support !== "supported" || value.experimental)) ||
    (support === "experimental") !== value.experimental ||
    (support === "unsupported" &&
      browserCapabilityNames.some(
        (name) => (value.capabilities as Record<string, unknown>)[name] !== "unsupported",
      ))
  ) {
    return undefined;
  }
  return structuredClone(value) as unknown as BrowserEngineCoverage;
};

const apiBlindSpots = [
  "implicit-headers-cookies-auth",
  "redirect-chain",
  "page-request",
  "context-request",
  "manual-request-context",
] as const;

const parseAPIRequestCoverage = (value: unknown): APIRequestCoverage | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["enabled", "status", "calls", "skipped", "blindSpots"]) ||
    typeof value.enabled !== "boolean" ||
    !["complete", "partial", "unsupported"].includes(String(value.status)) ||
    !hasNonNegativeCounts(value.calls, ["seen", "observed", "failed", "serverErrors"]) ||
    value.calls.observed + value.calls.failed > value.calls.seen ||
    value.calls.serverErrors > value.calls.observed ||
    !hasNonNegativeCounts(value.skipped, [
      "accessors",
      "streams",
      "files",
      "unsupportedObjects",
      "oversized",
      "aggregateLimit",
      "sinkLimit",
      "materialLimit",
    ]) ||
    !Array.isArray(value.blindSpots) ||
    JSON.stringify(value.blindSpots) !== JSON.stringify(apiBlindSpots) ||
    (value.calls.seen === 0 && value.status !== "complete") ||
    (value.calls.seen > 0 && value.status === "complete") ||
    (value.enabled && value.calls.seen > 0 && value.status !== "partial") ||
    (!value.enabled && value.calls.seen > 0 && value.status !== "unsupported")
  ) {
    return undefined;
  }
  return structuredClone(value) as unknown as APIRequestCoverage;
};

const unsupportedCapabilities =
  (): BrowserEngineReportCoverage["engines"]["chromium"]["capabilities"] => ({
    "init-scripts": "unsupported",
    events: "unsupported",
    "teardown-fallback": "unsupported",
    network: "unsupported",
    console: "unsupported",
    storage: "unsupported",
    cookies: "unsupported",
    "response-headers": "unsupported",
    "page-errors": "unsupported",
  });

const createReportBrowserEngineCoverage = (): BrowserEngineReportCoverage => ({
  experimental: true,
  tests: { supported: 0, experimental: 0, unsupported: 0, unavailable: 0 },
  engines: {
    chromium: { tests: 0, support: "supported", capabilities: unsupportedCapabilities() },
    firefox: { tests: 0, support: "unsupported", capabilities: unsupportedCapabilities() },
    webkit: { tests: 0, support: "unsupported", capabilities: unsupportedCapabilities() },
  },
});

const addBrowserEngineCoverage = (
  target: BrowserEngineReportCoverage,
  coverage: BrowserEngineCoverage | undefined,
): void => {
  if (coverage === undefined) {
    target.tests.unavailable += 1;
    return;
  }
  target.tests[coverage.support] += 1;
  const engine = target.engines[coverage.engine];
  const first = engine.tests === 0;
  engine.tests += 1;
  if (first || supportRank[coverage.support] > supportRank[engine.support]) {
    engine.support = coverage.support;
  }
  for (const capability of browserCapabilityNames) {
    const incoming = coverage.capabilities[capability];
    if (first || capabilityRank[incoming] > capabilityRank[engine.capabilities[capability]]) {
      engine.capabilities[capability] = incoming;
    }
  }
};

const createReportAPIRequestCoverage = (): APIRequestReportCoverage => ({
  experimental: true,
  tests: { enabled: 0, disabled: 0, unavailable: 0, complete: 0, partial: 0, unsupported: 0 },
  calls: { seen: 0, observed: 0, failed: 0, serverErrors: 0 },
  skipped: {
    accessors: 0,
    streams: 0,
    files: 0,
    unsupportedObjects: 0,
    oversized: 0,
    aggregateLimit: 0,
    sinkLimit: 0,
    materialLimit: 0,
  },
  blindSpots: [...apiBlindSpots],
});

const addAPIRequestCoverage = (
  target: APIRequestReportCoverage,
  coverage: APIRequestCoverage | undefined,
): void => {
  if (coverage === undefined) {
    target.tests.unavailable += 1;
    return;
  }
  target.tests[coverage.enabled ? "enabled" : "disabled"] += 1;
  target.tests[coverage.status] += 1;
  for (const key of Object.keys(target.calls) as Array<keyof typeof target.calls>) {
    target.calls[key] += coverage.calls[key];
  }
  for (const key of Object.keys(target.skipped) as Array<keyof typeof target.skipped>) {
    target.skipped[key] += coverage.skipped[key];
  }
};

const createPlaywrightObservationCounters = (): PlaywrightObservationCounters => ({
  browserObjects: { seen: 0 },
  contexts: { seen: 0, instrumented: 0 },
  pages: { seen: 0, instrumented: 0, storageCapable: 0 },
  events: { navigations: 0, network: 0, console: 0 },
});

const parsePlaywrightObservationCounters = (
  value: unknown,
): PlaywrightObservationCounters | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["browserObjects", "contexts", "pages", "events"]) ||
    !hasNonNegativeCounts(value.browserObjects, ["seen"]) ||
    !hasNonNegativeCounts(value.contexts, ["seen", "instrumented"]) ||
    !hasNonNegativeCounts(value.pages, ["seen", "instrumented", "storageCapable"]) ||
    !hasNonNegativeCounts(value.events, ["navigations", "network", "console"])
  ) {
    return undefined;
  }
  const browserObjects = value.browserObjects as PlaywrightObservationCounters["browserObjects"];
  const contexts = value.contexts as PlaywrightObservationCounters["contexts"];
  const pages = value.pages as PlaywrightObservationCounters["pages"];
  const events = value.events as PlaywrightObservationCounters["events"];
  if (
    contexts.instrumented > contexts.seen ||
    pages.instrumented > pages.seen ||
    pages.storageCapable > pages.seen
  ) {
    return undefined;
  }
  return {
    browserObjects: { ...browserObjects },
    contexts: { ...contexts },
    pages: { ...pages },
    events: { ...events },
  };
};

const addPlaywrightObservationCounters = (
  target: PlaywrightObservationCounters,
  coverage: PlaywrightObservationCounters,
): void => {
  target.browserObjects.seen += coverage.browserObjects.seen;
  target.contexts.seen += coverage.contexts.seen;
  target.contexts.instrumented += coverage.contexts.instrumented;
  target.pages.seen += coverage.pages.seen;
  target.pages.instrumented += coverage.pages.instrumented;
  target.pages.storageCapable += coverage.pages.storageCapable;
  target.events.navigations += coverage.events.navigations;
  target.events.network += coverage.events.network;
  target.events.console += coverage.events.console;
};

const createObservationCoverageReport = (input: {
  counters: PlaywrightObservationCounters;
  diagnostics: number;
  observerFinalizationIncomplete: boolean;
  nonPassingAttempts: number;
  observedAttempts: number;
  responseCoverage: FirstPartyJsonResponseReportCoverage;
  result: FullResult;
  testCounts: TestAttemptCounts;
  unavailableAttachments: number;
  browserEngines: BrowserEngineReportCoverage;
  apiRequests: APIRequestReportCoverage;
}): ObservationCoverageReport => {
  const diagnostics: ObservationCoverageDiagnostic[] = [];
  const unsupported =
    input.counters.contexts.instrumented < input.counters.contexts.seen ||
    input.counters.pages.instrumented < input.counters.pages.seen;
  if (unsupported) {
    diagnostics.push({
      code: "COVERAGE_UNSUPPORTED_CONTEXT",
      message:
        "One or more BrowserContexts or pages were created outside the PrivacySpec-instrumented test context.",
    });
  }
  if (input.unavailableAttachments > 0) {
    diagnostics.push({
      code: "COVERAGE_RESULT_UNAVAILABLE",
      message: "One or more observed test results did not contain current coverage counters.",
    });
  }
  if (input.browserEngines.tests.unavailable > 0 || input.apiRequests.tests.unavailable > 0) {
    diagnostics.push({
      code: "COVERAGE_RESULT_UNAVAILABLE",
      message: "One or more observed test results did not contain current experimental coverage.",
    });
  }
  if (input.browserEngines.tests.unsupported > 0) {
    diagnostics.push({
      code: "COVERAGE_UNSUPPORTED_BROWSER_ENGINE",
      message: "One or more tests used Firefox or WebKit without the explicit experimental gate.",
    });
  }
  const testedBrowserCapabilityStates = Object.values(input.browserEngines.engines).flatMap(
    (engine) => (engine.tests > 0 ? Object.values(engine.capabilities) : []),
  );
  if (testedBrowserCapabilityStates.some((state) => state !== "complete")) {
    diagnostics.push({
      code: "COVERAGE_BROWSER_ENGINE_CAPABILITY_LIMITED",
      message:
        "One or more browser-engine capabilities were partial, incomplete, disabled, or unsupported.",
    });
  }
  if (input.apiRequests.tests.partial > 0) {
    diagnostics.push({
      code: "COVERAGE_API_REQUEST_PARTIAL",
      message:
        "Observed request-fixture calls have partial coverage because implicit headers, authentication, cookies, and redirect hops are unavailable.",
    });
  }
  if (input.apiRequests.tests.unsupported > 0) {
    diagnostics.push({
      code: "COVERAGE_API_REQUEST_UNSUPPORTED",
      message: "The composed request fixture was used without the explicit API observation gate.",
    });
  }
  if (input.observerFinalizationIncomplete) {
    diagnostics.push({
      code: "COVERAGE_OBSERVER_FINALIZATION_INCOMPLETE",
      message: "Bounded observer finalization did not complete before analysis.",
    });
  }
  if (
    input.result.status !== "passed" ||
    input.nonPassingAttempts > 0 ||
    input.observedAttempts !== input.testCounts.total
  ) {
    diagnostics.push({
      code: "COVERAGE_TEST_SCOPE_INCOMPLETE",
      message: "The executed Playwright test scope did not produce complete observation evidence.",
    });
  }
  if (input.observedAttempts > 0 && input.counters.pages.seen === 0) {
    diagnostics.push({
      code: "COVERAGE_NO_PAGES",
      message: "Tests ran, but no browser page was observed for secondary analysis.",
    });
  }
  const totalRuntimeEvents =
    input.counters.events.navigations +
    input.counters.events.network +
    input.counters.events.console;
  if (input.observedAttempts >= 5 && input.counters.pages.seen > 0 && totalRuntimeEvents === 0) {
    diagnostics.push({
      code: "COVERAGE_NO_RUNTIME_EVENTS",
      message:
        "Multiple tests ran with pages, but no navigation, network, or console event was observed.",
    });
  }
  if (input.diagnostics > 0) {
    diagnostics.push({
      code: "COVERAGE_LIMIT_REACHED",
      message: "A bounded observer or correlation limit was reached during the run.",
    });
  }
  const optionalSkips = Object.values(input.responseCoverage.skipped).reduce(
    (total, count) => total + count,
    0,
  );
  if (input.responseCoverage.tests.enabled > 0 && optionalSkips > 0) {
    diagnostics.push({
      code: "COVERAGE_OPTIONAL_OBSERVER_SKIPPED",
      message: "The optional first-party JSON response observer skipped bounded work.",
    });
  }

  const incomplete = diagnostics.some((diagnostic) =>
    [
      "COVERAGE_NO_PAGES",
      "COVERAGE_NO_RUNTIME_EVENTS",
      "COVERAGE_OBSERVER_FINALIZATION_INCOMPLETE",
      "COVERAGE_RESULT_UNAVAILABLE",
      "COVERAGE_TEST_SCOPE_INCOMPLETE",
    ].includes(diagnostic.code),
  );
  const partial = diagnostics.some((diagnostic) =>
    [
      "COVERAGE_LIMIT_REACHED",
      "COVERAGE_OPTIONAL_OBSERVER_SKIPPED",
      "COVERAGE_API_REQUEST_PARTIAL",
    ].includes(diagnostic.code),
  );
  const engineCapabilityUnsupported = testedBrowserCapabilityStates.includes("unsupported");
  const engineCapabilityIncomplete = testedBrowserCapabilityStates.includes("incomplete");
  const engineCapabilityPartial = testedBrowserCapabilityStates.some(
    (state) => state === "partial" || state === "disabled",
  );
  const status =
    unsupported ||
    engineCapabilityUnsupported ||
    input.browserEngines.tests.unsupported > 0 ||
    input.apiRequests.tests.unsupported > 0
      ? "unsupported"
      : incomplete || engineCapabilityIncomplete
        ? "incomplete"
        : partial || engineCapabilityPartial
          ? "partial"
          : "complete";

  return {
    status,
    tests: { attempts: input.testCounts.total, observed: input.observedAttempts },
    browserObjects: { ...input.counters.browserObjects },
    contexts: { ...input.counters.contexts },
    pages: { ...input.counters.pages },
    events: { ...input.counters.events },
    diagnostics,
  };
};

const addNetworkCoverage = (
  target: NetworkObservationReportCoverage,
  coverage: NetworkObservationCoverage,
): void => {
  target.requests.seen += coverage.requests.seen;
  target.requests.accepted += coverage.requests.accepted;
  target.requests.filteredLowValueStatic += coverage.requests.filteredLowValueStatic;
};

const addPlaywrightCoverage = (
  target: PlaywrightInstrumentationReportCoverage,
  coverage: PlaywrightInstrumentationCoverage | undefined,
): void => {
  if (coverage === undefined) {
    target.tests.unavailable += 1;
    return;
  }
  target.tests[coverage.applicationContexts === 0 ? "incompatible" : "compatible"] += 1;
  target.applicationContexts += coverage.applicationContexts;
  target.pages += coverage.pages;
};

export default class PrivacySpecReporter implements Reporter {
  readonly #write: (message: string) => void;
  readonly #baselinePath: string | false;
  #latestRunPath: string | false;
  #reportPath: string | false;
  readonly #dependencyBaselinePath: string | false;
  #dependencyLatestRunPath: string | false;
  #dependencyReportPath: string | false;
  readonly #securityBaselinePath: string | false;
  #securityLatestRunPath: string | false;
  #securityReportPath: string | false;
  readonly #runtimeFailureBaselinePath: string | false;
  #runtimeFailureLatestRunPath: string | false;
  #runtimeFailureReportPath: string | false;
  readonly #failOnNewReviewFindings: boolean;
  readonly #nis2EvidenceProfile: boolean;
  readonly #runScopeOptions: PrivacySpecRunScopeOptions | undefined;
  #runScope: ResolvedPrivacySpecRunScope | undefined;
  #shardScopeMissing = false;
  #observedAttempts = 0;
  #nonPassingAttempts = 0;
  readonly #sourceCounts = new Map<string, number>();
  readonly #sinkCounts = new Map<string, number>();
  readonly #flows = new Map<string, DataFlow>();
  readonly #findings = new Map<string, Finding>();
  readonly #diagnostics = new Map<string, InformationalDiagnostic>();
  #observerFinalizationIncomplete = false;
  readonly #responseCoverage = createReportResponseCoverage();
  readonly #playwrightCoverage = createReportPlaywrightCoverage();
  readonly #networkCoverage = createReportNetworkCoverage();
  readonly #browserEngineCoverage = createReportBrowserEngineCoverage();
  readonly #apiRequestCoverage = createReportAPIRequestCoverage();
  readonly #observationCounters = createPlaywrightObservationCounters();
  #observationCoverageUnavailable = 0;
  readonly #classifierConfigurations = new Map<string, ClassifierConfigurationState>();
  readonly #testDataObservations = new Map<string, TestDataObservation>();
  readonly #dependencyInventory = new Map<string, RuntimeDependencyInventoryEntry>();
  readonly #dependencyDiagnostics = new Map<string, DependencyDiagnostic>();
  #dependencyAttachments = 0;
  #dependencyCoverage: DependencyCoverageStatus = "complete";
  readonly #securityInventory = new Map<string, SecurityPostureInventoryEntry>();
  readonly #securityDiagnostics = new Map<string, SecurityDiagnostic>();
  #securityAttachments = 0;
  #securityCoverage: SecurityCoverageStatus = "complete";
  readonly #runtimeFailureInventory = new Map<string, RuntimeFailureInventoryEntry>();
  readonly #runtimeFailureDiagnostics = new Map<string, RuntimeFailureDiagnostic>();
  #runtimeFailureAttachments = 0;
  #runtimeFailureCoverage: RuntimeFailureCoverageStatus = "complete";
  readonly #integrationErrors: string[] = [];
  readonly #projectNames = new Set<string>();
  readonly #testCounts = createTestAttemptCounts();
  #cumulativeTestDurationMilliseconds = 0;

  constructor(options: PrivacySpecReporterOptions = {}) {
    this.#write = options.write ?? ((message) => process.stdout.write(message));
    this.#runScopeOptions = options.runScope;
    const writesRunPart = this.#runScopeOptions !== undefined;
    // `write` is an internal test seam; callers that replace terminal output do
    // not persist artifacts unless they also opt into explicit paths.
    this.#baselinePath = writesRunPart
      ? false
      : (options.baselinePath ?? (options.write === undefined ? DEFAULT_BASELINE_PATH : false));
    this.#latestRunPath = writesRunPart
      ? false
      : (options.latestRunPath ?? (options.write === undefined ? DEFAULT_LATEST_RUN_PATH : false));
    this.#reportPath = writesRunPart
      ? false
      : (options.reportPath ?? (options.write === undefined ? DEFAULT_REPORT_PATH : false));
    this.#dependencyBaselinePath = writesRunPart
      ? false
      : (options.dependencies?.baselinePath ??
        (options.write === undefined ? DEFAULT_DEPENDENCY_BASELINE_PATH : false));
    this.#dependencyLatestRunPath = writesRunPart
      ? false
      : (options.dependencies?.latestRunPath ??
        (options.write === undefined ? DEFAULT_DEPENDENCY_LATEST_RUN_PATH : false));
    this.#dependencyReportPath = writesRunPart
      ? false
      : (options.dependencies?.reportPath ??
        (options.write === undefined ? DEFAULT_DEPENDENCY_REPORT_PATH : false));
    this.#securityBaselinePath = writesRunPart
      ? false
      : (options.security?.baselinePath ??
        (options.write === undefined ? DEFAULT_SECURITY_BASELINE_PATH : false));
    this.#securityLatestRunPath = writesRunPart
      ? false
      : (options.security?.latestRunPath ??
        (options.write === undefined ? DEFAULT_SECURITY_LATEST_RUN_PATH : false));
    this.#securityReportPath = writesRunPart
      ? false
      : (options.security?.reportPath ??
        (options.write === undefined ? DEFAULT_SECURITY_REPORT_PATH : false));
    this.#runtimeFailureBaselinePath = writesRunPart
      ? false
      : (options.runtimeFailures?.baselinePath ??
        (options.write === undefined ? DEFAULT_RUNTIME_FAILURE_BASELINE_PATH : false));
    this.#runtimeFailureLatestRunPath = writesRunPart
      ? false
      : (options.runtimeFailures?.latestRunPath ??
        (options.write === undefined ? DEFAULT_RUNTIME_FAILURE_LATEST_RUN_PATH : false));
    this.#runtimeFailureReportPath = writesRunPart
      ? false
      : (options.runtimeFailures?.reportPath ??
        (options.write === undefined ? DEFAULT_RUNTIME_FAILURE_REPORT_PATH : false));
    // Phase 8 policy decision A: new contextual review findings warn by default.
    this.#failOnNewReviewFindings = options.failOnNewReviewFindings ?? false;
    this.#nis2EvidenceProfile = options.profiles?.nis2_2024_2690 === true;
  }

  onBegin(config?: FullConfig): void {
    for (const project of config?.projects ?? []) {
      if (isBoundedTerminalString(project.name, MAX_TEST_PROJECT_LENGTH)) {
        this.#projectNames.add(project.name);
      }
    }
    if (
      this.#runScopeOptions === undefined &&
      config?.shard !== null &&
      config?.shard !== undefined
    ) {
      this.#shardScopeMissing = true;
      this.#latestRunPath = false;
      this.#reportPath = false;
      this.#dependencyLatestRunPath = false;
      this.#dependencyReportPath = false;
      this.#securityLatestRunPath = false;
      this.#securityReportPath = false;
      this.#runtimeFailureLatestRunPath = false;
      this.#runtimeFailureReportPath = false;
      this.#integrationErrors.push(
        "Playwright sharding requires an explicit PrivacySpec runScope; single-writer outputs were disabled",
      );
    }
    if (this.#runScopeOptions !== undefined) {
      const { runId, configurationId, outputDirectory } = this.#runScopeOptions;
      const explicitPart = this.#runScopeOptions.part;
      const explicitTotal = this.#runScopeOptions.total;
      const shard = config?.shard ?? undefined;
      if (
        outputDirectory !== undefined &&
        (!isBoundedTerminalString(outputDirectory, MAX_ENDPOINT_LENGTH, false) ||
          (!isAbsolute(outputDirectory) && outputDirectory.split(/[\\/]+/u).includes("..")))
      ) {
        this.#integrationErrors.push("invalid run-scope output directory");
      } else if (!isRunScopeIdentifier(runId) || !isRunScopeIdentifier(configurationId)) {
        this.#integrationErrors.push(
          "invalid run-scope identity; use 1-128 ASCII letters, digits, dots, underscores, or hyphens",
        );
      } else if ((explicitPart === undefined) !== (explicitTotal === undefined)) {
        this.#integrationErrors.push("run-scope part and total must be supplied together");
      } else {
        const part = explicitPart ?? shard?.current ?? 1;
        const total = explicitTotal ?? shard?.total ?? 1;
        if (
          !Number.isSafeInteger(part) ||
          !Number.isSafeInteger(total) ||
          part < 1 ||
          total < 1 ||
          part > total ||
          total > MAX_RUN_PARTS
        ) {
          this.#integrationErrors.push("run-scope coordinates must identify a part within 1..128");
        } else if (
          shard !== undefined &&
          (explicitPart !== undefined || explicitTotal !== undefined) &&
          (part !== shard.current || total !== shard.total)
        ) {
          this.#integrationErrors.push(
            "run-scope coordinates do not match Playwright shard metadata",
          );
        } else {
          const directory = join(outputDirectory ?? DEFAULT_RUN_PARTS_DIRECTORY, runId);
          this.#runScope = {
            runId,
            configurationId,
            part,
            total,
            outputPath: join(directory, `part-${part}-of-${total}.json`),
          };
        }
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
    if (this.#dependencyLatestRunPath !== false) {
      try {
        invalidateDependencyLatestRunFile(this.#dependencyLatestRunPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate dependency latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#securityLatestRunPath !== false) {
      try {
        invalidateSecurityLatestRunFile(this.#securityLatestRunPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate security posture latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#runtimeFailureLatestRunPath !== false) {
      try {
        invalidateRuntimeFailureLatestRunFile(this.#runtimeFailureLatestRunPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate runtime failure latest-run artifact (${terminalErrorMessage(error)})`,
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
    if (this.#dependencyReportPath !== false) {
      try {
        removeDependencyReportSync(this.#dependencyReportPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate dependency report (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#securityReportPath !== false) {
      try {
        removeSecurityReportSync(this.#securityReportPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate security posture report (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#runtimeFailureReportPath !== false) {
      try {
        removeRuntimeFailureReportSync(this.#runtimeFailureReportPath);
      } catch (error) {
        this.#integrationErrors.push(
          `could not invalidate runtime failure report (${terminalErrorMessage(error)})`,
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
    const dependencyAttachments = result.attachments.filter(
      (attachment) => attachment.name === DEPENDENCY_ATTACHMENT_NAME,
    );
    const securityAttachments = result.attachments.filter(
      (attachment) => attachment.name === SECURITY_ATTACHMENT_NAME,
    );
    const runtimeFailureAttachments = result.attachments.filter(
      (attachment) => attachment.name === RUNTIME_FAILURE_ATTACHMENT_NAME,
    );

    if (dependencyAttachments.length > 1) {
      this.#integrationErrors.push(
        `${testTitle}: expected at most one ${DEPENDENCY_ATTACHMENT_NAME} attachment, received ${dependencyAttachments.length}`,
      );
    } else if (dependencyAttachments.length === 1) {
      const dependencyAttachment = dependencyAttachments[0];
      if (
        dependencyAttachment === undefined ||
        dependencyAttachment.contentType !== DEPENDENCY_ATTACHMENT_CONTENT_TYPE ||
        dependencyAttachment.body === undefined
      ) {
        this.#integrationErrors.push(
          `${testTitle}: dependency analyzer attachment is not inline JSON`,
        );
      } else {
        try {
          const dependency = parseDependencyAttachment(
            JSON.parse(dependencyAttachment.body.toString("utf8")),
          );
          if (dependency === undefined) throw new Error("unsupported dependency result schema");
          const suiteLimitReached = mergeDependencyInventory(
            this.#dependencyInventory,
            dependency.inventory,
          );
          if (suiteLimitReached) {
            const diagnostic: DependencyDiagnostic = {
              code: "DEPENDENCY_LIMIT_REACHED",
              message: "Runtime dependency analysis reached the per-run origin safety limit.",
            };
            this.#dependencyDiagnostics.set(diagnostic.code, diagnostic);
            this.#dependencyCoverage = leastCompleteDependencyCoverage(
              this.#dependencyCoverage,
              "partial",
            );
          }
          this.#dependencyCoverage = leastCompleteDependencyCoverage(
            this.#dependencyCoverage,
            dependency.coverage,
          );
          for (const diagnostic of dependency.diagnostics) {
            this.#dependencyDiagnostics.set(diagnostic.code, diagnostic);
          }
          this.#dependencyAttachments += 1;
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : "unknown parse error";
          const message = terminalLabel(rawMessage, MAX_DIAGNOSTIC_MESSAGE_LENGTH, "parse error");
          this.#integrationErrors.push(
            `${testTitle}: invalid dependency analyzer attachment (${message})`,
          );
        }
      }
    }

    if (securityAttachments.length > 1) {
      this.#integrationErrors.push(
        `${testTitle}: expected at most one ${SECURITY_ATTACHMENT_NAME} attachment, received ${securityAttachments.length}`,
      );
    } else if (securityAttachments.length === 1) {
      const attachment = securityAttachments[0];
      if (
        attachment === undefined ||
        attachment.contentType !== SECURITY_ATTACHMENT_CONTENT_TYPE ||
        attachment.body === undefined
      ) {
        this.#integrationErrors.push(
          `${testTitle}: security posture analyzer attachment is not inline JSON`,
        );
      } else {
        try {
          const security = parseSecurityAttachment(JSON.parse(attachment.body.toString("utf8")));
          if (security === undefined) throw new Error("unsupported security posture result schema");
          if (mergeSecurityInventory(this.#securityInventory, security.inventory)) {
            const diagnostic: SecurityDiagnostic = {
              code: "SECURITY_LIMIT_REACHED",
              message: "Security posture analysis reached the per-run target safety limit.",
            };
            this.#securityDiagnostics.set(diagnostic.code, diagnostic);
            this.#securityCoverage = leastCompleteSecurityCoverage(
              this.#securityCoverage,
              "partial",
            );
          }
          this.#securityCoverage = leastCompleteSecurityCoverage(
            this.#securityCoverage,
            security.coverage,
          );
          for (const diagnostic of security.diagnostics) {
            this.#securityDiagnostics.set(diagnostic.code, diagnostic);
          }
          this.#securityAttachments += 1;
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : "unknown parse error";
          const message = terminalLabel(rawMessage, MAX_DIAGNOSTIC_MESSAGE_LENGTH, "parse error");
          this.#integrationErrors.push(
            `${testTitle}: invalid security posture analyzer attachment (${message})`,
          );
        }
      }
    }

    if (runtimeFailureAttachments.length > 1) {
      this.#integrationErrors.push(
        `${testTitle}: expected at most one ${RUNTIME_FAILURE_ATTACHMENT_NAME} attachment, received ${runtimeFailureAttachments.length}`,
      );
    } else if (runtimeFailureAttachments.length === 1) {
      const attachment = runtimeFailureAttachments[0];
      if (
        attachment === undefined ||
        attachment.contentType !== RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE ||
        attachment.body === undefined
      ) {
        this.#integrationErrors.push(
          `${testTitle}: runtime failure analyzer attachment is not inline JSON`,
        );
      } else {
        try {
          const runtimeFailure = parseRuntimeFailureAttachment(
            JSON.parse(attachment.body.toString("utf8")),
          );
          if (runtimeFailure === undefined) {
            throw new Error("unsupported runtime failure result schema");
          }
          if (
            mergeRuntimeFailureInventory(this.#runtimeFailureInventory, runtimeFailure.inventory)
          ) {
            const diagnostic: RuntimeFailureDiagnostic = {
              code: "RUNTIME_FAILURE_LIMIT_REACHED",
              message: "Runtime failure analysis reached the per-run identity safety limit.",
            };
            this.#runtimeFailureDiagnostics.set(diagnostic.code, diagnostic);
            this.#runtimeFailureCoverage = leastCompleteRuntimeFailureCoverage(
              this.#runtimeFailureCoverage,
              "partial",
            );
          }
          this.#runtimeFailureCoverage = leastCompleteRuntimeFailureCoverage(
            this.#runtimeFailureCoverage,
            runtimeFailure.coverage,
          );
          for (const diagnostic of runtimeFailure.diagnostics) {
            this.#runtimeFailureDiagnostics.set(diagnostic.code, diagnostic);
          }
          this.#runtimeFailureAttachments += 1;
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : "unknown parse error";
          const message = terminalLabel(rawMessage, MAX_DIAGNOSTIC_MESSAGE_LENGTH, "parse error");
          this.#integrationErrors.push(
            `${testTitle}: invalid runtime failure analyzer attachment (${message})`,
          );
        }
      }
    }

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
      const raw: unknown = JSON.parse(attachment.body.toString("utf8"));
      const parsed = parsePrivacySpecResult(raw);
      if (parsed === undefined) throw new Error(getPrivacySpecResultValidationError(raw));
      const responseCoverage =
        parsed.schemaVersion === 1
          ? undefined
          : parseResponseJsonCoverage(parsed.coverage.firstPartyJsonResponses);
      if (parsed.schemaVersion !== 1 && responseCoverage === undefined) {
        throw new Error("invalid response-source coverage");
      }
      const playwrightCoverage =
        parsed.schemaVersion === 1
          ? undefined
          : parsePlaywrightCoverage(parsed.coverage.playwright);
      if (parsed.schemaVersion !== 1 && playwrightCoverage === undefined) {
        throw new Error("invalid Playwright instrumentation coverage");
      }
      const networkCoverage =
        parsed.schemaVersion === 1 ? undefined : parseNetworkCoverage(parsed.coverage.network);
      if (parsed.schemaVersion !== 1 && networkCoverage === undefined) {
        throw new Error("invalid network observation coverage");
      }
      const observationCoverage =
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION ||
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V4 ||
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V3
          ? parsePlaywrightObservationCounters(parsed.coverage.observation)
          : undefined;
      if (
        (parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION ||
          parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V4 ||
          parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V3) &&
        observationCoverage === undefined
      ) {
        throw new Error("invalid observation coverage counters");
      }
      const browserEngineCoverage =
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION ||
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V4
          ? parseBrowserEngineCoverage(parsed.coverage.browserEngine)
          : undefined;
      if (
        (parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION ||
          parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V4) &&
        browserEngineCoverage === undefined
      ) {
        throw new Error("invalid browser-engine coverage");
      }
      const apiRequestCoverage =
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION ||
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V4
          ? parseAPIRequestCoverage(parsed.coverage.apiRequests)
          : undefined;
      if (
        (parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION ||
          parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V4) &&
        apiRequestCoverage === undefined
      ) {
        throw new Error("invalid API-request coverage");
      }
      const testData =
        parsed.schemaVersion === 1 || parsed.testData === undefined
          ? undefined
          : parseTestDataAttachment(parsed.testData);
      if (parsed.schemaVersion !== 1 && parsed.testData !== undefined && testData === undefined) {
        throw new Error("invalid test-data hygiene section");
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
            if (
              diagnostic.code === "PS_ANALYZER_PRIVACY_FAILED" ||
              diagnostic.code === "PS_OBSERVER_FINALIZATION_FAILED" ||
              diagnostic.code === "PS_OBSERVER_FINALIZATION_TIMEOUT"
            ) {
              this.#observerFinalizationIncomplete = true;
            }
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
          isDataCategory(observation.category)
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
      if (responseCoverage === undefined) this.#responseCoverage.tests.unavailable += 1;
      else addResponseCoverage(this.#responseCoverage, responseCoverage);
      addPlaywrightCoverage(this.#playwrightCoverage, playwrightCoverage);
      if (networkCoverage !== undefined) addNetworkCoverage(this.#networkCoverage, networkCoverage);
      if (observationCoverage === undefined) this.#observationCoverageUnavailable += 1;
      else addPlaywrightObservationCounters(this.#observationCounters, observationCoverage);
      addBrowserEngineCoverage(this.#browserEngineCoverage, browserEngineCoverage);
      addAPIRequestCoverage(this.#apiRequestCoverage, apiRequestCoverage);
      for (const observation of testData?.observations ?? []) {
        this.#testDataObservations.set(JSON.stringify(observation), observation);
      }
      const classifierConfiguration: ClassifierConfigurationState =
        parsed.schemaVersion === ATTACHMENT_SCHEMA_VERSION
          ? parsed.classifierConfiguration
          : UNAVAILABLE_CLASSIFIER_CONFIGURATION;
      this.#classifierConfigurations.set(
        JSON.stringify(classifierConfiguration),
        structuredClone(classifierConfiguration),
      );
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
    let acceptedBaselineFlows: BaselineFlow[] = [];
    const classifierConfiguration: ClassifierConfigurationState =
      this.#classifierConfigurations.size === 1
        ? structuredClone(
            Array.from(this.#classifierConfigurations.values())[0] ??
              UNAVAILABLE_CLASSIFIER_CONFIGURATION,
          )
        : this.#classifierConfigurations.size === 0 && this.#testCounts.total === 0
          ? BUILTIN_ONLY_CLASSIFIER_CONFIGURATION
          : UNAVAILABLE_CLASSIFIER_CONFIGURATION;
    let classifierConfigurationCompatible = classifierConfiguration.mode !== "unavailable";

    const observationCoverage = createObservationCoverageReport({
      counters: this.#observationCounters,
      diagnostics: this.#diagnostics.size,
      observerFinalizationIncomplete: this.#observerFinalizationIncomplete,
      nonPassingAttempts: this.#nonPassingAttempts,
      observedAttempts: this.#observedAttempts,
      responseCoverage: this.#responseCoverage,
      result,
      testCounts: this.#testCounts,
      unavailableAttachments: this.#observationCoverageUnavailable,
      browserEngines: this.#browserEngineCoverage,
      apiRequests: this.#apiRequestCoverage,
    });
    const timingAvailable = hasRunTiming(result);
    const terminalDetails: string[] = [];
    const writeDetail = (message: string): void => {
      if (timingAvailable) terminalDetails.push(message);
      else this.#write(message);
    };
    if (observationCoverage.status === "unsupported") {
      const entirelyUninstrumentedApplication =
        observationCoverage.pages.seen > 0 && observationCoverage.pages.instrumented === 0;
      this.#integrationErrors.push(
        this.#browserEngineCoverage.tests.unsupported > 0
          ? "COVERAGE_UNSUPPORTED_BROWSER_ENGINE: Firefox or WebKit tests require the explicit PrivacySpec experimental browserEngines gate."
          : this.#apiRequestCoverage.tests.unsupported > 0
            ? "COVERAGE_UNSUPPORTED_API_REQUEST: the composed Playwright request fixture was used without the explicit PrivacySpec apiRequestContext gate."
            : entirelyUninstrumentedApplication
              ? `COVERAGE_INCOMPATIBLE: ${this.#observedAttempts} Playwright tests ran but no application BrowserContexts were instrumented. Tests may be creating pages through browser.newPage() or independent browser contexts.`
              : `COVERAGE_INCOMPATIBLE: PrivacySpec detected application BrowserContexts or pages outside the instrumented test context (${observationCoverage.contexts.instrumented}/${observationCoverage.contexts.seen} contexts, ${observationCoverage.pages.instrumented}/${observationCoverage.pages.seen} pages instrumented).`,
      );
    }

    if (this.#baselinePath !== false) {
      try {
        const baseline = await readBaselineFile(this.#baselinePath);
        baselineExists = baseline !== undefined;
        acceptedBaselineFlows = baseline?.flows ?? [];
        comparison = compareBaseline(findings, baseline);
        if (baseline !== undefined) {
          const baselineClassifierConfiguration = classifierConfigurationForBaseline(baseline);
          classifierConfigurationCompatible =
            classifierConfigurationCompatible &&
            baselineClassifierConfiguration.mode !== "unavailable" &&
            classifierConfigurationsEqual(classifierConfiguration, baselineClassifierConfiguration);
        }
      } catch (error) {
        this.#integrationErrors.push(
          `could not read semantic baseline (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (!classifierConfigurationCompatible) {
      comparison = {
        observed: comparison.observed,
        known: [],
        new: [],
        resolved: [],
      };
      if (this.#observedAttempts > 0) {
        writeDetail(
          "PrivacySpec classifier configuration: unavailable or incompatible; privacy baseline comparison suppressed.\n",
        );
      }
    }

    const dependencyInventory = sortedDependencyInventory(this.#dependencyInventory);
    let dependencyCoverage: DependencyCoverageStatus | "unavailable" =
      this.#dependencyAttachments === 0 ? "unavailable" : this.#dependencyCoverage;
    if (
      dependencyCoverage !== "unavailable" &&
      this.#dependencyAttachments < this.#observedAttempts
    ) {
      dependencyCoverage = leastCompleteDependencyCoverage(dependencyCoverage, "incomplete");
    }
    if (
      dependencyCoverage !== "unavailable" &&
      (result.status !== "passed" ||
        this.#nonPassingAttempts > 0 ||
        this.#observedAttempts !== this.#testCounts.total)
    ) {
      dependencyCoverage = leastCompleteDependencyCoverage(dependencyCoverage, "incomplete");
    }
    let dependencyBaselineExists = false;
    let dependencyComparison = compareDependencyBaseline(dependencyInventory);
    if (this.#dependencyBaselinePath !== false) {
      try {
        const dependencyBaseline = await readDependencyBaselineFile(this.#dependencyBaselinePath);
        dependencyBaselineExists = dependencyBaseline !== undefined;
        dependencyComparison = compareDependencyBaseline(dependencyInventory, dependencyBaseline);
      } catch (error) {
        this.#integrationErrors.push(
          `could not read dependency baseline (${terminalErrorMessage(error)})`,
        );
      }
    }

    const securityInventory = sortedSecurityInventory(this.#securityInventory);
    let securityCoverage: SecurityCoverageStatus | "unavailable" =
      this.#securityAttachments === 0 ? "unavailable" : this.#securityCoverage;
    if (securityCoverage !== "unavailable" && this.#securityAttachments < this.#observedAttempts) {
      securityCoverage = leastCompleteSecurityCoverage(securityCoverage, "incomplete");
    }
    if (
      securityCoverage !== "unavailable" &&
      (result.status !== "passed" ||
        this.#nonPassingAttempts > 0 ||
        this.#observedAttempts !== this.#testCounts.total)
    ) {
      securityCoverage = leastCompleteSecurityCoverage(securityCoverage, "incomplete");
    }
    let securityBaselineExists = false;
    let securityComparison = compareSecurityBaseline(securityInventory);
    if (this.#securityBaselinePath !== false) {
      try {
        const baseline = await readSecurityBaselineFile(this.#securityBaselinePath);
        securityBaselineExists = baseline !== undefined;
        securityComparison = compareSecurityBaseline(securityInventory, baseline);
      } catch (error) {
        this.#integrationErrors.push(
          `could not read security posture baseline (${terminalErrorMessage(error)})`,
        );
      }
    }

    const runtimeFailureInventory = sortedRuntimeFailureInventory(this.#runtimeFailureInventory);
    let runtimeFailureCoverage: RuntimeFailureCoverageStatus | "unavailable" =
      this.#runtimeFailureAttachments === 0 ? "unavailable" : this.#runtimeFailureCoverage;
    if (
      runtimeFailureCoverage !== "unavailable" &&
      this.#runtimeFailureAttachments < this.#observedAttempts
    ) {
      runtimeFailureCoverage = leastCompleteRuntimeFailureCoverage(
        runtimeFailureCoverage,
        "incomplete",
      );
    }
    if (
      runtimeFailureCoverage !== "unavailable" &&
      (result.status !== "passed" ||
        this.#nonPassingAttempts > 0 ||
        this.#observedAttempts !== this.#testCounts.total)
    ) {
      runtimeFailureCoverage = leastCompleteRuntimeFailureCoverage(
        runtimeFailureCoverage,
        "incomplete",
      );
    }
    let runtimeFailureBaselineExists = false;
    let runtimeFailureComparison = compareRuntimeFailureBaseline(runtimeFailureInventory);
    if (this.#runtimeFailureBaselinePath !== false) {
      try {
        const baseline = await readRuntimeFailureBaselineFile(this.#runtimeFailureBaselinePath);
        runtimeFailureBaselineExists = baseline !== undefined;
        runtimeFailureComparison = compareRuntimeFailureBaseline(runtimeFailureInventory, baseline);
      } catch (error) {
        this.#integrationErrors.push(
          `could not read runtime failure baseline (${terminalErrorMessage(error)})`,
        );
      }
    }

    if (this.#runScopeOptions !== undefined || this.#shardScopeMissing) {
      comparison = {
        observed: comparison.observed,
        known: [],
        new: [],
        resolved: [],
      };
      dependencyComparison = {
        ...dependencyComparison,
        known: [],
        new: [],
        resolved: [],
        findings: [],
      };
      securityComparison = {
        ...securityComparison,
        known: [],
        newTargets: [],
        changed: [],
        resolved: [],
        findings: [],
      };
      runtimeFailureComparison = {
        ...runtimeFailureComparison,
        known: [],
        new: [],
        resolved: [],
        findings: [],
      };
    }

    const privacyObservationComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      this.#diagnostics.size === 0 &&
      observationCoverage.status === "complete" &&
      !findings.some((finding) => finding.classification === "technical_failure") &&
      this.#integrationErrors.length === 0;
    const runComplete = privacyObservationComplete && classifierConfigurationCompatible;
    const dependencyRunComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      dependencyCoverage === "complete" &&
      this.#dependencyAttachments === this.#observedAttempts &&
      this.#dependencyDiagnostics.size === 0 &&
      this.#integrationErrors.length === 0;
    const securityRunComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      securityCoverage === "complete" &&
      this.#securityAttachments === this.#observedAttempts &&
      this.#securityDiagnostics.size === 0 &&
      this.#integrationErrors.length === 0;
    const runtimeFailureRunComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      runtimeFailureCoverage === "complete" &&
      this.#runtimeFailureAttachments === this.#observedAttempts &&
      this.#runtimeFailureDiagnostics.size === 0 &&
      this.#integrationErrors.length === 0;
    if (this.#latestRunPath !== false) {
      try {
        await writeLatestRunFile(this.#latestRunPath, comparison.observed, {
          complete: privacyObservationComplete && classifierConfiguration.mode !== "unavailable",
          classifierConfiguration,
        });
      } catch (error) {
        this.#integrationErrors.push(
          `could not write latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#dependencyLatestRunPath !== false) {
      try {
        await writeDependencyLatestRunFile(
          this.#dependencyLatestRunPath,
          dependencyComparison.observed,
          { complete: dependencyRunComplete },
        );
      } catch (error) {
        this.#integrationErrors.push(
          `could not write dependency latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#securityLatestRunPath !== false) {
      try {
        await writeSecurityLatestRunFile(this.#securityLatestRunPath, securityComparison.observed, {
          complete: securityRunComplete,
        });
      } catch (error) {
        this.#integrationErrors.push(
          `could not write security posture latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }
    if (this.#runtimeFailureLatestRunPath !== false) {
      try {
        await writeRuntimeFailureLatestRunFile(
          this.#runtimeFailureLatestRunPath,
          runtimeFailureComparison.observed,
          { complete: runtimeFailureRunComplete },
        );
      } catch (error) {
        this.#integrationErrors.push(
          `could not write runtime failure latest-run artifact (${terminalErrorMessage(error)})`,
        );
      }
    }

    if (!timingAvailable) writeDetail(`PrivacySpec observed ${this.#observedAttempts} tests\n`);
    if (this.#sourceCounts.size > 0) {
      const summary = Array.from(this.#sourceCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, count]) => `${category}=${count}`)
        .join(", ");
      writeDetail(`PrivacySpec sources: ${summary}\n`);
    }
    const testDataReviewCount = Array.from(this.#testDataObservations.values()).filter(
      (observation) => observation.verdict === "REVIEW_REQUIRED",
    ).length;
    if (testDataReviewCount > 0) {
      writeDetail(
        `PrivacySpec test-data hygiene: ${testDataReviewCount} review-required observation${testDataReviewCount === 1 ? "" : "s"}; inspect with privacyspec testdata\n`,
      );
    }
    if (this.#responseCoverage.tests.enabled > 0) {
      const skipped = Object.values(this.#responseCoverage.skipped).reduce(
        (total, count) => total + count,
        0,
      );
      writeDetail(
        `PrivacySpec experimental JSON response sources: parsed=${this.#responseCoverage.responses.parsed}, discovered=${this.#responseCoverage.discoveredSources.total}, skipped=${skipped}\n`,
      );
    }
    if (this.#sinkCounts.size > 0) {
      const summary = Array.from(this.#sinkCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sink, count]) => `${sink}=${count}`)
        .join(", ");
      writeDetail(`PrivacySpec sinks: ${summary}\n`);
    }
    if (this.#networkCoverage.requests.filteredLowValueStatic > 0) {
      writeDetail(
        `PrivacySpec network filtering: low-value static requests=${this.#networkCoverage.requests.filteredLowValueStatic}\n`,
      );
    }
    const experimentalEngineTests = this.#browserEngineCoverage.tests.experimental;
    if (experimentalEngineTests > 0) {
      const engines = (["firefox", "webkit"] as const)
        .filter((engine) => this.#browserEngineCoverage.engines[engine].tests > 0)
        .join(",");
      writeDetail(
        `PrivacySpec experimental browser engines: tests=${experimentalEngineTests}, engines=${engines}\n`,
      );
    }
    if (this.#apiRequestCoverage.calls.seen > 0) {
      const skipped = Object.values(this.#apiRequestCoverage.skipped).reduce(
        (total, count) => total + count,
        0,
      );
      writeDetail(
        `PrivacySpec experimental API request fixture: calls=${this.#apiRequestCoverage.calls.seen}, observed=${this.#apiRequestCoverage.calls.observed}, failed=${this.#apiRequestCoverage.calls.failed}, skipped=${skipped}, coverage=${this.#apiRequestCoverage.tests.partial > 0 ? "PARTIAL" : "UNSUPPORTED"}\n`,
      );
    }
    if (this.#flows.size > 0) {
      writeDetail(`PrivacySpec data flows: ${this.#flows.size}\n`);
    }
    if (this.#dependencyAttachments > 0) {
      const externalOrigins = dependencyInventory.filter(
        (entry) => entry.boundary === "external",
      ).length;
      const occurrences = dependencyInventory.reduce(
        (total, entry) => total + entry.occurrenceCount,
        0,
      );
      writeDetail(
        `PrivacySpec runtime dependencies: origins=${dependencyInventory.length}, external=${externalOrigins}, requests=${occurrences}\n`,
      );
      if (!timingAvailable) {
        const status =
          dependencyCoverage !== "complete"
            ? "INCONCLUSIVE"
            : dependencyComparison.new.length > 0
              ? "REVIEW"
              : "PASS";
        writeDetail(
          `PrivacySpec dependency analysis: ${status} (coverage=${dependencyCoverage.toUpperCase()}, known=${dependencyComparison.known.length}, new=${dependencyComparison.new.length}, resolved=${dependencyRunComplete ? dependencyComparison.resolved.length : 0})\n`,
        );
      }
      for (const diagnostic of Array.from(this.#dependencyDiagnostics.values()).sort(
        (left, right) => compareCanonicalStrings(left.code, right.code),
      )) {
        writeDetail(
          `PrivacySpec dependency informational: ${diagnostic.code}: ${diagnostic.message}\n`,
        );
      }
      const visibleFindings = dependencyComparison.findings.slice(
        0,
        MAX_TERMINAL_FINDINGS_PER_MODULE,
      );
      for (const finding of visibleFindings) {
        writeDetail(
          `PrivacySpec dependency review: ${finding.ruleId} ${terminalLabel(finding.origin, MAX_RECIPIENT_ORIGIN_LENGTH, "[unprintable origin]")} as ${finding.observedAs} first observed in ${terminalLabel(finding.firstSeenTest.file, MAX_TEST_FILE_LENGTH, "[unprintable test file]")}\n`,
        );
      }
      if (dependencyComparison.findings.length > visibleFindings.length) {
        writeDetail(
          `PrivacySpec dependency review: ${dependencyComparison.findings.length - visibleFindings.length} additional findings omitted from terminal output\n`,
        );
      }
    }
    if (this.#securityAttachments > 0) {
      if (!timingAvailable) {
        const status =
          securityCoverage !== "complete"
            ? "INCONCLUSIVE"
            : securityComparison.findings.length > 0
              ? "REVIEW"
              : "PASS";
        writeDetail(
          `PrivacySpec security posture: ${status} (coverage=${securityCoverage.toUpperCase()}, targets=${securityInventory.length}, known=${securityComparison.known.length}, changed=${securityComparison.changed.length}, new-targets=${securityComparison.newTargets.length}, resolved=${securityRunComplete ? securityComparison.resolved.length : 0})\n`,
        );
      }
      for (const diagnostic of Array.from(this.#securityDiagnostics.values()).sort((left, right) =>
        compareCanonicalStrings(left.code, right.code),
      )) {
        writeDetail(
          `PrivacySpec security informational: ${diagnostic.code}: ${diagnostic.message}\n`,
        );
      }
      const visibleFindings = securityComparison.findings.slice(
        0,
        MAX_TERMINAL_FINDINGS_PER_MODULE,
      );
      for (const finding of visibleFindings) {
        writeDetail(
          `PrivacySpec security review: ${finding.ruleId} ${terminalLabel(finding.host, MAX_RECIPIENT_ORIGIN_LENGTH, "[unprintable host]")}${terminalLabel(finding.endpoint, MAX_ENDPOINT_LENGTH, "[unprintable endpoint]")} ${finding.previous} -> ${finding.current} first observed in ${terminalLabel(finding.firstSeenTest.file, MAX_TEST_FILE_LENGTH, "[unprintable test file]")}\n`,
        );
        const controls = SECURITY_TECHNICAL_CONTROLS[finding.ruleId];
        writeDetail(
          `PrivacySpec security technical relevance: ${controls.map((control) => `${control.framework} ${control.control} [${control.relationship.toUpperCase()}]`).join(", ")} :: ${controls[0]?.sourceUrl ?? "unavailable"}\n`,
        );
      }
      if (securityComparison.findings.length > visibleFindings.length) {
        writeDetail(
          `PrivacySpec security review: ${securityComparison.findings.length - visibleFindings.length} additional findings omitted from terminal output\n`,
        );
      }
    }
    const actionableRuntimeFindings = runtimeFailureRunComplete
      ? runtimeFailureComparison.findings
      : [];
    const newRuntimeErrors = actionableRuntimeFindings.filter(
      (finding) => finding.severity === "ERROR",
    ).length;
    const newRuntimeReviews = actionableRuntimeFindings.filter(
      (finding) => finding.severity === "REVIEW",
    ).length;
    if (this.#runtimeFailureAttachments > 0) {
      if (!timingAvailable) {
        const status =
          runtimeFailureCoverage !== "complete"
            ? "INCONCLUSIVE"
            : newRuntimeErrors > 0
              ? "FAIL"
              : newRuntimeReviews > 0
                ? "REVIEW"
                : "PASS";
        writeDetail(
          `PrivacySpec runtime failures: ${status} (coverage=${runtimeFailureCoverage.toUpperCase()}, observed=${runtimeFailureInventory.length}, known=${runtimeFailureComparison.known.length}, new=${runtimeFailureRunComplete ? runtimeFailureComparison.new.length : 0}, resolved=${runtimeFailureRunComplete ? runtimeFailureComparison.resolved.length : 0})\n`,
        );
      }
      for (const diagnostic of Array.from(this.#runtimeFailureDiagnostics.values()).sort(
        (left, right) => compareCanonicalStrings(left.code, right.code),
      )) {
        writeDetail(
          `PrivacySpec runtime informational: ${diagnostic.code}: ${diagnostic.message}\n`,
        );
      }
      const visibleFindings = actionableRuntimeFindings.slice(0, MAX_TERMINAL_FINDINGS_PER_MODULE);
      for (const finding of visibleFindings) {
        const target = [
          finding.method,
          finding.host,
          finding.endpoint,
          finding.httpStatus === null ? undefined : String(finding.httpStatus),
          finding.failureCode,
        ]
          .filter((value): value is string => value !== null && value !== undefined)
          .join(" ");
        writeDetail(
          `PrivacySpec runtime ${finding.severity.toLowerCase()}: ${finding.ruleId} ${finding.summary}${target.length > 0 ? ` :: ${target}` : ""} first observed in ${terminalLabel(finding.firstSeenTest.file, MAX_TEST_FILE_LENGTH, "[unprintable test file]")}\n`,
        );
      }
      if (actionableRuntimeFindings.length > visibleFindings.length) {
        writeDetail(
          `PrivacySpec runtime finding: ${actionableRuntimeFindings.length - visibleFindings.length} additional findings omitted from terminal output\n`,
        );
      }
      for (const entry of runtimeFailureRunComplete
        ? runtimeFailureComparison.resolved.slice(0, MAX_TERMINAL_FINDINGS_PER_MODULE)
        : []) {
        writeDetail(`PrivacySpec runtime resolved: ${entry.failureType} ${entry.summary}\n`);
      }
      if (
        runtimeFailureRunComplete &&
        runtimeFailureComparison.resolved.length > MAX_TERMINAL_FINDINGS_PER_MODULE
      ) {
        writeDetail(
          `PrivacySpec runtime resolved: ${runtimeFailureComparison.resolved.length - MAX_TERMINAL_FINDINGS_PER_MODULE} additional resolved identities omitted from terminal output\n`,
        );
      }
    }
    if (this.#diagnostics.size > 0) {
      const diagnostics = Array.from(this.#diagnostics.values()).sort(
        (left, right) =>
          left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
      );
      for (const diagnostic of diagnostics) {
        writeDetail(`PrivacySpec informational: ${diagnostic.code}: ${diagnostic.message}\n`);
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
    const localEvidenceRunComplete =
      result.status === "passed" &&
      this.#observedAttempts > 0 &&
      this.#nonPassingAttempts === 0 &&
      this.#diagnostics.size === 0 &&
      observationCoverage.status === "complete" &&
      this.#integrationErrors.length === 0 &&
      classifierConfigurationCompatible;
    const zeroTestPartComplete =
      this.#runScopeOptions !== undefined &&
      result.status === "passed" &&
      this.#testCounts.total === 0 &&
      this.#integrationErrors.length === 0;
    let evidenceRunComplete =
      this.#runScopeOptions === undefined ? localEvidenceRunComplete : false;
    let resolved = finalRunComplete ? comparison.resolved : [];
    const startedAt = timingAvailable ? result.startTime : new Date();
    const durationMilliseconds = timingAvailable ? result.duration : 0;
    let privacyspecStatus =
      this.#runScopeOptions === undefined
        ? runStatus(
            result,
            evidenceRunComplete,
            technicalFailures,
            newReviewRequired,
            this.#integrationErrors.length,
            this.#failOnNewReviewFindings,
          )
        : "incomplete";
    let reportWritten = false;
    let dependencyReportWritten = false;
    let securityReportWritten = false;
    let runtimeFailureReportWritten = false;
    let runPartWritten = false;
    let runPartWriteFailed = false;

    const generatedAt = new Date(startedAt.getTime() + durationMilliseconds).toISOString();
    const dependencyReport: DependencyReport = {
      schemaVersion: DEPENDENCY_REPORT_SCHEMA_VERSION,
      generatedAt,
      complete:
        this.#runScopeOptions === undefined &&
        dependencyRunComplete &&
        this.#integrationErrors.length === 0,
      coverage: dependencyCoverage,
      inventory: dependencyInventory,
      findings: dependencyComparison.findings,
      baseline: {
        exists: dependencyBaselineExists,
        known: dependencyComparison.known.length,
        new: dependencyComparison.new.length,
        resolved: dependencyRunComplete ? dependencyComparison.resolved.length : 0,
      },
      diagnostics: Array.from(this.#dependencyDiagnostics.values()).sort(
        (left, right) =>
          compareCanonicalStrings(left.code, right.code) ||
          compareCanonicalStrings(left.message, right.message),
      ),
    };
    const securityReport: SecurityReport = {
      schemaVersion: SECURITY_SCHEMA_VERSION,
      generatedAt,
      complete:
        this.#runScopeOptions === undefined &&
        securityRunComplete &&
        this.#integrationErrors.length === 0,
      coverage: securityCoverage,
      inventory: securityInventory,
      findings: securityComparison.findings,
      baseline: {
        exists: securityBaselineExists,
        known: securityComparison.known.length,
        changed: securityComparison.changed.length,
        newTargets: securityComparison.newTargets.length,
        resolved: securityRunComplete ? securityComparison.resolved.length : 0,
      },
      diagnostics: Array.from(this.#securityDiagnostics.values()).sort(
        (left, right) =>
          compareCanonicalStrings(left.code, right.code) ||
          compareCanonicalStrings(left.message, right.message),
      ),
    };
    const runtimeFailureReport: RuntimeFailureReport = {
      schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
      generatedAt,
      complete:
        this.#runScopeOptions === undefined &&
        runtimeFailureRunComplete &&
        this.#integrationErrors.length === 0,
      coverage: runtimeFailureCoverage,
      inventory: runtimeFailureInventory,
      findings: runtimeFailureRunComplete ? runtimeFailureComparison.findings : [],
      baseline: {
        exists: runtimeFailureBaselineExists,
        known: runtimeFailureComparison.known.length,
        new: runtimeFailureRunComplete ? runtimeFailureComparison.new.length : 0,
        resolved: runtimeFailureRunComplete ? runtimeFailureComparison.resolved.length : 0,
      },
      diagnostics: Array.from(this.#runtimeFailureDiagnostics.values()).sort(
        (left, right) =>
          compareCanonicalStrings(left.code, right.code) ||
          compareCanonicalStrings(left.message, right.message),
      ),
    };

    if (this.#dependencyReportPath !== false) {
      try {
        await writeDependencyReport(this.#dependencyReportPath, dependencyReport);
        dependencyReportWritten = true;
      } catch (error) {
        this.#integrationErrors.push(
          `could not write dependency report (${terminalErrorMessage(error)})`,
        );
        if (this.#dependencyLatestRunPath !== false) {
          try {
            invalidateDependencyLatestRunFile(this.#dependencyLatestRunPath);
          } catch (invalidationError) {
            this.#integrationErrors.push(
              `could not invalidate dependency latest-run artifact after report failure (${terminalErrorMessage(invalidationError)})`,
            );
          }
        }
        evidenceRunComplete = false;
        privacyspecStatus = "failed";
      }
    }

    if (this.#securityReportPath !== false) {
      try {
        await writeSecurityReport(this.#securityReportPath, securityReport);
        securityReportWritten = true;
      } catch (error) {
        this.#integrationErrors.push(
          `could not write security posture report (${terminalErrorMessage(error)})`,
        );
        if (this.#securityLatestRunPath !== false) {
          try {
            invalidateSecurityLatestRunFile(this.#securityLatestRunPath);
          } catch (invalidationError) {
            this.#integrationErrors.push(
              `could not invalidate security posture latest-run artifact after report failure (${terminalErrorMessage(invalidationError)})`,
            );
          }
        }
        evidenceRunComplete = false;
        privacyspecStatus = "failed";
      }
    }

    if (this.#runtimeFailureReportPath !== false) {
      try {
        await writeRuntimeFailureReport(this.#runtimeFailureReportPath, runtimeFailureReport);
        runtimeFailureReportWritten = true;
      } catch (error) {
        this.#integrationErrors.push(
          `could not write runtime failure report (${terminalErrorMessage(error)})`,
        );
        if (this.#runtimeFailureLatestRunPath !== false) {
          try {
            invalidateRuntimeFailureLatestRunFile(this.#runtimeFailureLatestRunPath);
          } catch (invalidationError) {
            this.#integrationErrors.push(
              `could not invalidate runtime failure latest-run artifact after report failure (${terminalErrorMessage(invalidationError)})`,
            );
          }
        }
        evidenceRunComplete = false;
        privacyspecStatus = "failed";
      }
    }

    const ruleMappings = Array.from(new Set(findings.map((finding) => finding.ruleId)))
      .sort((left, right) => left.localeCompare(right))
      .map((ruleId) => RULE_LEGAL_MAPPINGS[ruleId]);
    const profileMappings = this.#nis2EvidenceProfile
      ? [REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690]
      : [];
    const createUnifiedReport = () => {
      const reportComparison: BaselineComparison = evidenceRunComplete
        ? { ...comparison, resolved }
        : { observed: comparison.observed, known: [], new: [], resolved: [] };
      return createPrivacySpecReport({
        generatedAt,
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
        comparison: reportComparison,
        baselineExists,
        diagnostics: Array.from(this.#diagnostics.values()).sort(
          (left, right) =>
            left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
        ),
        integrationErrors: this.#integrationErrors,
        ruleMappings,
        profileMappings,
        responseCoverage: this.#responseCoverage,
        playwrightCoverage: this.#playwrightCoverage,
        networkCoverage: this.#networkCoverage,
        observationCoverage,
        browserEngineCoverage: this.#browserEngineCoverage,
        apiRequestCoverage: this.#apiRequestCoverage,
        testDataObservations: Array.from(this.#testDataObservations.values()),
        secondaryAnalysis: {
          dependencies: dependencyReport,
          security: securityReport,
          runtimeErrors: runtimeFailureReport,
        },
      });
    };
    let unifiedReport = createUnifiedReport();
    if (this.#reportPath !== false) {
      try {
        await writePrivacySpecReport(this.#reportPath, unifiedReport);
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
        unifiedReport = createUnifiedReport();
      }
    }

    if (this.#runScopeOptions !== undefined) {
      if (this.#runScope === undefined) {
        runPartWriteFailed = true;
      } else {
        try {
          await writePrivacySpecRunPart(this.#runScope.outputPath, {
            runPartSchemaVersion: RUN_PART_SCHEMA_VERSION,
            scope: {
              runId: this.#runScope.runId,
              configurationId: this.#runScope.configurationId,
              part: this.#runScope.part,
              total: this.#runScope.total,
              failOnNewReviewFindings: this.#failOnNewReviewFindings,
              nis2EvidenceProfile: this.#nis2EvidenceProfile,
            },
            completeness: {
              privacy:
                (privacyObservationComplete && classifierConfiguration.mode !== "unavailable") ||
                zeroTestPartComplete,
              dependencies: dependencyRunComplete || zeroTestPartComplete,
              security: securityRunComplete || zeroTestPartComplete,
              runtimeErrors: runtimeFailureRunComplete || zeroTestPartComplete,
            },
            classifierConfiguration,
            report: unifiedReport,
          });
          runPartWritten = true;
        } catch (error) {
          this.#integrationErrors.push(
            `could not write run-part artifact (${terminalErrorMessage(error)})`,
          );
          runPartWriteFailed = true;
        }
      }
    }

    if (technicalFailures > 0 || newReviewRequired > 0) {
      const reviewFindingLabel = evidenceRunComplete
        ? "new review findings"
        : "baseline-ineligible review findings";
      writeDetail(
        `PrivacySpec semantic findings: ${technicalFailures + newReviewRequired} (technical failures=${technicalFailures}, ${reviewFindingLabel}=${newReviewRequired}, observations=${actionableObservations})\n`,
      );
    }

    const displayedComparison: BaselineComparison = evidenceRunComplete
      ? comparison
      : { observed: comparison.observed, known: [], new: [], resolved: [] };
    if (baselineExists || displayedComparison.observed.length > 0 || resolved.length > 0) {
      writeDetail(
        `PrivacySpec baseline: known=${displayedComparison.known.length}, new=${displayedComparison.new.length}, resolved=${resolved.length}\n`,
      );
    }

    if (this.#nis2EvidenceProfile) {
      const mapping = REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690;
      writeDetail(
        `PrivacySpec report profile: ${mapping.profileId} [OPT-IN] [${evidenceRunComplete ? "RUN_COMPLETE" : "RUN_INCOMPLETE"}] ${mapping.title}\n`,
      );
      writeDetail(`PrivacySpec evidence observation: ${mapping.observation}\n`);
      for (const relevance of mapping.regulatoryRelevance) {
        writeDetail(
          `PrivacySpec EU relevance: ${relevance.instrument} ${relevance.provision} [${relevance.relationship.toUpperCase()}]\n`,
        );
        writeDetail(`PrivacySpec relevance rationale: ${relevance.rationale}\n`);
        writeDetail(`PrivacySpec applicability: ${relevance.applicabilityCaveat}\n`);
        writeDetail(`PrivacySpec primary source: ${relevance.sourceUrl}\n`);
        writeDetail(`PrivacySpec mapping reviewed: ${relevance.lastReviewed}\n`);
      }
      for (const limitation of mapping.limitations) {
        writeDetail(`PrivacySpec profile limitation: ${limitation}\n`);
      }
      if (!evidenceRunComplete) {
        writeDetail(
          "PrivacySpec profile limitation: This run did not complete its observed test scope and must not be treated as complete test-run evidence.\n",
        );
      }
    }

    const visibleTechnicalFindings = technicalFindingGroups.slice(
      0,
      MAX_TERMINAL_FINDINGS_PER_MODULE,
    );
    const remainingPrivacyFindingSlots =
      MAX_TERMINAL_FINDINGS_PER_MODULE - visibleTechnicalFindings.length;
    const visibleNewFindings = comparison.new.slice(0, remainingPrivacyFindingSlots);
    for (const observed of visibleTechnicalFindings) {
      writeSemanticFinding(writeDetail, observed, "technical_failure");
    }
    for (const observed of visibleNewFindings) {
      writeSemanticFinding(
        writeDetail,
        observed,
        evidenceRunComplete ? "new" : "not_baseline_eligible",
        evidenceRunComplete
          ? classifyBaselineChange(observed.flow, acceptedBaselineFlows)
          : undefined,
      );
    }
    const omittedPrivacyFindings =
      technicalFindingGroups.length +
      comparison.new.length -
      visibleTechnicalFindings.length -
      visibleNewFindings.length;
    if (omittedPrivacyFindings > 0) {
      writeDetail(
        `PrivacySpec finding: ${omittedPrivacyFindings} additional privacy findings omitted from terminal output\n`,
      );
    }
    const visibleResolved = resolved.slice(0, MAX_TERMINAL_FINDINGS_PER_MODULE);
    for (const flow of visibleResolved) {
      const request = [flow.endpoint, flow.location].filter(Boolean).join(" :: ");
      writeDetail(
        `PrivacySpec resolved: ${flow.ruleId} ${flow.dataCategory} -> ${flow.sinkKind}${resolvedDestination(flow)}${request ? ` :: ${request}` : ""} [${flow.transform}]\n`,
      );
    }
    if (resolved.length > visibleResolved.length) {
      writeDetail(
        `PrivacySpec resolved: ${resolved.length - visibleResolved.length} additional privacy resolutions omitted from terminal output\n`,
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
        writeDetail(`PrivacySpec technical relevance ${ruleId}: ${controls}\n`);
        writeDetail(`PrivacySpec EU relevance ${ruleId}: ${relevance}\n`);
        writeDetail(`PrivacySpec authoritative sources ${ruleId}: ${sources}\n`);
      }
      writeDetail(
        `PrivacySpec performance: suite=${Math.round(durationMilliseconds)}ms, cumulative test duration=${Math.round(this.#cumulativeTestDurationMilliseconds)}ms\n`,
      );
      if (reportWritten && this.#reportPath !== false) {
        writeDetail(
          `PrivacySpec JSON report: ${terminalLabel(this.#reportPath, MAX_ENDPOINT_LENGTH, "[unprintable report path]")} (schema v${REPORT_SCHEMA_VERSION})\n`,
        );
      }
      if (dependencyReportWritten && this.#dependencyReportPath !== false) {
        writeDetail(
          `PrivacySpec dependency report: ${terminalLabel(this.#dependencyReportPath, MAX_ENDPOINT_LENGTH, "[unprintable dependency report path]")} (schema v1)\n`,
        );
      }
      if (securityReportWritten && this.#securityReportPath !== false) {
        writeDetail(
          `PrivacySpec security posture report: ${terminalLabel(this.#securityReportPath, MAX_ENDPOINT_LENGTH, "[unprintable security report path]")} (schema v1)\n`,
        );
      }
      if (runtimeFailureReportWritten && this.#runtimeFailureReportPath !== false) {
        writeDetail(
          `PrivacySpec runtime failure report: ${terminalLabel(this.#runtimeFailureReportPath, MAX_ENDPOINT_LENGTH, "[unprintable runtime failure report path]")} (schema v1)\n`,
        );
      }
      if (runPartWritten && this.#runScope !== undefined) {
        writeDetail(
          `PrivacySpec run part: ${terminalLabel(this.#runScope.outputPath, MAX_ENDPOINT_LENGTH, "[unprintable run-part path]")} (schema v${RUN_PART_SCHEMA_VERSION}, ${this.#runScope.part}/${this.#runScope.total}, baseline-ineligible)\n`,
        );
        writeDetail(
          "PrivacySpec run scope: aggregate all expected parts before publishing results.\n",
        );
      }
    }

    const overallStatus: PrivacySpecRunStatus =
      unifiedReport.analysis.status === "pass"
        ? "passed"
        : unifiedReport.analysis.status === "review"
          ? "review"
          : unifiedReport.analysis.status === "fail"
            ? "failed"
            : "incomplete";
    if (timingAvailable) {
      this.#write(renderSecondaryCoverageSummary(unifiedReport));
      for (const detail of terminalDetails) this.#write(detail);
    }
    for (const error of this.#integrationErrors) {
      this.#write(`PrivacySpec integration error: ${error}\n`);
    }
    if (timingAvailable) {
      const technicalFailureChanges = technicalFailures + newRuntimeErrors;
      const reviewChanges =
        newReviewRequired +
        dependencyComparison.findings.length +
        securityComparison.findings.length +
        newRuntimeReviews;
      this.#write(
        `PrivacySpec result: ${displayPrivacySpecStatus(overallStatus)} (functional tests=${displayPlaywrightStatus(result.status)}, changes=${unifiedReport.analysis.changes.total}, technical failures=${technicalFailureChanges}, review findings=${reviewChanges})\n`,
      );
    }

    if (overallStatus !== "failed" && !runPartWriteFailed) return undefined;
    return { status: "failed" };
  }
}
