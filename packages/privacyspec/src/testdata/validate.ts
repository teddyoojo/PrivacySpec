import type { DataFlowSourceKind } from "../correlate/model.js";
import { type DataCategory, isDataCategory } from "../discovery/source-model.js";
import {
  type PrivacySpecTestDataAttachment,
  type PrivacySpecTestDataSection,
  TEST_DATA_SCHEMA_VERSION,
  type TestDataObservation,
  type TestDataSignal,
  type TestDataVerdict,
} from "./model.js";

const MAX_OBSERVATIONS = 10_000;
const MAX_LIMITATIONS = 100;
const MAX_TEXT_LENGTH = 2_048;

const verdicts = new Set<TestDataVerdict>(["SYNTHETIC", "REVIEW_REQUIRED", "UNASSESSED"]);
const signals = new Set<TestDataSignal>([
  "IANA_RESERVED_EMAIL_DOMAIN",
  "CONFIGURED_SYNTHETIC_EMAIL_DOMAIN",
  "EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC",
  "EMAIL_SHAPE_UNSUPPORTED",
  "UNSUPPORTED_CATEGORY",
  "UNSUPPORTED_SOURCE_KIND",
]);
const sourceKinds = new Set<DataFlowSourceKind>(["form-input", "dom-control", "response-json"]);
const elementKinds = new Set(["input", "textarea", "select", "contenteditable"]);

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

const isBoundedString = (value: unknown, allowEmpty = false): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  value.length <= MAX_TEXT_LENGTH &&
  !containsUnsafeCharacter(value) &&
  !/[^\s@]+@[^\s@]+/u.test(value);

const isSanitizedTestPath = (value: unknown): value is string =>
  isBoundedString(value) &&
  !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value) &&
  !value.split(/[\\/]/u).includes("..");

const validVerdictSignal = (verdict: TestDataVerdict, signal: TestDataSignal): boolean => {
  if (verdict === "SYNTHETIC") {
    return (
      signal === "IANA_RESERVED_EMAIL_DOMAIN" || signal === "CONFIGURED_SYNTHETIC_EMAIL_DOMAIN"
    );
  }
  if (verdict === "REVIEW_REQUIRED") {
    return signal === "EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC";
  }
  return ["EMAIL_SHAPE_UNSUPPORTED", "UNSUPPORTED_CATEGORY", "UNSUPPORTED_SOURCE_KIND"].includes(
    signal,
  );
};

export const parseTestDataObservation = (value: unknown): TestDataObservation | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["verdict", "signal", "category", "sourceKind", "attribution"]) ||
    typeof value.verdict !== "string" ||
    !verdicts.has(value.verdict as TestDataVerdict) ||
    typeof value.signal !== "string" ||
    !signals.has(value.signal as TestDataSignal) ||
    !validVerdictSignal(value.verdict as TestDataVerdict, value.signal as TestDataSignal) ||
    typeof value.category !== "string" ||
    !isDataCategory(value.category) ||
    typeof value.sourceKind !== "string" ||
    !sourceKinds.has(value.sourceKind as DataFlowSourceKind) ||
    !isRecord(value.attribution) ||
    !hasExactKeys(value.attribution, ["test"], ["control"]) ||
    !isRecord(value.attribution.test) ||
    !hasExactKeys(value.attribution.test, ["file", "title", "project"]) ||
    !isSanitizedTestPath(value.attribution.test.file) ||
    !isBoundedString(value.attribution.test.title) ||
    !isBoundedString(value.attribution.test.project, true)
  ) {
    return undefined;
  }
  let control: TestDataObservation["attribution"]["control"];
  if (value.attribution.control !== undefined) {
    if (
      !isRecord(value.attribution.control) ||
      !hasExactKeys(value.attribution.control, ["elementKind", "observedBy"]) ||
      typeof value.attribution.control.elementKind !== "string" ||
      !elementKinds.has(value.attribution.control.elementKind) ||
      (value.attribution.control.observedBy !== "event" &&
        value.attribution.control.observedBy !== "fallback")
    ) {
      return undefined;
    }
    control = {
      elementKind: value.attribution.control.elementKind as NonNullable<
        typeof control
      >["elementKind"],
      observedBy: value.attribution.control.observedBy,
    };
  }
  if ((value.sourceKind === "response-json") === (control !== undefined)) return undefined;
  const verdict = value.verdict as TestDataVerdict;
  const signal = value.signal as TestDataSignal;
  if (
    (verdict === "SYNTHETIC" ||
      verdict === "REVIEW_REQUIRED" ||
      signal === "EMAIL_SHAPE_UNSUPPORTED") &&
    value.category !== "personal.email"
  ) {
    return undefined;
  }
  return {
    verdict,
    signal,
    category: value.category as DataCategory,
    sourceKind: value.sourceKind as DataFlowSourceKind,
    attribution: {
      test: {
        file: value.attribution.test.file,
        title: value.attribution.test.title,
        project: value.attribution.test.project,
      },
      ...(control === undefined ? {} : { control }),
    },
  };
};

const parseUniqueObservations = (value: unknown): TestDataObservation[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_OBSERVATIONS) return undefined;
  const observations: TestDataObservation[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    const observation = parseTestDataObservation(candidate);
    if (observation === undefined) return undefined;
    const identity = JSON.stringify(observation);
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    observations.push(observation);
  }
  return observations;
};

export const parseTestDataAttachment = (
  value: unknown,
): PrivacySpecTestDataAttachment | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["testDataSchemaVersion", "observations"]) ||
    value.testDataSchemaVersion !== TEST_DATA_SCHEMA_VERSION
  ) {
    return undefined;
  }
  const observations = parseUniqueObservations(value.observations);
  if (observations === undefined) return undefined;
  return { testDataSchemaVersion: TEST_DATA_SCHEMA_VERSION, observations };
};

export const parseTestDataSection = (value: unknown): PrivacySpecTestDataSection | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["testDataSchemaVersion", "summary", "observations", "limitations"]) ||
    value.testDataSchemaVersion !== TEST_DATA_SCHEMA_VERSION ||
    !isRecord(value.summary) ||
    !hasExactKeys(value.summary, ["total", "synthetic", "reviewRequired", "unassessed"]) ||
    !Object.values(value.summary).every(
      (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) ||
    !Array.isArray(value.observations) ||
    value.observations.length > MAX_OBSERVATIONS ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > MAX_LIMITATIONS ||
    !value.limitations.every((limitation) => isBoundedString(limitation))
  ) {
    return undefined;
  }
  const observations = parseUniqueObservations(value.observations);
  if (observations === undefined) return undefined;
  const synthetic = observations.filter((item) => item.verdict === "SYNTHETIC").length;
  const reviewRequired = observations.filter((item) => item.verdict === "REVIEW_REQUIRED").length;
  const unassessed = observations.filter((item) => item.verdict === "UNASSESSED").length;
  if (
    value.summary.total !== observations.length ||
    value.summary.synthetic !== synthetic ||
    value.summary.reviewRequired !== reviewRequired ||
    value.summary.unassessed !== unassessed
  ) {
    return undefined;
  }
  return {
    testDataSchemaVersion: TEST_DATA_SCHEMA_VERSION,
    summary: { total: observations.length, synthetic, reviewRequired, unassessed },
    observations,
    limitations: [...(value.limitations as string[])],
  };
};
