import { domainToASCII } from "node:url";
import type { DataFlowSourceKind, DataFlowTestMetadata } from "../correlate/model.js";
import { sanitizeLabel } from "../correlate/redact.js";
import { createRedactionValues } from "../correlate/transforms.js";
import type { RawSensitiveSource } from "../discovery/source-model.js";
import type {
  TestDataAttribution,
  TestDataObservation,
  TestDataSignal,
  TestDataVerdict,
} from "./model.js";

export const MAX_SYNTHETIC_EMAIL_DOMAINS = 100;

const IANA_RESERVED_EMAIL_DOMAINS = [
  "example",
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test",
] as const;

const emailLocalPart = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u;
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const containsUnsafeCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return true;
    }
  }
  return false;
};

const normalizeDomain = (value: string): string | undefined => {
  if (
    value.length === 0 ||
    value.length > 254 ||
    value.trim() !== value ||
    containsUnsafeCharacter(value)
  ) {
    return undefined;
  }
  const withoutRootDot = value.endsWith(".") ? value.slice(0, -1) : value;
  if (withoutRootDot.length === 0 || withoutRootDot.endsWith(".")) return undefined;
  const ascii = domainToASCII(withoutRootDot.normalize("NFC")).toLowerCase();
  if (ascii.length === 0 || ascii.length > 253) return undefined;
  const labels = ascii.split(".");
  if (labels.some((label) => label.length === 0 || !dnsLabel.test(label))) return undefined;
  return ascii;
};

export const normalizeSyntheticEmailDomains = (domains: readonly string[] = []): string[] => {
  if (domains.length > MAX_SYNTHETIC_EMAIL_DOMAINS) {
    throw new TypeError(
      `testData.syntheticEmailDomains supports at most ${MAX_SYNTHETIC_EMAIL_DOMAINS} domains.`,
    );
  }
  const normalized = new Set<string>();
  for (const domain of domains) {
    if (typeof domain !== "string") {
      throw new TypeError("testData.syntheticEmailDomains must contain only domain strings.");
    }
    const candidate = normalizeDomain(domain);
    if (candidate === undefined) {
      throw new TypeError("testData.syntheticEmailDomains contains an invalid domain.");
    }
    normalized.add(candidate);
  }
  return Array.from(normalized).sort((left, right) => left.localeCompare(right));
};

const matchesDomain = (domain: string, candidate: string): boolean =>
  domain === candidate || domain.endsWith(`.${candidate}`);

interface ParsedEmailDomain {
  normalized: string;
  privateFragments: string[];
}

const parseEmailDomain = (value: string): ParsedEmailDomain | undefined => {
  if (
    value.length > 320 ||
    value.trim() !== value ||
    containsUnsafeCharacter(value) ||
    value.indexOf("@") <= 0 ||
    value.indexOf("@") !== value.lastIndexOf("@")
  ) {
    return undefined;
  }
  const separator = value.indexOf("@");
  const local = value.slice(0, separator);
  const rawDomain = value.slice(separator + 1);
  if (
    local.length === 0 ||
    local.length > 64 ||
    !emailLocalPart.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return undefined;
  }
  const normalized = normalizeDomain(rawDomain);
  if (normalized === undefined) return undefined;
  return {
    normalized,
    privateFragments: Array.from(
      new Set([rawDomain, rawDomain.toLowerCase(), rawDomain.toUpperCase(), normalized]),
    ).filter((fragment) => fragment.length > 0),
  };
};

const sourceKind = (source: RawSensitiveSource): DataFlowSourceKind => {
  if (source.kind === "response-json") return "response-json";
  return source.control.elementKind === "contenteditable" ? "dom-control" : "form-input";
};

const sanitizeTest = (
  test: DataFlowTestMetadata,
  sources: readonly RawSensitiveSource[],
): DataFlowTestMetadata => {
  const redactionValues = createRedactionValues(sources);
  for (const source of sources) {
    const parsed = source.category === "personal.email" ? parseEmailDomain(source.raw) : undefined;
    if (parsed === undefined) continue;
    for (const fragment of parsed.privateFragments) {
      redactionValues.push(
        fragment,
        fragment.toLowerCase(),
        fragment.toUpperCase(),
        encodeURIComponent(fragment),
      );
    }
  }
  const sanitize = (value: string, maxLength: number): string =>
    sanitizeLabel(value, Array.from(new Set(redactionValues)), maxLength);
  const file = sanitize(test.file, 2_048);
  return {
    file:
      /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(file) || file.split(/[\\/]/u).includes("..")
        ? ":redacted"
        : file,
    title: sanitize(test.title, 2_048),
    project: sanitize(test.project, 512),
  };
};

const attributionFor = (
  source: RawSensitiveSource,
  test: DataFlowTestMetadata,
): TestDataAttribution => {
  if (source.kind === "response-json") return { test };
  return {
    test,
    control: {
      elementKind: source.control.elementKind,
      observedBy: source.observedBy,
    },
  };
};

const classifySource = (
  source: RawSensitiveSource,
  configuredDomains: readonly string[],
  test: DataFlowTestMetadata,
): TestDataObservation => {
  let verdict: TestDataVerdict = "UNASSESSED";
  let signal: TestDataSignal = "UNSUPPORTED_CATEGORY";
  if (source.kind === "response-json") {
    signal = "UNSUPPORTED_SOURCE_KIND";
  } else if (source.category === "personal.email") {
    const parsed = parseEmailDomain(source.raw);
    if (parsed === undefined) {
      signal = "EMAIL_SHAPE_UNSUPPORTED";
    } else if (
      IANA_RESERVED_EMAIL_DOMAINS.some((domain) => matchesDomain(parsed.normalized, domain))
    ) {
      verdict = "SYNTHETIC";
      signal = "IANA_RESERVED_EMAIL_DOMAIN";
    } else if (configuredDomains.some((domain) => matchesDomain(parsed.normalized, domain))) {
      verdict = "SYNTHETIC";
      signal = "CONFIGURED_SYNTHETIC_EMAIL_DOMAIN";
    } else {
      verdict = "REVIEW_REQUIRED";
      signal = "EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC";
    }
  }
  return {
    verdict,
    signal,
    category: source.category,
    sourceKind: sourceKind(source),
    attribution: attributionFor(source, test),
  };
};

export const createTestDataObservations = (
  sources: readonly RawSensitiveSource[],
  syntheticEmailDomains: readonly string[],
  test: DataFlowTestMetadata,
): TestDataObservation[] => {
  const normalizedDomains = normalizeSyntheticEmailDomains(syntheticEmailDomains);
  const sanitizedTest = sanitizeTest(test, sources);
  const observations = new Map<string, TestDataObservation>();
  for (const source of sources) {
    const observation = classifySource(source, normalizedDomains, sanitizedTest);
    const identity = JSON.stringify(observation);
    observations.set(identity, observation);
  }
  return Array.from(observations.values()).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
};

export const browserInputEmailSources = (
  sources: readonly RawSensitiveSource[],
): RawSensitiveSource[] =>
  sources.filter((source) => source.kind === "control" && source.category === "personal.email");
