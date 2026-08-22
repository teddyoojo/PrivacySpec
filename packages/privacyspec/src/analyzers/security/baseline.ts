import { createHash } from "node:crypto";
import { compareCanonicalStrings } from "../../canonical-order.js";
import { createSecurityTargetKey } from "./analyzer.js";
import {
  SECURITY_SCHEMA_VERSION,
  type SecurityBaselineComparison,
  type SecurityBaselineEntry,
  type SecurityBaselineFile,
  type SecurityFinding,
  type SecurityFingerprint,
  type SecurityLatestRunFile,
  type SecurityPostureInventoryEntry,
  type SecurityProperty,
  type SecurityResponseKind,
  type SecurityRuleId,
} from "./model.js";

export const MAX_SECURITY_BASELINE_ENTRIES = 10_000;

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
const isHost = (value: unknown): value is string => {
  if (!isSafeString(value, 255) || value !== value.toLowerCase()) return false;
  try {
    return new URL(`https://${value}`).hostname === value;
  } catch {
    return false;
  }
};
const isSortedUnique = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareCanonicalStrings(values[index - 1] ?? "", value) < 0,
  );

const parseCookie = (value: unknown): SecurityFingerprint["cookies"][number] | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["name", "secure", "httpOnly", "sameSite"]) ||
    !isSafeString(value.name, 128) ||
    typeof value.secure !== "boolean" ||
    typeof value.httpOnly !== "boolean" ||
    (value.sameSite !== "strict" &&
      value.sameSite !== "lax" &&
      value.sameSite !== "none" &&
      value.sameSite !== "unspecified")
  )
    return undefined;
  return {
    name: value.name,
    secure: value.secure,
    httpOnly: value.httpOnly,
    sameSite: value.sameSite,
  };
};

export const parseSecurityFingerprint = (value: unknown): SecurityFingerprint | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["transport", "csp", "hsts", "xContentTypeOptions", "cors", "cookies"]) ||
    (value.transport !== "secure" && value.transport !== "insecure") ||
    !isSafeString(value.csp, 64) ||
    !isSafeString(value.hsts, 128) ||
    !isSafeString(value.xContentTypeOptions, 32) ||
    !isSafeString(value.cors, 512) ||
    !Array.isArray(value.cookies) ||
    value.cookies.length > 32
  )
    return undefined;
  const cookies = value.cookies.map(parseCookie);
  if (cookies.some((cookie) => cookie === undefined)) return undefined;
  if (!isSortedUnique(cookies.map((cookie) => cookie?.name ?? ""))) return undefined;
  return {
    transport: value.transport,
    csp: value.csp,
    hsts: value.hsts,
    xContentTypeOptions: value.xContentTypeOptions,
    cors: value.cors,
    cookies: cookies as SecurityFingerprint["cookies"],
  };
};

export const parseSecurityBaselineEntry = (value: unknown): SecurityBaselineEntry | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "key",
      "host",
      "endpoint",
      "responseKind",
      "method",
      "fingerprints",
      "status",
    ]) ||
    !isSafeString(value.key, 3_000) ||
    !isHost(value.host) ||
    !isSafeString(value.endpoint, 2_048) ||
    !value.endpoint.startsWith("/") ||
    typeof value.responseKind !== "string" ||
    !new Set<SecurityResponseKind>(["document", "api", "authentication"]).has(
      value.responseKind as SecurityResponseKind,
    ) ||
    !isSafeString(value.method, 32) ||
    !/^[A-Z0-9!#$%&'*+.^_`|~-]{1,32}$/u.test(value.method) ||
    !Array.isArray(value.fingerprints) ||
    value.fingerprints.length === 0 ||
    value.fingerprints.length > 8 ||
    value.status !== "accepted"
  )
    return undefined;
  const fingerprints = value.fingerprints.map(parseSecurityFingerprint);
  if (fingerprints.some((fingerprint) => fingerprint === undefined)) return undefined;
  const fingerprintKeys = fingerprints.map((fingerprint) => JSON.stringify(fingerprint));
  if (!isSortedUnique(fingerprintKeys)) return undefined;
  const responseKind = value.responseKind as SecurityResponseKind;
  if (
    value.key !==
    createSecurityTargetKey({
      host: value.host,
      endpoint: value.endpoint,
      responseKind,
      method: value.method,
    })
  )
    return undefined;
  return {
    key: value.key,
    host: value.host,
    endpoint: value.endpoint,
    responseKind,
    method: value.method,
    fingerprints: fingerprints as SecurityFingerprint[],
    status: "accepted",
  };
};

const parseEntries = (value: unknown): SecurityBaselineEntry[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_SECURITY_BASELINE_ENTRIES) return undefined;
  const entries = value.map(parseSecurityBaselineEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const parsed = entries as SecurityBaselineEntry[];
  if (!isSortedUnique(parsed.map((entry) => entry.key))) return undefined;
  return parsed;
};

export class SecurityArtifactFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityArtifactFormatError";
  }
}

export class SecurityLatestRunIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityLatestRunIncompleteError";
  }
}

export const parseSecurityBaseline = (value: unknown): SecurityBaselineFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "entries"]) ||
    value.schemaVersion !== SECURITY_SCHEMA_VERSION ||
    !isTimestamp(value.createdAt)
  ) {
    throw new SecurityArtifactFormatError("Invalid security posture baseline schema.");
  }
  const entries = parseEntries(value.entries);
  if (entries === undefined)
    throw new SecurityArtifactFormatError("Invalid security posture baseline entries.");
  return { schemaVersion: SECURITY_SCHEMA_VERSION, createdAt: value.createdAt, entries };
};

export const parseSecurityLatestRun = (value: unknown): SecurityLatestRunFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "complete", "entries"]) ||
    value.schemaVersion !== SECURITY_SCHEMA_VERSION ||
    !isTimestamp(value.createdAt) ||
    typeof value.complete !== "boolean"
  ) {
    throw new SecurityArtifactFormatError("Invalid security posture latest-run schema.");
  }
  const entries = parseEntries(value.entries);
  if (entries === undefined)
    throw new SecurityArtifactFormatError("Invalid security posture latest-run entries.");
  return {
    schemaVersion: SECURITY_SCHEMA_VERSION,
    createdAt: value.createdAt,
    complete: value.complete,
    entries,
  };
};

export const createSecurityBaselineEntries = (
  inventory: readonly SecurityPostureInventoryEntry[],
): SecurityBaselineEntry[] =>
  inventory
    .map((entry) => ({
      key: entry.key,
      host: entry.host,
      endpoint: entry.endpoint,
      responseKind: entry.responseKind,
      method: entry.method,
      fingerprints: entry.fingerprints
        .map((fingerprint) => ({
          ...fingerprint,
          cookies: fingerprint.cookies
            .map((cookie) => ({ ...cookie }))
            .sort((left, right) => compareCanonicalStrings(left.name, right.name)),
        }))
        .sort((left, right) =>
          compareCanonicalStrings(JSON.stringify(left), JSON.stringify(right)),
        ),
      status: "accepted" as const,
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));

const propertyValues = (entry: SecurityBaselineEntry, property: SecurityProperty): string[] => {
  const values = entry.fingerprints.map((fingerprint) => {
    if (property === "transport") return fingerprint.transport;
    if (property === "csp") return fingerprint.csp;
    if (property === "hsts") return fingerprint.hsts;
    if (property === "x-content-type-options") return fingerprint.xContentTypeOptions;
    if (property === "cors") return fingerprint.cors;
    return (
      fingerprint.cookies
        .map(
          (cookie) =>
            `${cookie.name}(Secure=${cookie.secure},HttpOnly=${cookie.httpOnly},SameSite=${cookie.sameSite})`,
        )
        .join(",") || "none"
    );
  });
  return Array.from(new Set(values)).sort(compareCanonicalStrings);
};

const displayValues = (values: readonly string[]): string => {
  const joined = values.join(" | ");
  if (joined.length <= 512) return joined;
  return `variants:sha256:${createHash("sha256").update(joined).digest("hex").slice(0, 16)}`;
};

const ruleFor: Readonly<Record<SecurityProperty, SecurityRuleId>> = {
  csp: "SECURITY_CSP_CHANGED",
  hsts: "SECURITY_HSTS_CHANGED",
  "x-content-type-options": "SECURITY_XCTO_CHANGED",
  cors: "SECURITY_CORS_CHANGED",
  cookie: "SECURITY_COOKIE_CHANGED",
  transport: "SECURITY_TRANSPORT_CHANGED",
};

const properties: readonly SecurityProperty[] = [
  "csp",
  "hsts",
  "x-content-type-options",
  "cors",
  "cookie",
  "transport",
];

export const compareSecurityBaseline = (
  inventory: readonly SecurityPostureInventoryEntry[],
  baseline?: SecurityBaselineFile,
): SecurityBaselineComparison => {
  const observed = createSecurityBaselineEntries(inventory);
  const baselineByKey = new Map((baseline?.entries ?? []).map((entry) => [entry.key, entry]));
  const inventoryByKey = new Map(inventory.map((entry) => [entry.key, entry]));
  const known: SecurityBaselineEntry[] = [];
  const newTargets: SecurityBaselineEntry[] = [];
  const changed: SecurityBaselineEntry[] = [];
  const findings: SecurityFinding[] = [];
  for (const current of observed) {
    const previous = baselineByKey.get(current.key);
    if (previous === undefined) {
      newTargets.push(current);
      continue;
    }
    if (JSON.stringify(previous.fingerprints) === JSON.stringify(current.fingerprints)) {
      known.push(current);
      continue;
    }
    changed.push(current);
    const test = inventoryByKey.get(current.key)?.firstSeenTests[0];
    if (test === undefined) continue;
    for (const property of properties) {
      const previousValues = propertyValues(previous, property);
      const currentValues = propertyValues(current, property);
      if (JSON.stringify(previousValues) === JSON.stringify(currentValues)) continue;
      findings.push({
        kind: "security-posture-finding",
        ruleId: ruleFor[property],
        classification: "REVIEW_REQUIRED",
        identity: `${current.key}|${property}`,
        host: current.host,
        endpoint: current.endpoint,
        property,
        previous: displayValues(previousValues),
        current: displayValues(currentValues),
        firstSeenTest: { ...test },
      });
    }
  }
  const observedKeys = new Set(observed.map((entry) => entry.key));
  const resolved = (baseline?.entries ?? [])
    .filter((entry) => !observedKeys.has(entry.key))
    .slice()
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));
  findings.sort((left, right) => compareCanonicalStrings(left.identity, right.identity));
  return { observed, known, newTargets, changed, resolved, findings };
};
