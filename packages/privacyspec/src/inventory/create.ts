import {
  type BaselineChangeReason,
  classifyBaselineChange,
  createBaselineFlowCandidate,
  normalizeBaselineEndpoint,
} from "../baseline/compare.js";
import type { BaselineFlow } from "../baseline/schema.js";
import type { DataFlow, DataFlowTestMetadata } from "../correlate/model.js";
import type { PrivacySpecJsonReport, ReportFinding } from "../report/model.js";
import {
  INVENTORY_SCHEMA_VERSION,
  type InventoryBoundary,
  type InventoryEntry,
  type InventoryState,
  type PrivacyInventory,
} from "./model.js";

export const MAX_INVENTORY_TESTS_PER_ENTRY = 100;

interface MutableInventoryEntry {
  entry: InventoryEntry;
  sourceKinds: Set<InventoryEntry["sourceKinds"][number]>;
  sourceConfidences: Set<InventoryEntry["sourceConfidences"][number]>;
  transforms: Set<InventoryEntry["transforms"][number]>;
  severities: Set<InventoryEntry["severities"][number]>;
  changeReasons: Set<BaselineChangeReason>;
  tests: Map<string, DataFlowTestMetadata>;
}

const stateRank: Record<InventoryState, number> = {
  OBSERVED: 0,
  KNOWN_REVIEW: 1,
  NEW_REVIEW: 2,
  TECHNICAL_FAILURE: 3,
};

const boundaryFor = (flow: DataFlow): InventoryBoundary => {
  if (flow.recipient?.firstParty === true) return "FIRST_PARTY";
  if (flow.recipient?.firstParty === false) return "EXTERNAL";
  if (["local-storage", "session-storage", "cookie"].includes(flow.sinkKind)) return "BROWSER";
  if (flow.sinkKind === "console") return "CONSOLE";
  return "UNKNOWN";
};

const flowIdentity = (flow: DataFlow): string =>
  JSON.stringify([
    flow.dataCategory,
    flow.sourceKind,
    flow.sourceConfidence,
    flow.sourceProvenance?.origin ?? null,
    flow.sourceProvenance?.endpoint ?? null,
    flow.sourceProvenance?.location ?? null,
    flow.requestSurface ?? "browser",
    flow.sinkKind,
    flow.recipient?.origin ?? null,
    flow.recipient?.host ?? null,
    flow.recipient?.firstParty ?? null,
    flow.method ?? null,
    flow.endpoint ?? null,
    flow.location ?? null,
    flow.transform,
    flow.test.file,
    flow.test.title,
    flow.test.project,
  ]);

const aggregateIdentity = (flow: DataFlow): string =>
  JSON.stringify([
    flow.dataCategory,
    flow.requestSurface ?? "browser",
    boundaryFor(flow),
    flow.sinkKind,
    flow.recipient?.origin ?? null,
    flow.recipient?.host ?? null,
    flow.recipient?.firstParty ?? null,
    flow.method ?? null,
    normalizeBaselineEndpoint(flow.endpoint) ?? null,
    flow.location ?? null,
    flow.sourceProvenance?.origin ?? null,
    flow.sourceProvenance?.endpoint ?? null,
    flow.sourceProvenance?.location ?? null,
  ]);

const testIdentity = (test: DataFlowTestMetadata): string =>
  JSON.stringify([test.file, test.title, test.project]);

const findingState = (findings: readonly ReportFinding[]): InventoryState => {
  if (findings.some(({ finding }) => finding.classification === "technical_failure")) {
    return "TECHNICAL_FAILURE";
  }
  if (findings.some(({ baselineState }) => baselineState === "new")) return "NEW_REVIEW";
  if (findings.some(({ baselineState }) => baselineState === "known")) return "KNOWN_REVIEW";
  return "OBSERVED";
};

const acceptedBaselineFlows = (report: PrivacySpecJsonReport): BaselineFlow[] => [
  ...report.baseline.known.map(({ flow }) => ({ ...flow, status: "accepted" as const })),
  ...report.baseline.resolved,
];

const uniqueChangeReasons = (
  findings: readonly ReportFinding[],
  accepted: readonly BaselineFlow[],
): BaselineChangeReason[] => {
  const reasons = new Set<BaselineChangeReason>();
  for (const { baselineState, finding } of findings) {
    if (baselineState !== "new") continue;
    const candidate = createBaselineFlowCandidate(finding);
    if (candidate !== undefined) reasons.add(classifyBaselineChange(candidate, accepted));
  }
  return Array.from(reasons).sort((left, right) => left.localeCompare(right));
};

const compareEntry = (left: InventoryEntry, right: InventoryEntry): number =>
  left.dataCategory.localeCompare(right.dataCategory) ||
  (left.requestSurface ?? "browser").localeCompare(right.requestSurface ?? "browser") ||
  left.boundary.localeCompare(right.boundary) ||
  (left.recipient?.origin ?? "").localeCompare(right.recipient?.origin ?? "") ||
  (left.method ?? "").localeCompare(right.method ?? "") ||
  (left.endpoint ?? "").localeCompare(right.endpoint ?? "") ||
  (left.location ?? "").localeCompare(right.location ?? "") ||
  left.sinkKind.localeCompare(right.sinkKind);

export const createPrivacyInventory = (report: PrivacySpecJsonReport): PrivacyInventory => {
  const findingsByFlow = new Map<string, ReportFinding[]>();
  for (const reportFinding of report.findings) {
    const identity = flowIdentity(reportFinding.finding.flow);
    const existing = findingsByFlow.get(identity);
    if (existing === undefined) findingsByFlow.set(identity, [reportFinding]);
    else existing.push(reportFinding);
  }
  const accepted = acceptedBaselineFlows(report);
  const groups = new Map<string, MutableInventoryEntry>();

  for (const flow of report.flows) {
    const identity = aggregateIdentity(flow);
    const findings = findingsByFlow.get(flowIdentity(flow)) ?? [];
    const state = findingState(findings);
    let group = groups.get(identity);
    if (group === undefined) {
      const entry: InventoryEntry = {
        dataCategory: flow.dataCategory,
        requestSurface: flow.requestSurface ?? "browser",
        boundary: boundaryFor(flow),
        sinkKind: flow.sinkKind,
        sourceKinds: [],
        sourceConfidences: [],
        transforms: [],
        state,
        severities: [],
        changeReasons: [],
        occurrences: 0,
        tests: [],
        testsTruncated: 0,
      };
      if (flow.recipient !== undefined) entry.recipient = { ...flow.recipient };
      if (flow.method !== undefined) entry.method = flow.method;
      const endpoint = normalizeBaselineEndpoint(flow.endpoint);
      if (endpoint !== undefined) entry.endpoint = endpoint;
      if (flow.location !== undefined) entry.location = flow.location;
      if (flow.sourceProvenance !== undefined) {
        entry.sourceProvenance = { ...flow.sourceProvenance };
      }
      group = {
        entry,
        sourceKinds: new Set(),
        sourceConfidences: new Set(),
        transforms: new Set(),
        severities: new Set(),
        changeReasons: new Set(),
        tests: new Map(),
      };
      groups.set(identity, group);
    }

    group.entry.occurrences += 1;
    group.sourceKinds.add(flow.sourceKind);
    group.sourceConfidences.add(flow.sourceConfidence);
    group.transforms.add(flow.transform);
    if (stateRank[state] > stateRank[group.entry.state]) group.entry.state = state;
    for (const { finding } of findings) group.severities.add(finding.severity);
    for (const reason of uniqueChangeReasons(findings, accepted)) group.changeReasons.add(reason);
    group.tests.set(testIdentity(flow.test), { ...flow.test });
  }

  const entries = Array.from(groups.values()).map((group) => {
    group.entry.sourceKinds = Array.from(group.sourceKinds).sort((left, right) =>
      left.localeCompare(right),
    );
    group.entry.sourceConfidences = Array.from(group.sourceConfidences).sort((left, right) =>
      left.localeCompare(right),
    );
    group.entry.transforms = Array.from(group.transforms).sort((left, right) =>
      left.localeCompare(right),
    );
    group.entry.severities = Array.from(group.severities).sort((left, right) =>
      left.localeCompare(right),
    );
    group.entry.changeReasons = Array.from(group.changeReasons).sort((left, right) =>
      left.localeCompare(right),
    );
    const tests = Array.from(group.tests.values()).sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.title.localeCompare(right.title) ||
        left.project.localeCompare(right.project),
    );
    group.entry.tests = tests.slice(0, MAX_INVENTORY_TESTS_PER_ENTRY);
    group.entry.testsTruncated = Math.max(0, tests.length - group.entry.tests.length);
    return group.entry;
  });
  entries.sort(compareEntry);

  const byState: PrivacyInventory["summary"]["byState"] = {
    OBSERVED: 0,
    KNOWN_REVIEW: 0,
    NEW_REVIEW: 0,
    TECHNICAL_FAILURE: 0,
  };
  for (const entry of entries) byState[entry.state] += 1;

  const limitations = [
    "This inventory is a current-run snapshot of browser-side flows exercised by the observed Playwright scope.",
    "Unobserved backend-only transfers, purposes, lawful bases, retention periods, processor roles, and transfer safeguards are outside this inventory.",
    "Known review flows are previously observed baseline identities; they are not legal or organisational approvals.",
    "This inventory is technical input for privacy review and is not a complete record of processing activities or legal conclusion.",
  ];
  if (!report.run.complete) {
    limitations.unshift(
      "The source run is incomplete; absence and resolved baseline candidates must not be treated as conclusive.",
    );
  }

  return {
    inventorySchemaVersion: INVENTORY_SCHEMA_VERSION,
    tool: { ...report.tool },
    sourceReport: {
      schemaVersion: report.schemaVersion,
      generatedAt: report.generatedAt,
      complete: report.run.complete,
      status: report.run.privacyspecStatus,
      projects: [...report.run.projects],
      tests: { ...report.run.tests },
    },
    summary: {
      entries: entries.length,
      occurrences: entries.reduce((total, entry) => total + entry.occurrences, 0),
      categories: new Set(entries.map((entry) => entry.dataCategory)).size,
      externalRecipients: new Set(
        entries
          .filter((entry) => entry.boundary === "EXTERNAL")
          .map((entry) => entry.recipient?.origin)
          .filter((origin): origin is string => origin !== undefined),
      ).size,
      byState,
    },
    entries,
    resolved: report.run.complete ? report.baseline.resolved.map((flow) => ({ ...flow })) : [],
    experimentalCoverage:
      report.schemaVersion === 5
        ? {
            browserEngines: {
              available: true,
              details: structuredClone(report.coverage.browserEngines),
            },
            apiRequests: {
              available: true,
              details: structuredClone(report.coverage.apiRequests),
            },
          }
        : {
            browserEngines: { available: false },
            apiRequests: { available: false },
          },
    limitations,
  };
};
