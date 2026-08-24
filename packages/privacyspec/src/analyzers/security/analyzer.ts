import { createHash } from "node:crypto";
import { compareCanonicalStrings } from "../../canonical-order.js";
import { classifyRecipient } from "../../correlate/first-party.js";
import type { FirstPartyConfig } from "../../correlate/model.js";
import { canonicalizeEndpointPath, normalizePath, sanitizeLabel } from "../../correlate/redact.js";
import type { RuntimeSecurityResponse } from "../../observe/response-security.js";
import type { Analyzer, AnalyzerContext, AnalyzerDiagnostic } from "../../runtime/analyzer.js";
import type { RuntimeEvent } from "../../runtime/events.js";
import {
  SECURITY_ANALYZER_ID,
  type SecurityAnalyzerTestResult,
  type SecurityCoverageStatus,
  type SecurityDiagnostic,
  type SecurityFingerprint,
  type SecurityPostureInventoryEntry,
  type SecurityResponseKind,
  type SecurityTestReference,
} from "./model.js";

export const MAX_SECURITY_TARGETS_PER_TEST = 512;
export const MAX_SECURITY_VARIANTS_PER_TARGET = 8;

interface MutableSecurityEntry {
  key: string;
  host: string;
  endpoint: string;
  responseKind: SecurityResponseKind;
  method: string;
  fingerprints: Map<string, SecurityFingerprint>;
  occurrenceCount: number;
}

const methodPattern = /^[A-Z0-9!#$%&'*+.^_`|~-]{1,32}$/u;
const normalizeMethod = (method: string): string => {
  const normalized = method.toUpperCase();
  return methodPattern.test(normalized) ? normalized : "OTHER";
};

const normalizeCsp = (value: string): string =>
  value
    .replace(/'nonce-[^']+'/giu, "'nonce-*'")
    .replace(/'(sha256|sha384|sha512)-[^']+'/giu, "'$1-*'")
    .trim()
    .replace(/\s+/gu, " ");

const fingerprintCsp = (value: string | undefined): string => {
  if (value === undefined) return "missing";
  if (value === ":oversized") return "present:oversized";
  const digest = createHash("sha256")
    .update(normalizeCsp(value), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `present:sha256:${digest}`;
};

const fingerprintHsts = (value: string | undefined): string => {
  if (value === undefined) return "missing";
  if (value === ":oversized") return "present:oversized";
  const directives = value.split(";").map((part) => part.trim());
  const maxAgeValue = directives
    .find((part) => /^max-age\s*=/iu.test(part))
    ?.split("=", 2)[1]
    ?.trim();
  const maxAge =
    maxAgeValue !== undefined && /^\d{1,16}$/u.test(maxAgeValue) ? maxAgeValue : "invalid";
  const includeSubDomains = directives.some((part) => /^includesubdomains$/iu.test(part));
  const preload = directives.some((part) => /^preload$/iu.test(part));
  return `max-age=${maxAge};includeSubDomains=${includeSubDomains};preload=${preload}`;
};

const fingerprintXcto = (value: string | undefined): string => {
  if (value === undefined) return "missing";
  return value.trim().toLowerCase() === "nosniff" ? "nosniff" : "present:other";
};

const normalizeCorsOrigin = (value: string | undefined): string => {
  if (value === undefined) return "none";
  const trimmed = value.trim();
  if (trimmed === "*" || trimmed === "null") return trimmed;
  try {
    const url = new URL(trimmed);
    return url.origin === "null" ? "other" : `origin:${url.origin.toLowerCase()}`;
  } catch {
    return "other";
  }
};

const normalizeCorsMethods = (value: string | undefined): string => {
  if (value === undefined) return "none";
  const methods = value
    .split(",")
    .map((method) => normalizeMethod(method.trim()))
    .filter((method, index, values) => values.indexOf(method) === index)
    .sort(compareCanonicalStrings);
  return methods.length === 0 ? "none" : methods.join(",");
};

const fingerprintCors = (headers: RuntimeSecurityResponse["headers"]): string => {
  const credentials = headers.accessControlAllowCredentials?.trim().toLowerCase();
  const credentialState =
    credentials === undefined ? "none" : credentials === "true" ? "true" : "other";
  return `origin=${normalizeCorsOrigin(headers.accessControlAllowOrigin)};credentials=${credentialState};methods=${normalizeCorsMethods(headers.accessControlAllowMethods)}`;
};

export const createSecurityFingerprint = (
  response: RuntimeSecurityResponse,
): SecurityFingerprint => ({
  transport: new URL(response.url).protocol === "https:" ? "secure" : "insecure",
  csp: fingerprintCsp(response.headers.contentSecurityPolicy),
  hsts: fingerprintHsts(response.headers.strictTransportSecurity),
  xContentTypeOptions: fingerprintXcto(response.headers.xContentTypeOptions),
  cors: fingerprintCors(response.headers),
  cookies: response.cookies
    .map((cookie) => ({ ...cookie }))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name)),
});

const canonicalFingerprint = (fingerprint: SecurityFingerprint): string =>
  JSON.stringify(fingerprint);

export const sanitizeSecurityTestReference = (test: {
  file: string;
  projectName: string;
}): SecurityTestReference => {
  const normalizedFile = normalizePath(`/${test.file.replaceAll("\\", "/")}`, []).slice(1);
  return {
    file: normalizedFile || ":redacted",
    project: sanitizeLabel(test.projectName || "default", [], 512) || ":redacted",
  };
};

export const createSecurityTargetKey = (input: {
  host: string;
  endpoint: string;
  responseKind: SecurityResponseKind;
  method: string;
}): string =>
  `security:response|${input.host}|${input.responseKind}|${input.method}|${encodeURIComponent(input.endpoint)}`;

const partialCoverage = (coverage: SecurityCoverageStatus): SecurityCoverageStatus =>
  coverage === "complete" ? "partial" : coverage;

export class SecurityPostureAnalyzer implements Analyzer {
  readonly id = SECURITY_ANALYZER_ID;
  readonly capabilities = Object.freeze({
    required: ["response-headers", "cookies", "browser-engine", "api-requests"] as const,
  });
  readonly #entries = new Map<string, MutableSecurityEntry>();
  readonly #hasConfiguredFirstParty: boolean;
  #inferredFirstPartyOrigin: string | undefined;
  #inferredFirstPartyHost: string | undefined;
  #limitReached = false;

  constructor(private readonly firstParty: FirstPartyConfig) {
    this.#hasConfiguredFirstParty =
      (firstParty.origins?.length ?? 0) > 0 || (firstParty.hosts?.length ?? 0) > 0;
  }

  onEvent(event: RuntimeEvent): void {
    if (event.type === "security-cookie") {
      const host = event.cookie.domain.toLowerCase().replace(/^\./u, "").replace(/\.$/u, "");
      const firstParty = ["http", "https"].some(
        (scheme) => classifyRecipient(`${scheme}://${host}`, this.firstParty).firstParty,
      );
      if (!firstParty && host !== this.#inferredFirstPartyHost) return;
      const endpoint = canonicalizeEndpointPath(event.cookie.path, []);
      this.#record({
        host,
        endpoint,
        responseKind: "authentication",
        method: "COOKIE",
        fingerprint: {
          transport: "secure",
          csp: "not-applicable",
          hsts: "not-applicable",
          xContentTypeOptions: "not-applicable",
          cors: "not-applicable",
          cookies: [
            {
              name: event.cookie.name,
              secure: event.cookie.secure,
              httpOnly: event.cookie.httpOnly,
              sameSite: event.cookie.sameSite,
            },
          ],
        },
      });
      return;
    }
    if (event.type !== "security-response") return;
    let url: URL;
    try {
      url = new URL(event.response.url);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const recipient = classifyRecipient(url.href, this.firstParty);
    if (!recipient.valid || recipient.origin === "opaque" || recipient.host === "unknown") return;
    if (
      !this.#hasConfiguredFirstParty &&
      this.#inferredFirstPartyOrigin === undefined &&
      event.response.resourceType === "document" &&
      event.response.frameKind === "main"
    ) {
      this.#inferredFirstPartyOrigin = recipient.origin.toLowerCase();
      this.#inferredFirstPartyHost = recipient.host.toLowerCase().replace(/\.$/u, "");
    }
    if (!recipient.firstParty && recipient.origin.toLowerCase() !== this.#inferredFirstPartyOrigin)
      return;

    const responseKind: SecurityResponseKind =
      event.response.cookies.length > 0
        ? "authentication"
        : event.response.resourceType === "document"
          ? "document"
          : "api";
    const endpoint = canonicalizeEndpointPath(url.pathname, []);
    const method = normalizeMethod(event.response.method);
    const host = recipient.host.toLowerCase().replace(/\.$/u, "");
    this.#record({
      host,
      endpoint,
      responseKind,
      method,
      fingerprint: createSecurityFingerprint(event.response),
    });
  }

  #record(input: {
    host: string;
    endpoint: string;
    responseKind: SecurityResponseKind;
    method: string;
    fingerprint: SecurityFingerprint;
  }): void {
    const { host, endpoint, responseKind, method, fingerprint } = input;
    const key = createSecurityTargetKey({ host, endpoint, responseKind, method });
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      if (this.#entries.size >= MAX_SECURITY_TARGETS_PER_TEST) {
        this.#limitReached = true;
        return;
      }
      entry = {
        key,
        host,
        endpoint,
        responseKind,
        method,
        fingerprints: new Map(),
        occurrenceCount: 0,
      };
      this.#entries.set(key, entry);
    }
    entry.occurrenceCount += 1;
    const canonical = canonicalFingerprint(fingerprint);
    if (entry.fingerprints.has(canonical)) return;
    if (entry.fingerprints.size >= MAX_SECURITY_VARIANTS_PER_TARGET) {
      this.#limitReached = true;
      return;
    }
    entry.fingerprints.set(canonical, fingerprint);
  }

  finalizeTest(context: AnalyzerContext): SecurityAnalyzerTestResult {
    const test = sanitizeSecurityTestReference(context.test);
    const inventory = Array.from(this.#entries.values())
      .map(
        (entry): SecurityPostureInventoryEntry => ({
          kind: "security-posture",
          key: entry.key,
          host: entry.host,
          endpoint: entry.endpoint,
          responseKind: entry.responseKind,
          method: entry.method,
          fingerprints: Array.from(entry.fingerprints.entries())
            .sort(([left], [right]) => compareCanonicalStrings(left, right))
            .map(([, fingerprint]) => fingerprint),
          firstSeenTests: [test],
          occurrenceCount: entry.occurrenceCount,
        }),
      )
      .sort((left, right) => compareCanonicalStrings(left.key, right.key));
    const diagnostics: SecurityDiagnostic[] = this.#limitReached
      ? [
          {
            code: "SECURITY_LIMIT_REACHED",
            message: "Security posture analysis reached a per-test safety limit.",
          },
        ]
      : [];
    return {
      analyzerId: SECURITY_ANALYZER_ID,
      coverage: this.#limitReached
        ? partialCoverage(context.capabilityCoverage.status)
        : context.capabilityCoverage.status,
      inventory,
      diagnostics,
    };
  }

  dispose(): void {
    for (const entry of this.#entries.values()) entry.fingerprints.clear();
    this.#entries.clear();
  }
}

export const securityAnalyzerFailed = (diagnostics: readonly AnalyzerDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.analyzerId === SECURITY_ANALYZER_ID);
