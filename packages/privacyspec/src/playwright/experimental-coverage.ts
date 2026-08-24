import type { RuntimeCapabilityState } from "../runtime/capabilities.js";

export type PrivacySpecBrowserEngine = "chromium" | "firefox" | "webkit";
export type ExperimentalBrowserEngine = Exclude<PrivacySpecBrowserEngine, "chromium">;

export type BrowserEngineCapability =
  | "init-scripts"
  | "events"
  | "teardown-fallback"
  | "network"
  | "console"
  | "storage"
  | "cookies"
  | "response-headers"
  | "page-errors";

export interface BrowserEngineCoverage {
  engine: PrivacySpecBrowserEngine;
  support: "supported" | "experimental" | "unsupported";
  experimental: boolean;
  capabilities: Readonly<Record<BrowserEngineCapability, RuntimeCapabilityState>>;
}

export interface APIRequestCoverage {
  enabled: boolean;
  status: "complete" | "partial" | "unsupported";
  calls: {
    seen: number;
    observed: number;
    failed: number;
    serverErrors: number;
  };
  skipped: {
    accessors: number;
    streams: number;
    files: number;
    unsupportedObjects: number;
    oversized: number;
    aggregateLimit: number;
    sinkLimit: number;
    materialLimit: number;
  };
  blindSpots: readonly [
    "implicit-headers-cookies-auth",
    "redirect-chain",
    "page-request",
    "context-request",
    "manual-request-context",
  ];
}

export interface PrivacySpecExperimentalOptions {
  apiRequestContext?: "request-fixture" | undefined;
  browserEngines?: readonly ExperimentalBrowserEngine[] | undefined;
}

export interface NormalizedPrivacySpecExperimentalOptions {
  apiRequestContext: boolean;
  browserEngines: ReadonlySet<ExperimentalBrowserEngine>;
}

const capabilityNames: readonly BrowserEngineCapability[] = [
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

const capabilityTable = (
  state: RuntimeCapabilityState,
): Readonly<Record<BrowserEngineCapability, RuntimeCapabilityState>> =>
  Object.freeze(
    Object.fromEntries(capabilityNames.map((capability) => [capability, state])) as Record<
      BrowserEngineCapability,
      RuntimeCapabilityState
    >,
  );

export const normalizePrivacySpecExperimentalOptions = (
  value: PrivacySpecExperimentalOptions | undefined,
): NormalizedPrivacySpecExperimentalOptions => {
  if (
    value !== undefined &&
    (typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "apiRequestContext" && key !== "browserEngines"))
  ) {
    throw new TypeError("Invalid PrivacySpec experimental configuration.");
  }
  if (value?.apiRequestContext !== undefined && value.apiRequestContext !== "request-fixture") {
    throw new TypeError("Invalid PrivacySpec experimental configuration.");
  }
  if (value?.browserEngines !== undefined && !Array.isArray(value.browserEngines)) {
    throw new TypeError("Invalid PrivacySpec experimental configuration.");
  }
  const browserEngines = new Set<ExperimentalBrowserEngine>();
  for (const engine of value?.browserEngines ?? []) {
    if ((engine !== "firefox" && engine !== "webkit") || browserEngines.has(engine)) {
      throw new TypeError("Invalid PrivacySpec experimental configuration.");
    }
    browserEngines.add(engine);
  }
  return Object.freeze({
    apiRequestContext: value?.apiRequestContext === "request-fixture",
    browserEngines,
  });
};

export const createBrowserEngineCoverage = (
  engine: string,
  gatedEngines: ReadonlySet<ExperimentalBrowserEngine>,
): BrowserEngineCoverage => {
  const normalized: PrivacySpecBrowserEngine =
    engine === "firefox" || engine === "webkit" ? engine : "chromium";
  const gated = normalized === "chromium" || gatedEngines.has(normalized);
  return {
    engine: normalized,
    support: normalized === "chromium" ? "supported" : gated ? "experimental" : "unsupported",
    experimental: normalized !== "chromium" && gated,
    capabilities: capabilityTable(gated ? "complete" : "unsupported"),
  };
};

export const createAPIRequestCoverage = (enabled: boolean): APIRequestCoverage => ({
  enabled,
  status: "complete",
  calls: { seen: 0, observed: 0, failed: 0, serverErrors: 0 },
  skipped: {
    accessors: 0,
    streams: 0,
    files: 0,
    unsupportedObjects: 0,
    oversized: 0,
    aggregateLimit: 0,
    sinkLimit: 0,
    materialLimit: 0,
  },
  blindSpots: [
    "implicit-headers-cookies-auth",
    "redirect-chain",
    "page-request",
    "context-request",
    "manual-request-context",
  ],
});
