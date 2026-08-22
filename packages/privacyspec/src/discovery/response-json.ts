import type {
  DataCategory,
  RawResponseSensitiveSource,
  ResponseSourceProvenance,
} from "./source-model.js";

export const MAX_RESPONSE_JSON_BYTES = 256 * 1024;
export const MAX_RESPONSE_JSON_RETAINED_BYTES_PER_TEST = 2 * 1024 * 1024;
export const MAX_RESPONSE_JSON_DEPTH = 8;
export const MAX_RESPONSE_JSON_NODES = 10_000;
export const MAX_RESPONSE_JSON_VALUES = 2_000;
export const MAX_RESPONSE_JSON_SOURCES_PER_RESPONSE = 100;
export const MAX_RESPONSE_JSON_RESPONSES_PER_TEST = 250;
export const MAX_RESPONSE_JSON_QUEUE = 64;
export const MAX_RESPONSE_JSON_CONCURRENCY = 4;

export type ResponseJsonSkipReason =
  | "unknownLength"
  | "oversized"
  | "aggregateLimit"
  | "workLimit"
  | "bodyReadError"
  | "invalidJson"
  | "traversalLimit"
  | "sourceLimit";

export interface ResponseJsonCoverage {
  enabled: boolean;
  responses: {
    seen: number;
    firstParty: number;
    json: number;
    parsed: number;
    withSources: number;
  };
  retainedBytes: number;
  discoveredSources: {
    total: number;
    byCategory: Record<"personal.email" | "personal.phone", number>;
  };
  skipped: Record<ResponseJsonSkipReason, number>;
}

export const createResponseJsonCoverage = (enabled: boolean): ResponseJsonCoverage => ({
  enabled,
  responses: { seen: 0, firstParty: 0, json: 0, parsed: 0, withSources: 0 },
  retainedBytes: 0,
  discoveredSources: {
    total: 0,
    byCategory: { "personal.email": 0, "personal.phone": 0 },
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

const normalizedKeyCategory = (key: string): "personal.email" | "personal.phone" | undefined => {
  const normalized = key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
  if (normalized === "email" || normalized === "emailaddress") return "personal.email";
  if (
    normalized === "phone" ||
    normalized === "phonenumber" ||
    normalized === "telephone" ||
    normalized === "mobile" ||
    normalized === "mobilephone"
  ) {
    return "personal.phone";
  }
  return undefined;
};

const validEmail = (value: string): boolean =>
  value.length >= 6 &&
  value.length <= 320 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u.test(
    value,
  );

const validPhone = (value: string): boolean => {
  if (value.length < 7 || value.length > 32 || !/^\+?[0-9][0-9 ().-]*[0-9]$/u.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 7 && digits.length <= 15;
};

const validShape = (category: DataCategory, value: string): boolean =>
  category === "personal.email"
    ? validEmail(value)
    : category === "personal.phone" && validPhone(value);

const pathSegment = (key: string): string => {
  const normalized = Array.from(key.normalize("NFKC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 ||
      (codePoint >= 127 && codePoint <= 159) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      character === "."
      ? "_"
      : character;
  })
    .join("")
    .trim();
  return normalized.length === 0 ? "_" : normalized.slice(0, 80);
};

export interface DiscoverResponseJsonResult {
  sources: RawResponseSensitiveSource[];
  invalidJson: boolean;
  traversalLimitReached: boolean;
}

export const discoverResponseJsonSources = (
  serialized: string,
  provenance: Omit<ResponseSourceProvenance, "location">,
  timestamp: number,
): DiscoverResponseJsonResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return { sources: [], invalidJson: true, traversalLimitReached: false };
  }

  const sources: RawResponseSensitiveSource[] = [];
  let nodes = 0;
  let values = 0;
  let traversalLimitReached = false;

  const visit = (
    value: unknown,
    location: string,
    key: string | undefined,
    depth: number,
  ): void => {
    if (traversalLimitReached) return;
    nodes += 1;
    if (depth > MAX_RESPONSE_JSON_DEPTH || nodes > MAX_RESPONSE_JSON_NODES) {
      traversalLimitReached = true;
      return;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      values += 1;
      if (values > MAX_RESPONSE_JSON_VALUES) traversalLimitReached = true;
      return;
    }
    if (typeof value === "string") {
      values += 1;
      if (values > MAX_RESPONSE_JSON_VALUES) {
        traversalLimitReached = true;
        return;
      }
      const category = key === undefined ? undefined : normalizedKeyCategory(key);
      if (
        category !== undefined &&
        validShape(category, value) &&
        sources.length < MAX_RESPONSE_JSON_SOURCES_PER_RESPONSE
      ) {
        sources.push({
          kind: "response-json",
          category,
          confidence: "high",
          evidence: [{ kind: "json-key", value: (key ?? "").slice(0, 200) }],
          raw: value,
          provenance: { ...provenance, location },
          timestamp,
          observedBy: "response",
        });
      } else if (sources.length >= MAX_RESPONSE_JSON_SOURCES_PER_RESPONSE) {
        traversalLimitReached = true;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        visit(value[index], `${location}[${index}]`, undefined, depth + 1);
        if (traversalLimitReached) return;
      }
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, `${location}.${pathSegment(childKey)}`, childKey, depth + 1);
        if (traversalLimitReached) return;
      }
    }
  };

  visit(parsed, "json", undefined, 0);
  if (traversalLimitReached) sources.length = 0;
  parsed = undefined;
  return { sources, invalidJson: false, traversalLimitReached };
};

export const isJsonMediaType = (value: string): boolean => {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType)
  );
};
