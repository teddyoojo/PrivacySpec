import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compareCanonicalStrings } from "../../canonical-order.js";
import {
  parseSecurityBaseline,
  parseSecurityBaselineEntry,
  parseSecurityLatestRun,
  SecurityArtifactFormatError,
  SecurityLatestRunIncompleteError,
} from "./baseline.js";
import {
  SECURITY_ANALYZER_ID,
  SECURITY_SCHEMA_VERSION,
  type SecurityAnalyzerTestResult,
  type SecurityAttachment,
  type SecurityBaselineEntry,
  type SecurityBaselineFile,
  type SecurityCoverageStatus,
  type SecurityDiagnostic,
  type SecurityFinding,
  type SecurityLatestRunFile,
  type SecurityPostureInventoryEntry,
  type SecurityProperty,
  type SecurityReport,
  type SecurityRuleId,
  type SecurityTestReference,
} from "./model.js";

export const SECURITY_ATTACHMENT_NAME = "privacyspec-security-result";
export const SECURITY_ATTACHMENT_CONTENT_TYPE = "application/json";
export const MAX_SECURITY_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_SECURITY_REPORT_ENTRIES = 10_000;

const coverageStates = new Set<SecurityCoverageStatus>([
  "complete",
  "partial",
  "incomplete",
  "unsupported",
]);
const diagnosticCodes = new Set<SecurityDiagnostic["code"]>([
  "SECURITY_ANALYZER_FAILED",
  "SECURITY_ANALYSIS_INCOMPLETE",
  "SECURITY_LIMIT_REACHED",
]);
const ruleProperties: Readonly<Record<SecurityRuleId, SecurityProperty>> = {
  SECURITY_CSP_CHANGED: "csp",
  SECURITY_HSTS_CHANGED: "hsts",
  SECURITY_XCTO_CHANGED: "x-content-type-options",
  SECURITY_CORS_CHANGED: "cors",
  SECURITY_COOKIE_CHANGED: "cookie",
  SECURITY_TRANSPORT_CHANGED: "transport",
};

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
    return code < 32 || (code >= 127 && code <= 159);
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

const compareTestReferences = (left: SecurityTestReference, right: SecurityTestReference): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

const areSortedUniqueTestReferences = (values: readonly SecurityTestReference[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareTestReferences(values[index - 1] ?? value, value) < 0,
  );

const canonicalFingerprint = (
  fingerprint: SecurityPostureInventoryEntry["fingerprints"][number],
): SecurityPostureInventoryEntry["fingerprints"][number] => ({
  ...fingerprint,
  cookies: fingerprint.cookies
    .map((cookie) => ({ ...cookie }))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name)),
});

const canonicalFingerprints = (
  fingerprints: readonly SecurityPostureInventoryEntry["fingerprints"][number][],
): SecurityPostureInventoryEntry["fingerprints"] =>
  fingerprints
    .map(canonicalFingerprint)
    .sort((left, right) => compareCanonicalStrings(JSON.stringify(left), JSON.stringify(right)));

const canonicalInventory = (
  inventory: readonly SecurityPostureInventoryEntry[],
): SecurityPostureInventoryEntry[] =>
  inventory
    .map((entry) => ({
      ...entry,
      fingerprints: canonicalFingerprints(entry.fingerprints),
      firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })).sort(compareTestReferences),
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));

const canonicalBaselineEntries = (
  entries: readonly SecurityBaselineEntry[],
): SecurityBaselineEntry[] =>
  entries
    .map((entry) => ({
      ...entry,
      fingerprints: canonicalFingerprints(entry.fingerprints),
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));

const canonicalDiagnostics = (diagnostics: readonly SecurityDiagnostic[]): SecurityDiagnostic[] =>
  diagnostics
    .map((diagnostic) => ({ ...diagnostic }))
    .sort((left, right) => compareCanonicalStrings(left.code, right.code));

const parseTestReference = (value: unknown): SecurityTestReference | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["file", "project"]) ||
    !isSafeString(value.file, 2_048) ||
    !isSafeString(value.project, 512)
  )
    return undefined;
  return { file: value.file, project: value.project };
};

export const parseSecurityInventoryEntry = (
  value: unknown,
): SecurityPostureInventoryEntry | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "key",
      "host",
      "endpoint",
      "responseKind",
      "method",
      "fingerprints",
      "firstSeenTests",
      "occurrenceCount",
    ]) ||
    value.kind !== "security-posture" ||
    !Number.isSafeInteger(value.occurrenceCount) ||
    (value.occurrenceCount as number) <= 0 ||
    !Array.isArray(value.firstSeenTests) ||
    value.firstSeenTests.length === 0 ||
    value.firstSeenTests.length > 20
  )
    return undefined;
  const core = parseSecurityBaselineEntry({
    key: value.key,
    host: value.host,
    endpoint: value.endpoint,
    responseKind: value.responseKind,
    method: value.method,
    fingerprints: value.fingerprints,
    status: "accepted",
  });
  const tests = value.firstSeenTests.map(parseTestReference);
  if (core === undefined || tests.some((test) => test === undefined)) return undefined;
  if (!areSortedUniqueTestReferences(tests as SecurityTestReference[])) return undefined;
  return {
    kind: "security-posture",
    key: core.key,
    host: core.host,
    endpoint: core.endpoint,
    responseKind: core.responseKind,
    method: core.method,
    fingerprints: core.fingerprints,
    firstSeenTests: tests as SecurityTestReference[],
    occurrenceCount: value.occurrenceCount as number,
  };
};

const parseInventory = (
  value: unknown,
  maximum: number,
): SecurityPostureInventoryEntry[] | undefined => {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const entries = value.map(parseSecurityInventoryEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const parsed = entries as SecurityPostureInventoryEntry[];
  return isSortedUnique(parsed.map((entry) => entry.key)) ? parsed : undefined;
};

const parseDiagnostic = (value: unknown): SecurityDiagnostic | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["code", "message"]) ||
    typeof value.code !== "string" ||
    !diagnosticCodes.has(value.code as SecurityDiagnostic["code"]) ||
    !isSafeString(value.message, 256)
  )
    return undefined;
  return { code: value.code as SecurityDiagnostic["code"], message: value.message };
};
const parseDiagnostics = (value: unknown): SecurityDiagnostic[] | undefined => {
  if (!Array.isArray(value) || value.length > diagnosticCodes.size) return undefined;
  const diagnostics = value.map(parseDiagnostic);
  if (diagnostics.some((diagnostic) => diagnostic === undefined)) return undefined;
  const parsed = diagnostics as SecurityDiagnostic[];
  return isSortedUnique(parsed.map((diagnostic) => diagnostic.code)) ? parsed : undefined;
};

export const createSecurityAttachment = (
  result: SecurityAnalyzerTestResult | undefined,
  options: { failed: boolean },
): SecurityAttachment => {
  const attachment: SecurityAttachment =
    result === undefined
      ? {
          schemaVersion: SECURITY_SCHEMA_VERSION,
          analyzerId: SECURITY_ANALYZER_ID,
          coverage: "incomplete",
          inventory: [],
          diagnostics: [
            options.failed
              ? {
                  code: "SECURITY_ANALYZER_FAILED",
                  message: "The security analyzer failed inside the bounded runtime analyzer host.",
                }
              : {
                  code: "SECURITY_ANALYSIS_INCOMPLETE",
                  message:
                    "Security posture analysis did not complete inside the finalization bound.",
                },
          ],
        }
      : {
          schemaVersion: SECURITY_SCHEMA_VERSION,
          analyzerId: result.analyzerId,
          coverage: result.coverage,
          inventory: canonicalInventory(result.inventory),
          diagnostics: canonicalDiagnostics(result.diagnostics),
        };
  const parsed = parseSecurityAttachment(attachment);
  if (parsed === undefined) {
    throw new TypeError("Security attachment producer created an invalid artifact.");
  }
  return parsed;
};

export const parseSecurityAttachment = (value: unknown): SecurityAttachment | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "analyzerId", "coverage", "inventory", "diagnostics"]) ||
    value.schemaVersion !== SECURITY_SCHEMA_VERSION ||
    value.analyzerId !== SECURITY_ANALYZER_ID ||
    typeof value.coverage !== "string" ||
    !coverageStates.has(value.coverage as SecurityCoverageStatus)
  )
    return undefined;
  const inventory = parseInventory(value.inventory, 512);
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (inventory === undefined || diagnostics === undefined) return undefined;
  return {
    schemaVersion: SECURITY_SCHEMA_VERSION,
    analyzerId: SECURITY_ANALYZER_ID,
    coverage: value.coverage as SecurityCoverageStatus,
    inventory,
    diagnostics,
  };
};

const parseFinding = (value: unknown): SecurityFinding | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "ruleId",
      "classification",
      "identity",
      "host",
      "endpoint",
      "property",
      "previous",
      "current",
      "firstSeenTest",
    ]) ||
    value.kind !== "security-posture-finding" ||
    typeof value.ruleId !== "string" ||
    !Object.hasOwn(ruleProperties, value.ruleId) ||
    value.classification !== "REVIEW_REQUIRED" ||
    !isSafeString(value.identity, 4_096) ||
    !isSafeString(value.host, 255) ||
    !isSafeString(value.endpoint, 2_048) ||
    typeof value.property !== "string" ||
    !isSafeString(value.previous, 512) ||
    !isSafeString(value.current, 512)
  )
    return undefined;
  const ruleId = value.ruleId as SecurityRuleId;
  const test = parseTestReference(value.firstSeenTest);
  if (
    test === undefined ||
    value.property !== ruleProperties[ruleId] ||
    value.identity !== `${value.identity.split("|").slice(0, -1).join("|")}|${value.property}`
  )
    return undefined;
  return {
    kind: "security-posture-finding",
    ruleId,
    classification: "REVIEW_REQUIRED",
    identity: value.identity,
    host: value.host,
    endpoint: value.endpoint,
    property: value.property as SecurityProperty,
    previous: value.previous,
    current: value.current,
    firstSeenTest: test,
  };
};

const compareFindings = (left: SecurityFinding, right: SecurityFinding): number =>
  compareCanonicalStrings(left.identity, right.identity);

const areSortedUniqueFindings = (findings: readonly SecurityFinding[]): boolean =>
  findings.every(
    (finding, index) => index === 0 || compareFindings(findings[index - 1] ?? finding, finding) < 0,
  );

export const parseSecurityReport = (value: unknown): SecurityReport => {
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
    value.schemaVersion !== SECURITY_SCHEMA_VERSION ||
    !isTimestamp(value.generatedAt) ||
    typeof value.complete !== "boolean" ||
    (value.coverage !== "unavailable" &&
      (typeof value.coverage !== "string" ||
        !coverageStates.has(value.coverage as SecurityCoverageStatus)))
  )
    throw new SecurityArtifactFormatError("Invalid security posture report schema.");
  const inventory = parseInventory(value.inventory, MAX_SECURITY_REPORT_ENTRIES);
  const findings =
    Array.isArray(value.findings) && value.findings.length <= MAX_SECURITY_REPORT_ENTRIES
      ? value.findings.map(parseFinding)
      : [];
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (
    inventory === undefined ||
    !Array.isArray(value.findings) ||
    findings.length !== value.findings.length ||
    findings.some((finding) => finding === undefined) ||
    !areSortedUniqueFindings(findings as SecurityFinding[]) ||
    diagnostics === undefined ||
    !isRecord(value.baseline) ||
    !hasExactKeys(value.baseline, ["exists", "known", "changed", "newTargets", "resolved"]) ||
    typeof value.baseline.exists !== "boolean" ||
    ![
      value.baseline.known,
      value.baseline.changed,
      value.baseline.newTargets,
      value.baseline.resolved,
    ].every((count) => Number.isSafeInteger(count) && (count as number) >= 0)
  )
    throw new SecurityArtifactFormatError("Invalid security posture report content.");
  return {
    schemaVersion: SECURITY_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    complete: value.complete,
    coverage: value.coverage as SecurityReport["coverage"],
    inventory,
    findings: findings as SecurityFinding[],
    baseline: {
      exists: value.baseline.exists,
      known: value.baseline.known as number,
      changed: value.baseline.changed as number,
      newTargets: value.baseline.newTargets as number,
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
  if (!metadata.isFile() || metadata.size > MAX_SECURITY_ARTIFACT_BYTES)
    throw new SecurityArtifactFormatError(
      "Security posture artifact is not a bounded regular file.",
    );
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new SecurityArtifactFormatError("Security posture artifact is not valid JSON.");
    throw error;
  }
};
const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_SECURITY_ARTIFACT_BYTES)
    throw new Error("Security posture artifact exceeds the size limit.");
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

export const readSecurityBaselineFile = async (
  path: string,
): Promise<SecurityBaselineFile | undefined> => {
  const value = await readBoundedJson(path);
  return value === undefined ? undefined : parseSecurityBaseline(value);
};
export const writeSecurityBaselineFile = async (
  path: string,
  entries: readonly SecurityBaselineEntry[],
  options: { createdAt?: string } = {},
): Promise<SecurityBaselineFile> => {
  const value = parseSecurityBaseline({
    schemaVersion: SECURITY_SCHEMA_VERSION,
    createdAt: timestamp(options.createdAt),
    entries: canonicalBaselineEntries(entries),
  });
  await writeAtomicJson(path, value);
  return value;
};
export const readSecurityLatestRunFile = async (
  path: string,
): Promise<SecurityLatestRunFile | undefined> => {
  const value = await readBoundedJson(path);
  return value === undefined ? undefined : parseSecurityLatestRun(value);
};
export const readCompleteSecurityLatestRunFile = async (
  path: string,
): Promise<SecurityLatestRunFile> => {
  const value = await readSecurityLatestRunFile(path);
  if (value === undefined)
    throw new SecurityLatestRunIncompleteError(
      "No security posture latest-run artifact is available.",
    );
  if (!value.complete)
    throw new SecurityLatestRunIncompleteError(
      "The security posture latest-run artifact is incomplete and cannot replace the baseline.",
    );
  return value;
};
export const writeSecurityLatestRunFile = async (
  path: string,
  entries: readonly SecurityBaselineEntry[],
  options: { complete: boolean; createdAt?: string },
): Promise<SecurityLatestRunFile> => {
  const value = parseSecurityLatestRun({
    schemaVersion: SECURITY_SCHEMA_VERSION,
    createdAt: timestamp(options.createdAt),
    complete: options.complete,
    entries: canonicalBaselineEntries(entries),
  });
  await writeAtomicJson(path, value);
  return value;
};
export const writeSecurityReport = async (path: string, report: SecurityReport): Promise<void> =>
  writeAtomicJson(
    path,
    parseSecurityReport({
      ...report,
      inventory: canonicalInventory(report.inventory),
      findings: report.findings
        .map((finding) => ({ ...finding, firstSeenTest: { ...finding.firstSeenTest } }))
        .sort(compareFindings),
      diagnostics: canonicalDiagnostics(report.diagnostics),
    }),
  );
export const readSecurityReport = async (path: string): Promise<SecurityReport> => {
  const value = await readBoundedJson(path);
  if (value === undefined)
    throw new SecurityArtifactFormatError("Security posture report not found.");
  return parseSecurityReport(value);
};
const unlinkIfPresent = (path: string): void => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};
export const invalidateSecurityLatestRunFile = unlinkIfPresent;
export const removeSecurityReportSync = unlinkIfPresent;
