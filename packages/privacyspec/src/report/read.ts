import { lstat, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { parseDependencyReport } from "../analyzers/dependency/artifact.js";
import type { DependencyReport } from "../analyzers/dependency/model.js";
import { parseRuntimeFailureReport } from "../analyzers/runtime-failure/artifact.js";
import type { RuntimeFailureReport } from "../analyzers/runtime-failure/model.js";
import { parseSecurityReport } from "../analyzers/security/artifact.js";
import type { SecurityReport } from "../analyzers/security/model.js";
import {
  createBaselineFlowCandidate,
  createBaselineKey,
  isBaselineEligibleIdentity,
  normalizeBaselineEndpoint,
} from "../baseline/compare.js";
import type {
  BaselineFlow,
  BaselineFlowCandidate,
  BaselineFlowIdentity,
} from "../baseline/schema.js";
import type { DataFlow, DataFlowSinkKind, TransformKind } from "../correlate/model.js";
import { type DataCategory, isDataCategory } from "../discovery/source-model.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import type { Finding, RuleId } from "../rules/model.js";
import { parseTestDataSection } from "../testdata/validate.js";
import { MAX_REPORT_FILE_BYTES } from "./json.js";
import {
  createSecondaryAnalysisReport,
  type FindingBaselineState,
  type PrivacySpecJsonReport,
  type PrivacySpecJsonReportV1,
  type PrivacySpecJsonReportV2,
  type PrivacySpecJsonReportV3,
  type PrivacySpecJsonReportV4,
  type PrivacySpecJsonReportV5,
  type PrivacySpecRunStatus,
  REPORT_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION_V1,
  REPORT_SCHEMA_VERSION_V2,
  REPORT_SCHEMA_VERSION_V3,
  REPORT_SCHEMA_VERSION_V4,
  type TestAttemptStatus,
} from "./model.js";

const MAX_REPORT_ITEMS = 100_000;
const MAX_COUNT_NAMES = 1_000;
const MAX_DIAGNOSTICS = 10_000;
const MAX_INTEGRATION_ERRORS = 10_000;
const MAX_LEGAL_MAPPINGS = 100;
const MAX_SAFE_JSON_NODES = 50_000;
const MAX_SAFE_JSON_DEPTH = 12;

const MAX_TIMESTAMP_LENGTH = 64;
const MAX_VERSION_LENGTH = 64;
const MAX_NAME_LENGTH = 512;
const MAX_RECIPIENT_ORIGIN_LENGTH = 2_048;
const MAX_RECIPIENT_HOST_LENGTH = 255;
const MAX_METHOD_LENGTH = 32;
const MAX_ENDPOINT_LENGTH = 8_192;
const MAX_LOCATION_LENGTH = 1_024;
const MAX_TEST_FILE_LENGTH = 2_048;
const MAX_TEST_TITLE_LENGTH = 2_048;
const MAX_TEST_PROJECT_LENGTH = 512;
const MAX_FINDING_TEXT_LENGTH = 2_048;
const MAX_FINDING_LIMITATIONS = 10;
const MAX_DIAGNOSTIC_LENGTH = 1_024;

const sourceKindsV1 = new Set<DataFlow["sourceKind"]>(["form-input", "dom-control"]);
const sourceKindsV2 = new Set<DataFlow["sourceKind"]>([
  "form-input",
  "dom-control",
  "response-json",
]);
const sourceConfidences = new Set<DataFlow["sourceConfidence"]>(["high", "medium", "low"]);
const sinkKinds = new Set<DataFlowSinkKind>([
  "request-url",
  "request-body",
  "request-header",
  "external-request",
  "local-storage",
  "session-storage",
  "cookie",
  "console",
]);
const transforms = new Set<TransformKind>([
  "EXACT",
  "LOWERCASE",
  "UPPERCASE",
  "URL_ENCODED",
  "BASE64",
  "SHA256",
  "SHA256_NORMALIZED",
]);
const ruleIds = new Set<RuleId>(Object.keys(RULE_DEFINITIONS) as RuleId[]);
const findingStates = new Set<FindingBaselineState>(["known", "new", "not_baseline_eligible"]);
const playwrightStatuses = new Set(["passed", "failed", "timedout", "interrupted"]);
const privacyspecStatuses = new Set<PrivacySpecRunStatus>([
  "passed",
  "review",
  "failed",
  "incomplete",
]);
const attemptStatuses: readonly TestAttemptStatus[] = [
  "passed",
  "failed",
  "timedOut",
  "skipped",
  "interrupted",
];

export class ReportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportFormatError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
};

const containsUnsafeCharacter = (value: string): boolean => {
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

const isBoundedString = (value: unknown, maxLength: number, allowEmpty = false): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  value.length <= maxLength &&
  !containsUnsafeCharacter(value);

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (!isBoundedString(value, MAX_TIMESTAMP_LENGTH)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  isNonNegativeNumber(value) && Number.isSafeInteger(value);

const hasNonNegativeCounts = <Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Record<Key, number> =>
  isRecord(value) &&
  hasExactKeys(value, keys) &&
  keys.every((key) => isNonNegativeInteger(value[key]));

const isCanonicalOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.origin !== "null" && url.origin === value;
  } catch {
    return false;
  }
};

const isSanitizedTestPath = (value: unknown): value is string => {
  if (!isBoundedString(value, MAX_TEST_FILE_LENGTH)) return false;
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value)) return false;
  return !value.split(/[\\/]/u).includes("..");
};

type SupportedReportSchemaVersion =
  | typeof REPORT_SCHEMA_VERSION_V1
  | typeof REPORT_SCHEMA_VERSION_V2
  | typeof REPORT_SCHEMA_VERSION_V3
  | typeof REPORT_SCHEMA_VERSION_V4
  | typeof REPORT_SCHEMA_VERSION;

const parseDataFlow = (
  value: unknown,
  schemaVersion: SupportedReportSchemaVersion,
): DataFlow | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "kind",
        ...(schemaVersion === REPORT_SCHEMA_VERSION ? ["requestSurface"] : []),
        "dataCategory",
        "sourceKind",
        "sourceConfidence",
        "sinkKind",
        "transform",
        "test",
      ],
      schemaVersion !== REPORT_SCHEMA_VERSION_V1
        ? ["recipient", "method", "endpoint", "location", "sourceProvenance"]
        : ["recipient", "method", "endpoint", "location"],
    ) ||
    value.kind !== "data-flow" ||
    typeof value.dataCategory !== "string" ||
    !isDataCategory(value.dataCategory) ||
    typeof value.sourceKind !== "string" ||
    !(schemaVersion !== REPORT_SCHEMA_VERSION_V1 ? sourceKindsV2 : sourceKindsV1).has(
      value.sourceKind as DataFlow["sourceKind"],
    ) ||
    typeof value.sourceConfidence !== "string" ||
    !sourceConfidences.has(value.sourceConfidence as DataFlow["sourceConfidence"]) ||
    (schemaVersion === REPORT_SCHEMA_VERSION &&
      value.requestSurface !== "browser" &&
      value.requestSurface !== "api-request") ||
    typeof value.sinkKind !== "string" ||
    !sinkKinds.has(value.sinkKind as DataFlowSinkKind) ||
    typeof value.transform !== "string" ||
    !transforms.has(value.transform as TransformKind) ||
    !isRecord(value.test) ||
    !hasExactKeys(value.test, ["file", "title", "project"]) ||
    !isSanitizedTestPath(value.test.file) ||
    !isBoundedString(value.test.title, MAX_TEST_TITLE_LENGTH) ||
    !isBoundedString(value.test.project, MAX_TEST_PROJECT_LENGTH, true)
  ) {
    return undefined;
  }

  if (value.method !== undefined && !isBoundedString(value.method, MAX_METHOD_LENGTH)) {
    return undefined;
  }
  if (value.endpoint !== undefined && !isBoundedString(value.endpoint, MAX_ENDPOINT_LENGTH)) {
    return undefined;
  }
  if (value.location !== undefined && !isBoundedString(value.location, MAX_LOCATION_LENGTH)) {
    return undefined;
  }

  let sourceProvenance: DataFlow["sourceProvenance"];
  if (value.sourceProvenance !== undefined) {
    if (
      schemaVersion === REPORT_SCHEMA_VERSION_V1 ||
      !isRecord(value.sourceProvenance) ||
      !hasExactKeys(value.sourceProvenance, ["origin", "endpoint", "location"]) ||
      !isBoundedString(value.sourceProvenance.origin, MAX_RECIPIENT_ORIGIN_LENGTH) ||
      !isCanonicalOrigin(value.sourceProvenance.origin) ||
      !isBoundedString(value.sourceProvenance.endpoint, MAX_ENDPOINT_LENGTH) ||
      !isBoundedString(value.sourceProvenance.location, MAX_LOCATION_LENGTH)
    ) {
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
      !hasExactKeys(value.recipient, ["origin", "host", "firstParty"]) ||
      !isBoundedString(value.recipient.origin, MAX_RECIPIENT_ORIGIN_LENGTH) ||
      !isCanonicalOrigin(value.recipient.origin) ||
      !isBoundedString(value.recipient.host, MAX_RECIPIENT_HOST_LENGTH) ||
      new URL(value.recipient.origin).hostname !== value.recipient.host ||
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
    requestSurface:
      schemaVersion === REPORT_SCHEMA_VERSION
        ? (value.requestSurface as DataFlow["requestSurface"])
        : "browser",
    dataCategory: value.dataCategory as DataCategory,
    sourceKind: value.sourceKind as DataFlow["sourceKind"],
    sourceConfidence: value.sourceConfidence as DataFlow["sourceConfidence"],
    sinkKind: value.sinkKind as DataFlowSinkKind,
    transform: value.transform as TransformKind,
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

const dataFlowIdentity = (flow: DataFlow): string =>
  JSON.stringify([
    flow.dataCategory,
    flow.sourceKind,
    flow.sourceConfidence,
    flow.sourceProvenance?.origin ?? null,
    flow.sourceProvenance?.endpoint ?? null,
    flow.sourceProvenance?.location ?? null,
    flow.requestSurface,
    flow.sinkKind,
    flow.recipient?.origin ?? null,
    flow.recipient?.host ?? null,
    flow.recipient?.firstParty ?? null,
    flow.method ?? null,
    flow.endpoint ?? null,
    flow.location ?? null,
    flow.transform,
    flow.test.file,
    flow.test.title,
    flow.test.project,
  ]);

const parseFinding = (
  value: unknown,
  schemaVersion: SupportedReportSchemaVersion,
): Finding | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "ruleId",
      "severity",
      "classification",
      "title",
      "observation",
      "flow",
      "limitations",
    ]) ||
    value.kind !== "finding" ||
    typeof value.ruleId !== "string" ||
    !ruleIds.has(value.ruleId as RuleId) ||
    !["info", "warning", "error", "critical"].includes(String(value.severity)) ||
    !["technical_failure", "review_required", "informational"].includes(
      String(value.classification),
    ) ||
    value.title !== RULE_DEFINITIONS[value.ruleId as RuleId].title ||
    !isBoundedString(value.observation, MAX_FINDING_TEXT_LENGTH) ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > MAX_FINDING_LIMITATIONS
  ) {
    return undefined;
  }
  const flow = parseDataFlow(value.flow, schemaVersion);
  if (flow === undefined) return undefined;
  const limitations: string[] = [];
  for (const limitation of value.limitations) {
    if (!isBoundedString(limitation, MAX_FINDING_TEXT_LENGTH)) return undefined;
    limitations.push(limitation);
  }
  return {
    kind: "finding",
    ruleId: value.ruleId as RuleId,
    severity: value.severity as Finding["severity"],
    classification: value.classification as Finding["classification"],
    title: value.title as string,
    observation: value.observation,
    flow,
    limitations,
  };
};

const parseBaselineCandidate = (
  value: unknown,
  accepted: boolean,
): BaselineFlowCandidate | BaselineFlow | undefined => {
  if (!isRecord(value)) return undefined;
  const required = ["key", "ruleId", "dataCategory", "sinkKind", "transform"];
  if (accepted) required.push("status");
  if (!hasExactKeys(value, required, ["recipient", "endpoint", "location"])) return undefined;
  if (
    !isBoundedString(value.key, 16_384) ||
    typeof value.ruleId !== "string" ||
    !ruleIds.has(value.ruleId as RuleId) ||
    typeof value.dataCategory !== "string" ||
    !isDataCategory(value.dataCategory) ||
    typeof value.sinkKind !== "string" ||
    !sinkKinds.has(value.sinkKind as DataFlowSinkKind) ||
    typeof value.transform !== "string" ||
    !transforms.has(value.transform as TransformKind) ||
    (accepted && value.status !== "accepted")
  ) {
    return undefined;
  }
  const identity: BaselineFlowIdentity = {
    ruleId: value.ruleId as RuleId,
    dataCategory: value.dataCategory as DataCategory,
    sinkKind: value.sinkKind as DataFlowSinkKind,
    transform: value.transform as TransformKind,
  };
  if (value.recipient !== undefined) {
    if (
      !isBoundedString(value.recipient, MAX_RECIPIENT_ORIGIN_LENGTH) ||
      !isCanonicalOrigin(value.recipient)
    ) {
      return undefined;
    }
    identity.recipient = value.recipient;
  }
  if (value.endpoint !== undefined) {
    if (
      !isBoundedString(value.endpoint, MAX_ENDPOINT_LENGTH) ||
      normalizeBaselineEndpoint(value.endpoint) !== value.endpoint
    ) {
      return undefined;
    }
    identity.endpoint = value.endpoint;
  }
  if (value.location !== undefined) {
    if (!isBoundedString(value.location, MAX_LOCATION_LENGTH)) return undefined;
    identity.location = value.location;
  }
  if (!isBaselineEligibleIdentity(identity) || createBaselineKey(identity) !== value.key) {
    return undefined;
  }
  const candidate: BaselineFlowCandidate = { key: value.key, ...identity };
  return accepted ? { ...candidate, status: "accepted" } : candidate;
};

const parseObservedBaselineFlows = (
  value: unknown,
  schemaVersion: SupportedReportSchemaVersion,
): boolean => {
  if (!Array.isArray(value) || value.length > MAX_REPORT_ITEMS) return false;
  const keys = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["flow", "findings"]) ||
      !Array.isArray(entry.findings) ||
      entry.findings.length === 0 ||
      entry.findings.length > MAX_REPORT_ITEMS
    ) {
      return false;
    }
    const flow = parseBaselineCandidate(entry.flow, false);
    if (flow === undefined || keys.has(flow.key)) return false;
    keys.add(flow.key);
    for (const findingValue of entry.findings) {
      const finding = parseFinding(findingValue, schemaVersion);
      const candidate = finding === undefined ? undefined : createBaselineFlowCandidate(finding);
      if (candidate === undefined || candidate.key !== flow.key) return false;
    }
  }
  return true;
};

const parseResolvedBaselineFlows = (value: unknown): boolean => {
  if (!Array.isArray(value) || value.length > MAX_REPORT_ITEMS) return false;
  const keys = new Set<string>();
  for (const entry of value) {
    const flow = parseBaselineCandidate(entry, true);
    if (flow === undefined || keys.has(flow.key)) return false;
    keys.add(flow.key);
  }
  return true;
};

const parseCountByName = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["total", "byName"]) ||
    !isNonNegativeInteger(value.total) ||
    !isRecord(value.byName) ||
    Object.keys(value.byName).length > MAX_COUNT_NAMES
  ) {
    return false;
  }
  let total = 0;
  for (const [name, count] of Object.entries(value.byName)) {
    if (!isBoundedString(name, MAX_NAME_LENGTH) || !isNonNegativeInteger(count)) return false;
    total += count;
    if (!Number.isSafeInteger(total)) return false;
  }
  return total === value.total;
};

const parseTestCounts = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "total",
      "observed",
      "passed",
      "failed",
      "timedOut",
      "skipped",
      "interrupted",
    ]) ||
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.observed) ||
    value.observed > value.total
  ) {
    return false;
  }
  let attempts = 0;
  for (const status of attemptStatuses) {
    const count = value[status];
    if (!isNonNegativeInteger(count)) return false;
    attempts += count;
  }
  return attempts === value.total;
};

const isBoundedSafeJson = (value: unknown): boolean => {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_SAFE_JSON_NODES || depth > MAX_SAFE_JSON_DEPTH) return false;
    if (candidate === null || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") return isBoundedString(candidate, 8_192, true);
    if (Array.isArray(candidate)) {
      return (
        candidate.length <= MAX_REPORT_ITEMS && candidate.every((item) => visit(item, depth + 1))
      );
    }
    if (!isRecord(candidate) || Object.keys(candidate).length > MAX_COUNT_NAMES) return false;
    return Object.entries(candidate).every(
      ([key, item]) => isBoundedString(key, MAX_NAME_LENGTH) && visit(item, depth + 1),
    );
  };
  return visit(value, 0);
};

const parseResponseReportCoverage = (
  value: unknown,
  observedTests: number,
  schemaVersion: SupportedReportSchemaVersion,
): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "firstPartyJsonResponses",
        ...(schemaVersion === REPORT_SCHEMA_VERSION ? ["browserEngines", "apiRequests"] : []),
      ],
      ["playwright", "network", "observation"],
    ) ||
    !isRecord(value.firstPartyJsonResponses)
  ) {
    return false;
  }
  const coverage = value.firstPartyJsonResponses;
  const responseKeys = ["seen", "firstParty", "json", "parsed", "withSources"] as const;
  const skipKeys = [
    "unknownLength",
    "oversized",
    "aggregateLimit",
    "workLimit",
    "bodyReadError",
    "invalidJson",
    "traversalLimit",
    "sourceLimit",
  ] as const;
  if (
    !hasExactKeys(coverage, [
      "experimental",
      "tests",
      "responses",
      "retainedBytes",
      "discoveredSources",
      "skipped",
    ]) ||
    coverage.experimental !== true ||
    !hasNonNegativeCounts(coverage.tests, ["enabled", "disabled", "unavailable"]) ||
    coverage.tests.enabled + coverage.tests.disabled + coverage.tests.unavailable !==
      observedTests ||
    !hasNonNegativeCounts(coverage.responses, responseKeys) ||
    !isNonNegativeInteger(coverage.retainedBytes) ||
    !parseCountByName(coverage.discoveredSources) ||
    !isRecord(coverage.discoveredSources) ||
    !isRecord(coverage.discoveredSources.byName) ||
    !hasExactKeys(coverage.discoveredSources.byName, ["personal.email", "personal.phone"]) ||
    !hasNonNegativeCounts(coverage.skipped, skipKeys)
  ) {
    return false;
  }
  return (
    coverage.responses.firstParty <= coverage.responses.seen &&
    coverage.responses.json <= coverage.responses.firstParty &&
    coverage.responses.parsed <= coverage.responses.json &&
    coverage.responses.withSources <= coverage.responses.parsed
  );
};

const browserEngineNames = ["chromium", "firefox", "webkit"] as const;
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
const runtimeCapabilityStates = new Set([
  "complete",
  "partial",
  "incomplete",
  "unsupported",
  "disabled",
]);

export const parseBrowserEngineReportCoverage = (
  value: unknown,
  observedTests: number,
): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["experimental", "tests", "engines"]) ||
    value.experimental !== true ||
    !hasNonNegativeCounts(value.tests, [
      "supported",
      "experimental",
      "unsupported",
      "unavailable",
    ]) ||
    value.tests.supported +
      value.tests.experimental +
      value.tests.unsupported +
      value.tests.unavailable !==
      observedTests ||
    !isRecord(value.engines) ||
    !hasExactKeys(value.engines, browserEngineNames)
  ) {
    return false;
  }
  let engineTests = 0;
  const supportTests = { supported: 0, experimental: 0, unsupported: 0 };
  for (const engine of browserEngineNames) {
    const coverage = value.engines[engine];
    if (
      !isRecord(coverage) ||
      !hasExactKeys(coverage, ["tests", "support", "capabilities"]) ||
      !isNonNegativeInteger(coverage.tests) ||
      !["supported", "experimental", "unsupported"].includes(String(coverage.support)) ||
      !isRecord(coverage.capabilities) ||
      !hasExactKeys(coverage.capabilities, browserCapabilityNames) ||
      !browserCapabilityNames.every((name) =>
        runtimeCapabilityStates.has(
          (coverage.capabilities as Record<string, unknown>)[name] as string,
        ),
      )
    ) {
      return false;
    }
    if (
      (engine === "chromium" && coverage.support !== "supported") ||
      (engine !== "chromium" && coverage.support === "supported") ||
      (coverage.support === "unsupported" &&
        browserCapabilityNames.some(
          (name) => (coverage.capabilities as Record<string, unknown>)[name] !== "unsupported",
        ))
    ) {
      return false;
    }
    engineTests += coverage.tests;
    supportTests[coverage.support as keyof typeof supportTests] += coverage.tests;
  }
  return (
    engineTests + value.tests.unavailable === observedTests &&
    supportTests.supported === value.tests.supported &&
    supportTests.experimental === value.tests.experimental &&
    supportTests.unsupported === value.tests.unsupported
  );
};

const apiBlindSpots = [
  "implicit-headers-cookies-auth",
  "redirect-chain",
  "page-request",
  "context-request",
  "manual-request-context",
] as const;

export const parseAPIRequestReportCoverage = (value: unknown, observedTests: number): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["experimental", "tests", "calls", "skipped", "blindSpots"]) ||
    value.experimental !== true ||
    !hasNonNegativeCounts(value.tests, [
      "enabled",
      "disabled",
      "unavailable",
      "complete",
      "partial",
      "unsupported",
    ]) ||
    value.tests.enabled + value.tests.disabled + value.tests.unavailable !== observedTests ||
    value.tests.complete +
      value.tests.partial +
      value.tests.unsupported +
      value.tests.unavailable !==
      observedTests ||
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
    !isDeepStrictEqual(value.blindSpots, apiBlindSpots)
  ) {
    return false;
  }
  return true;
};

const parseNetworkReportCoverage = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["requests"]) ||
    !hasNonNegativeCounts(value.requests, ["seen", "accepted", "filteredLowValueStatic"])
  ) {
    return false;
  }
  return value.requests.accepted + value.requests.filteredLowValueStatic <= value.requests.seen;
};

const parsePlaywrightReportCoverage = (value: unknown, observedTests: number): boolean => {
  if (!isRecord(value) || !isRecord(value.tests)) return false;
  if (
    !hasExactKeys(value, ["tests", "applicationContexts", "pages"]) ||
    !hasNonNegativeCounts(value.tests, ["compatible", "incompatible", "unavailable"]) ||
    value.tests.compatible + value.tests.incompatible + value.tests.unavailable !== observedTests ||
    !isNonNegativeInteger(value.applicationContexts) ||
    !isNonNegativeInteger(value.pages) ||
    value.applicationContexts !== value.tests.compatible ||
    value.pages < value.applicationContexts
  ) {
    return false;
  }
  return true;
};

const observationCoverageStatuses = new Set(["complete", "partial", "incomplete", "unsupported"]);
const observationCoverageDiagnosticCodes = new Set([
  "COVERAGE_NO_PAGES",
  "COVERAGE_NO_RUNTIME_EVENTS",
  "COVERAGE_OBSERVER_FINALIZATION_INCOMPLETE",
  "COVERAGE_LIMIT_REACHED",
  "COVERAGE_OPTIONAL_OBSERVER_SKIPPED",
  "COVERAGE_RESULT_UNAVAILABLE",
  "COVERAGE_TEST_SCOPE_INCOMPLETE",
  "COVERAGE_UNSUPPORTED_CONTEXT",
  "COVERAGE_UNSUPPORTED_BROWSER_ENGINE",
  "COVERAGE_BROWSER_ENGINE_CAPABILITY_LIMITED",
  "COVERAGE_API_REQUEST_PARTIAL",
  "COVERAGE_API_REQUEST_UNSUPPORTED",
]);

const parseObservationReportCoverage = (
  value: unknown,
  attempts: number,
  observedTests: number,
): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "status",
      "tests",
      "browserObjects",
      "contexts",
      "pages",
      "events",
      "diagnostics",
    ]) ||
    typeof value.status !== "string" ||
    !observationCoverageStatuses.has(value.status) ||
    !hasNonNegativeCounts(value.tests, ["attempts", "observed"]) ||
    value.tests.attempts !== attempts ||
    value.tests.observed !== observedTests ||
    !hasNonNegativeCounts(value.browserObjects, ["seen"]) ||
    !hasNonNegativeCounts(value.contexts, ["seen", "instrumented"]) ||
    !hasNonNegativeCounts(value.pages, ["seen", "instrumented", "storageCapable"]) ||
    !hasNonNegativeCounts(value.events, ["navigations", "network", "console"]) ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > 20
  ) {
    return false;
  }
  if (
    value.contexts.instrumented > value.contexts.seen ||
    value.pages.instrumented > value.pages.seen ||
    value.pages.storageCapable > value.pages.seen
  ) {
    return false;
  }
  return value.diagnostics.every(
    (diagnostic) =>
      isRecord(diagnostic) &&
      hasExactKeys(diagnostic, ["code", "message"]) &&
      typeof diagnostic.code === "string" &&
      observationCoverageDiagnosticCodes.has(diagnostic.code) &&
      isBoundedString(diagnostic.message, MAX_DIAGNOSTIC_LENGTH),
  );
};

const parseModuleAnalysis = <Report>(
  value: unknown,
  parse: (candidate: unknown) => Report,
): Report | undefined => {
  if (!isRecord(value) || !Object.hasOwn(value, "status")) return undefined;
  const { status, ...reportValue } = value;
  if (status !== "pass" && status !== "review" && status !== "fail" && status !== "inconclusive") {
    return undefined;
  }
  try {
    return parse(reportValue);
  } catch {
    return undefined;
  }
};

const parseSecondaryAnalysis = (value: unknown, report: PrivacySpecJsonReportV4): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "status",
      "changes",
      "privacy",
      "dependencies",
      "security",
      "runtimeErrors",
    ]) ||
    !isRecord(value.privacy) ||
    !hasExactKeys(value.privacy, ["status", "complete", "coverage", "summary"]) ||
    !isRecord(value.changes) ||
    !hasNonNegativeCounts(value.changes, [
      "total",
      "privacy",
      "dependencies",
      "security",
      "runtimeErrors",
    ])
  ) {
    return false;
  }

  const dependencies = parseModuleAnalysis<DependencyReport>(
    value.dependencies,
    parseDependencyReport,
  );
  const security = parseModuleAnalysis<SecurityReport>(value.security, parseSecurityReport);
  const runtimeErrors = parseModuleAnalysis<RuntimeFailureReport>(
    value.runtimeErrors,
    parseRuntimeFailureReport,
  );
  if (
    dependencies === undefined ||
    security === undefined ||
    runtimeErrors === undefined ||
    dependencies.generatedAt !== report.generatedAt ||
    security.generatedAt !== report.generatedAt ||
    runtimeErrors.generatedAt !== report.generatedAt
  ) {
    return false;
  }

  const expected = createSecondaryAnalysisReport({
    generatedAt: report.generatedAt,
    privacySpecStatus: report.run.privacyspecStatus,
    privacyComplete: report.run.complete,
    privacyCoverage: report.coverage.observation.status,
    privacySummary: report.summary,
    modules: { dependencies, security, runtimeErrors },
  });
  return isDeepStrictEqual(value, expected);
};

const parseReport = (value: unknown): value is PrivacySpecJsonReport => {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== REPORT_SCHEMA_VERSION_V1 &&
    value.schemaVersion !== REPORT_SCHEMA_VERSION_V2 &&
    value.schemaVersion !== REPORT_SCHEMA_VERSION_V3 &&
    value.schemaVersion !== REPORT_SCHEMA_VERSION_V4 &&
    value.schemaVersion !== REPORT_SCHEMA_VERSION
  ) {
    return false;
  }
  const schemaVersion = value.schemaVersion;
  const reportKeys = [
    "schemaVersion",
    "tool",
    "generatedAt",
    "run",
    "summary",
    "performance",
    "flows",
    "findings",
    "baseline",
    "diagnostics",
    "integrationErrors",
    "legalMappings",
    ...(schemaVersion !== REPORT_SCHEMA_VERSION_V1 ? ["coverage"] : []),
    ...(schemaVersion === REPORT_SCHEMA_VERSION_V4 || schemaVersion === REPORT_SCHEMA_VERSION
      ? ["analysis"]
      : []),
  ];
  if (
    !hasExactKeys(
      value,
      reportKeys,
      schemaVersion !== REPORT_SCHEMA_VERSION_V1 ? ["testData"] : [],
    ) ||
    !isCanonicalTimestamp(value.generatedAt) ||
    !isRecord(value.tool) ||
    !hasExactKeys(value.tool, ["name", "version"]) ||
    value.tool.name !== "privacyspec" ||
    !isBoundedString(value.tool.version, MAX_VERSION_LENGTH) ||
    !isRecord(value.run) ||
    !hasExactKeys(value.run, [
      "playwrightStatus",
      "privacyspecStatus",
      "complete",
      "startedAt",
      "projects",
      "tests",
    ]) ||
    typeof value.run.playwrightStatus !== "string" ||
    !playwrightStatuses.has(value.run.playwrightStatus) ||
    typeof value.run.privacyspecStatus !== "string" ||
    !privacyspecStatuses.has(value.run.privacyspecStatus as PrivacySpecRunStatus) ||
    typeof value.run.complete !== "boolean" ||
    !isCanonicalTimestamp(value.run.startedAt) ||
    !Array.isArray(value.run.projects) ||
    value.run.projects.length > MAX_COUNT_NAMES ||
    !value.run.projects.every((project) =>
      isBoundedString(project, MAX_TEST_PROJECT_LENGTH, true),
    ) ||
    !parseTestCounts(value.run.tests) ||
    !isRecord(value.summary) ||
    !hasExactKeys(value.summary, [
      "sensitiveSources",
      "sinks",
      "dataFlows",
      "findings",
      "baseline",
    ]) ||
    !parseCountByName(value.summary.sensitiveSources) ||
    !parseCountByName(value.summary.sinks) ||
    !isNonNegativeInteger(value.summary.dataFlows) ||
    !isRecord(value.summary.findings) ||
    !hasExactKeys(value.summary.findings, [
      "total",
      "technicalFailures",
      "reviewRequired",
      "newReviewRequired",
      "knownReviewRequired",
    ]) ||
    !Object.values(value.summary.findings).every(isNonNegativeInteger) ||
    !isRecord(value.summary.baseline) ||
    !hasExactKeys(value.summary.baseline, ["known", "new", "resolved"]) ||
    !Object.values(value.summary.baseline).every(isNonNegativeInteger) ||
    !isRecord(value.performance) ||
    !hasExactKeys(value.performance, [
      "suiteDurationMilliseconds",
      "cumulativeTestDurationMilliseconds",
    ]) ||
    !isNonNegativeNumber(value.performance.suiteDurationMilliseconds) ||
    !isNonNegativeNumber(value.performance.cumulativeTestDurationMilliseconds) ||
    !Array.isArray(value.flows) ||
    value.flows.length > MAX_REPORT_ITEMS ||
    !Array.isArray(value.findings) ||
    value.findings.length > MAX_REPORT_ITEMS ||
    !isRecord(value.baseline) ||
    !hasExactKeys(value.baseline, ["exists", "known", "new", "resolved"]) ||
    typeof value.baseline.exists !== "boolean" ||
    !parseObservedBaselineFlows(value.baseline.known, schemaVersion) ||
    !parseObservedBaselineFlows(value.baseline.new, schemaVersion) ||
    !parseResolvedBaselineFlows(value.baseline.resolved) ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > MAX_DIAGNOSTICS ||
    !Array.isArray(value.integrationErrors) ||
    value.integrationErrors.length > MAX_INTEGRATION_ERRORS ||
    !isRecord(value.legalMappings) ||
    !hasExactKeys(value.legalMappings, ["rules", "profiles"]) ||
    !Array.isArray(value.legalMappings.rules) ||
    value.legalMappings.rules.length > MAX_LEGAL_MAPPINGS ||
    !Array.isArray(value.legalMappings.profiles) ||
    value.legalMappings.profiles.length > MAX_LEGAL_MAPPINGS ||
    !isBoundedSafeJson(value.legalMappings) ||
    (schemaVersion !== REPORT_SCHEMA_VERSION_V1 &&
      !parseResponseReportCoverage(
        value.coverage,
        (value.run.tests as { observed: number }).observed,
        schemaVersion,
      )) ||
    (schemaVersion !== REPORT_SCHEMA_VERSION_V1 &&
      isRecord(value.coverage) &&
      value.coverage.playwright !== undefined &&
      !parsePlaywrightReportCoverage(
        value.coverage.playwright,
        (value.run.tests as { observed: number }).observed,
      )) ||
    (schemaVersion !== REPORT_SCHEMA_VERSION_V1 &&
      isRecord(value.coverage) &&
      value.coverage.network !== undefined &&
      !parseNetworkReportCoverage(value.coverage.network)) ||
    (schemaVersion === REPORT_SCHEMA_VERSION_V2 &&
      isRecord(value.coverage) &&
      value.coverage.observation !== undefined) ||
    ((schemaVersion === REPORT_SCHEMA_VERSION_V3 ||
      schemaVersion === REPORT_SCHEMA_VERSION_V4 ||
      schemaVersion === REPORT_SCHEMA_VERSION) &&
      isRecord(value.coverage) &&
      !parseObservationReportCoverage(
        value.coverage.observation,
        (value.run.tests as { total: number }).total,
        (value.run.tests as { observed: number }).observed,
      )) ||
    (schemaVersion === REPORT_SCHEMA_VERSION &&
      isRecord(value.coverage) &&
      (!parseBrowserEngineReportCoverage(
        value.coverage.browserEngines,
        (value.run.tests as { observed: number }).observed,
      ) ||
        !parseAPIRequestReportCoverage(
          value.coverage.apiRequests,
          (value.run.tests as { observed: number }).observed,
        ))) ||
    (schemaVersion !== REPORT_SCHEMA_VERSION_V1 &&
      value.testData !== undefined &&
      parseTestDataSection(value.testData) === undefined)
  ) {
    return false;
  }

  const flowIdentities = new Set<string>();
  const parsedFlows: DataFlow[] = [];
  for (const flowValue of value.flows) {
    const flow = parseDataFlow(flowValue, schemaVersion);
    if (flow === undefined) return false;
    parsedFlows.push(flow);
    flowIdentities.add(dataFlowIdentity(flow));
  }

  const knownKeys = new Set(
    (value.baseline.known as Array<{ flow: BaselineFlowCandidate }>).map(({ flow }) => flow.key),
  );
  const newKeys = new Set(
    (value.baseline.new as Array<{ flow: BaselineFlowCandidate }>).map(({ flow }) => flow.key),
  );
  const resolvedKeys = new Set((value.baseline.resolved as BaselineFlow[]).map((flow) => flow.key));
  if (
    Array.from(knownKeys).some((key) => newKeys.has(key) || resolvedKeys.has(key)) ||
    Array.from(newKeys).some((key) => resolvedKeys.has(key)) ||
    (value.baseline.exists === false && (knownKeys.size > 0 || resolvedKeys.size > 0))
  ) {
    return false;
  }

  for (const reportFinding of value.findings) {
    if (
      !isRecord(reportFinding) ||
      !hasExactKeys(reportFinding, ["baselineState", "finding"]) ||
      typeof reportFinding.baselineState !== "string" ||
      !findingStates.has(reportFinding.baselineState as FindingBaselineState) ||
      parseFinding(reportFinding.finding, schemaVersion) === undefined
    ) {
      return false;
    }
    const finding = parseFinding(reportFinding.finding, schemaVersion);
    if (finding === undefined || !flowIdentities.has(dataFlowIdentity(finding.flow))) return false;
    const candidate = createBaselineFlowCandidate(finding);
    const expectedState =
      candidate === undefined ||
      (schemaVersion === REPORT_SCHEMA_VERSION && value.run.complete === false)
        ? "not_baseline_eligible"
        : knownKeys.has(candidate.key)
          ? "known"
          : newKeys.has(candidate.key)
            ? "new"
            : undefined;
    if (reportFinding.baselineState !== expectedState) return false;
  }

  if (schemaVersion === REPORT_SCHEMA_VERSION) {
    const report = value as unknown as PrivacySpecJsonReportV5;
    const apiCoverage = report.coverage.apiRequests;
    const engineCoverage = report.coverage.browserEngines;
    const hasUnavailableOrUnsupportedEngine =
      engineCoverage.tests.unavailable > 0 || engineCoverage.tests.unsupported > 0;
    const engineCapabilityStates = Object.values(engineCoverage.engines).flatMap((engine) =>
      engine.tests > 0 ? Object.values(engine.capabilities) : [],
    );
    const hasLimitedEngineCapability = engineCapabilityStates.some((state) => state !== "complete");
    const hasIncompleteAPI =
      apiCoverage.tests.unavailable > 0 ||
      apiCoverage.tests.partial > 0 ||
      apiCoverage.tests.unsupported > 0;
    const hasAPICall = apiCoverage.calls.seen > 0;
    const hasAPIFlow = parsedFlows.some((flow) => flow.requestSurface === "api-request");
    if (
      (report.run.complete === false &&
        (report.baseline.known.length > 0 || report.baseline.new.length > 0)) ||
      ((hasUnavailableOrUnsupportedEngine || hasLimitedEngineCapability || hasIncompleteAPI) &&
        (report.run.complete || report.coverage.observation.status === "complete")) ||
      hasAPICall !== (apiCoverage.tests.partial > 0 || apiCoverage.tests.unsupported > 0) ||
      (apiCoverage.calls.observed > 0 && apiCoverage.tests.partial === 0) ||
      (hasAPIFlow && (apiCoverage.calls.observed === 0 || report.run.complete))
    ) {
      return false;
    }
  }
  for (const diagnostic of value.diagnostics) {
    if (
      !isRecord(diagnostic) ||
      !hasExactKeys(diagnostic, ["code", "message"]) ||
      !isBoundedString(diagnostic.code, MAX_NAME_LENGTH) ||
      !isBoundedString(diagnostic.message, MAX_DIAGNOSTIC_LENGTH)
    ) {
      return false;
    }
  }
  if (!value.integrationErrors.every((error) => isBoundedString(error, MAX_DIAGNOSTIC_LENGTH))) {
    return false;
  }

  if (
    (schemaVersion === REPORT_SCHEMA_VERSION_V4 || schemaVersion === REPORT_SCHEMA_VERSION) &&
    !parseSecondaryAnalysis(value.analysis, value as unknown as PrivacySpecJsonReportV4)
  ) {
    return false;
  }

  const technicalFailures = value.findings.filter(
    (entry) => entry.finding.classification === "technical_failure",
  ).length;
  const reviewRequired = value.findings.filter(
    (entry) => entry.finding.classification === "review_required",
  ).length;
  const newReviewRequired = value.findings.filter(
    (entry) => entry.finding.classification === "review_required" && entry.baselineState === "new",
  ).length;
  const knownReviewRequired = value.findings.filter(
    (entry) =>
      entry.finding.classification === "review_required" && entry.baselineState === "known",
  ).length;
  return (
    value.summary.dataFlows === value.flows.length &&
    value.summary.findings.total === value.findings.length &&
    value.summary.findings.technicalFailures === technicalFailures &&
    value.summary.findings.reviewRequired === reviewRequired &&
    value.summary.findings.newReviewRequired === newReviewRequired &&
    value.summary.findings.knownReviewRequired === knownReviewRequired &&
    value.summary.baseline.known === (value.baseline.known as unknown[]).length &&
    value.summary.baseline.new === (value.baseline.new as unknown[]).length &&
    value.summary.baseline.resolved === (value.baseline.resolved as unknown[]).length
  );
};

export const parsePrivacySpecReportV1 = (value: unknown): PrivacySpecJsonReportV1 => {
  if (!parseReport(value) || value.schemaVersion !== REPORT_SCHEMA_VERSION_V1) {
    throw new ReportFormatError("Invalid or unsupported PrivacySpec JSON report schema.");
  }
  return value;
};

export const parsePrivacySpecReportV2 = (value: unknown): PrivacySpecJsonReportV2 => {
  if (!parseReport(value) || value.schemaVersion !== REPORT_SCHEMA_VERSION_V2) {
    throw new ReportFormatError("Invalid or unsupported PrivacySpec JSON report schema.");
  }
  return value;
};

export const parsePrivacySpecReportV3 = (value: unknown): PrivacySpecJsonReportV3 => {
  if (!parseReport(value) || value.schemaVersion !== REPORT_SCHEMA_VERSION_V3) {
    throw new ReportFormatError("Invalid or unsupported PrivacySpec JSON report schema.");
  }
  return value;
};

export const parsePrivacySpecReportV4 = (value: unknown): PrivacySpecJsonReportV4 => {
  if (!parseReport(value) || value.schemaVersion !== REPORT_SCHEMA_VERSION_V4) {
    throw new ReportFormatError("Invalid or unsupported PrivacySpec JSON report schema.");
  }
  return value;
};

export const parsePrivacySpecReportV5 = (value: unknown): PrivacySpecJsonReportV5 => {
  if (!parseReport(value) || value.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new ReportFormatError("Invalid or unsupported PrivacySpec JSON report schema.");
  }
  return value;
};

export const parsePrivacySpecReport = (value: unknown): PrivacySpecJsonReport => {
  if (!parseReport(value)) {
    throw new ReportFormatError("Invalid or unsupported PrivacySpec JSON report schema.");
  }
  return value;
};

const isMissingFileError = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";

export const readPrivacySpecReport = async (path: string): Promise<PrivacySpecJsonReport> => {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new ReportFormatError("No PrivacySpec JSON report is available.");
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.size > MAX_REPORT_FILE_BYTES) {
    throw new ReportFormatError("PrivacySpec JSON report is not a bounded regular file.");
  }
  const serialized = await readFile(path, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_FILE_BYTES) {
    throw new ReportFormatError("PrivacySpec JSON report exceeds the size limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new ReportFormatError("PrivacySpec JSON report is not valid JSON.");
  }
  return parsePrivacySpecReport(value);
};
