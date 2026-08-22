import { compareCanonicalStrings } from "../../canonical-order.js";
import { DEPENDENCY_ANALYSIS_MODULE, namespacedAnalysisIdentity } from "../../runtime/modules.js";
import {
  type AcceptedDependencySemantic,
  DEPENDENCY_BASELINE_SCHEMA_VERSION,
  DEPENDENCY_LATEST_RUN_SCHEMA_VERSION,
  type DependencyBaselineComparison,
  type DependencyBaselineFile,
  type DependencyFinding,
  type DependencyLatestRunFile,
  type DependencyResourceType,
  type DependencySemanticCandidate,
  type DependencySemanticCategory,
  type DependencyTestReference,
  type RuntimeDependencyInventoryEntry,
} from "./model.js";

export const MAX_DEPENDENCY_BASELINE_ENTRIES = 10_000;

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
const semanticCategories = new Set<DependencySemanticCategory>(["origin", ...resourceTypes]);
const MAX_HOST_LENGTH = 255;
const MAX_KEY_LENGTH = 512;
const MAX_CREATED_AT_LENGTH = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, required: readonly string[]): boolean => {
  const expected = new Set(required);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

const isSafeString = (value: unknown, maxLength: number): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return false;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 32 || (code >= 127 && code <= 159))) return false;
  }
  return true;
};

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (!isSafeString(value, MAX_CREATED_AT_LENGTH)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const isCanonicalHost = (value: unknown): value is string => {
  if (!isSafeString(value, MAX_HOST_LENGTH) || value !== value.toLowerCase()) return false;
  try {
    const parsed = new URL(`https://${value}`);
    return parsed.hostname === value && parsed.port === "" && parsed.pathname === "/";
  } catch {
    return false;
  }
};

export const createDependencySemanticKey = (
  category: DependencySemanticCategory,
  host: string,
): string => {
  const identityCategory = category === "fetch/xhr" ? "api" : category;
  return namespacedAnalysisIdentity(
    DEPENDENCY_ANALYSIS_MODULE,
    `external-${identityCategory}|${host}`,
  );
};

const canonicalCandidate = (
  category: DependencySemanticCategory,
  host: string,
): DependencySemanticCandidate => ({
  key: createDependencySemanticKey(category, host),
  boundary: "external",
  category,
  host,
});

export const createDependencySemanticCandidates = (
  inventory: readonly RuntimeDependencyInventoryEntry[],
): DependencySemanticCandidate[] => {
  const byKey = new Map<string, DependencySemanticCandidate>();
  for (const entry of inventory) {
    if (entry.boundary !== "external") continue;
    const origin = canonicalCandidate("origin", entry.host);
    byKey.set(origin.key, origin);
    for (const resourceType of entry.resourceTypes) {
      const candidate = canonicalCandidate(resourceType, entry.host);
      byKey.set(candidate.key, candidate);
    }
  }
  return Array.from(byKey.values()).sort((left, right) =>
    compareCanonicalStrings(left.key, right.key),
  );
};

const findingRule = (
  category: DependencySemanticCategory,
): DependencyFinding["ruleId"] | undefined => {
  if (category === "origin") return "NEW_EXTERNAL_ORIGIN";
  if (category === "script") return "NEW_EXTERNAL_SCRIPT";
  if (category === "iframe") return "NEW_EXTERNAL_IFRAME";
  if (category === "fetch/xhr") return "NEW_EXTERNAL_API";
  return undefined;
};

const compareTestReference = (
  left: DependencyTestReference,
  right: DependencyTestReference,
): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

const evidenceFor = (
  candidate: DependencySemanticCandidate,
  inventory: readonly RuntimeDependencyInventoryEntry[],
): { origin: string; test: DependencyTestReference } | undefined => {
  const entries = inventory
    .filter(
      (entry) =>
        entry.boundary === "external" &&
        entry.host === candidate.host &&
        (candidate.category === "origin" || entry.resourceTypes.includes(candidate.category)),
    )
    .sort((left, right) => compareCanonicalStrings(left.origin, right.origin));
  const tests = entries.flatMap((entry) => entry.firstSeenTests).sort(compareTestReference);
  const origin = entries[0]?.origin;
  const test = tests[0];
  return origin === undefined || test === undefined ? undefined : { origin, test };
};

export const compareDependencyBaseline = (
  inventory: readonly RuntimeDependencyInventoryEntry[],
  baseline?: DependencyBaselineFile,
): DependencyBaselineComparison => {
  const observed = createDependencySemanticCandidates(inventory);
  const baselineByKey = new Map((baseline?.dependencies ?? []).map((entry) => [entry.key, entry]));
  const observedKeys = new Set(observed.map((entry) => entry.key));
  const known = observed.filter((entry) => baselineByKey.has(entry.key));
  const newlyObserved = observed.filter((entry) => !baselineByKey.has(entry.key));
  const resolved = (baseline?.dependencies ?? [])
    .filter((entry) => !observedKeys.has(entry.key))
    .slice()
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));
  const findings: DependencyFinding[] = [];
  for (const candidate of newlyObserved) {
    const ruleId = findingRule(candidate.category);
    const evidence = evidenceFor(candidate, inventory);
    if (ruleId === undefined || evidence === undefined) continue;
    findings.push({
      kind: "dependency-finding",
      ruleId,
      classification: "REVIEW_REQUIRED",
      identity: candidate.key,
      host: candidate.host,
      origin: evidence.origin,
      observedAs: candidate.category,
      firstSeenTest: evidence.test,
    });
  }
  findings.sort(
    (left, right) =>
      compareCanonicalStrings(left.host, right.host) ||
      compareCanonicalStrings(left.ruleId, right.ruleId),
  );
  return { observed, known, new: newlyObserved, resolved, findings };
};

export class DependencyBaselineFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyBaselineFormatError";
  }
}

export class DependencyLatestRunIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyLatestRunIncompleteError";
  }
}

const parseCandidate = (
  value: unknown,
  accepted: boolean,
): DependencySemanticCandidate | AcceptedDependencySemantic | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = accepted
    ? ["key", "boundary", "category", "host", "status"]
    : ["key", "boundary", "category", "host"];
  if (!hasExactKeys(value, keys)) return undefined;
  if (
    !isSafeString(value.key, MAX_KEY_LENGTH) ||
    value.boundary !== "external" ||
    typeof value.category !== "string" ||
    !semanticCategories.has(value.category as DependencySemanticCategory) ||
    !isCanonicalHost(value.host) ||
    (accepted && value.status !== "accepted")
  ) {
    return undefined;
  }
  const candidate = canonicalCandidate(value.category as DependencySemanticCategory, value.host);
  if (candidate.key !== value.key) return undefined;
  return accepted ? { ...candidate, status: "accepted" } : candidate;
};

const parseCandidates = (
  value: unknown,
  accepted: boolean,
): Array<DependencySemanticCandidate | AcceptedDependencySemantic> | undefined => {
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCY_BASELINE_ENTRIES) return undefined;
  const parsed: Array<DependencySemanticCandidate | AcceptedDependencySemantic> = [];
  for (const item of value) {
    const candidate = parseCandidate(item, accepted);
    if (candidate === undefined) return undefined;
    parsed.push(candidate);
  }
  if (
    !parsed.every(
      (candidate, index) =>
        index === 0 || compareCanonicalStrings(parsed[index - 1]?.key ?? "", candidate.key) < 0,
    )
  ) {
    return undefined;
  }
  return parsed;
};

export const parseDependencyBaseline = (value: unknown): DependencyBaselineFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "dependencies"]) ||
    value.schemaVersion !== DEPENDENCY_BASELINE_SCHEMA_VERSION ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    throw new DependencyBaselineFormatError("Invalid dependency baseline schema.");
  }
  const dependencies = parseCandidates(value.dependencies, true);
  if (dependencies === undefined) {
    throw new DependencyBaselineFormatError("Invalid dependency baseline entries.");
  }
  return {
    schemaVersion: DEPENDENCY_BASELINE_SCHEMA_VERSION,
    createdAt: value.createdAt,
    dependencies: dependencies as AcceptedDependencySemantic[],
  };
};

export const parseDependencyLatestRun = (value: unknown): DependencyLatestRunFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "complete", "dependencies"]) ||
    value.schemaVersion !== DEPENDENCY_LATEST_RUN_SCHEMA_VERSION ||
    !isCanonicalTimestamp(value.createdAt) ||
    typeof value.complete !== "boolean"
  ) {
    throw new DependencyBaselineFormatError("Invalid dependency latest-run schema.");
  }
  const dependencies = parseCandidates(value.dependencies, false);
  if (dependencies === undefined) {
    throw new DependencyBaselineFormatError("Invalid dependency latest-run entries.");
  }
  return {
    schemaVersion: DEPENDENCY_LATEST_RUN_SCHEMA_VERSION,
    createdAt: value.createdAt,
    complete: value.complete,
    dependencies: dependencies as DependencySemanticCandidate[],
  };
};
