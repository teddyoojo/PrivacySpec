import { compareCanonicalStrings } from "../../canonical-order.js";
import { classifyRecipient } from "../../correlate/first-party.js";
import type { FirstPartyConfig } from "../../correlate/model.js";
import { normalizePath, sanitizeLabel } from "../../correlate/redact.js";
import type { Analyzer, AnalyzerContext, AnalyzerDiagnostic } from "../../runtime/analyzer.js";
import type { RuntimeEvent } from "../../runtime/events.js";
import {
  DEPENDENCY_ANALYZER_ID,
  type DependencyAnalyzerTestResult,
  type DependencyBoundary,
  type DependencyCoverageStatus,
  type DependencyDiagnostic,
  type DependencyResourceType,
  type DependencyTestReference,
  type RuntimeDependencyInventoryEntry,
} from "./model.js";

export const MAX_DEPENDENCY_REQUESTS_PER_TEST = 10_000;
export const MAX_DEPENDENCY_ORIGINS_PER_TEST = 512;
export const MAX_DEPENDENCY_METHODS_PER_ORIGIN = 16;

interface MutableDependencyEntry {
  origin: string;
  host: string;
  boundary: DependencyBoundary;
  resourceTypes: Set<DependencyResourceType>;
  requestMethods: Set<string>;
  occurrenceCount: number;
}

const methodPattern = /^[A-Z0-9!#$%&'*+.^_`|~-]{1,32}$/u;

export const normalizeDependencyMethod = (value: string): string => {
  const normalized = value.toUpperCase();
  return methodPattern.test(normalized) ? normalized : "OTHER";
};

export const classifyDependencyResource = (input: {
  resourceType: string;
  frameKind: "main" | "child" | "unknown";
}): DependencyResourceType => {
  const resourceType = input.resourceType.toLowerCase();
  if (resourceType === "script") return "script";
  if (resourceType === "stylesheet") return "stylesheet";
  if (resourceType === "font") return "font";
  if (resourceType === "image") return "image";
  if (resourceType === "fetch" || resourceType === "xhr") return "fetch/xhr";
  if (resourceType === "document" && input.frameKind === "child") return "iframe";
  if (resourceType === "websocket") return "websocket";
  return "other";
};

export const normalizeDependencyTarget = (
  rawUrl: string,
  firstParty: FirstPartyConfig,
): { origin: string; host: string; boundary: DependencyBoundary } | undefined => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return undefined;
  const recipient = classifyRecipient(url.href, firstParty);
  if (!recipient.valid || recipient.origin === "opaque" || recipient.host === "unknown") {
    return undefined;
  }
  return {
    origin: recipient.origin.toLowerCase(),
    host: recipient.host.toLowerCase().replace(/\.$/u, ""),
    boundary: recipient.firstParty ? "first-party" : "external",
  };
};

const partialCoverage = (coverage: DependencyCoverageStatus): DependencyCoverageStatus =>
  coverage === "complete" ? "partial" : coverage;

export const sanitizeDependencyTestReference = (test: {
  file: string;
  projectName: string;
}): DependencyTestReference => {
  const normalizedFile = normalizePath(`/${test.file.replaceAll("\\", "/")}`, []).slice(1);
  return {
    file: normalizedFile || ":redacted",
    project: sanitizeLabel(test.projectName || "default", [], 512) || ":redacted",
  };
};

export class DependencyRuntimeAnalyzer implements Analyzer {
  readonly id = DEPENDENCY_ANALYZER_ID;
  readonly capabilities = Object.freeze({
    required: ["network", "browser-engine", "api-requests"] as const,
  });
  readonly #entries = new Map<string, MutableDependencyEntry>();
  readonly #hasConfiguredFirstParty: boolean;
  #inferredFirstPartyOrigin: string | undefined;
  #requests = 0;
  #limitReached = false;

  constructor(private readonly firstParty: FirstPartyConfig) {
    this.#hasConfiguredFirstParty =
      (firstParty.origins?.length ?? 0) > 0 || (firstParty.hosts?.length ?? 0) > 0;
  }

  onEvent(event: RuntimeEvent): void {
    if (event.type !== "request") return;
    if (this.#requests >= MAX_DEPENDENCY_REQUESTS_PER_TEST) {
      this.#limitReached = true;
      return;
    }
    this.#requests += 1;
    const normalizedTarget = normalizeDependencyTarget(event.request.url, this.firstParty);
    if (normalizedTarget === undefined) return;
    if (
      !this.#hasConfiguredFirstParty &&
      this.#inferredFirstPartyOrigin === undefined &&
      event.request.resourceType.toLowerCase() === "document" &&
      event.request.frameKind === "main"
    ) {
      this.#inferredFirstPartyOrigin = normalizedTarget.origin;
    }
    const target =
      normalizedTarget.origin === this.#inferredFirstPartyOrigin
        ? { ...normalizedTarget, boundary: "first-party" as const }
        : normalizedTarget;
    let entry = this.#entries.get(target.origin);
    if (entry === undefined) {
      if (this.#entries.size >= MAX_DEPENDENCY_ORIGINS_PER_TEST) {
        this.#limitReached = true;
        return;
      }
      entry = {
        ...target,
        resourceTypes: new Set(),
        requestMethods: new Set(),
        occurrenceCount: 0,
      };
      this.#entries.set(target.origin, entry);
    }
    entry.occurrenceCount += 1;
    entry.resourceTypes.add(classifyDependencyResource(event.request));
    if (entry.requestMethods.size < MAX_DEPENDENCY_METHODS_PER_ORIGIN) {
      entry.requestMethods.add(normalizeDependencyMethod(event.request.method));
    } else if (!entry.requestMethods.has(normalizeDependencyMethod(event.request.method))) {
      this.#limitReached = true;
    }
  }

  finalizeTest(context: AnalyzerContext): DependencyAnalyzerTestResult {
    const test = sanitizeDependencyTestReference(context.test);
    const inventory: RuntimeDependencyInventoryEntry[] = Array.from(this.#entries.values())
      .map((entry) => ({
        kind: "runtime-dependency" as const,
        origin: entry.origin,
        host: entry.host,
        boundary: entry.boundary,
        resourceTypes: Array.from(entry.resourceTypes).sort(compareCanonicalStrings),
        requestMethods: Array.from(entry.requestMethods).sort(compareCanonicalStrings),
        firstSeenTests: [test],
        occurrenceCount: entry.occurrenceCount,
      }))
      .sort((left, right) => compareCanonicalStrings(left.origin, right.origin));
    const diagnostics: DependencyDiagnostic[] = this.#limitReached
      ? [
          {
            code: "DEPENDENCY_LIMIT_REACHED",
            message: "Runtime dependency analysis reached a per-test safety limit.",
          },
        ]
      : [];
    return {
      analyzerId: DEPENDENCY_ANALYZER_ID,
      coverage: this.#limitReached
        ? partialCoverage(context.capabilityCoverage.status)
        : context.capabilityCoverage.status,
      inventory,
      diagnostics,
    };
  }

  dispose(): void {
    for (const entry of this.#entries.values()) {
      entry.resourceTypes.clear();
      entry.requestMethods.clear();
    }
    this.#entries.clear();
  }
}

export const dependencyAnalyzerFailed = (diagnostics: readonly AnalyzerDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.analyzerId === DEPENDENCY_ANALYZER_ID);
