import { normalizePath } from "../correlate/redact.js";
import type { Finding } from "../rules/model.js";
import type {
  BaselineFile,
  BaselineFlow,
  BaselineFlowCandidate,
  BaselineFlowIdentity,
} from "./schema.js";

export interface ObservedBaselineFlow {
  flow: BaselineFlowCandidate;
  findings: Finding[];
}

export interface BaselineComparison {
  observed: BaselineFlowCandidate[];
  known: ObservedBaselineFlow[];
  new: ObservedBaselineFlow[];
  resolved: BaselineFlow[];
}

const storageSinkKinds = new Set<BaselineFlowIdentity["sinkKind"]>([
  "local-storage",
  "session-storage",
  "cookie",
]);

export const isBaselineEligibleIdentity = (identity: BaselineFlowIdentity): boolean => {
  if (!identity.dataCategory.startsWith("personal.")) return false;
  if (identity.ruleId === "PS1001") {
    return identity.sinkKind === "request-url" || identity.location?.startsWith("url.") === true;
  }
  if (identity.ruleId === "PS1004") {
    return identity.sinkKind === "external-request" && identity.recipient !== undefined;
  }
  return (
    identity.ruleId === "PS1005" &&
    storageSinkKinds.has(identity.sinkKind) &&
    identity.recipient === undefined &&
    identity.endpoint === undefined
  );
};

export const normalizeBaselineEndpoint = (endpoint: string | undefined): string | undefined => {
  if (endpoint === undefined) return undefined;
  return normalizePath(endpoint, []);
};

export const createBaselineKey = (identity: BaselineFlowIdentity): string =>
  JSON.stringify([
    identity.ruleId,
    identity.dataCategory,
    identity.sinkKind,
    identity.recipient ?? null,
    normalizeBaselineEndpoint(identity.endpoint) ?? null,
    identity.location ?? null,
    identity.transform,
  ]);

export const createBaselineFlowCandidate = (
  finding: Finding,
): BaselineFlowCandidate | undefined => {
  if (finding.classification !== "review_required") return undefined;
  const candidate = createSemanticFindingCandidate(finding);
  if (!isBaselineEligibleIdentity(candidate)) return undefined;
  return candidate;
};

export const createSemanticFindingCandidate = (finding: Finding): BaselineFlowCandidate => {
  const identity: BaselineFlowIdentity = {
    ruleId: finding.ruleId,
    dataCategory: finding.flow.dataCategory,
    sinkKind: finding.flow.sinkKind,
    transform: finding.flow.transform,
  };
  if (finding.flow.recipient !== undefined) {
    identity.recipient = finding.flow.recipient.origin;
  }
  const endpoint = normalizeBaselineEndpoint(finding.flow.endpoint);
  if (endpoint !== undefined) identity.endpoint = endpoint;
  if (finding.flow.location !== undefined) identity.location = finding.flow.location;

  return {
    key: createBaselineKey(identity),
    ...identity,
  };
};

const findingIdentity = (finding: Finding): string => JSON.stringify(finding);

export const compareBaseline = (
  findings: readonly Finding[],
  baseline: BaselineFile | undefined,
): BaselineComparison => {
  const observedByKey = new Map<string, ObservedBaselineFlow>();
  for (const finding of findings) {
    const flow = createBaselineFlowCandidate(finding);
    if (flow === undefined) continue;
    const observed = observedByKey.get(flow.key);
    if (observed === undefined) {
      observedByKey.set(flow.key, { flow, findings: [finding] });
    } else if (
      !observed.findings.some(
        (candidate) => findingIdentity(candidate) === findingIdentity(finding),
      )
    ) {
      observed.findings.push(finding);
    }
  }

  const baselineByKey = new Map((baseline?.flows ?? []).map((flow) => [flow.key, flow]));
  const known: ObservedBaselineFlow[] = [];
  const newlyObserved: ObservedBaselineFlow[] = [];
  for (const observed of observedByKey.values()) {
    observed.findings.sort((left, right) =>
      findingIdentity(left).localeCompare(findingIdentity(right)),
    );
    (baselineByKey.has(observed.flow.key) ? known : newlyObserved).push(observed);
  }

  const byKey = (
    left: { flow: BaselineFlowCandidate },
    right: { flow: BaselineFlowCandidate },
  ): number => left.flow.key.localeCompare(right.flow.key);
  known.sort(byKey);
  newlyObserved.sort(byKey);

  const observed = Array.from(observedByKey.values())
    .map(({ flow }) => flow)
    .sort((left, right) => left.key.localeCompare(right.key));
  const resolved = (baseline?.flows ?? [])
    .filter((flow) => !observedByKey.has(flow.key))
    .slice()
    .sort((left, right) => left.key.localeCompare(right.key));

  return { observed, known, new: newlyObserved, resolved };
};
