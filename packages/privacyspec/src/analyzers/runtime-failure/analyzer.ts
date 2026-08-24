import { createHash } from "node:crypto";
import { compareCanonicalStrings } from "../../canonical-order.js";
import { classifyRecipient } from "../../correlate/first-party.js";
import type { FirstPartyConfig } from "../../correlate/model.js";
import { canonicalizeEndpointPath, normalizePath, sanitizeLabel } from "../../correlate/redact.js";
import type { Analyzer, AnalyzerContext, AnalyzerDiagnostic } from "../../runtime/analyzer.js";
import type { RuntimeEvent } from "../../runtime/events.js";
import {
  namespacedAnalysisIdentity,
  RUNTIME_FAILURE_ANALYSIS_MODULE,
} from "../../runtime/modules.js";
import {
  RUNTIME_FAILURE_ANALYZER_ID,
  type RuntimeFailureAnalyzerTestResult,
  type RuntimeFailureBoundary,
  type RuntimeFailureCoverageStatus,
  type RuntimeFailureDetails,
  type RuntimeFailureDiagnostic,
  type RuntimeFailureInventoryEntry,
  type RuntimeFailureSeverity,
  type RuntimeFailureTestReference,
  type RuntimeFailureType,
} from "./model.js";

export const MAX_RUNTIME_FAILURE_EVENTS_PER_TEST = 2_048;
export const MAX_RUNTIME_FAILURE_IDENTITIES_PER_TEST = 512;
export const MAX_RUNTIME_FAILURE_MESSAGE_INPUT = 8_192;
export const MAX_RUNTIME_CONSOLE_IDENTITY_TEXT = 512;

interface MutableRuntimeFailureEntry extends Omit<RuntimeFailureInventoryEntry, "firstSeenTests"> {}

const methodPattern = /^[A-Z0-9!#$%&'*+.^_`|~-]{1,32}$/u;
const errorNamePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const staticResourceTypes = new Set([
  "font",
  "image",
  "manifest",
  "media",
  "script",
  "stylesheet",
  "texttrack",
]);
const staticAssetFilenamePattern =
  /([A-Za-z0-9._-]+?)(\.(?:[cm]?js|css|map|wasm|json|avif|gif|jpe?g|png|svg|webp|ico|woff2?|ttf|otf|eot|mp[34]|webm))(?:\.map)?(?=$|[/?#:\s)'"<>])/giu;
const urlSafeTokenPattern = /^[A-Za-z0-9_-]{8,64}$/u;

const normalizeMethod = (value: string): string => {
  const normalized = value.toUpperCase();
  return methodPattern.test(normalized) ? normalized : "OTHER";
};

const normalizeErrorName = (value: string): string =>
  errorNamePattern.test(value) ? value : "Error";

const looksLikeBundlerHash = (value: string): boolean =>
  urlSafeTokenPattern.test(value) &&
  (/^[a-f]{8,64}$/iu.test(value) ||
    (/\d/u.test(value) && /[A-Za-z]/u.test(value)) ||
    (/[a-z]/u.test(value) && /[A-Z]/u.test(value)) ||
    /[_-]/u.test(value));

const normalizeEmbeddedBundlerHashes = (value: string): string =>
  value.replace(staticAssetFilenamePattern, (filename: string, rawStem: string) => {
    const extensionIndex = filename.indexOf(".", rawStem.length);
    const extension = filename.slice(extensionIndex);
    for (let index = rawStem.length - 1; index >= 0; index -= 1) {
      if (rawStem[index] !== "-" && rawStem[index] !== "." && rawStem[index] !== "_") continue;
      const candidate = rawStem.slice(index + 1);
      if (looksLikeBundlerHash(candidate)) {
        return `${rawStem.slice(0, index + 1)}:hash${extension}`;
      }
    }
    return filename;
  });

const normalizeIncrementalParserDetails = (value: string): string => {
  if (
    /^unknowndiagramerror: no diagram type detected matching given configuration for text:/u.test(
      value,
    )
  ) {
    return "unknowndiagramerror: no diagram type detected matching given configuration for text: :input";
  }
  if (/^syntaxerror:/u.test(value) && /\bjson\b/u.test(value)) {
    return "syntaxerror: json parse failed";
  }
  if (/^syntaxerror:\s+unexpected token\b/u.test(value)) {
    return "syntaxerror: unexpected token";
  }
  if (/^(?:error:\s+)?(?:parsing failed:\s+)?(?:parse|lexical) error\b/u.test(value)) {
    return value.replace(/\b(found|got)\s+['"`][^'"`\r\n]{0,128}['"`]/gu, "$1 :parser-token");
  }
  return value;
};

const isStaticResourceType = (value: string): boolean =>
  staticResourceTypes.has(value.toLowerCase());

export const normalizeRuntimeFailureMessage = (value: string): string =>
  normalizeIncrementalParserDetails(
    normalizeEmbeddedBundlerHashes(value.slice(0, MAX_RUNTIME_FAILURE_MESSAGE_INPUT))
      .normalize("NFKC")
      .toLowerCase(),
  )
    .replace(/https?:\/\/[^\s"'<>]+/gu, ":url")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gu, ":email")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, ":uuid")
    .replace(/\b\d{4}-\d{2}-\d{2}[t ][0-9:.+-]+z?\b/giu, ":timestamp")
    .replace(/\bline\s+\d+(?:\s*[,;:]?\s*column\s+\d+)?\b/giu, ":location")
    .replace(/:\d+:\d+(?=$|[\s)\]}>])/gu, ":location")
    .replace(/\b[0-9a-f]{16,}\b/giu, ":id")
    .replace(/\b\d+\b/gu, ":number")
    .replace(/\s+/gu, " ")
    .trim();

export const runtimeFailureMessageSignature = (value: string): string => {
  const normalized = normalizeRuntimeFailureMessage(value) || ":empty";
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16)}`;
};

const runtimeConsoleFallbackSignature = runtimeFailureMessageSignature(
  ":console-rendered-text-unavailable",
);

const firstRenderedConsoleLine = (
  event: Extract<RuntimeEvent, { type: "console" }>,
): string | undefined => {
  const renderedText = event.sink.materials.find(
    (material) => material.location === "console.text",
  )?.value;
  if (renderedText === undefined) return undefined;
  for (const line of renderedText.split(/\r\n?|\n/gu)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed.slice(0, MAX_RUNTIME_CONSOLE_IDENTITY_TEXT);
  }
  return undefined;
};

export const sanitizeRuntimeFailureTestReference = (test: {
  file: string;
  projectName: string;
}): RuntimeFailureTestReference => ({
  file: normalizePath(`/${test.file.replaceAll("\\", "/")}`, []).slice(1) || ":redacted",
  project: sanitizeLabel(test.projectName || "default", [], 512) || ":redacted",
});

const normalizedHttpTarget = (
  rawUrl: string,
  resourceType: string,
  firstParty: FirstPartyConfig,
  inferredFirstPartyOrigin: string | undefined,
):
  | {
      origin: string;
      host: string;
      endpoint: string;
      boundary: RuntimeFailureBoundary;
    }
  | undefined => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const recipient = classifyRecipient(url.href, firstParty);
  if (!recipient.valid || recipient.origin === "opaque" || recipient.host === "unknown") {
    return undefined;
  }
  const origin = recipient.origin.toLowerCase();
  return {
    origin,
    host: recipient.host.toLowerCase().replace(/\.$/u, ""),
    endpoint: isStaticResourceType(resourceType)
      ? normalizeEmbeddedBundlerHashes(canonicalizeEndpointPath(url.pathname, []))
      : canonicalizeEndpointPath(url.pathname, []),
    boundary:
      recipient.firstParty || origin === inferredFirstPartyOrigin ? "first-party" : "external",
  };
};

export const createRuntimeFailureKey = (input: {
  failureType: RuntimeFailureType;
  details: RuntimeFailureDetails;
}): string => {
  const { failureType, details } = input;
  const parts =
    failureType === "page-error"
      ? [failureType, details.errorName, details.signature]
      : failureType === "console-error"
        ? [failureType, details.signature]
        : failureType === "request-failed"
          ? [
              failureType,
              details.boundary,
              details.host,
              details.method,
              details.endpoint,
              details.failureCode,
            ]
          : [failureType, details.host, details.method, details.endpoint, details.httpStatus];
  return namespacedAnalysisIdentity(
    RUNTIME_FAILURE_ANALYSIS_MODULE,
    parts.map((part) => encodeURIComponent(String(part ?? "none"))).join("|"),
  );
};

const emptyDetails = (): RuntimeFailureDetails => ({
  boundary: null,
  host: null,
  method: null,
  endpoint: null,
  httpStatus: null,
  errorName: null,
  signature: null,
  failureCode: null,
});

const partialCoverage = (coverage: RuntimeFailureCoverageStatus): RuntimeFailureCoverageStatus =>
  coverage === "complete" ? "partial" : coverage;

export class RuntimeFailureAnalyzer implements Analyzer {
  readonly id = RUNTIME_FAILURE_ANALYZER_ID;
  readonly capabilities = Object.freeze({
    required: ["network", "console", "page-errors", "browser-engine", "api-requests"] as const,
  });
  readonly #entries = new Map<string, MutableRuntimeFailureEntry>();
  readonly #hasConfiguredFirstParty: boolean;
  #inferredFirstPartyOrigin: string | undefined;
  #events = 0;
  #limitReached = false;

  constructor(private readonly firstParty: FirstPartyConfig) {
    this.#hasConfiguredFirstParty =
      (firstParty.origins?.length ?? 0) > 0 || (firstParty.hosts?.length ?? 0) > 0;
  }

  onEvent(event: RuntimeEvent): void {
    if (
      !this.#hasConfiguredFirstParty &&
      this.#inferredFirstPartyOrigin === undefined &&
      event.type === "request" &&
      event.request.resourceType.toLowerCase() === "document" &&
      event.request.frameKind === "main"
    ) {
      try {
        const url = new URL(event.request.url);
        if (url.protocol === "http:" || url.protocol === "https:") {
          this.#inferredFirstPartyOrigin = url.origin.toLowerCase();
        }
      } catch {
        // Invalid and opaque request URLs do not establish a first-party boundary.
      }
    }

    if (event.type === "page-error") {
      const details = {
        ...emptyDetails(),
        errorName: normalizeErrorName(event.name),
        signature: runtimeFailureMessageSignature(event.message),
      };
      this.#record("page-error", "ERROR", `Uncaught ${details.errorName}`, details);
      return;
    }

    if (event.type === "console" && event.sink.level.toLowerCase() === "error") {
      const renderedLine = firstRenderedConsoleLine(event);
      // Chromium also mirrors failed requests and HTTP errors into the console.
      // The network events carry the stable method/route/status identity, so keep
      // only that representation instead of reporting the same failure twice.
      if (
        renderedLine !== undefined &&
        /failed to load resource[^\n]*(?:err_|status)/iu.test(renderedLine)
      )
        return;
      const details = {
        ...emptyDetails(),
        signature:
          renderedLine === undefined
            ? runtimeConsoleFallbackSignature
            : runtimeFailureMessageSignature(renderedLine),
      };
      this.#record("console-error", "REVIEW", "Browser console error", details);
      return;
    }

    if (event.type === "request-failed") {
      const method = normalizeMethod(event.request.method);
      const failureCode = /^ERR_[A-Z0-9_]{1,64}$/u.test(event.failureCode)
        ? event.failureCode
        : "REQUEST_FAILED";
      if (
        failureCode === "ERR_ABORTED" &&
        (method === "GET" || method === "HEAD" || isStaticResourceType(event.request.resourceType))
      ) {
        return;
      }
      const target = normalizedHttpTarget(
        event.request.url,
        event.request.resourceType,
        this.firstParty,
        this.#inferredFirstPartyOrigin,
      );
      if (target === undefined) return;
      const details: RuntimeFailureDetails = {
        ...emptyDetails(),
        boundary: target.boundary,
        host: target.host,
        method,
        endpoint: target.endpoint,
        failureCode,
      };
      this.#record("request-failed", "REVIEW", "Network request failed", details);
      return;
    }

    if (event.type === "http-response" && event.status >= 500 && event.status <= 599) {
      const target = normalizedHttpTarget(
        event.url,
        event.resourceType,
        this.firstParty,
        this.#inferredFirstPartyOrigin,
      );
      if (target?.boundary !== "first-party") return;
      const details: RuntimeFailureDetails = {
        ...emptyDetails(),
        boundary: "first-party",
        host: target.host,
        method: normalizeMethod(event.method),
        endpoint: target.endpoint,
        httpStatus: event.status,
      };
      this.#record("http-5xx", "ERROR", `First-party HTTP ${event.status}`, details);
    }
  }

  #record(
    failureType: RuntimeFailureType,
    severity: RuntimeFailureSeverity,
    summary: string,
    details: RuntimeFailureDetails,
  ): void {
    if (this.#events >= MAX_RUNTIME_FAILURE_EVENTS_PER_TEST) {
      this.#limitReached = true;
      return;
    }
    this.#events += 1;
    const key = createRuntimeFailureKey({ failureType, details });
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      existing.occurrenceCount = Math.min(Number.MAX_SAFE_INTEGER, existing.occurrenceCount + 1);
      return;
    }
    if (this.#entries.size >= MAX_RUNTIME_FAILURE_IDENTITIES_PER_TEST) {
      this.#limitReached = true;
      return;
    }
    this.#entries.set(key, {
      kind: "runtime-failure",
      key,
      failureType,
      severity,
      summary,
      ...details,
      occurrenceCount: 1,
    });
  }

  finalizeTest(context: AnalyzerContext): RuntimeFailureAnalyzerTestResult {
    const test = sanitizeRuntimeFailureTestReference(context.test);
    const inventory = Array.from(this.#entries.values())
      .map((entry): RuntimeFailureInventoryEntry => ({ ...entry, firstSeenTests: [test] }))
      .sort((left, right) => compareCanonicalStrings(left.key, right.key));
    const diagnostics: RuntimeFailureDiagnostic[] = this.#limitReached
      ? [
          {
            code: "RUNTIME_FAILURE_LIMIT_REACHED",
            message: "Runtime failure analysis reached a per-test safety limit.",
          },
        ]
      : [];
    return {
      analyzerId: RUNTIME_FAILURE_ANALYZER_ID,
      coverage: this.#limitReached
        ? partialCoverage(context.capabilityCoverage.status)
        : context.capabilityCoverage.status,
      inventory,
      diagnostics,
    };
  }

  dispose(): void {
    this.#entries.clear();
  }
}

export const runtimeFailureAnalyzerFailed = (diagnostics: readonly AnalyzerDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.analyzerId === RUNTIME_FAILURE_ANALYZER_ID);
