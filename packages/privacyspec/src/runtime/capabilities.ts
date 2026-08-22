import type { ResponseJsonCoverage } from "../discovery/response-json.js";
import type { PlaywrightObservationCounters } from "../playwright/coverage.js";

export type RuntimeCapability =
  | "network"
  | "responses"
  | "response-headers"
  | "console"
  | "storage"
  | "cookies"
  | "page-errors"
  | "custom-contexts"
  | "response-bodies"
  | "sensitive-sources";

export type RuntimeCapabilityState =
  | "complete"
  | "partial"
  | "incomplete"
  | "unsupported"
  | "disabled";

export type RuntimeCapabilityModel = Readonly<Record<RuntimeCapability, RuntimeCapabilityState>>;

export interface AnalyzerCapabilityRequirements {
  required: readonly RuntimeCapability[];
  optional?: readonly RuntimeCapability[] | undefined;
}

export interface AnalyzerCapabilityCoverage {
  status: Exclude<RuntimeCapabilityState, "disabled">;
  required: Readonly<Partial<Record<RuntimeCapability, RuntimeCapabilityState>>>;
  optional: Readonly<Partial<Record<RuntimeCapability, RuntimeCapabilityState>>>;
}

const incompleteRank: Readonly<Record<RuntimeCapabilityState, number>> = {
  complete: 0,
  disabled: 1,
  partial: 2,
  incomplete: 3,
  unsupported: 4,
};

const aggregateStatus = (
  states: readonly RuntimeCapabilityState[],
): AnalyzerCapabilityCoverage["status"] => {
  const worst = states.reduce<RuntimeCapabilityState>(
    (current, state) => (incompleteRank[state] > incompleteRank[current] ? state : current),
    "complete",
  );
  return worst === "disabled" ? "incomplete" : worst;
};

export const resolveAnalyzerCapabilityCoverage = (
  capabilities: RuntimeCapabilityModel,
  requirements: AnalyzerCapabilityRequirements,
): AnalyzerCapabilityCoverage => {
  const required: Partial<Record<RuntimeCapability, RuntimeCapabilityState>> = {};
  const optional: Partial<Record<RuntimeCapability, RuntimeCapabilityState>> = {};
  for (const capability of requirements.required) required[capability] = capabilities[capability];
  for (const capability of requirements.optional ?? [])
    optional[capability] = capabilities[capability];
  return {
    status: aggregateStatus(Object.values(required)),
    required,
    optional,
  };
};

const responseCoverageIsPartial = (coverage: ResponseJsonCoverage): boolean =>
  Object.values(coverage.skipped).some((count) => count > 0);

export const createRuntimeCapabilityModel = (input: {
  observation: PlaywrightObservationCounters;
  responseJson: ResponseJsonCoverage;
  observerWorkFailed: boolean;
  responseHeaders?: { enabled: boolean; limitReached: boolean; workFailed: boolean } | undefined;
}): RuntimeCapabilityModel => {
  const unsupported =
    input.observation.contexts.seen > input.observation.contexts.instrumented ||
    input.observation.pages.seen > input.observation.pages.instrumented;
  const base: RuntimeCapabilityState = unsupported
    ? "unsupported"
    : input.observerWorkFailed
      ? "incomplete"
      : "complete";
  const responseState: RuntimeCapabilityState = !input.responseJson.enabled
    ? "disabled"
    : responseCoverageIsPartial(input.responseJson) && base === "complete"
      ? "partial"
      : base;
  const responseHeaderState: RuntimeCapabilityState =
    input.responseHeaders?.enabled !== true
      ? "disabled"
      : input.responseHeaders.workFailed
        ? "incomplete"
        : input.responseHeaders.limitReached && base === "complete"
          ? "partial"
          : base;
  return Object.freeze({
    network: base,
    responses: responseState,
    "response-headers": responseHeaderState,
    console: base,
    storage: base,
    cookies: base,
    "page-errors": base,
    "custom-contexts": unsupported ? "unsupported" : "complete",
    "response-bodies": responseState,
    "sensitive-sources": base,
  });
};
