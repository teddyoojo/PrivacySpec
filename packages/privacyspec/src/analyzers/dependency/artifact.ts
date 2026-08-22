import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compareCanonicalStrings } from "../../canonical-order.js";
import {
  createDependencySemanticKey,
  DependencyBaselineFormatError,
  DependencyLatestRunIncompleteError,
  parseDependencyBaseline,
  parseDependencyLatestRun,
} from "./baseline.js";
import {
  type AcceptedDependencySemantic,
  DEPENDENCY_ANALYZER_ID,
  DEPENDENCY_ATTACHMENT_SCHEMA_VERSION,
  DEPENDENCY_BASELINE_SCHEMA_VERSION,
  DEPENDENCY_LATEST_RUN_SCHEMA_VERSION,
  DEPENDENCY_REPORT_SCHEMA_VERSION,
  type DependencyAnalyzerTestResult,
  type DependencyAttachment,
  type DependencyBaselineFile,
  type DependencyCoverageStatus,
  type DependencyDiagnostic,
  type DependencyFinding,
  type DependencyLatestRunFile,
  type DependencyReport,
  type DependencyResourceType,
  type DependencyRuleId,
  type DependencySemanticCandidate,
  type DependencySemanticCategory,
  type DependencyTestReference,
  type RuntimeDependencyInventoryEntry,
} from "./model.js";

export const DEPENDENCY_ATTACHMENT_NAME = "privacyspec-dependency-result";
export const DEPENDENCY_ATTACHMENT_CONTENT_TYPE = "application/json";
export const MAX_DEPENDENCY_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_DEPENDENCY_REPORT_ENTRIES = 10_000;

const coverageStates = new Set<DependencyCoverageStatus>([
  "complete",
  "partial",
  "incomplete",
  "unsupported",
]);
const resourceTypes = new Set<DependencyResourceType>([
  "script",
  "stylesheet",
  "font",
  "image",
  "fetch/xhr",
  "iframe",
  "websocket",
  "other",
]);
const findingRules = new Set<DependencyRuleId>([
  "NEW_EXTERNAL_ORIGIN",
  "NEW_EXTERNAL_SCRIPT",
  "NEW_EXTERNAL_IFRAME",
  "NEW_EXTERNAL_API",
]);
const diagnosticCodes = new Set<DependencyDiagnostic["code"]>([
  "DEPENDENCY_ANALYZER_FAILED",
  "DEPENDENCY_ANALYSIS_INCOMPLETE",
  "DEPENDENCY_LIMIT_REACHED",
]);
const MAX_ORIGIN_LENGTH = 2_048;
const MAX_FILE_LENGTH = 2_048;
const MAX_PROJECT_LENGTH = 512;
const MAX_DIAGNOSTIC_LENGTH = 256;
const MAX_TESTS_PER_ENTRY = 20;
const MAX_METHODS_PER_ENTRY = 16;

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
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      code !== undefined &&
      (code < 32 ||
        (code >= 127 && code <= 159) ||
        code === 0x2028 ||
        code === 0x2029 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069))
    ) {
      return false;
    }
  }
  return true;
};

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (!isSafeString(value, 64)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const parseTestReference = (value: unknown): DependencyTestReference | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["file", "project"]) ||
    !isSafeString(value.file, MAX_FILE_LENGTH) ||
    !isSafeString(value.project, MAX_PROJECT_LENGTH)
  ) {
    return undefined;
  }
  return { file: value.file, project: value.project };
};

const parseCanonicalOrigin = (value: unknown): { origin: string; host: string } | undefined => {
  if (!isSafeString(value, MAX_ORIGIN_LENGTH)) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return undefined;
    if (url.origin.toLowerCase() !== value || url.username !== "" || url.password !== "") {
      return undefined;
    }
    return { origin: value, host: url.hostname.toLowerCase().replace(/\.$/u, "") };
  } catch {
    return undefined;
  }
};

const isSortedUnique = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareCanonicalStrings(values[index - 1] ?? "", value) < 0,
  );

const compareTestReferences = (
  left: DependencyTestReference,
  right: DependencyTestReference,
): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

const areSortedUniqueTestReferences = (values: readonly DependencyTestReference[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareTestReferences(values[index - 1] ?? value, value) < 0,
  );

const canonicalInventory = (
  inventory: readonly RuntimeDependencyInventoryEntry[],
): RuntimeDependencyInventoryEntry[] =>
  inventory
    .map((entry) => ({
      ...entry,
      resourceTypes: [...entry.resourceTypes].sort(compareCanonicalStrings),
      requestMethods: [...entry.requestMethods].sort(compareCanonicalStrings),
      firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })).sort(compareTestReferences),
    }))
    .sort((left, right) => compareCanonicalStrings(left.origin, right.origin));

const canonicalDiagnostics = (
  diagnostics: readonly DependencyDiagnostic[],
): DependencyDiagnostic[] =>
  diagnostics
    .map((diagnostic) => ({ ...diagnostic }))
    .sort((left, right) => compareCanonicalStrings(left.code, right.code));

export const parseDependencyInventoryEntry = (
  value: unknown,
): RuntimeDependencyInventoryEntry | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "origin",
      "host",
      "boundary",
      "resourceTypes",
      "requestMethods",
      "firstSeenTests",
      "occurrenceCount",
    ]) ||
    value.kind !== "runtime-dependency" ||
    (value.boundary !== "first-party" && value.boundary !== "external") ||
    !Number.isSafeInteger(value.occurrenceCount) ||
    (value.occurrenceCount as number) <= 0
  ) {
    return undefined;
  }
  const target = parseCanonicalOrigin(value.origin);
  if (target === undefined || value.host !== target.host) return undefined;
  if (
    !Array.isArray(value.resourceTypes) ||
    value.resourceTypes.length === 0 ||
    value.resourceTypes.length > resourceTypes.size ||
    !value.resourceTypes.every(
      (resourceType): resourceType is DependencyResourceType =>
        typeof resourceType === "string" &&
        resourceTypes.has(resourceType as DependencyResourceType),
    ) ||
    !isSortedUnique(value.resourceTypes)
  ) {
    return undefined;
  }
  if (
    !Array.isArray(value.requestMethods) ||
    value.requestMethods.length === 0 ||
    value.requestMethods.length > MAX_METHODS_PER_ENTRY ||
    !value.requestMethods.every(
      (method) => typeof method === "string" && /^[A-Z0-9!#$%&'*+.^_`|~-]{1,32}$/u.test(method),
    ) ||
    !isSortedUnique(value.requestMethods)
  ) {
    return undefined;
  }
  if (
    !Array.isArray(value.firstSeenTests) ||
    value.firstSeenTests.length === 0 ||
    value.firstSeenTests.length > MAX_TESTS_PER_ENTRY
  ) {
    return undefined;
  }
  const firstSeenTests = value.firstSeenTests.map(parseTestReference);
  if (firstSeenTests.some((test) => test === undefined)) return undefined;
  if (!areSortedUniqueTestReferences(firstSeenTests as DependencyTestReference[])) return undefined;
  return {
    kind: "runtime-dependency",
    origin: target.origin,
    host: target.host,
    boundary: value.boundary,
    resourceTypes: [...value.resourceTypes],
    requestMethods: [...value.requestMethods],
    firstSeenTests: firstSeenTests as DependencyTestReference[],
    occurrenceCount: value.occurrenceCount as number,
  };
};

const parseInventory = (
  value: unknown,
  maxEntries: number,
): RuntimeDependencyInventoryEntry[] | undefined => {
  if (!Array.isArray(value) || value.length > maxEntries) return undefined;
  const entries = value.map(parseDependencyInventoryEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const parsed = entries as RuntimeDependencyInventoryEntry[];
  if (!isSortedUnique(parsed.map((entry) => entry.origin))) return undefined;
  return parsed;
};

const parseDiagnostic = (value: unknown): DependencyDiagnostic | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["code", "message"]) ||
    typeof value.code !== "string" ||
    !diagnosticCodes.has(value.code as DependencyDiagnostic["code"]) ||
    !isSafeString(value.message, MAX_DIAGNOSTIC_LENGTH)
  ) {
    return undefined;
  }
  return { code: value.code as DependencyDiagnostic["code"], message: value.message };
};

const parseDiagnostics = (value: unknown): DependencyDiagnostic[] | undefined => {
  if (!Array.isArray(value) || value.length > diagnosticCodes.size) return undefined;
  const diagnostics = value.map(parseDiagnostic);
  if (diagnostics.some((diagnostic) => diagnostic === undefined)) return undefined;
  const parsed = diagnostics as DependencyDiagnostic[];
  if (!isSortedUnique(parsed.map((diagnostic) => diagnostic.code))) return undefined;
  return parsed;
};

export const createDependencyAttachment = (
  result: DependencyAnalyzerTestResult | undefined,
  options: { failed: boolean },
): DependencyAttachment => {
  const attachment: DependencyAttachment =
    result !== undefined
      ? {
          schemaVersion: DEPENDENCY_ATTACHMENT_SCHEMA_VERSION,
          analyzerId: result.analyzerId,
          coverage: result.coverage,
          inventory: canonicalInventory(result.inventory),
          diagnostics: canonicalDiagnostics(result.diagnostics),
        }
      : {
          schemaVersion: DEPENDENCY_ATTACHMENT_SCHEMA_VERSION,
          analyzerId: DEPENDENCY_ANALYZER_ID,
          coverage: "incomplete",
          inventory: [],
          diagnostics: [
            options.failed
              ? {
                  code: "DEPENDENCY_ANALYZER_FAILED",
                  message:
                    "The dependency analyzer failed inside the bounded runtime analyzer host.",
                }
              : {
                  code: "DEPENDENCY_ANALYSIS_INCOMPLETE",
                  message:
                    "Runtime dependency analysis did not complete inside the finalization bound.",
                },
          ],
        };
  const parsed = parseDependencyAttachment(attachment);
  if (parsed === undefined) {
    throw new TypeError("Dependency attachment producer created an invalid artifact.");
  }
  return parsed;
};

export const parseDependencyAttachment = (value: unknown): DependencyAttachment | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "analyzerId", "coverage", "inventory", "diagnostics"]) ||
    value.schemaVersion !== DEPENDENCY_ATTACHMENT_SCHEMA_VERSION ||
    value.analyzerId !== DEPENDENCY_ANALYZER_ID ||
    typeof value.coverage !== "string" ||
    !coverageStates.has(value.coverage as DependencyCoverageStatus)
  ) {
    return undefined;
  }
  const inventory = parseInventory(value.inventory, 512);
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (inventory === undefined || diagnostics === undefined) return undefined;
  return {
    schemaVersion: DEPENDENCY_ATTACHMENT_SCHEMA_VERSION,
    analyzerId: DEPENDENCY_ANALYZER_ID,
    coverage: value.coverage as DependencyCoverageStatus,
    inventory,
    diagnostics,
  };
};

const ruleCategory: Readonly<Record<DependencyRuleId, DependencySemanticCategory>> = {
  NEW_EXTERNAL_ORIGIN: "origin",
  NEW_EXTERNAL_SCRIPT: "script",
  NEW_EXTERNAL_IFRAME: "iframe",
  NEW_EXTERNAL_API: "fetch/xhr",
};

const parseFinding = (value: unknown): DependencyFinding | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "ruleId",
      "classification",
      "identity",
      "host",
      "origin",
      "observedAs",
      "firstSeenTest",
    ]) ||
    value.kind !== "dependency-finding" ||
    typeof value.ruleId !== "string" ||
    !findingRules.has(value.ruleId as DependencyRuleId) ||
    value.classification !== "REVIEW_REQUIRED" ||
    !isSafeString(value.identity, 512) ||
    typeof value.observedAs !== "string" ||
    (!resourceTypes.has(value.observedAs as DependencyResourceType) &&
      value.observedAs !== "origin")
  ) {
    return undefined;
  }
  const target = parseCanonicalOrigin(value.origin);
  const firstSeenTest = parseTestReference(value.firstSeenTest);
  const ruleId = value.ruleId as DependencyRuleId;
  if (
    target === undefined ||
    value.host !== target.host ||
    value.observedAs !== ruleCategory[ruleId] ||
    value.identity !==
      createDependencySemanticKey(value.observedAs as DependencySemanticCategory, target.host) ||
    firstSeenTest === undefined
  ) {
    return undefined;
  }
  return {
    kind: "dependency-finding",
    ruleId,
    classification: "REVIEW_REQUIRED",
    identity: value.identity,
    host: target.host,
    origin: target.origin,
    observedAs: value.observedAs as DependencySemanticCategory,
    firstSeenTest,
  };
};

const compareFindings = (left: DependencyFinding, right: DependencyFinding): number =>
  compareCanonicalStrings(left.host, right.host) ||
  compareCanonicalStrings(left.ruleId, right.ruleId);

const areSortedUniqueFindings = (findings: readonly DependencyFinding[]): boolean =>
  findings.every(
    (finding, index) => index === 0 || compareFindings(findings[index - 1] ?? finding, finding) < 0,
  );

export const parseDependencyReport = (value: unknown): DependencyReport => {
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
    value.schemaVersion !== DEPENDENCY_REPORT_SCHEMA_VERSION ||
    !isCanonicalTimestamp(value.generatedAt) ||
    typeof value.complete !== "boolean" ||
    (value.coverage !== "unavailable" &&
      (typeof value.coverage !== "string" ||
        !coverageStates.has(value.coverage as DependencyCoverageStatus)))
  ) {
    throw new DependencyBaselineFormatError("Invalid dependency report schema.");
  }
  const inventory = parseInventory(value.inventory, MAX_DEPENDENCY_REPORT_ENTRIES);
  if (!Array.isArray(value.findings) || value.findings.length > MAX_DEPENDENCY_REPORT_ENTRIES) {
    throw new DependencyBaselineFormatError("Invalid dependency report findings.");
  }
  const findings = value.findings.map(parseFinding);
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (
    inventory === undefined ||
    findings.some((finding) => finding === undefined) ||
    !areSortedUniqueFindings(findings as DependencyFinding[]) ||
    diagnostics === undefined ||
    !isRecord(value.baseline) ||
    !hasExactKeys(value.baseline, ["exists", "known", "new", "resolved"]) ||
    typeof value.baseline.exists !== "boolean" ||
    ![value.baseline.known, value.baseline.new, value.baseline.resolved].every(
      (count) => Number.isSafeInteger(count) && (count as number) >= 0,
    )
  ) {
    throw new DependencyBaselineFormatError("Invalid dependency report content.");
  }
  return {
    schemaVersion: DEPENDENCY_REPORT_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    complete: value.complete,
    coverage: value.coverage as DependencyReport["coverage"],
    inventory,
    findings: findings as DependencyFinding[],
    baseline: {
      exists: value.baseline.exists,
      known: value.baseline.known as number,
      new: value.baseline.new as number,
      resolved: value.baseline.resolved as number,
    },
    diagnostics,
  };
};

const isMissingFileError = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";

const readBoundedJson = async (path: string): Promise<unknown | undefined> => {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > MAX_DEPENDENCY_ARTIFACT_BYTES) {
    throw new DependencyBaselineFormatError("Dependency artifact is not a bounded regular file.");
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DependencyBaselineFormatError("Dependency artifact is not valid JSON.");
    }
    throw error;
  }
};

const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_DEPENDENCY_ARTIFACT_BYTES) {
    throw new Error("Dependency artifact exceeds the size limit.");
  }
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!isMissingFileError(cleanupError)) throw cleanupError;
    }
    throw error;
  }
};

const canonicalTimestamp = (createdAt?: string): string => createdAt ?? new Date().toISOString();

export const readDependencyBaselineFile = async (
  path: string,
): Promise<DependencyBaselineFile | undefined> => {
  const value = await readBoundedJson(path);
  return value === undefined ? undefined : parseDependencyBaseline(value);
};

export const writeDependencyBaselineFile = async (
  path: string,
  dependencies: readonly DependencySemanticCandidate[],
  options: { createdAt?: string } = {},
): Promise<DependencyBaselineFile> => {
  const value = parseDependencyBaseline({
    schemaVersion: DEPENDENCY_BASELINE_SCHEMA_VERSION,
    createdAt: canonicalTimestamp(options.createdAt),
    dependencies: dependencies
      .map((dependency) => ({ ...dependency, status: "accepted" }))
      .sort((left, right) => compareCanonicalStrings(left.key, right.key)),
  });
  await writeAtomicJson(path, value);
  return value;
};

export const readDependencyLatestRunFile = async (
  path: string,
): Promise<DependencyLatestRunFile | undefined> => {
  const value = await readBoundedJson(path);
  return value === undefined ? undefined : parseDependencyLatestRun(value);
};

export const readCompleteDependencyLatestRunFile = async (
  path: string,
): Promise<DependencyLatestRunFile> => {
  const value = await readDependencyLatestRunFile(path);
  if (value === undefined) {
    throw new DependencyLatestRunIncompleteError("No dependency latest-run artifact is available.");
  }
  if (!value.complete) {
    throw new DependencyLatestRunIncompleteError(
      "The dependency latest-run artifact is incomplete and cannot replace the baseline.",
    );
  }
  return value;
};

export const writeDependencyLatestRunFile = async (
  path: string,
  dependencies: readonly DependencySemanticCandidate[],
  options: { complete: boolean; createdAt?: string },
): Promise<DependencyLatestRunFile> => {
  const value = parseDependencyLatestRun({
    schemaVersion: DEPENDENCY_LATEST_RUN_SCHEMA_VERSION,
    createdAt: canonicalTimestamp(options.createdAt),
    complete: options.complete,
    dependencies: dependencies
      .map((dependency) => ({ ...dependency }))
      .sort((left, right) => compareCanonicalStrings(left.key, right.key)),
  });
  await writeAtomicJson(path, value);
  return value;
};

export const invalidateDependencyLatestRunFile = (path: string): void => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
};

export const removeDependencyReportSync = (path: string): void => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
};

export const writeDependencyReport = async (
  path: string,
  report: DependencyReport,
): Promise<void> => {
  const canonical = parseDependencyReport({
    ...report,
    inventory: canonicalInventory(report.inventory),
    findings: report.findings
      .map((finding) => ({ ...finding, firstSeenTest: { ...finding.firstSeenTest } }))
      .sort(compareFindings),
    diagnostics: canonicalDiagnostics(report.diagnostics),
  });
  await writeAtomicJson(path, canonical);
};

export const readDependencyReport = async (path: string): Promise<DependencyReport> => {
  const value = await readBoundedJson(path);
  if (value === undefined) throw new DependencyBaselineFormatError("Dependency report not found.");
  return parseDependencyReport(value);
};

export const acceptedDependencyCandidates = (
  dependencies: readonly AcceptedDependencySemantic[],
): DependencySemanticCandidate[] =>
  dependencies.map(({ status: _status, ...dependency }) => dependency);
