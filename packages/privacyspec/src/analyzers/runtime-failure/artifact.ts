import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compareCanonicalStrings } from "../../canonical-order.js";
import { createRuntimeFailureKey } from "./analyzer.js";
import {
  RUNTIME_FAILURE_ANALYZER_ID,
  RUNTIME_FAILURE_SCHEMA_VERSION,
  type RuntimeFailureAnalyzerTestResult,
  type RuntimeFailureAttachment,
  type RuntimeFailureBaselineEntry,
  type RuntimeFailureBaselineFile,
  type RuntimeFailureCoverageStatus,
  type RuntimeFailureDetails,
  type RuntimeFailureDiagnostic,
  type RuntimeFailureFinding,
  type RuntimeFailureInventoryEntry,
  type RuntimeFailureLatestRunFile,
  type RuntimeFailureReport,
  type RuntimeFailureTestReference,
  type RuntimeFailureType,
} from "./model.js";

export const RUNTIME_FAILURE_ATTACHMENT_NAME = "privacyspec-runtime-failure-result";
export const RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE = "application/json";
export const MAX_RUNTIME_FAILURE_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_ENTRIES = 10_000;
const MAX_TEST_ENTRIES = 512;
const MAX_TEST_REFERENCES = 20;

const coverageStates = new Set<RuntimeFailureCoverageStatus>([
  "complete",
  "partial",
  "incomplete",
  "unsupported",
]);
const failureTypes = new Set<RuntimeFailureType>([
  "page-error",
  "console-error",
  "request-failed",
  "http-5xx",
]);
const diagnosticCodes = new Set<RuntimeFailureDiagnostic["code"]>([
  "RUNTIME_FAILURE_ANALYZER_FAILED",
  "RUNTIME_FAILURE_ANALYSIS_INCOMPLETE",
  "RUNTIME_FAILURE_LIMIT_REACHED",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};
const isSafeString = (value: unknown, maxLength: number): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return false;
  return !Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  });
};
const isTimestamp = (value: unknown): value is string => {
  if (!isSafeString(value, 64)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};
const isSortedUnique = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareCanonicalStrings(values[index - 1] ?? "", value) < 0,
  );

const compareTestReferences = (
  left: RuntimeFailureTestReference,
  right: RuntimeFailureTestReference,
): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

const areSortedUniqueTestReferences = (values: readonly RuntimeFailureTestReference[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareTestReferences(values[index - 1] ?? value, value) < 0,
  );

const canonicalEntries = (
  entries: readonly RuntimeFailureBaselineEntry[],
): RuntimeFailureBaselineEntry[] =>
  entries
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));

const canonicalInventory = (
  inventory: readonly RuntimeFailureInventoryEntry[],
): RuntimeFailureInventoryEntry[] =>
  inventory
    .map((entry) => ({
      ...entry,
      firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })).sort(compareTestReferences),
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));

const canonicalDiagnostics = (
  diagnostics: readonly RuntimeFailureDiagnostic[],
): RuntimeFailureDiagnostic[] =>
  diagnostics
    .map((diagnostic) => ({ ...diagnostic }))
    .sort((left, right) => compareCanonicalStrings(left.code, right.code));
const isHost = (value: unknown): value is string => {
  if (!isSafeString(value, 255) || value !== value.toLowerCase()) return false;
  try {
    return new URL(`https://${value}`).hostname === value;
  } catch {
    return false;
  }
};

const detailKeys = [
  "boundary",
  "host",
  "method",
  "endpoint",
  "httpStatus",
  "errorName",
  "signature",
  "failureCode",
] as const;

const parseDetails = (
  value: Record<string, unknown>,
  failureType: RuntimeFailureType,
): RuntimeFailureDetails | undefined => {
  const boundary = value.boundary;
  const host = value.host;
  const method = value.method;
  const endpoint = value.endpoint;
  const httpStatus = value.httpStatus;
  const errorName = value.errorName;
  const signature = value.signature;
  const failureCode = value.failureCode;
  if (
    (boundary !== null && boundary !== "first-party" && boundary !== "external") ||
    (host !== null && !isHost(host)) ||
    (method !== null &&
      (!isSafeString(method, 32) || !/^[A-Z0-9!#$%&'*+.^_`|~-]+$/u.test(method))) ||
    (endpoint !== null && (!isSafeString(endpoint, 2_048) || !endpoint.startsWith("/"))) ||
    (httpStatus !== null &&
      (!Number.isSafeInteger(httpStatus) ||
        (httpStatus as number) < 100 ||
        (httpStatus as number) > 599)) ||
    (errorName !== null &&
      (!isSafeString(errorName, 64) || !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(errorName))) ||
    (signature !== null &&
      (typeof signature !== "string" || !/^sha256:[0-9a-f]{16}$/u.test(signature))) ||
    (failureCode !== null &&
      (typeof failureCode !== "string" ||
        !/^(?:ERR_[A-Z0-9_]{1,64}|REQUEST_FAILED)$/u.test(failureCode)))
  )
    return undefined;
  const details: RuntimeFailureDetails = {
    boundary: boundary as RuntimeFailureDetails["boundary"],
    host: host as string | null,
    method: method as string | null,
    endpoint: endpoint as string | null,
    httpStatus: httpStatus as number | null,
    errorName: errorName as string | null,
    signature: signature as string | null,
    failureCode: failureCode as string | null,
  };
  const valid =
    failureType === "page-error"
      ? details.errorName !== null &&
        details.signature !== null &&
        boundary === null &&
        host === null &&
        method === null &&
        endpoint === null &&
        httpStatus === null &&
        failureCode === null
      : failureType === "console-error"
        ? details.signature !== null &&
          boundary === null &&
          host === null &&
          method === null &&
          endpoint === null &&
          httpStatus === null &&
          errorName === null &&
          failureCode === null
        : failureType === "request-failed"
          ? boundary !== null &&
            host !== null &&
            method !== null &&
            endpoint !== null &&
            failureCode !== null &&
            httpStatus === null &&
            errorName === null &&
            signature === null
          : boundary === "first-party" &&
            host !== null &&
            method !== null &&
            endpoint !== null &&
            typeof httpStatus === "number" &&
            httpStatus >= 500 &&
            errorName === null &&
            signature === null &&
            failureCode === null;
  return valid ? details : undefined;
};

const expectedSummary = (type: RuntimeFailureType, details: RuntimeFailureDetails): string => {
  if (type === "page-error") return `Uncaught ${details.errorName}`;
  if (type === "console-error") return "Browser console error";
  if (type === "request-failed") return "Network request failed";
  return `First-party HTTP ${details.httpStatus}`;
};

const parseTestReference = (value: unknown): RuntimeFailureTestReference | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["file", "project"]) ||
    !isSafeString(value.file, 2_048) ||
    !isSafeString(value.project, 512)
  )
    return undefined;
  return { file: value.file, project: value.project };
};

const parseSemantic = (
  value: unknown,
  accepted: boolean,
): RuntimeFailureBaselineEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = ["key", "failureType", "severity", "summary", ...detailKeys];
  if (accepted) keys.push("status");
  if (
    !hasExactKeys(value, keys) ||
    !isSafeString(value.key, 3_000) ||
    typeof value.failureType !== "string" ||
    !failureTypes.has(value.failureType as RuntimeFailureType) ||
    (value.severity !== "ERROR" && value.severity !== "REVIEW") ||
    !isSafeString(value.summary, 128) ||
    (accepted && value.status !== "accepted")
  )
    return undefined;
  const failureType = value.failureType as RuntimeFailureType;
  const details = parseDetails(value, failureType);
  if (details === undefined || value.summary !== expectedSummary(failureType, details))
    return undefined;
  const key = createRuntimeFailureKey({ failureType, details });
  if (value.key !== key) return undefined;
  const expectedSeverity =
    failureType === "page-error" || failureType === "http-5xx" ? "ERROR" : "REVIEW";
  if (value.severity !== expectedSeverity) return undefined;
  return {
    key,
    failureType,
    severity: expectedSeverity,
    summary: value.summary,
    ...details,
    status: "accepted",
  };
};

const parseInventoryEntry = (value: unknown): RuntimeFailureInventoryEntry | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "key",
      "failureType",
      "severity",
      "summary",
      ...detailKeys,
      "firstSeenTests",
      "occurrenceCount",
    ]) ||
    value.kind !== "runtime-failure" ||
    !Number.isSafeInteger(value.occurrenceCount) ||
    (value.occurrenceCount as number) <= 0 ||
    !Array.isArray(value.firstSeenTests) ||
    value.firstSeenTests.length === 0 ||
    value.firstSeenTests.length > MAX_TEST_REFERENCES
  )
    return undefined;
  const semantic = parseSemantic(
    {
      key: value.key,
      failureType: value.failureType,
      severity: value.severity,
      summary: value.summary,
      ...Object.fromEntries(detailKeys.map((key) => [key, value[key]])),
      status: "accepted",
    },
    true,
  );
  const tests = value.firstSeenTests.map(parseTestReference);
  if (semantic === undefined || tests.some((test) => test === undefined)) return undefined;
  if (!areSortedUniqueTestReferences(tests as RuntimeFailureTestReference[])) return undefined;
  const { status: _status, ...entry } = semantic;
  return {
    kind: "runtime-failure",
    ...entry,
    firstSeenTests: tests as RuntimeFailureTestReference[],
    occurrenceCount: value.occurrenceCount as number,
  };
};

const parseEntries = (value: unknown, max: number): RuntimeFailureBaselineEntry[] | undefined => {
  if (!Array.isArray(value) || value.length > max) return undefined;
  const entries = value.map((entry) => parseSemantic(entry, true));
  if (entries.some((entry) => entry === undefined)) return undefined;
  const parsed = entries as RuntimeFailureBaselineEntry[];
  return isSortedUnique(parsed.map((entry) => entry.key)) ? parsed : undefined;
};
const parseInventory = (
  value: unknown,
  max: number,
): RuntimeFailureInventoryEntry[] | undefined => {
  if (!Array.isArray(value) || value.length > max) return undefined;
  const entries = value.map(parseInventoryEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const parsed = entries as RuntimeFailureInventoryEntry[];
  return isSortedUnique(parsed.map((entry) => entry.key)) ? parsed : undefined;
};

const parseDiagnostic = (value: unknown): RuntimeFailureDiagnostic | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["code", "message"]) ||
    typeof value.code !== "string" ||
    !diagnosticCodes.has(value.code as RuntimeFailureDiagnostic["code"]) ||
    !isSafeString(value.message, 256)
  )
    return undefined;
  return { code: value.code as RuntimeFailureDiagnostic["code"], message: value.message };
};
const parseDiagnostics = (value: unknown): RuntimeFailureDiagnostic[] | undefined => {
  if (!Array.isArray(value) || value.length > diagnosticCodes.size) return undefined;
  const diagnostics = value.map(parseDiagnostic);
  if (diagnostics.some((entry) => entry === undefined)) return undefined;
  const parsed = diagnostics as RuntimeFailureDiagnostic[];
  return isSortedUnique(parsed.map((entry) => entry.code)) ? parsed : undefined;
};

const ruleFor: Readonly<Record<RuntimeFailureType, RuntimeFailureFinding["ruleId"]>> = {
  "page-error": "RUNTIME_PAGE_ERROR",
  "console-error": "RUNTIME_CONSOLE_ERROR",
  "request-failed": "RUNTIME_REQUEST_FAILED",
  "http-5xx": "RUNTIME_HTTP_5XX",
};
const parseFinding = (value: unknown): RuntimeFailureFinding | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "ruleId",
      "classification",
      "identity",
      "failureType",
      "severity",
      "summary",
      ...detailKeys,
      "firstSeenTest",
      "occurrenceCount",
    ]) ||
    value.kind !== "runtime-failure-finding" ||
    !Number.isSafeInteger(value.occurrenceCount) ||
    (value.occurrenceCount as number) <= 0
  )
    return undefined;
  const semantic = parseSemantic(
    {
      key: value.identity,
      failureType: value.failureType,
      severity: value.severity,
      summary: value.summary,
      ...Object.fromEntries(detailKeys.map((key) => [key, value[key]])),
      status: "accepted",
    },
    true,
  );
  const test = parseTestReference(value.firstSeenTest);
  if (
    semantic === undefined ||
    test === undefined ||
    value.ruleId !== ruleFor[semantic.failureType] ||
    value.classification !==
      (semantic.severity === "ERROR" ? "TECHNICAL_FAILURE" : "REVIEW_REQUIRED")
  )
    return undefined;
  const { key: identity, status: _status, ...entry } = semantic;
  return {
    kind: "runtime-failure-finding",
    ruleId: ruleFor[semantic.failureType],
    classification: semantic.severity === "ERROR" ? "TECHNICAL_FAILURE" : "REVIEW_REQUIRED",
    identity,
    ...entry,
    firstSeenTest: test,
    occurrenceCount: value.occurrenceCount as number,
  };
};

const compareFindings = (left: RuntimeFailureFinding, right: RuntimeFailureFinding): number =>
  compareCanonicalStrings(left.identity, right.identity);

const areSortedUniqueFindings = (findings: readonly RuntimeFailureFinding[]): boolean =>
  findings.every(
    (finding, index) => index === 0 || compareFindings(findings[index - 1] ?? finding, finding) < 0,
  );

export class RuntimeFailureArtifactFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeFailureArtifactFormatError";
  }
}
export class RuntimeFailureLatestRunIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeFailureLatestRunIncompleteError";
  }
}

export const parseRuntimeFailureBaseline = (value: unknown): RuntimeFailureBaselineFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "entries"]) ||
    value.schemaVersion !== RUNTIME_FAILURE_SCHEMA_VERSION ||
    !isTimestamp(value.createdAt)
  )
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure baseline schema.");
  const entries = parseEntries(value.entries, MAX_ARTIFACT_ENTRIES);
  if (entries === undefined)
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure baseline entries.");
  return { schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION, createdAt: value.createdAt, entries };
};
export const parseRuntimeFailureLatestRun = (value: unknown): RuntimeFailureLatestRunFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "complete", "entries"]) ||
    value.schemaVersion !== RUNTIME_FAILURE_SCHEMA_VERSION ||
    !isTimestamp(value.createdAt) ||
    typeof value.complete !== "boolean"
  )
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure latest-run schema.");
  const entries = parseEntries(value.entries, MAX_ARTIFACT_ENTRIES);
  if (entries === undefined)
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure latest-run entries.");
  return {
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    createdAt: value.createdAt,
    complete: value.complete,
    entries,
  };
};

export const createRuntimeFailureAttachment = (
  result: RuntimeFailureAnalyzerTestResult | undefined,
  options: { failed: boolean },
): RuntimeFailureAttachment => {
  const attachment: RuntimeFailureAttachment =
    result === undefined
      ? {
          schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
          analyzerId: RUNTIME_FAILURE_ANALYZER_ID,
          coverage: "incomplete",
          inventory: [],
          diagnostics: [
            options.failed
              ? {
                  code: "RUNTIME_FAILURE_ANALYZER_FAILED",
                  message:
                    "The runtime failure analyzer failed inside the bounded runtime analyzer host.",
                }
              : {
                  code: "RUNTIME_FAILURE_ANALYSIS_INCOMPLETE",
                  message:
                    "Runtime failure analysis did not complete inside the finalization bound.",
                },
          ],
        }
      : {
          schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
          analyzerId: result.analyzerId,
          coverage: result.coverage,
          inventory: canonicalInventory(result.inventory),
          diagnostics: canonicalDiagnostics(result.diagnostics),
        };
  const parsed = parseRuntimeFailureAttachment(attachment);
  if (parsed === undefined) {
    throw new TypeError("Runtime failure attachment producer created an invalid artifact.");
  }
  return parsed;
};

export const parseRuntimeFailureAttachment = (
  value: unknown,
): RuntimeFailureAttachment | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "analyzerId", "coverage", "inventory", "diagnostics"]) ||
    value.schemaVersion !== RUNTIME_FAILURE_SCHEMA_VERSION ||
    value.analyzerId !== RUNTIME_FAILURE_ANALYZER_ID ||
    typeof value.coverage !== "string" ||
    !coverageStates.has(value.coverage as RuntimeFailureCoverageStatus)
  )
    return undefined;
  const inventory = parseInventory(value.inventory, MAX_TEST_ENTRIES);
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (inventory === undefined || diagnostics === undefined) return undefined;
  return {
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    analyzerId: RUNTIME_FAILURE_ANALYZER_ID,
    coverage: value.coverage as RuntimeFailureCoverageStatus,
    inventory,
    diagnostics,
  };
};

export const parseRuntimeFailureReport = (value: unknown): RuntimeFailureReport => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "generatedAt",
      "complete",
      "coverage",
      "inventory",
      "findings",
      "baseline",
      "diagnostics",
    ]) ||
    value.schemaVersion !== RUNTIME_FAILURE_SCHEMA_VERSION ||
    !isTimestamp(value.generatedAt) ||
    typeof value.complete !== "boolean" ||
    (value.coverage !== "unavailable" &&
      (typeof value.coverage !== "string" ||
        !coverageStates.has(value.coverage as RuntimeFailureCoverageStatus)))
  )
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure report schema.");
  const inventory = parseInventory(value.inventory, MAX_ARTIFACT_ENTRIES);
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (
    !Array.isArray(value.findings) ||
    value.findings.length > MAX_ARTIFACT_ENTRIES ||
    !isRecord(value.baseline) ||
    !hasExactKeys(value.baseline, ["exists", "known", "new", "resolved"]) ||
    typeof value.baseline.exists !== "boolean" ||
    ![value.baseline.known, value.baseline.new, value.baseline.resolved].every(
      (count) => Number.isSafeInteger(count) && (count as number) >= 0,
    )
  )
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure report content.");
  const findings = value.findings.map(parseFinding);
  if (
    inventory === undefined ||
    diagnostics === undefined ||
    findings.some((entry) => entry === undefined) ||
    !areSortedUniqueFindings(findings as RuntimeFailureFinding[])
  )
    throw new RuntimeFailureArtifactFormatError("Invalid runtime failure report entries.");
  return {
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    complete: value.complete,
    coverage: value.coverage as RuntimeFailureReport["coverage"],
    inventory,
    findings: findings as RuntimeFailureFinding[],
    baseline: {
      exists: value.baseline.exists,
      known: value.baseline.known as number,
      new: value.baseline.new as number,
      resolved: value.baseline.resolved as number,
    },
    diagnostics,
  };
};

const isMissing = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";
const readBoundedJson = async (path: string): Promise<unknown | undefined> => {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > MAX_RUNTIME_FAILURE_ARTIFACT_BYTES)
    throw new RuntimeFailureArtifactFormatError(
      "Runtime failure artifact is not a bounded regular file.",
    );
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new RuntimeFailureArtifactFormatError("Runtime failure artifact is not valid JSON.");
    throw error;
  }
};
const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_RUNTIME_FAILURE_ARTIFACT_BYTES)
    throw new Error("Runtime failure artifact exceeds the size limit.");
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (!isMissing(cleanupError)) throw cleanupError;
    }
    throw error;
  }
};
const timestamp = (createdAt?: string): string => createdAt ?? new Date().toISOString();

export const readRuntimeFailureBaselineFile = async (
  path: string,
): Promise<RuntimeFailureBaselineFile | undefined> => {
  const value = await readBoundedJson(path);
  return value === undefined ? undefined : parseRuntimeFailureBaseline(value);
};
export const writeRuntimeFailureBaselineFile = async (
  path: string,
  entries: readonly RuntimeFailureBaselineEntry[],
  options: { createdAt?: string } = {},
): Promise<RuntimeFailureBaselineFile> => {
  const value = parseRuntimeFailureBaseline({
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    createdAt: timestamp(options.createdAt),
    entries: canonicalEntries(entries),
  });
  await writeAtomicJson(path, value);
  return value;
};
export const readRuntimeFailureLatestRunFile = async (
  path: string,
): Promise<RuntimeFailureLatestRunFile | undefined> => {
  const value = await readBoundedJson(path);
  return value === undefined ? undefined : parseRuntimeFailureLatestRun(value);
};
export const readCompleteRuntimeFailureLatestRunFile = async (
  path: string,
): Promise<RuntimeFailureLatestRunFile> => {
  const value = await readRuntimeFailureLatestRunFile(path);
  if (value === undefined)
    throw new RuntimeFailureLatestRunIncompleteError(
      "No runtime failure latest-run artifact is available.",
    );
  if (!value.complete)
    throw new RuntimeFailureLatestRunIncompleteError(
      "The runtime failure latest-run artifact is incomplete and cannot replace the baseline.",
    );
  return value;
};
export const writeRuntimeFailureLatestRunFile = async (
  path: string,
  entries: readonly RuntimeFailureBaselineEntry[],
  options: { complete: boolean; createdAt?: string },
): Promise<RuntimeFailureLatestRunFile> => {
  const value = parseRuntimeFailureLatestRun({
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    createdAt: timestamp(options.createdAt),
    complete: options.complete,
    entries: canonicalEntries(entries),
  });
  await writeAtomicJson(path, value);
  return value;
};
export const writeRuntimeFailureReport = async (
  path: string,
  report: RuntimeFailureReport,
): Promise<void> =>
  writeAtomicJson(
    path,
    parseRuntimeFailureReport({
      ...report,
      inventory: canonicalInventory(report.inventory),
      findings: report.findings
        .map((finding) => ({ ...finding, firstSeenTest: { ...finding.firstSeenTest } }))
        .sort(compareFindings),
      diagnostics: canonicalDiagnostics(report.diagnostics),
    }),
  );
export const readRuntimeFailureReport = async (path: string): Promise<RuntimeFailureReport> => {
  const value = await readBoundedJson(path);
  if (value === undefined)
    throw new RuntimeFailureArtifactFormatError("Runtime failure report not found.");
  return parseRuntimeFailureReport(value);
};
const unlinkIfPresent = (path: string): void => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};
export const invalidateRuntimeFailureLatestRunFile = unlinkIfPresent;
export const removeRuntimeFailureReportSync = unlinkIfPresent;
