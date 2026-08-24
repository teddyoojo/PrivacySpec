import {
  BUILTIN_ONLY_CLASSIFIER_CONFIGURATION,
  type ClassifierConfiguration,
  parseClassifierConfiguration,
} from "../discovery/classifier-configuration.js";
import {
  createResponseJsonCoverage,
  type ResponseJsonCoverage,
} from "../discovery/response-json.js";
import { isDataCategory } from "../discovery/source-model.js";
import type { PrivacySpecObservation } from "../observation-model.js";
import type { NetworkObservationCoverage } from "../observe/network.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import { createTestDataAttachment } from "../testdata/create.js";
import type { PrivacySpecTestDataAttachment } from "../testdata/model.js";
import { parseTestDataAttachment } from "../testdata/validate.js";
import type { PlaywrightObservationCounters } from "./coverage.js";
import {
  type APIRequestCoverage,
  type BrowserEngineCoverage,
  createAPIRequestCoverage,
  createBrowserEngineCoverage,
} from "./experimental-coverage.js";

export const PRIVACYSPEC_ATTACHMENT_NAME = "privacyspec-result";
export const PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE = "application/json";
export const ATTACHMENT_SCHEMA_VERSION_V2 = 2 as const;
export const ATTACHMENT_SCHEMA_VERSION_V3 = 3 as const;
export const ATTACHMENT_SCHEMA_VERSION_V4 = 4 as const;
export const ATTACHMENT_SCHEMA_VERSION = 5 as const;

export interface PlaywrightInstrumentationCoverage {
  applicationContexts: 0 | 1;
  pages: number;
}

export interface PrivacySpecResultV1 {
  schemaVersion: 1;
  observations: PrivacySpecObservation[];
}

export interface PrivacySpecResultV2 {
  schemaVersion: typeof ATTACHMENT_SCHEMA_VERSION_V2;
  observations: PrivacySpecObservation[];
  coverage: {
    playwright: PlaywrightInstrumentationCoverage;
    network: NetworkObservationCoverage;
    firstPartyJsonResponses: ResponseJsonCoverage;
  };
  testData?: PrivacySpecTestDataAttachment | undefined;
}

export interface PrivacySpecResultV3 {
  schemaVersion: typeof ATTACHMENT_SCHEMA_VERSION_V3;
  observations: PrivacySpecObservation[];
  coverage: PrivacySpecResultV2["coverage"] & {
    observation: PlaywrightObservationCounters;
  };
  testData?: PrivacySpecTestDataAttachment | undefined;
}

export interface PrivacySpecResultV4 {
  schemaVersion: typeof ATTACHMENT_SCHEMA_VERSION_V4;
  observations: PrivacySpecObservation[];
  coverage: PrivacySpecResultV3["coverage"] & {
    browserEngine: BrowserEngineCoverage;
    apiRequests: APIRequestCoverage;
  };
  testData?: PrivacySpecTestDataAttachment | undefined;
}

export interface PrivacySpecResultV5 {
  schemaVersion: typeof ATTACHMENT_SCHEMA_VERSION;
  classifierConfiguration: ClassifierConfiguration;
  observations: PrivacySpecObservation[];
  coverage: PrivacySpecResultV4["coverage"];
  testData?: PrivacySpecTestDataAttachment | undefined;
}

export type PrivacySpecResult =
  | PrivacySpecResultV1
  | PrivacySpecResultV2
  | PrivacySpecResultV3
  | PrivacySpecResultV4
  | PrivacySpecResultV5;

export const createPrivacySpecResult = (
  observations: PrivacySpecObservation[] = [],
  responseCoverage: ResponseJsonCoverage = createResponseJsonCoverage(false),
  testData: PrivacySpecTestDataAttachment = createTestDataAttachment([]),
  playwrightCoverage: PlaywrightInstrumentationCoverage = {
    applicationContexts: 1,
    pages: 1,
  },
  networkCoverage: NetworkObservationCoverage = {
    requests: { seen: 0, accepted: 0, filteredLowValueStatic: 0 },
  },
  observationCoverage: PlaywrightObservationCounters = {
    browserObjects: { seen: 1 },
    contexts: { seen: 1, instrumented: 1 },
    pages: { seen: 1, instrumented: 1, storageCapable: 1 },
    events: { navigations: 0, network: 0, console: 0 },
  },
  browserEngineCoverage: BrowserEngineCoverage = createBrowserEngineCoverage("chromium", new Set()),
  apiRequestCoverage: APIRequestCoverage = createAPIRequestCoverage(false),
  classifierConfiguration: ClassifierConfiguration = BUILTIN_ONLY_CLASSIFIER_CONFIGURATION,
): PrivacySpecResultV5 => ({
  schemaVersion: ATTACHMENT_SCHEMA_VERSION,
  classifierConfiguration: structuredClone(classifierConfiguration),
  observations,
  coverage: {
    playwright: { ...playwrightCoverage },
    network: { requests: { ...networkCoverage.requests } },
    firstPartyJsonResponses: responseCoverage,
    observation: {
      browserObjects: { ...observationCoverage.browserObjects },
      contexts: { ...observationCoverage.contexts },
      pages: { ...observationCoverage.pages },
      events: { ...observationCoverage.events },
    },
    browserEngine: structuredClone(browserEngineCoverage),
    apiRequests: structuredClone(apiRequestCoverage),
  },
  testData,
});

export const createEmptyPrivacySpecResult = (): PrivacySpecResultV5 => createPrivacySpecResult();

export const MAX_ATTACHMENT_JSON_NODES = 50_000;
export const MAX_ATTACHMENT_JSON_DEPTH = 12;
export const MAX_ATTACHMENT_OBSERVATIONS = 100_000;

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

const isSafeString = (value: unknown, maximum: number, allowEmpty = false): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (allowEmpty || value.length > 0) &&
  !containsUnsafeCharacter(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const hasNonNegativeCounts = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, number> =>
  isRecord(value) &&
  hasExactKeys(value, keys) &&
  keys.every((key) => isNonNegativeInteger(value[key]));

const isBoundedJson = (root: unknown): boolean => {
  const stack: Array<{ value: unknown; depth: number; ancestors: object[] }> = [
    { value: root, depth: 0, ancestors: [] },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > MAX_ATTACHMENT_JSON_NODES || current.depth > MAX_ATTACHMENT_JSON_DEPTH)
      return false;
    if (typeof current.value === "string") {
      if (containsUnsafeCharacter(current.value)) return false;
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.ancestors.includes(current.value)) return false;
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      if (Object.getOwnPropertySymbols(current.value).length > 0) return false;
      descriptors = Object.getOwnPropertyDescriptors(current.value);
    } catch {
      return false;
    }
    const entries = Array.isArray(current.value)
      ? Object.entries(descriptors).filter(([key]) => key !== "length")
      : Object.entries(descriptors);
    for (const [, descriptor] of entries) {
      if (!("value" in descriptor) || !descriptor.enumerable) return false;
      stack.push({
        value: descriptor.value,
        depth: current.depth + 1,
        ancestors: [...current.ancestors, current.value],
      });
    }
  }
  return true;
};

const isCanonicalOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const isSanitizedPath = (value: unknown, maximum = 8_192): value is string =>
  isSafeString(value, maximum, true) && !/[?&][A-Za-z0-9._-]{1,64}=/u.test(value);

const parseTest = (
  value: unknown,
): { file: string; title: string; project: string } | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["file", "title", "project"]) ||
    !isSafeString(value.file, 2_048) ||
    /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value.file) ||
    value.file.split(/[\\/]/u).includes("..") ||
    !isSafeString(value.title, 2_048) ||
    !isSafeString(value.project, 512, true)
  ) {
    return undefined;
  }
  return { file: value.file, title: value.title, project: value.project };
};

const evidenceKinds = new Set([
  "input-type",
  "autocomplete",
  "label",
  "name-attribute",
  "id-attribute",
  "aria-label",
  "placeholder",
  "pattern",
  "json-key",
]);

const parseEvidence = (value: unknown): Array<{ kind: string; value: string }> | undefined => {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const result: Array<{ kind: string; value: string }> = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["kind", "value"]) ||
      !evidenceKinds.has(String(entry.kind)) ||
      !isSafeString(entry.value, 200)
    ) {
      return undefined;
    }
    result.push({ kind: entry.kind as string, value: entry.value });
  }
  return result;
};

const controlKeys = [
  "elementKind",
  "type",
  "name",
  "id",
  "autocomplete",
  "ariaLabel",
  "associatedLabel",
  "placeholder",
] as const;

const parseControl = (value: unknown): Record<string, unknown> | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["elementKind"], controlKeys.slice(1)) ||
    !["input", "textarea", "select", "contenteditable"].includes(String(value.elementKind))
  ) {
    return undefined;
  }
  for (const key of controlKeys.slice(1)) {
    if (value[key] !== undefined && !isSafeString(value[key], 200, true)) return undefined;
  }
  return structuredClone(value);
};

const parsePage = (value: unknown): { origin: string; path: string } | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["origin", "path"]) ||
    !isSafeString(value.origin, 2_048) ||
    (value.origin !== "opaque" && value.origin !== "unknown" && !isCanonicalOrigin(value.origin)) ||
    !isSanitizedPath(value.path)
  ) {
    return undefined;
  }
  return { origin: value.origin, path: value.path };
};

const parseProvenance = (
  value: unknown,
): { origin: string; endpoint: string; location: string } | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["origin", "endpoint", "location"]) ||
    !isSafeString(value.origin, 2_048) ||
    !isCanonicalOrigin(value.origin) ||
    !isSanitizedPath(value.endpoint) ||
    !isSafeString(value.location, 1_024)
  ) {
    return undefined;
  }
  return { origin: value.origin, endpoint: value.endpoint, location: value.location };
};

const parseSensitiveSource = (
  value: Record<string, unknown>,
  responseSources: boolean,
): PrivacySpecObservation | undefined => {
  const sourceKind = value.sourceKind;
  const response = sourceKind === "response-json";
  if (
    !hasExactKeys(
      value,
      response
        ? ["kind", "category", "confidence", "evidence", "sourceKind", "provenance", "observedBy"]
        : [
            "kind",
            "category",
            "confidence",
            "evidence",
            "sourceKind",
            "control",
            "page",
            "observedBy",
          ],
    ) ||
    !isDataCategory(value.category) ||
    !["high", "medium", "low"].includes(String(value.confidence)) ||
    (response
      ? !responseSources ||
        (value.category !== "personal.email" && value.category !== "personal.phone") ||
        value.observedBy !== "response"
      : (sourceKind !== "form-input" && sourceKind !== "dom-control") ||
        (value.observedBy !== "event" && value.observedBy !== "fallback"))
  ) {
    return undefined;
  }
  const evidence = parseEvidence(value.evidence);
  if (evidence === undefined) return undefined;
  if (response) {
    const provenance = parseProvenance(value.provenance);
    return provenance === undefined
      ? undefined
      : (structuredClone({ ...value, evidence, provenance }) as PrivacySpecObservation);
  }
  const control = parseControl(value.control);
  const page = parsePage(value.page);
  return control === undefined || page === undefined
    ? undefined
    : (structuredClone({ ...value, evidence, control, page }) as unknown as PrivacySpecObservation);
};

const bodyKinds = new Set(["none", "json", "form", "text", "multipart", "binary"]);

const parseStringArray = (value: unknown, maximum = 1_000): string[] | undefined => {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: string[] = [];
  for (const entry of value) {
    if (!isSafeString(entry, 1_024, true)) return undefined;
    result.push(entry);
  }
  return result;
};

const parseSink = (
  value: Record<string, unknown>,
  requestSurfaceRequired: boolean,
): PrivacySpecObservation | undefined => {
  if (value.sink === "network") {
    if (
      !hasExactKeys(
        value,
        [
          "kind",
          "sink",
          ...(requestSurfaceRequired ? ["requestSurface"] : []),
          "method",
          "resourceType",
          "recipient",
          "endpoint",
          "locations",
          "body",
        ],
        ["page"],
      ) ||
      (requestSurfaceRequired &&
        value.requestSurface !== "browser" &&
        value.requestSurface !== "api-request") ||
      !isSafeString(value.method, 32) ||
      !isSafeString(value.resourceType, 128) ||
      !isRecord(value.recipient) ||
      !hasExactKeys(value.recipient, ["origin", "host"]) ||
      !isSafeString(value.recipient.origin, 2_048) ||
      !isCanonicalOrigin(value.recipient.origin) ||
      !isSafeString(value.recipient.host, 255) ||
      !isSanitizedPath(value.endpoint) ||
      !isRecord(value.body) ||
      !hasExactKeys(value.body, ["kind", "size", "truncated"]) ||
      !bodyKinds.has(String(value.body.kind)) ||
      !isNonNegativeInteger(value.body.size) ||
      typeof value.body.truncated !== "boolean"
    ) {
      return undefined;
    }
    const locations = parseStringArray(value.locations);
    const page = value.page === undefined ? undefined : parsePage(value.page);
    if (locations === undefined || (value.page !== undefined && page === undefined))
      return undefined;
    return structuredClone({
      ...value,
      requestSurface: requestSurfaceRequired ? value.requestSurface : "browser",
      locations,
      ...(page === undefined ? {} : { page }),
    }) as PrivacySpecObservation;
  }
  if (value.sink === "console") {
    if (
      !hasExactKeys(value, ["kind", "sink", "level", "argumentCount", "locations"], ["page"]) ||
      !isSafeString(value.level, 128) ||
      !isNonNegativeInteger(value.argumentCount)
    ) {
      return undefined;
    }
    const locations = parseStringArray(value.locations);
    const page = value.page === undefined ? undefined : parsePage(value.page);
    return locations === undefined || (value.page !== undefined && page === undefined)
      ? undefined
      : (structuredClone({
          ...value,
          locations,
          ...(page === undefined ? {} : { page }),
        }) as PrivacySpecObservation);
  }
  if (value.sink === "storage") {
    if (
      !hasExactKeys(value, ["kind", "sink", "storageType", "key", "observedBy", "page"]) ||
      !["local-storage", "session-storage", "cookie"].includes(String(value.storageType)) ||
      !isSafeString(value.key, 1_024) ||
      (value.observedBy !== "write" && value.observedBy !== "snapshot")
    ) {
      return undefined;
    }
    const page = parsePage(value.page);
    return page === undefined
      ? undefined
      : (structuredClone({ ...value, page }) as PrivacySpecObservation);
  }
  return undefined;
};

const flowSinkKinds = new Set([
  "request-url",
  "request-body",
  "request-header",
  "external-request",
  "local-storage",
  "session-storage",
  "cookie",
  "console",
]);
const transforms = new Set([
  "EXACT",
  "LOWERCASE",
  "UPPERCASE",
  "URL_ENCODED",
  "BASE64",
  "SHA256",
  "SHA256_NORMALIZED",
]);

const parseFlow = (
  value: unknown,
  responseSources: boolean,
  requestSurfaceRequired: boolean,
): Record<string, unknown> | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "kind",
        ...(requestSurfaceRequired ? ["requestSurface"] : []),
        "dataCategory",
        "sourceKind",
        "sourceConfidence",
        "sinkKind",
        "transform",
        "test",
      ],
      ["sourceProvenance", "recipient", "method", "endpoint", "location"],
    ) ||
    value.kind !== "data-flow" ||
    !isDataCategory(value.dataCategory) ||
    !["form-input", "dom-control", ...(responseSources ? ["response-json"] : [])].includes(
      String(value.sourceKind),
    ) ||
    !["high", "medium", "low"].includes(String(value.sourceConfidence)) ||
    (requestSurfaceRequired &&
      value.requestSurface !== "browser" &&
      value.requestSurface !== "api-request") ||
    !flowSinkKinds.has(String(value.sinkKind)) ||
    !transforms.has(String(value.transform))
  ) {
    return undefined;
  }
  const test = parseTest(value.test);
  const provenance =
    value.sourceProvenance === undefined ? undefined : parseProvenance(value.sourceProvenance);
  if (
    test === undefined ||
    (value.sourceKind === "response-json") !== (provenance !== undefined) ||
    (value.method !== undefined && !isSafeString(value.method, 32)) ||
    (value.endpoint !== undefined && !isSanitizedPath(value.endpoint)) ||
    (value.location !== undefined && !isSafeString(value.location, 1_024))
  ) {
    return undefined;
  }
  let recipient: Record<string, unknown> | undefined;
  if (value.recipient !== undefined) {
    if (
      !isRecord(value.recipient) ||
      !hasExactKeys(value.recipient, ["origin", "host", "firstParty"]) ||
      !isSafeString(value.recipient.origin, 2_048) ||
      !isCanonicalOrigin(value.recipient.origin) ||
      !isSafeString(value.recipient.host, 255) ||
      typeof value.recipient.firstParty !== "boolean"
    ) {
      return undefined;
    }
    recipient = structuredClone(value.recipient);
  }
  return structuredClone({
    ...value,
    requestSurface: requestSurfaceRequired ? value.requestSurface : "browser",
    test,
    ...(provenance === undefined ? {} : { sourceProvenance: provenance }),
    ...(recipient === undefined ? {} : { recipient }),
  });
};

const diagnosticCodes = new Set([
  "PS_ANALYZER_PRIVACY_FAILED",
  "PS_OBSERVER_FINALIZATION_FAILED",
  "PS_OBSERVER_FINALIZATION_TIMEOUT",
  "PS_SOURCE_LIMIT_REACHED",
  "PS_CUSTOM_SOURCE_AMBIGUOUS",
  "PS_SINK_LIMIT_REACHED",
  "PS_CORRELATION_LIMIT_REACHED",
]);

const parseObservation = (
  value: unknown,
  responseSources: boolean,
  requestSurfaceRequired: boolean,
): PrivacySpecObservation | undefined => {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "sensitive-source") return parseSensitiveSource(value, responseSources);
  if (value.kind === "sink") return parseSink(value, requestSurfaceRequired);
  if (value.kind === "data-flow") {
    return parseFlow(value, responseSources, requestSurfaceRequired) as
      | PrivacySpecObservation
      | undefined;
  }
  if (value.kind === "finding") {
    if (
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
      !Object.hasOwn(RULE_DEFINITIONS, String(value.ruleId)) ||
      !["info", "warning", "error", "critical"].includes(String(value.severity)) ||
      !["technical_failure", "review_required", "informational"].includes(
        String(value.classification),
      ) ||
      value.title !== RULE_DEFINITIONS[value.ruleId as keyof typeof RULE_DEFINITIONS].title ||
      !isSafeString(value.observation, 2_048) ||
      !Array.isArray(value.limitations) ||
      value.limitations.length > 10 ||
      !value.limitations.every((entry) => isSafeString(entry, 2_048))
    ) {
      return undefined;
    }
    const flow = parseFlow(value.flow, responseSources, requestSurfaceRequired);
    return flow === undefined
      ? undefined
      : (structuredClone({
          ...value,
          flow,
          limitations: [...value.limitations],
        }) as unknown as PrivacySpecObservation);
  }
  if (value.kind === "diagnostic") {
    const sinkLimit = value.code === "PS_SINK_LIMIT_REACHED";
    if (
      !hasExactKeys(
        value,
        sinkLimit
          ? ["kind", "code", "classification", "collector", "message"]
          : ["kind", "code", "classification", "message"],
      ) ||
      !diagnosticCodes.has(String(value.code)) ||
      value.classification !== "informational" ||
      !isSafeString(value.message, 1_024) ||
      (sinkLimit && !["network", "console", "storage"].includes(String(value.collector)))
    ) {
      return undefined;
    }
    return structuredClone(value) as unknown as PrivacySpecObservation;
  }
  return undefined;
};

const observationUsesCustomCategory = (observation: PrivacySpecObservation): boolean =>
  (observation.kind === "sensitive-source" && observation.category.startsWith("custom.")) ||
  (observation.kind === "data-flow" && observation.dataCategory.startsWith("custom.")) ||
  (observation.kind === "finding" && observation.flow.dataCategory.startsWith("custom."));

const parseResponseCoverage = (value: unknown): ResponseJsonCoverage | undefined => {
  const responseKeys = ["seen", "firstParty", "json", "parsed", "withSources"];
  const skipKeys = [
    "unknownLength",
    "oversized",
    "aggregateLimit",
    "workLimit",
    "bodyReadError",
    "invalidJson",
    "traversalLimit",
    "sourceLimit",
  ];
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
    !hasNonNegativeCounts(value.responses, responseKeys) ||
    !isNonNegativeInteger(value.retainedBytes) ||
    !isRecord(value.discoveredSources) ||
    !hasExactKeys(value.discoveredSources, ["total", "byCategory"]) ||
    !isNonNegativeInteger(value.discoveredSources.total) ||
    !hasNonNegativeCounts(value.discoveredSources.byCategory, [
      "personal.email",
      "personal.phone",
    ]) ||
    !hasNonNegativeCounts(value.skipped, skipKeys)
  ) {
    return undefined;
  }
  const responses = value.responses as unknown as ResponseJsonCoverage["responses"];
  const categories = value.discoveredSources
    .byCategory as unknown as ResponseJsonCoverage["discoveredSources"]["byCategory"];
  if (
    responses.firstParty > responses.seen ||
    responses.json > responses.firstParty ||
    responses.parsed > responses.json ||
    responses.withSources > responses.parsed ||
    value.discoveredSources.total !== categories["personal.email"] + categories["personal.phone"]
  ) {
    return undefined;
  }
  return structuredClone(value) as unknown as ResponseJsonCoverage;
};

const parseCoverage = (
  value: unknown,
  schemaVersion: 2 | 3 | 4 | 5,
):
  | PrivacySpecResultV2["coverage"]
  | PrivacySpecResultV3["coverage"]
  | PrivacySpecResultV4["coverage"]
  | undefined => {
  const keys = [
    "playwright",
    "network",
    "firstPartyJsonResponses",
    ...(schemaVersion >= 3 ? ["observation"] : []),
    ...(schemaVersion >= 4 ? ["browserEngine", "apiRequests"] : []),
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys)) return undefined;
  if (
    !isRecord(value.playwright) ||
    !hasExactKeys(value.playwright, ["applicationContexts", "pages"]) ||
    (value.playwright.applicationContexts !== 0 && value.playwright.applicationContexts !== 1) ||
    !isNonNegativeInteger(value.playwright.pages) ||
    (value.playwright.applicationContexts === 0) !== (value.playwright.pages === 0) ||
    !isRecord(value.network) ||
    !hasExactKeys(value.network, ["requests"]) ||
    !hasNonNegativeCounts(value.network.requests, ["seen", "accepted", "filteredLowValueStatic"]) ||
    (value.network.requests as unknown as NetworkObservationCoverage["requests"]).accepted +
      (value.network.requests as unknown as NetworkObservationCoverage["requests"])
        .filteredLowValueStatic >
      (value.network.requests as unknown as NetworkObservationCoverage["requests"]).seen
  ) {
    return undefined;
  }
  const response = parseResponseCoverage(value.firstPartyJsonResponses);
  if (response === undefined) return undefined;
  if (schemaVersion >= 3) {
    const observation = value.observation as Record<string, unknown>;
    if (
      !isRecord(value.observation) ||
      !hasExactKeys(value.observation, ["browserObjects", "contexts", "pages", "events"]) ||
      !hasNonNegativeCounts(value.observation.browserObjects, ["seen"]) ||
      !hasNonNegativeCounts(value.observation.contexts, ["seen", "instrumented"]) ||
      !hasNonNegativeCounts(value.observation.pages, ["seen", "instrumented", "storageCapable"]) ||
      !hasNonNegativeCounts(value.observation.events, ["navigations", "network", "console"]) ||
      (observation.contexts as unknown as PlaywrightObservationCounters["contexts"]).instrumented >
        (observation.contexts as unknown as PlaywrightObservationCounters["contexts"]).seen ||
      (observation.pages as unknown as PlaywrightObservationCounters["pages"]).instrumented >
        (observation.pages as unknown as PlaywrightObservationCounters["pages"]).seen ||
      (observation.pages as unknown as PlaywrightObservationCounters["pages"]).storageCapable >
        (observation.pages as unknown as PlaywrightObservationCounters["pages"]).seen
    ) {
      return undefined;
    }
  }
  if (schemaVersion >= 4) {
    const browserEngine = value.browserEngine as Record<string, unknown>;
    const capabilities = [
      "init-scripts",
      "events",
      "teardown-fallback",
      "network",
      "console",
      "storage",
      "cookies",
      "response-headers",
      "page-errors",
    ];
    if (
      !isRecord(value.browserEngine) ||
      !hasExactKeys(value.browserEngine, ["engine", "support", "experimental", "capabilities"]) ||
      !["chromium", "firefox", "webkit"].includes(String(value.browserEngine.engine)) ||
      !["supported", "experimental", "unsupported"].includes(String(value.browserEngine.support)) ||
      typeof value.browserEngine.experimental !== "boolean" ||
      !isRecord(value.browserEngine.capabilities) ||
      !hasExactKeys(value.browserEngine.capabilities, capabilities) ||
      !capabilities.every((key) =>
        ["complete", "partial", "incomplete", "unsupported", "disabled"].includes(
          String((browserEngine.capabilities as Record<string, unknown>)[key]),
        ),
      ) ||
      !isRecord(value.apiRequests) ||
      !hasExactKeys(value.apiRequests, ["enabled", "status", "calls", "skipped", "blindSpots"]) ||
      typeof value.apiRequests.enabled !== "boolean" ||
      !["complete", "partial", "unsupported"].includes(String(value.apiRequests.status)) ||
      !hasNonNegativeCounts(value.apiRequests.calls, [
        "seen",
        "observed",
        "failed",
        "serverErrors",
      ]) ||
      !hasNonNegativeCounts(value.apiRequests.skipped, [
        "accessors",
        "streams",
        "files",
        "unsupportedObjects",
        "oversized",
        "aggregateLimit",
        "sinkLimit",
        "materialLimit",
      ]) ||
      !Array.isArray(value.apiRequests.blindSpots) ||
      JSON.stringify(value.apiRequests.blindSpots) !==
        JSON.stringify([
          "implicit-headers-cookies-auth",
          "redirect-chain",
          "page-request",
          "context-request",
          "manual-request-context",
        ])
    ) {
      return undefined;
    }
  }
  return structuredClone({
    ...value,
    firstPartyJsonResponses: response,
  }) as PrivacySpecResultV4["coverage"];
};

export const getPrivacySpecResultValidationError = (value: unknown): string | undefined => {
  if (!isBoundedJson(value) || !isRecord(value)) return "invalid bounded JSON";
  const version = value.schemaVersion;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) {
    return "unsupported result schema version";
  }
  const required = [
    "schemaVersion",
    ...(version === 5 ? ["classifierConfiguration"] : []),
    "observations",
    ...(version >= 2 ? ["coverage"] : []),
  ];
  if (!hasExactKeys(value, required, version >= 2 ? ["testData"] : [])) {
    return "invalid result fields";
  }
  if (
    !Array.isArray(value.observations) ||
    value.observations.length > MAX_ATTACHMENT_OBSERVATIONS
  ) {
    return "invalid observation collection";
  }
  for (const observation of value.observations) {
    const parsed = parseObservation(observation, version >= 2, version >= 4);
    if (parsed === undefined) {
      const kind =
        isRecord(observation) && typeof observation.kind === "string"
          ? observation.kind
          : "unknown";
      return ["sensitive-source", "sink", "data-flow", "finding", "diagnostic"].includes(kind)
        ? `invalid ${kind} observation`
        : "invalid observation kind";
    }
  }
  if (version === 1) return undefined;
  const coverage = parseCoverage(value.coverage, version);
  const testData =
    value.testData === undefined ? undefined : parseTestDataAttachment(value.testData);
  if (coverage === undefined) return "invalid coverage";
  if (value.testData !== undefined && testData === undefined) return "invalid test-data hygiene";
  if (version === 5) {
    const classifierConfiguration = parseClassifierConfiguration(value.classifierConfiguration);
    if (classifierConfiguration === undefined) return "invalid classifier configuration";
    if (
      classifierConfiguration.mode === "builtin-only" &&
      value.observations.some((observation) =>
        observationUsesCustomCategory(
          parseObservation(observation, true, true) as PrivacySpecObservation,
        ),
      )
    ) {
      return "incompatible classifier configuration";
    }
  }
  return undefined;
};

export const parsePrivacySpecResult = (value: unknown): PrivacySpecResult | undefined => {
  if (getPrivacySpecResultValidationError(value) !== undefined || !isRecord(value))
    return undefined;
  const version = value.schemaVersion as 1 | 2 | 3 | 4 | 5;
  const observations = (value.observations as unknown[]).map(
    (observation) =>
      parseObservation(observation, version >= 2, version >= 4) as PrivacySpecObservation,
  );
  if (version === 1) return { schemaVersion: 1, observations };
  const coverage = parseCoverage(value.coverage, version) as PrivacySpecResultV4["coverage"];
  const testData =
    value.testData === undefined ? undefined : parseTestDataAttachment(value.testData);
  if (version === 5) {
    const classifierConfiguration = parseClassifierConfiguration(
      value.classifierConfiguration,
    ) as ClassifierConfiguration;
    return {
      schemaVersion: ATTACHMENT_SCHEMA_VERSION,
      classifierConfiguration,
      observations,
      coverage: coverage as PrivacySpecResultV5["coverage"],
      ...(testData === undefined ? {} : { testData }),
    };
  }
  return {
    schemaVersion: version,
    observations,
    coverage,
    ...(testData === undefined ? {} : { testData }),
  } as PrivacySpecResultV2 | PrivacySpecResultV3 | PrivacySpecResultV4;
};

export const isPrivacySpecResult = (value: unknown): value is PrivacySpecResult =>
  parsePrivacySpecResult(value) !== undefined;
