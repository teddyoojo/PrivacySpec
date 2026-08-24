import {
  DEPENDENCY_REPORT_SCHEMA_VERSION,
  type DependencyReport,
} from "../analyzers/dependency/model.js";
import {
  RUNTIME_FAILURE_SCHEMA_VERSION,
  type RuntimeFailureReport,
} from "../analyzers/runtime-failure/model.js";
import { SECURITY_SCHEMA_VERSION, type SecurityReport } from "../analyzers/security/model.js";
import type { BaselineComparison } from "../baseline/compare.js";
import type { BaselineFlow, BaselineFlowCandidate } from "../baseline/schema.js";
import type { DataFlow, DataFlowSourceKind } from "../correlate/model.js";
import type { PlaywrightObservationCounters } from "../playwright/coverage.js";
import type {
  APIRequestCoverage,
  BrowserEngineCapability,
  PrivacySpecBrowserEngine,
} from "../playwright/experimental-coverage.js";
import type { ReportLevelLegalMapping, RuleLegalMapping } from "../rules/legal-map.js";
import type { Finding } from "../rules/model.js";
import type { RuntimeCapabilityState } from "../runtime/capabilities.js";
import { createTestDataSection } from "../testdata/create.js";
import type { PrivacySpecTestDataSection, TestDataObservation } from "../testdata/model.js";

export const REPORT_SCHEMA_VERSION_V1 = 1 as const;
export const REPORT_SCHEMA_VERSION_V2 = 2 as const;
export const REPORT_SCHEMA_VERSION_V3 = 3 as const;
export const REPORT_SCHEMA_VERSION_V4 = 4 as const;
export const REPORT_SCHEMA_VERSION = 5 as const;
export const PRIVACYSPEC_TOOL_VERSION = "0.1.0-beta.3" as const;
export const DEFAULT_REPORT_PATH = "privacyspec-report.json";

export type PrivacySpecRunStatus = "passed" | "review" | "failed" | "incomplete";
export type PlaywrightRunStatus = "passed" | "failed" | "timedout" | "interrupted";
export type TestAttemptStatus = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
export type FindingBaselineState = "known" | "new" | "not_baseline_eligible";
export type ObservationCoverageStatus = "complete" | "partial" | "incomplete" | "unsupported";
export type SecondaryAnalysisStatus = "pass" | "review" | "fail" | "inconclusive";

export interface ObservationCoverageDiagnostic {
  code:
    | "COVERAGE_NO_PAGES"
    | "COVERAGE_NO_RUNTIME_EVENTS"
    | "COVERAGE_OBSERVER_FINALIZATION_INCOMPLETE"
    | "COVERAGE_LIMIT_REACHED"
    | "COVERAGE_OPTIONAL_OBSERVER_SKIPPED"
    | "COVERAGE_RESULT_UNAVAILABLE"
    | "COVERAGE_TEST_SCOPE_INCOMPLETE"
    | "COVERAGE_UNSUPPORTED_CONTEXT"
    | "COVERAGE_UNSUPPORTED_BROWSER_ENGINE"
    | "COVERAGE_BROWSER_ENGINE_CAPABILITY_LIMITED"
    | "COVERAGE_API_REQUEST_PARTIAL"
    | "COVERAGE_API_REQUEST_UNSUPPORTED";
  message: string;
}

export interface ObservationCoverageReport {
  status: ObservationCoverageStatus;
  tests: {
    attempts: number;
    observed: number;
  };
  browserObjects: PlaywrightObservationCounters["browserObjects"];
  contexts: PlaywrightObservationCounters["contexts"];
  pages: PlaywrightObservationCounters["pages"];
  events: PlaywrightObservationCounters["events"];
  diagnostics: ObservationCoverageDiagnostic[];
}

export interface TestAttemptCounts {
  total: number;
  observed: number;
  passed: number;
  failed: number;
  timedOut: number;
  skipped: number;
  interrupted: number;
}

export interface CountByName {
  total: number;
  byName: Record<string, number>;
}

export interface ReportFinding {
  baselineState: FindingBaselineState;
  finding: Finding;
}

export type PrivacySpecDataFlowV1 = Omit<DataFlow, "sourceKind" | "sourceProvenance"> & {
  sourceKind: Exclude<DataFlowSourceKind, "response-json">;
  sourceProvenance?: never;
};

export type PrivacySpecFindingV1 = Omit<Finding, "flow"> & {
  flow: PrivacySpecDataFlowV1;
};

export interface ReportFindingV1 {
  baselineState: FindingBaselineState;
  finding: PrivacySpecFindingV1;
}

interface ReportBaseline<ReportFindingType> {
  exists: boolean;
  known: Array<{ flow: BaselineFlowCandidate; findings: ReportFindingType[] }>;
  new: Array<{ flow: BaselineFlowCandidate; findings: ReportFindingType[] }>;
  resolved: BaselineFlow[];
}

interface PrivacySpecJsonReportCommon {
  tool: {
    name: "privacyspec";
    version: string;
  };
  generatedAt: string;
  run: {
    playwrightStatus: PlaywrightRunStatus;
    privacyspecStatus: PrivacySpecRunStatus;
    complete: boolean;
    startedAt: string;
    projects: string[];
    tests: TestAttemptCounts;
  };
  summary: {
    sensitiveSources: CountByName;
    sinks: CountByName;
    dataFlows: number;
    findings: {
      total: number;
      technicalFailures: number;
      reviewRequired: number;
      newReviewRequired: number;
      knownReviewRequired: number;
    };
    baseline: {
      known: number;
      new: number;
      resolved: number;
    };
  };
  performance: {
    suiteDurationMilliseconds: number;
    cumulativeTestDurationMilliseconds: number;
  };
  diagnostics: Array<{ code: string; message: string }>;
  integrationErrors: string[];
  legalMappings: {
    rules: RuleLegalMapping[];
    profiles: ReportLevelLegalMapping[];
  };
}

export interface PrivacySpecJsonReportV1 extends PrivacySpecJsonReportCommon {
  schemaVersion: typeof REPORT_SCHEMA_VERSION_V1;
  flows: PrivacySpecDataFlowV1[];
  findings: ReportFindingV1[];
  baseline: ReportBaseline<PrivacySpecFindingV1>;
}

export interface FirstPartyJsonResponseReportCoverage {
  experimental: true;
  tests: {
    enabled: number;
    disabled: number;
    unavailable: number;
  };
  responses: {
    seen: number;
    firstParty: number;
    json: number;
    parsed: number;
    withSources: number;
  };
  retainedBytes: number;
  discoveredSources: CountByName;
  skipped: {
    unknownLength: number;
    oversized: number;
    aggregateLimit: number;
    workLimit: number;
    bodyReadError: number;
    invalidJson: number;
    traversalLimit: number;
    sourceLimit: number;
  };
}

export interface PlaywrightInstrumentationReportCoverage {
  tests: {
    compatible: number;
    incompatible: number;
    unavailable: number;
  };
  applicationContexts: number;
  pages: number;
}

export interface NetworkObservationReportCoverage {
  requests: {
    seen: number;
    accepted: number;
    filteredLowValueStatic: number;
  };
}

export interface PrivacySpecJsonReportV2 extends PrivacySpecJsonReportCommon {
  schemaVersion: typeof REPORT_SCHEMA_VERSION_V2;
  flows: DataFlow[];
  findings: ReportFinding[];
  baseline: {
    exists: boolean;
    known: BaselineComparison["known"];
    new: BaselineComparison["new"];
    resolved: BaselineComparison["resolved"];
  };
  coverage: {
    playwright?: PlaywrightInstrumentationReportCoverage | undefined;
    network?: NetworkObservationReportCoverage | undefined;
    firstPartyJsonResponses: FirstPartyJsonResponseReportCoverage;
  };
  testData?: PrivacySpecTestDataSection | undefined;
}

export interface PrivacySpecJsonReportV3
  extends Omit<PrivacySpecJsonReportV2, "schemaVersion" | "coverage"> {
  schemaVersion: typeof REPORT_SCHEMA_VERSION_V3;
  coverage: PrivacySpecJsonReportV2["coverage"] & {
    observation: ObservationCoverageReport;
  };
}

export interface PrivacyAnalysisReport {
  status: SecondaryAnalysisStatus;
  complete: boolean;
  coverage: ObservationCoverageStatus;
  summary: PrivacySpecJsonReportCommon["summary"];
}

export type DependencyAnalysisReport = DependencyReport & {
  status: SecondaryAnalysisStatus;
};

export type SecurityAnalysisReport = SecurityReport & {
  status: SecondaryAnalysisStatus;
};

export type RuntimeErrorAnalysisReport = RuntimeFailureReport & {
  status: SecondaryAnalysisStatus;
};

export interface SecondaryAnalysisReport {
  status: SecondaryAnalysisStatus;
  changes: {
    total: number;
    privacy: number;
    dependencies: number;
    security: number;
    runtimeErrors: number;
  };
  privacy: PrivacyAnalysisReport;
  dependencies: DependencyAnalysisReport;
  security: SecurityAnalysisReport;
  runtimeErrors: RuntimeErrorAnalysisReport;
}

export interface PrivacySpecJsonReportV4 extends Omit<PrivacySpecJsonReportV3, "schemaVersion"> {
  schemaVersion: typeof REPORT_SCHEMA_VERSION_V4;
  analysis: SecondaryAnalysisReport;
}

export interface BrowserEngineReportCoverage {
  experimental: true;
  tests: {
    supported: number;
    experimental: number;
    unsupported: number;
    unavailable: number;
  };
  engines: Record<
    PrivacySpecBrowserEngine,
    {
      tests: number;
      support: "supported" | "experimental" | "unsupported";
      capabilities: Record<BrowserEngineCapability, RuntimeCapabilityState>;
    }
  >;
}

export interface APIRequestReportCoverage {
  experimental: true;
  tests: {
    enabled: number;
    disabled: number;
    unavailable: number;
    complete: number;
    partial: number;
    unsupported: number;
  };
  calls: APIRequestCoverage["calls"];
  skipped: APIRequestCoverage["skipped"];
  blindSpots: APIRequestCoverage["blindSpots"];
}

export interface PrivacySpecJsonReportV5
  extends Omit<PrivacySpecJsonReportV4, "schemaVersion" | "coverage"> {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  coverage: PrivacySpecJsonReportV4["coverage"] & {
    browserEngines: BrowserEngineReportCoverage;
    apiRequests: APIRequestReportCoverage;
  };
}

export type PrivacySpecJsonReport =
  | PrivacySpecJsonReportV1
  | PrivacySpecJsonReportV2
  | PrivacySpecJsonReportV3
  | PrivacySpecJsonReportV4
  | PrivacySpecJsonReportV5;

export interface SecondaryAnalysisInput {
  dependencies: DependencyReport;
  security: SecurityReport;
  runtimeErrors: RuntimeFailureReport;
}

export interface CreatePrivacySpecReportInput {
  generatedAt: string;
  startedAt: string;
  playwrightStatus: PlaywrightRunStatus;
  privacyspecStatus: PrivacySpecRunStatus;
  complete: boolean;
  projects: readonly string[];
  tests: TestAttemptCounts;
  sourceCounts: ReadonlyMap<string, number>;
  sinkCounts: ReadonlyMap<string, number>;
  suiteDurationMilliseconds: number;
  cumulativeTestDurationMilliseconds: number;
  flows: readonly DataFlow[];
  findings: readonly Finding[];
  comparison: BaselineComparison;
  baselineExists: boolean;
  diagnostics: ReadonlyArray<{ code: string; message: string }>;
  integrationErrors: readonly string[];
  ruleMappings: readonly RuleLegalMapping[];
  profileMappings: readonly ReportLevelLegalMapping[];
  responseCoverage?: FirstPartyJsonResponseReportCoverage | undefined;
  playwrightCoverage?: PlaywrightInstrumentationReportCoverage | undefined;
  networkCoverage?: NetworkObservationReportCoverage | undefined;
  observationCoverage?: ObservationCoverageReport | undefined;
  browserEngineCoverage?: BrowserEngineReportCoverage | undefined;
  apiRequestCoverage?: APIRequestReportCoverage | undefined;
  testDataObservations?: readonly TestDataObservation[] | undefined;
  secondaryAnalysis?: SecondaryAnalysisInput | undefined;
}

const countSummary = (counts: ReadonlyMap<string, number>): CountByName => {
  const byName: Record<string, number> = {};
  let total = 0;
  for (const [name, count] of Array.from(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    byName[name] = count;
    total += count;
  }
  return { total, byName };
};

const findingIdentity = (finding: Finding): string =>
  JSON.stringify([finding.ruleId, finding.flow]);

const withRequestSurface = (flow: DataFlow): DataFlow => ({
  ...flow,
  requestSurface: flow.requestSurface ?? "browser",
});

const findingWithRequestSurface = (finding: Finding): Finding => ({
  ...finding,
  flow: withRequestSurface(finding.flow),
});

const comparisonWithRequestSurfaces = (comparison: BaselineComparison): BaselineComparison => ({
  ...comparison,
  known: comparison.known.map((entry) => ({
    ...entry,
    findings: entry.findings.map(findingWithRequestSurface),
  })),
  new: comparison.new.map((entry) => ({
    ...entry,
    findings: entry.findings.map(findingWithRequestSurface),
  })),
});

const privacyAnalysisStatus = (
  complete: boolean,
  coverage: ObservationCoverageStatus,
  summary: PrivacySpecJsonReportCommon["summary"],
): SecondaryAnalysisStatus => {
  if (!complete || coverage !== "complete") return "inconclusive";
  if (summary.findings.technicalFailures > 0) return "fail";
  if (summary.findings.newReviewRequired > 0) return "review";
  return "pass";
};

const reviewModuleStatus = (
  report: Pick<DependencyReport | SecurityReport, "complete" | "coverage" | "findings">,
): SecondaryAnalysisStatus => {
  if (!report.complete || report.coverage !== "complete") return "inconclusive";
  return report.findings.length > 0 ? "review" : "pass";
};

const runtimeErrorAnalysisStatus = (report: RuntimeFailureReport): SecondaryAnalysisStatus => {
  if (!report.complete || report.coverage !== "complete") return "inconclusive";
  if (report.findings.some((finding) => finding.severity === "ERROR")) return "fail";
  return report.findings.length > 0 ? "review" : "pass";
};

const combinedAnalysisStatus = (
  privacySpecStatus: PrivacySpecRunStatus,
  statuses: readonly SecondaryAnalysisStatus[],
): SecondaryAnalysisStatus => {
  if (privacySpecStatus === "failed" || statuses.includes("fail")) return "fail";
  if (privacySpecStatus === "incomplete" || statuses.includes("inconclusive")) {
    return "inconclusive";
  }
  if (privacySpecStatus === "review" || statuses.includes("review")) return "review";
  return "pass";
};

const defaultSecondaryAnalysis = (generatedAt: string): SecondaryAnalysisInput => ({
  dependencies: {
    schemaVersion: DEPENDENCY_REPORT_SCHEMA_VERSION,
    generatedAt,
    complete: false,
    coverage: "unavailable",
    inventory: [],
    findings: [],
    baseline: { exists: false, known: 0, new: 0, resolved: 0 },
    diagnostics: [],
  },
  security: {
    schemaVersion: SECURITY_SCHEMA_VERSION,
    generatedAt,
    complete: false,
    coverage: "unavailable",
    inventory: [],
    findings: [],
    baseline: { exists: false, known: 0, changed: 0, newTargets: 0, resolved: 0 },
    diagnostics: [],
  },
  runtimeErrors: {
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    generatedAt,
    complete: false,
    coverage: "unavailable",
    inventory: [],
    findings: [],
    baseline: { exists: false, known: 0, new: 0, resolved: 0 },
    diagnostics: [],
  },
});

export const createSecondaryAnalysisReport = (input: {
  generatedAt: string;
  privacySpecStatus: PrivacySpecRunStatus;
  privacyComplete: boolean;
  privacyCoverage: ObservationCoverageStatus;
  privacySummary: PrivacySpecJsonReportCommon["summary"];
  modules?: SecondaryAnalysisInput | undefined;
}): SecondaryAnalysisReport => {
  const modules = input.modules ?? defaultSecondaryAnalysis(input.generatedAt);
  const privacyStatus = privacyAnalysisStatus(
    input.privacyComplete,
    input.privacyCoverage,
    input.privacySummary,
  );
  const dependencyStatus = reviewModuleStatus(modules.dependencies);
  const securityStatus = reviewModuleStatus(modules.security);
  const runtimeStatus = runtimeErrorAnalysisStatus(modules.runtimeErrors);
  const changes = {
    privacy: input.privacySummary.findings.technicalFailures + input.privacySummary.baseline.new,
    dependencies: modules.dependencies.findings.length,
    security: modules.security.findings.length,
    runtimeErrors: modules.runtimeErrors.findings.length,
  };

  return {
    status: combinedAnalysisStatus(input.privacySpecStatus, [
      privacyStatus,
      dependencyStatus,
      securityStatus,
      runtimeStatus,
    ]),
    changes: {
      total: changes.privacy + changes.dependencies + changes.security + changes.runtimeErrors,
      ...changes,
    },
    privacy: {
      status: privacyStatus,
      complete: input.privacyComplete,
      coverage: input.privacyCoverage,
      summary: structuredClone(input.privacySummary),
    },
    dependencies: { status: dependencyStatus, ...structuredClone(modules.dependencies) },
    security: { status: securityStatus, ...structuredClone(modules.security) },
    runtimeErrors: { status: runtimeStatus, ...structuredClone(modules.runtimeErrors) },
  };
};

const reportFindings = (
  findings: readonly Finding[],
  comparison: BaselineComparison,
): ReportFinding[] => {
  const known = new Set(
    comparison.known.flatMap(({ findings: observed }) => observed.map(findingIdentity)),
  );
  const newlyObserved = new Set(
    comparison.new.flatMap(({ findings: observed }) => observed.map(findingIdentity)),
  );
  return findings.map((finding) => ({
    baselineState: known.has(findingIdentity(finding))
      ? "known"
      : newlyObserved.has(findingIdentity(finding))
        ? "new"
        : "not_baseline_eligible",
    finding,
  }));
};

export const createPrivacySpecReport = (
  input: CreatePrivacySpecReportInput,
): PrivacySpecJsonReportV5 => {
  const normalizedFlows = input.flows.map(withRequestSurface);
  const normalizedInputFindings = input.findings.map(findingWithRequestSurface);
  const suppliedComparison = comparisonWithRequestSurfaces(input.comparison);
  const normalizedComparison: BaselineComparison = input.complete
    ? suppliedComparison
    : { observed: suppliedComparison.observed, known: [], new: [], resolved: [] };
  const findings = reportFindings(normalizedInputFindings, normalizedComparison);
  const technicalFailures = normalizedInputFindings.filter(
    (finding) => finding.classification === "technical_failure",
  ).length;
  const reviewRequired = normalizedInputFindings.filter(
    (finding) => finding.classification === "review_required",
  ).length;
  const newReviewRequired = normalizedComparison.new.reduce(
    (count, observed) => count + observed.findings.length,
    0,
  );
  const knownReviewRequired = normalizedComparison.known.reduce(
    (count, observed) => count + observed.findings.length,
    0,
  );
  const responseCoverage: FirstPartyJsonResponseReportCoverage = input.responseCoverage ?? {
    experimental: true,
    tests: { enabled: 0, disabled: input.tests.observed, unavailable: 0 },
    responses: { seen: 0, firstParty: 0, json: 0, parsed: 0, withSources: 0 },
    retainedBytes: 0,
    discoveredSources: {
      total: 0,
      byName: { "personal.email": 0, "personal.phone": 0 },
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
  };
  const observationCoverage: ObservationCoverageReport = input.observationCoverage ?? {
    status: input.complete ? "complete" : "incomplete",
    tests: { attempts: input.tests.total, observed: input.tests.observed },
    browserObjects: { seen: input.tests.observed },
    contexts: { seen: input.tests.observed, instrumented: input.tests.observed },
    pages: { seen: input.tests.observed, instrumented: input.tests.observed, storageCapable: 0 },
    events: { navigations: 0, network: 0, console: 0 },
    diagnostics: input.complete
      ? []
      : [
          {
            code: "COVERAGE_TEST_SCOPE_INCOMPLETE",
            message:
              "The executed Playwright test scope did not produce complete observation evidence.",
          },
        ],
  };
  const browserEngineCoverage: BrowserEngineReportCoverage = input.browserEngineCoverage ?? {
    experimental: true,
    tests: { supported: input.tests.observed, experimental: 0, unsupported: 0, unavailable: 0 },
    engines: {
      chromium: {
        tests: input.tests.observed,
        support: "supported",
        capabilities: {
          "init-scripts": "complete",
          events: "complete",
          "teardown-fallback": "complete",
          network: "complete",
          console: "complete",
          storage: "complete",
          cookies: "complete",
          "response-headers": "complete",
          "page-errors": "complete",
        },
      },
      firefox: {
        tests: 0,
        support: "unsupported",
        capabilities: {
          "init-scripts": "unsupported",
          events: "unsupported",
          "teardown-fallback": "unsupported",
          network: "unsupported",
          console: "unsupported",
          storage: "unsupported",
          cookies: "unsupported",
          "response-headers": "unsupported",
          "page-errors": "unsupported",
        },
      },
      webkit: {
        tests: 0,
        support: "unsupported",
        capabilities: {
          "init-scripts": "unsupported",
          events: "unsupported",
          "teardown-fallback": "unsupported",
          network: "unsupported",
          console: "unsupported",
          storage: "unsupported",
          cookies: "unsupported",
          "response-headers": "unsupported",
          "page-errors": "unsupported",
        },
      },
    },
  };
  const apiRequestCoverage: APIRequestReportCoverage = input.apiRequestCoverage ?? {
    experimental: true,
    tests: {
      enabled: 0,
      disabled: input.tests.observed,
      unavailable: 0,
      complete: input.tests.observed,
      partial: 0,
      unsupported: 0,
    },
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
  };

  const summary: PrivacySpecJsonReportCommon["summary"] = {
    sensitiveSources: countSummary(input.sourceCounts),
    sinks: countSummary(input.sinkCounts),
    dataFlows: normalizedFlows.length,
    findings: {
      total: normalizedInputFindings.length,
      technicalFailures,
      reviewRequired,
      newReviewRequired,
      knownReviewRequired,
    },
    baseline: {
      known: normalizedComparison.known.length,
      new: normalizedComparison.new.length,
      resolved: normalizedComparison.resolved.length,
    },
  };

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "privacyspec", version: PRIVACYSPEC_TOOL_VERSION },
    generatedAt: input.generatedAt,
    run: {
      playwrightStatus: input.playwrightStatus,
      privacyspecStatus: input.privacyspecStatus,
      complete: input.complete,
      startedAt: input.startedAt,
      projects: [...input.projects].sort((left, right) => left.localeCompare(right)),
      tests: { ...input.tests },
    },
    summary,
    performance: {
      suiteDurationMilliseconds: input.suiteDurationMilliseconds,
      cumulativeTestDurationMilliseconds: input.cumulativeTestDurationMilliseconds,
    },
    flows: normalizedFlows,
    findings,
    baseline: {
      exists: input.baselineExists,
      known: normalizedComparison.known,
      new: normalizedComparison.new,
      resolved: normalizedComparison.resolved,
    },
    diagnostics: [...input.diagnostics],
    integrationErrors: [...input.integrationErrors],
    legalMappings: {
      rules: [...input.ruleMappings],
      profiles: [...input.profileMappings],
    },
    coverage: {
      ...(input.playwrightCoverage === undefined
        ? {}
        : {
            playwright: {
              tests: { ...input.playwrightCoverage.tests },
              applicationContexts: input.playwrightCoverage.applicationContexts,
              pages: input.playwrightCoverage.pages,
            },
          }),
      ...(input.networkCoverage === undefined
        ? {}
        : { network: { requests: { ...input.networkCoverage.requests } } }),
      observation: {
        status: observationCoverage.status,
        tests: { ...observationCoverage.tests },
        browserObjects: { ...observationCoverage.browserObjects },
        contexts: { ...observationCoverage.contexts },
        pages: { ...observationCoverage.pages },
        events: { ...observationCoverage.events },
        diagnostics: observationCoverage.diagnostics.map((diagnostic) => ({
          ...diagnostic,
        })),
      },
      firstPartyJsonResponses: {
        ...responseCoverage,
        tests: { ...responseCoverage.tests },
        responses: { ...responseCoverage.responses },
        discoveredSources: {
          total: responseCoverage.discoveredSources.total,
          byName: { ...responseCoverage.discoveredSources.byName },
        },
        skipped: { ...responseCoverage.skipped },
      },
      browserEngines: structuredClone(browserEngineCoverage),
      apiRequests: structuredClone(apiRequestCoverage),
    },
    testData: createTestDataSection(input.testDataObservations ?? []),
    analysis: createSecondaryAnalysisReport({
      generatedAt: input.generatedAt,
      privacySpecStatus: input.privacyspecStatus,
      privacyComplete: input.complete,
      privacyCoverage: observationCoverage.status,
      privacySummary: summary,
      modules: input.secondaryAnalysis,
    }),
  };
};
