import { lstat, readFile } from "node:fs/promises";
import { compareCanonicalStrings } from "../canonical-order.js";
import { isDataCategory } from "../discovery/source-model.js";
import { MAX_REPORT_FILE_BYTES } from "../report/json.js";
import { parseAPIRequestReportCoverage, parseBrowserEngineReportCoverage } from "../report/read.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SCHEMA_VERSION_V1,
  type ReadablePrivacySpecEvidence,
} from "./model.js";

export class EvidenceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceFormatError";
  }
}

const MAX_ITEMS = 100_000;
const MAX_TEXT = 8_192;
const MAX_JSON_DEPTH = 16;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
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

const safeText = (value: unknown, maximum = MAX_TEXT, allowEmpty = false): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (allowEmpty || value.length > 0) &&
  !containsUnsafeCharacter(value) &&
  !/[^\s@]+@[^\s@]+\.[^\s@]+/u.test(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown): value is string => {
  if (!safeText(value, 64)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const boundedJson = (root: unknown): boolean => {
  const stack: Array<{ value: unknown; depth: number; ancestors: object[] }> = [
    { value: root, depth: 0, ancestors: [] },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > 50_000 || current.depth > MAX_JSON_DEPTH) return false;
    if (typeof current.value === "string") {
      if (!safeText(current.value, MAX_TEXT, true)) return false;
      continue;
    }
    if (typeof current.value === "number" && !Number.isFinite(current.value)) return false;
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.ancestors.includes(current.value)) return false;
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      if (Object.getOwnPropertySymbols(current.value).length > 0) return false;
      descriptors = Object.getOwnPropertyDescriptors(current.value);
    } catch {
      return false;
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(current.value) && key === "length") continue;
      if (!("value" in descriptor) || !descriptor.enumerable || !safeText(key, 512)) return false;
      stack.push({
        value: descriptor.value,
        depth: current.depth + 1,
        ancestors: [...current.ancestors, current.value],
      });
    }
  }
  return true;
};

const canonicalArray = <T>(
  value: unknown,
  parse: (candidate: unknown) => T | undefined,
  identity: (entry: T) => string,
  maximum = MAX_ITEMS,
): T[] | undefined => {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: T[] = [];
  let previous: string | undefined;
  for (const candidate of value) {
    const parsed = parse(candidate);
    if (parsed === undefined) return undefined;
    const key = identity(parsed);
    if (previous !== undefined && compareCanonicalStrings(previous, key) >= 0) return undefined;
    previous = key;
    result.push(parsed);
  }
  return result;
};

const strings = (value: unknown, maximum = 100, canonical = false): string[] | undefined => {
  if (!Array.isArray(value) || value.length > maximum || !value.every((entry) => safeText(entry)))
    return undefined;
  const result = [...value] as string[];
  if (new Set(result).size !== result.length) return undefined;
  if (
    canonical &&
    result.some(
      (entry, index) =>
        index > 0 && compareCanonicalStrings(result[index - 1] ?? entry, entry) >= 0,
    )
  )
    return undefined;
  return result;
};

const testCounts = (value: unknown): Record<string, number> | undefined => {
  const keys = ["total", "observed", "passed", "failed", "timedOut", "skipped", "interrupted"];
  if (!isRecord(value) || !hasExactKeys(value, keys) || !Object.values(value).every(count))
    return undefined;
  const attempts =
    Number(value.passed) +
    Number(value.failed) +
    Number(value.timedOut) +
    Number(value.skipped) +
    Number(value.interrupted);
  return attempts === value.total && Number(value.observed) <= Number(value.total)
    ? (value as Record<string, number>)
    : undefined;
};

const mapping = (value: unknown, technical: boolean): Record<string, unknown> | undefined => {
  const keys = technical
    ? [
        "framework",
        "version",
        "control",
        "requirementId",
        "relationship",
        "rationale",
        "applicabilityCaveat",
        "sourceUrl",
        "lastReviewed",
      ]
    : [
        "instrument",
        "provision",
        "relationship",
        "rationale",
        "applicabilityCaveat",
        "sourceType",
        "sourceUrl",
        "lastReviewed",
      ];
  if (!isRecord(value) || !hasExactKeys(value, keys) || !keys.every((key) => safeText(value[key])))
    return undefined;
  if (technical) {
    if (
      value.framework !== "OWASP ASVS" ||
      value.version !== "5.0.0" ||
      !["direct", "contextual"].includes(String(value.relationship))
    )
      return undefined;
  } else if (
    value.sourceType !== "primary" ||
    !["contextual", "supporting_evidence"].includes(String(value.relationship))
  )
    return undefined;
  return structuredClone(value);
};

const mappingArray = (
  value: unknown,
  technical: boolean,
): Record<string, unknown>[] | undefined => {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const result = value.map((entry) => mapping(entry, technical));
  return result.some((entry) => entry === undefined)
    ? undefined
    : (result as Record<string, unknown>[]);
};

const availability = (
  value: unknown,
  observed: number,
  parse: (details: unknown, observed: number) => boolean,
): boolean =>
  isRecord(value) &&
  ((hasExactKeys(value, ["available"]) && value.available === false) ||
    (hasExactKeys(value, ["available", "details"]) &&
      value.available === true &&
      parse(value.details, observed)));

const responseCoverage = (value: unknown, observed: number): boolean => {
  if (!isRecord(value)) return false;
  if (hasExactKeys(value, ["available"]) && value.available === false) return true;
  if (
    !hasExactKeys(value, ["available", "details"]) ||
    value.available !== true ||
    !isRecord(value.details)
  )
    return false;
  const details = value.details;
  if (
    !hasExactKeys(details, [
      "experimental",
      "tests",
      "responses",
      "retainedBytes",
      "discoveredSources",
      "skipped",
    ]) ||
    details.experimental !== true ||
    !isRecord(details.tests) ||
    !hasExactKeys(details.tests, ["enabled", "disabled", "unavailable"]) ||
    !Object.values(details.tests).every(count) ||
    Number(details.tests.enabled) +
      Number(details.tests.disabled) +
      Number(details.tests.unavailable) !==
      observed ||
    !isRecord(details.responses) ||
    !hasExactKeys(details.responses, ["seen", "firstParty", "json", "parsed", "withSources"]) ||
    !Object.values(details.responses).every(count) ||
    !count(details.retainedBytes) ||
    !isRecord(details.discoveredSources) ||
    !hasExactKeys(details.discoveredSources, ["total", "byName"]) ||
    !count(details.discoveredSources.total) ||
    !isRecord(details.discoveredSources.byName) ||
    !hasExactKeys(details.discoveredSources.byName, ["personal.email", "personal.phone"]) ||
    !Object.values(details.discoveredSources.byName).every(count) ||
    Number(details.discoveredSources.total) !==
      Number(details.discoveredSources.byName["personal.email"]) +
        Number(details.discoveredSources.byName["personal.phone"]) ||
    !isRecord(details.skipped) ||
    !hasExactKeys(details.skipped, [
      "unknownLength",
      "oversized",
      "aggregateLimit",
      "workLimit",
      "bodyReadError",
      "invalidJson",
      "traversalLimit",
      "sourceLimit",
    ]) ||
    !Object.values(details.skipped).every(count)
  )
    return false;
  return (
    Number(details.responses.firstParty) <= Number(details.responses.seen) &&
    Number(details.responses.json) <= Number(details.responses.firstParty) &&
    Number(details.responses.parsed) <= Number(details.responses.json) &&
    Number(details.responses.withSources) <= Number(details.responses.parsed)
  );
};

export const parsePrivacySpecEvidence = (value: unknown): ReadablePrivacySpecEvidence => {
  if (
    !isRecord(value) ||
    (value.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION_V1 &&
      value.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION)
  )
    throw new EvidenceFormatError("Invalid or unsupported PrivacySpec evidence schema.");
  if (!boundedJson(value))
    throw new EvidenceFormatError("PrivacySpec evidence is not bounded sanitized JSON.");
  const version = value.evidenceSchemaVersion;
  if (
    !hasExactKeys(value, [
      "evidenceSchemaVersion",
      "evidenceKind",
      "tool",
      "execution",
      "build",
      "scope",
      "observations",
      "coverage",
      "technicalRelevance",
      "regulatoryRelevance",
      "limitations",
    ]) ||
    value.evidenceKind !== "AUDIT_SUPPORTING_TECHNICAL_EVIDENCE" ||
    !isRecord(value.tool) ||
    !hasExactKeys(value.tool, ["name", "version"]) ||
    value.tool.name !== "privacyspec" ||
    !safeText(value.tool.version, 64)
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence metadata.");
  if (
    !isRecord(value.execution) ||
    !hasExactKeys(value.execution, [
      "evidenceGeneratedAt",
      "sourceRunStartedAt",
      "sourceReportGeneratedAt",
      "sourceReportSchemaVersion",
      "sourceRunState",
      "sourceStatus",
    ]) ||
    !timestamp(value.execution.evidenceGeneratedAt) ||
    !timestamp(value.execution.sourceRunStartedAt) ||
    !timestamp(value.execution.sourceReportGeneratedAt) ||
    ![1, 2, 3, 4, 5].includes(Number(value.execution.sourceReportSchemaVersion)) ||
    !["COMPLETE", "INCOMPLETE"].includes(String(value.execution.sourceRunState)) ||
    !["passed", "review", "failed", "incomplete"].includes(String(value.execution.sourceStatus))
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence execution metadata.");
  if (
    !isRecord(value.build) ||
    !hasExactKeys(value.build, Object.keys(value.build)) ||
    Object.keys(value.build).some((key) => key !== "commit" && key !== "buildId") ||
    Object.values(value.build).some((entry) => !safeText(entry, 128))
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence build identifiers.");
  if (
    !isRecord(value.scope) ||
    !hasExactKeys(value.scope, ["complete", "projectCount", "projects", "tests"]) ||
    typeof value.scope.complete !== "boolean" ||
    !count(value.scope.projectCount)
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence scope.");
  const projects = strings(value.scope.projects, 1_000, true);
  const tests = testCounts(value.scope.tests);
  if (
    projects === undefined ||
    projects.length !== value.scope.projectCount ||
    tests === undefined ||
    value.scope.complete !== (value.execution.sourceRunState === "COMPLETE")
  )
    throw new EvidenceFormatError("Inconsistent PrivacySpec evidence scope.");
  if (
    !isRecord(value.observations) ||
    !hasExactKeys(value.observations, [
      "categories",
      "externalRecipients",
      "rules",
      "dataFlowOccurrences",
      ...(version === 2 ? ["requestSurfaces"] : []),
      "findingOccurrences",
      "baselineReview",
      "testDataHygiene",
    ]) ||
    !count(value.observations.dataFlowOccurrences)
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence observations.");
  const categories = canonicalArray(
    value.observations.categories,
    (candidate) => {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ["category", "sourceObservations", "flowOccurrences"]) ||
        !isDataCategory(candidate.category) ||
        !count(candidate.sourceObservations) ||
        !count(candidate.flowOccurrences)
      )
        return undefined;
      return structuredClone(candidate) as {
        category: string;
        sourceObservations: number;
        flowOccurrences: number;
      };
    },
    (entry) => entry.category,
  );
  const recipients = canonicalArray(
    value.observations.externalRecipients,
    (candidate) => {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ["origin", "host", "flowOccurrences", "categories"]) ||
        !safeText(candidate.origin, 2_048) ||
        !safeText(candidate.host, 255) ||
        !count(candidate.flowOccurrences)
      )
        return undefined;
      const recipientCategories = canonicalArray(
        candidate.categories,
        (entry) => (isDataCategory(entry) ? entry : undefined),
        (entry) => entry,
        1_000,
      );
      return recipientCategories === undefined || recipientCategories.length === 0
        ? undefined
        : {
            origin: candidate.origin,
            host: candidate.host,
            flowOccurrences: candidate.flowOccurrences,
            categories: recipientCategories,
          };
    },
    (entry) => JSON.stringify([entry.origin, entry.host]),
  );
  const rules = canonicalArray(
    value.observations.rules,
    (candidate) => {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, [
          "ruleId",
          "title",
          "observation",
          "occurrences",
          "technicalFailures",
          "reviewRequired",
        ]) ||
        !Object.hasOwn(RULE_DEFINITIONS, String(candidate.ruleId)) ||
        candidate.title !==
          RULE_DEFINITIONS[candidate.ruleId as keyof typeof RULE_DEFINITIONS].title ||
        !safeText(candidate.observation) ||
        !count(candidate.occurrences) ||
        !count(candidate.technicalFailures) ||
        !count(candidate.reviewRequired) ||
        Number(candidate.technicalFailures) + Number(candidate.reviewRequired) !==
          candidate.occurrences
      )
        return undefined;
      return structuredClone(candidate) as {
        ruleId: string;
        occurrences: number;
        technicalFailures: number;
        reviewRequired: number;
      };
    },
    (entry) => entry.ruleId,
    100,
  );
  if (
    categories === undefined ||
    recipients === undefined ||
    rules === undefined ||
    categories.reduce((sum, entry) => sum + entry.flowOccurrences, 0) !==
      value.observations.dataFlowOccurrences
  )
    throw new EvidenceFormatError("Inconsistent PrivacySpec evidence observation counts.");
  if (
    !isRecord(value.observations.findingOccurrences) ||
    !hasExactKeys(value.observations.findingOccurrences, ["technicalFailures", "reviewRequired"]) ||
    !Object.values(value.observations.findingOccurrences).every(count) ||
    Number(value.observations.findingOccurrences.technicalFailures) !==
      rules.reduce((sum, entry) => sum + entry.technicalFailures, 0) ||
    Number(value.observations.findingOccurrences.reviewRequired) !==
      rules.reduce((sum, entry) => sum + entry.reviewRequired, 0)
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence finding counts.");
  if (
    version === 2 &&
    (!isRecord(value.observations.requestSurfaces) ||
      !hasExactKeys(value.observations.requestSurfaces, ["browser", "apiRequest"]) ||
      !Object.values(value.observations.requestSurfaces).every(count) ||
      Number(value.observations.requestSurfaces.browser) +
        Number(value.observations.requestSurfaces.apiRequest) !==
        value.observations.dataFlowOccurrences)
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence request-surface counts.");
  const baseline = value.observations.baselineReview;
  if (
    !isRecord(baseline) ||
    !hasExactKeys(baseline, ["exists", "known", "new", "resolved", "resolvedStatus"]) ||
    typeof baseline.exists !== "boolean" ||
    !count(baseline.known) ||
    !count(baseline.new) ||
    (baseline.resolved !== null && !count(baseline.resolved)) ||
    !["CONCLUSIVE", "INCONCLUSIVE"].includes(String(baseline.resolvedStatus)) ||
    (baseline.resolvedStatus === "CONCLUSIVE") !== (baseline.resolved !== null) ||
    (value.scope.complete
      ? baseline.resolvedStatus !== "CONCLUSIVE"
      : baseline.resolvedStatus !== "INCONCLUSIVE")
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence baseline summary.");
  const hygiene = value.observations.testDataHygiene;
  if (
    !isRecord(hygiene) ||
    !hasExactKeys(hygiene, ["available", "total", "synthetic", "reviewRequired", "unassessed"]) ||
    typeof hygiene.available !== "boolean" ||
    [hygiene.total, hygiene.synthetic, hygiene.reviewRequired, hygiene.unassessed].some(
      (entry) => entry !== null && !count(entry),
    ) ||
    (hygiene.available &&
      (hygiene.total === null ||
        Number(hygiene.synthetic) + Number(hygiene.reviewRequired) + Number(hygiene.unassessed) !==
          hygiene.total)) ||
    (!hygiene.available &&
      [hygiene.total, hygiene.synthetic, hygiene.reviewRequired, hygiene.unassessed].some(
        (entry) => entry !== null,
      ))
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence test-data summary.");
  const observedTests = Number(tests.observed);
  if (
    !isRecord(value.coverage) ||
    !hasExactKeys(value.coverage, [
      "diagnosticCount",
      "integrationErrorCount",
      "firstPartyJsonResponses",
      ...(version === 2 ? ["browserEngines", "apiRequests"] : []),
    ]) ||
    !count(value.coverage.diagnosticCount) ||
    !count(value.coverage.integrationErrorCount) ||
    !responseCoverage(value.coverage.firstPartyJsonResponses, observedTests)
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence coverage.");
  if (
    version === 2 &&
    (!availability(
      value.coverage.browserEngines,
      observedTests,
      parseBrowserEngineReportCoverage,
    ) ||
      !availability(value.coverage.apiRequests, observedTests, parseAPIRequestReportCoverage))
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence experimental coverage.");
  const parseRelevance = (candidate: unknown, technical: boolean) => {
    const relationKey = technical ? "controls" : "mappings";
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["ruleId", relationKey, "limitations"]) ||
      !Object.hasOwn(RULE_DEFINITIONS, String(candidate.ruleId))
    )
      return undefined;
    const mappings = mappingArray(candidate[relationKey], technical);
    const limitations = strings(candidate.limitations);
    return mappings === undefined || limitations === undefined
      ? undefined
      : (structuredClone(candidate) as { ruleId: string });
  };
  const technicalRelevance = canonicalArray(
    value.technicalRelevance,
    (candidate) => parseRelevance(candidate, true),
    (entry) => entry.ruleId,
    100,
  );
  if (
    !isRecord(value.regulatoryRelevance) ||
    !hasExactKeys(value.regulatoryRelevance, ["rules", "reportLevel"])
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence regulatory relevance.");
  const regulatoryRules = canonicalArray(
    value.regulatoryRelevance.rules,
    (candidate) => parseRelevance(candidate, false),
    (entry) => entry.ruleId,
    100,
  );
  const reportLevel = canonicalArray(
    value.regulatoryRelevance.reportLevel,
    (candidate) => {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, [
          "profileId",
          "title",
          "observation",
          "mappings",
          "limitations",
        ]) ||
        !safeText(candidate.profileId, 128) ||
        !safeText(candidate.title) ||
        !safeText(candidate.observation) ||
        mappingArray(candidate.mappings, false) === undefined ||
        strings(candidate.limitations) === undefined
      )
        return undefined;
      return structuredClone(candidate) as { profileId: string };
    },
    (entry) => entry.profileId,
    100,
  );
  if (
    technicalRelevance === undefined ||
    regulatoryRules === undefined ||
    reportLevel === undefined ||
    JSON.stringify(technicalRelevance.map((entry) => entry.ruleId)) !==
      JSON.stringify(regulatoryRules.map((entry) => entry.ruleId))
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence relevance records.");
  if (
    !isRecord(value.limitations) ||
    !hasExactKeys(value.limitations, ["coverage", "legal"]) ||
    strings(value.limitations.coverage) === undefined ||
    strings(value.limitations.legal) === undefined
  )
    throw new EvidenceFormatError("Invalid PrivacySpec evidence limitations.");
  return structuredClone(value) as unknown as ReadablePrivacySpecEvidence;
};

const missing = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";
export const readPrivacySpecEvidenceFile = async (
  path: string,
): Promise<ReadablePrivacySpecEvidence> => {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (missing(error)) throw new EvidenceFormatError("No PrivacySpec evidence is available.");
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_REPORT_FILE_BYTES)
    throw new EvidenceFormatError("PrivacySpec evidence is not a bounded regular file.");
  const serialized = await readFile(path, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_FILE_BYTES)
    throw new EvidenceFormatError("PrivacySpec evidence exceeds the size limit.");
  try {
    return parsePrivacySpecEvidence(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof EvidenceFormatError) throw error;
    throw new EvidenceFormatError("PrivacySpec evidence is not valid JSON.");
  }
};
