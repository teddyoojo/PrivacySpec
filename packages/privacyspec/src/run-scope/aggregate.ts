import {
  leastCompleteDependencyCoverage,
  mergeDependencyInventory,
  sortedDependencyInventory,
} from "../analyzers/dependency/aggregate.js";
import { compareDependencyBaseline } from "../analyzers/dependency/baseline.js";
import {
  DEPENDENCY_REPORT_SCHEMA_VERSION,
  type DependencyBaselineFile,
  type DependencyCoverageStatus,
  type DependencyReport,
  type RuntimeDependencyInventoryEntry,
} from "../analyzers/dependency/model.js";
import {
  leastCompleteRuntimeFailureCoverage,
  mergeRuntimeFailureInventory,
  sortedRuntimeFailureInventory,
} from "../analyzers/runtime-failure/aggregate.js";
import { compareRuntimeFailureBaseline } from "../analyzers/runtime-failure/baseline.js";
import {
  RUNTIME_FAILURE_SCHEMA_VERSION,
  type RuntimeFailureBaselineFile,
  type RuntimeFailureCoverageStatus,
  type RuntimeFailureInventoryEntry,
  type RuntimeFailureReport,
} from "../analyzers/runtime-failure/model.js";
import {
  leastCompleteSecurityCoverage,
  mergeSecurityInventory,
  sortedSecurityInventory,
} from "../analyzers/security/aggregate.js";
import { compareSecurityBaseline } from "../analyzers/security/baseline.js";
import {
  SECURITY_SCHEMA_VERSION,
  type SecurityBaselineFile,
  type SecurityCoverageStatus,
  type SecurityPostureInventoryEntry,
  type SecurityReport,
} from "../analyzers/security/model.js";
import type { BaselineComparison } from "../baseline/compare.js";
import { compareBaseline } from "../baseline/compare.js";
import type { BaselineFile } from "../baseline/schema.js";
import { classifierConfigurationForBaseline } from "../baseline/write.js";
import { compareCanonicalStrings } from "../canonical-order.js";
import type { DataFlow } from "../correlate/model.js";
import {
  type ClassifierConfigurationState,
  classifierConfigurationsEqual,
  UNAVAILABLE_CLASSIFIER_CONFIGURATION,
} from "../discovery/classifier-configuration.js";
import {
  type APIRequestReportCoverage,
  type BrowserEngineReportCoverage,
  createPrivacySpecReport,
  type FirstPartyJsonResponseReportCoverage,
  type NetworkObservationReportCoverage,
  type ObservationCoverageReport,
  type PlaywrightInstrumentationReportCoverage,
  type PlaywrightRunStatus,
  type PrivacySpecJsonReportV5,
  type PrivacySpecRunStatus,
  type TestAttemptCounts,
} from "../report/model.js";
import { REPORT_LEVEL_LEGAL_MAPPINGS, RULE_LEGAL_MAPPINGS } from "../rules/legal-map.js";
import type { Finding } from "../rules/model.js";
import type { TestDataObservation } from "../testdata/model.js";
import { parsePrivacySpecRunPart } from "./artifact.js";
import {
  type PrivacySpecAggregateScope,
  type PrivacySpecRunPart,
  RUN_PART_SCHEMA_VERSION,
  RUN_PART_SCHEMA_VERSION_V1,
} from "./model.js";

const MAX_AGGREGATE_ITEMS = 100_000;
const MAX_AGGREGATE_DIAGNOSTICS = 10_000;

export class RunAggregationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAggregationError";
  }
}

export interface PrivacySpecAggregationBaselines {
  privacy?: BaselineFile | undefined;
  dependencies?: DependencyBaselineFile | undefined;
  security?: SecurityBaselineFile | undefined;
  runtimeErrors?: RuntimeFailureBaselineFile | undefined;
}

export interface PrivacySpecAggregateLatestRuns {
  privacy: {
    complete: boolean;
    classifierConfiguration: ClassifierConfigurationState;
    entries: ReturnType<typeof compareBaseline>["observed"];
  };
  dependencies: {
    complete: boolean;
    entries: ReturnType<typeof compareDependencyBaseline>["observed"];
  };
  security: { complete: boolean; entries: ReturnType<typeof compareSecurityBaseline>["observed"] };
  runtimeErrors: {
    complete: boolean;
    entries: ReturnType<typeof compareRuntimeFailureBaseline>["observed"];
  };
}

export interface PrivacySpecAggregationResult {
  scope: PrivacySpecAggregateScope;
  report: PrivacySpecJsonReportV5;
  latestRuns: PrivacySpecAggregateLatestRuns;
}

const canonicalJson = (value: unknown): string => JSON.stringify(value);

const addBounded = (left: number, right: number, limit: { reached: boolean }): number => {
  if (left > Number.MAX_SAFE_INTEGER - right) {
    limit.reached = true;
    return Number.MAX_SAFE_INTEGER;
  }
  return left + right;
};

const addCounts = <T extends object>(target: T, incoming: T, limit: { reached: boolean }): void => {
  const targetCounts = target as Record<string, number>;
  const incomingCounts = incoming as Record<string, number>;
  for (const key of Object.keys(targetCounts)) {
    targetCounts[key] = addBounded(targetCounts[key] ?? 0, incomingCounts[key] ?? 0, limit);
  }
};

const deduplicateBounded = <T>(
  values: readonly T[],
  limit: { reached: boolean },
  maximum = MAX_AGGREGATE_ITEMS,
): T[] => {
  const byIdentity = new Map<string, T>();
  for (const value of values) {
    const identity = canonicalJson(value);
    if (byIdentity.has(identity)) continue;
    if (byIdentity.size >= maximum) {
      limit.reached = true;
      continue;
    }
    byIdentity.set(identity, structuredClone(value));
  }
  return Array.from(byIdentity.entries())
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([, value]) => value);
};

const validateAndSortParts = (input: readonly PrivacySpecRunPart[]): PrivacySpecRunPart[] => {
  if (input.length === 0)
    throw new RunAggregationError("At least one PrivacySpec run part is required.");
  if (input.length > 128)
    throw new RunAggregationError("PrivacySpec aggregation accepts at most 128 parts.");
  const parts = input
    .map((part) => parsePrivacySpecRunPart(part))
    .sort((left, right) => left.scope.part - right.scope.part);
  const first = parts[0];
  if (first === undefined)
    throw new RunAggregationError("At least one PrivacySpec run part is required.");
  const coordinates = new Set<number>();
  const projects = canonicalJson(first.report.run.projects);
  for (const part of parts) {
    if (part.runPartSchemaVersion !== first.runPartSchemaVersion) {
      throw new RunAggregationError("PrivacySpec run parts use mixed schema versions.");
    }
    if (part.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION) {
      if (
        first.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION &&
        !classifierConfigurationsEqual(part.classifierConfiguration, first.classifierConfiguration)
      ) {
        throw new RunAggregationError(
          "PrivacySpec run parts have mismatched classifier configuration.",
        );
      }
    }
    if (
      part.scope.runId !== first.scope.runId ||
      part.scope.configurationId !== first.scope.configurationId ||
      part.scope.total !== first.scope.total ||
      part.scope.failOnNewReviewFindings !== first.scope.failOnNewReviewFindings ||
      part.scope.nis2EvidenceProfile !== first.scope.nis2EvidenceProfile
    ) {
      throw new RunAggregationError("PrivacySpec run parts have mismatched run configuration.");
    }
    if (canonicalJson(part.report.run.projects) !== projects) {
      throw new RunAggregationError("PrivacySpec run parts have mismatched Playwright projects.");
    }
    if (coordinates.has(part.scope.part)) {
      throw new RunAggregationError("PrivacySpec run parts contain a duplicate part identity.");
    }
    coordinates.add(part.scope.part);
  }
  return parts;
};

const playwrightStatus = (parts: readonly PrivacySpecRunPart[]): PlaywrightRunStatus => {
  const statuses = parts.map((part) => part.report.run.playwrightStatus);
  if (statuses.includes("interrupted")) return "interrupted";
  if (statuses.includes("timedout")) return "timedout";
  if (statuses.includes("failed")) return "failed";
  return "passed";
};

const leastObservationCoverage = (
  left: ObservationCoverageReport["status"],
  right: ObservationCoverageReport["status"],
): ObservationCoverageReport["status"] => {
  const rank = { complete: 0, partial: 1, incomplete: 2, unsupported: 3 } as const;
  return rank[left] >= rank[right] ? left : right;
};

const moduleCoverage = <T extends DependencyCoverageStatus | "unavailable">(
  parts: readonly PrivacySpecRunPart[],
  select: (part: PrivacySpecRunPart) => T,
  least: (
    left: Exclude<T, "unavailable">,
    right: Exclude<T, "unavailable">,
  ) => Exclude<T, "unavailable">,
  scopeComplete: boolean,
): T => {
  let coverage: T = "unavailable" as T;
  for (const part of parts) {
    if (part.report.run.tests.total === 0) continue;
    const incoming = select(part);
    if (incoming === "unavailable") continue;
    coverage =
      coverage === "unavailable"
        ? incoming
        : (least(
            coverage as Exclude<T, "unavailable">,
            incoming as Exclude<T, "unavailable">,
          ) as T);
  }
  if (!scopeComplete && coverage !== "unavailable") {
    coverage = least(
      coverage as Exclude<T, "unavailable">,
      "incomplete" as Exclude<T, "unavailable">,
    ) as T;
  }
  return coverage;
};

const incompletePrivacyComparison = (findings: readonly Finding[]): BaselineComparison => ({
  observed: compareBaseline(findings, undefined).observed,
  known: [],
  new: [],
  resolved: [],
});

export const aggregatePrivacySpecRunParts = (
  input: readonly PrivacySpecRunPart[],
  baselines: PrivacySpecAggregationBaselines = {},
): PrivacySpecAggregationResult => {
  const parts = validateAndSortParts(input);
  const first = parts[0] as PrivacySpecRunPart;
  const received = new Set(parts.map((part) => part.scope.part));
  const missingParts = Array.from({ length: first.scope.total }, (_, index) => index + 1).filter(
    (part) => !received.has(part),
  );
  const scopeComplete = missingParts.length === 0 && parts.length === first.scope.total;
  const scope: PrivacySpecAggregateScope = {
    runId: first.scope.runId,
    configurationId: first.scope.configurationId,
    expectedParts: first.scope.total,
    receivedParts: parts.length,
    missingParts,
    complete: scopeComplete,
  };
  const limit = { reached: false };
  const classifierConfiguration: ClassifierConfigurationState =
    first.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION
      ? structuredClone(first.classifierConfiguration)
      : UNAVAILABLE_CLASSIFIER_CONFIGURATION;

  const tests: TestAttemptCounts = {
    total: 0,
    observed: 0,
    passed: 0,
    failed: 0,
    timedOut: 0,
    skipped: 0,
    interrupted: 0,
  };
  let cumulativeTestDurationMilliseconds = 0;
  const sourceCounts = new Map<string, number>();
  const sinkCounts = new Map<string, number>();
  const allFlows: DataFlow[] = [];
  const allFindings: Finding[] = [];
  const allTestData: TestDataObservation[] = [];
  const topLevelDiagnostics: Array<{ code: string; message: string }> = [];
  const integrationErrors: string[] = [];
  const observationDiagnostics: ObservationCoverageReport["diagnostics"] = [];
  const dependencyDiagnostics: DependencyReport["diagnostics"] = [];
  const securityDiagnostics: SecurityReport["diagnostics"] = [];
  const runtimeDiagnostics: RuntimeFailureReport["diagnostics"] = [];
  const dependencyInventory = new Map<string, RuntimeDependencyInventoryEntry>();
  const securityInventory = new Map<string, SecurityPostureInventoryEntry>();
  const runtimeInventory = new Map<string, RuntimeFailureInventoryEntry>();

  const observationCoverage: ObservationCoverageReport = {
    status: "complete",
    tests: { attempts: 0, observed: 0 },
    browserObjects: { seen: 0 },
    contexts: { seen: 0, instrumented: 0 },
    pages: { seen: 0, instrumented: 0, storageCapable: 0 },
    events: { navigations: 0, network: 0, console: 0 },
    diagnostics: [],
  };
  const responseCoverage: FirstPartyJsonResponseReportCoverage = {
    experimental: true,
    tests: { enabled: 0, disabled: 0, unavailable: 0 },
    responses: { seen: 0, firstParty: 0, json: 0, parsed: 0, withSources: 0 },
    retainedBytes: 0,
    discoveredSources: { total: 0, byName: {} },
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
  const playwrightCoverage: PlaywrightInstrumentationReportCoverage = {
    tests: { compatible: 0, incompatible: 0, unavailable: 0 },
    applicationContexts: 0,
    pages: 0,
  };
  const networkCoverage: NetworkObservationReportCoverage = {
    requests: { seen: 0, accepted: 0, filteredLowValueStatic: 0 },
  };
  const browserEngineCoverage: BrowserEngineReportCoverage = {
    experimental: true,
    tests: { supported: 0, experimental: 0, unsupported: 0, unavailable: 0 },
    engines: {
      chromium: {
        tests: 0,
        support: "supported",
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
  const apiRequestCoverage: APIRequestReportCoverage = {
    experimental: true,
    tests: { enabled: 0, disabled: 0, unavailable: 0, complete: 0, partial: 0, unsupported: 0 },
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
  const capabilityRank = {
    complete: 0,
    disabled: 1,
    partial: 2,
    incomplete: 3,
    unsupported: 4,
  } as const;
  const supportRank = { supported: 0, experimental: 1, unsupported: 2 } as const;
  let sawPlaywrightCoverage = false;
  let sawNetworkCoverage = false;

  for (const part of parts) {
    const report = part.report;
    addCounts(tests, report.run.tests, limit);
    cumulativeTestDurationMilliseconds = addBounded(
      cumulativeTestDurationMilliseconds,
      report.performance.cumulativeTestDurationMilliseconds,
      limit,
    );
    for (const [name, count] of Object.entries(report.summary.sensitiveSources.byName)) {
      sourceCounts.set(name, addBounded(sourceCounts.get(name) ?? 0, count, limit));
    }
    for (const [name, count] of Object.entries(report.summary.sinks.byName)) {
      sinkCounts.set(name, addBounded(sinkCounts.get(name) ?? 0, count, limit));
    }
    allFlows.push(...report.flows);
    allFindings.push(...report.findings.map((entry) => entry.finding));
    allTestData.push(...(report.testData?.observations ?? []));
    topLevelDiagnostics.push(...report.diagnostics);
    integrationErrors.push(...report.integrationErrors);
    observationDiagnostics.push(...report.coverage.observation.diagnostics);
    dependencyDiagnostics.push(...report.analysis.dependencies.diagnostics);
    securityDiagnostics.push(...report.analysis.security.diagnostics);
    runtimeDiagnostics.push(...report.analysis.runtimeErrors.diagnostics);

    if (report.run.tests.total > 0) {
      observationCoverage.status = leastObservationCoverage(
        observationCoverage.status,
        report.coverage.observation.status,
      );
    }
    addCounts(observationCoverage.tests, report.coverage.observation.tests, limit);
    addCounts(
      observationCoverage.browserObjects,
      report.coverage.observation.browserObjects,
      limit,
    );
    addCounts(observationCoverage.contexts, report.coverage.observation.contexts, limit);
    addCounts(observationCoverage.pages, report.coverage.observation.pages, limit);
    addCounts(observationCoverage.events, report.coverage.observation.events, limit);
    addCounts(responseCoverage.tests, report.coverage.firstPartyJsonResponses.tests, limit);
    addCounts(responseCoverage.responses, report.coverage.firstPartyJsonResponses.responses, limit);
    responseCoverage.retainedBytes = addBounded(
      responseCoverage.retainedBytes,
      report.coverage.firstPartyJsonResponses.retainedBytes,
      limit,
    );
    for (const [name, count] of Object.entries(
      report.coverage.firstPartyJsonResponses.discoveredSources.byName,
    )) {
      responseCoverage.discoveredSources.byName[name] = addBounded(
        responseCoverage.discoveredSources.byName[name] ?? 0,
        count,
        limit,
      );
    }
    addCounts(responseCoverage.skipped, report.coverage.firstPartyJsonResponses.skipped, limit);
    if (report.coverage.playwright !== undefined) {
      sawPlaywrightCoverage = true;
      addCounts(playwrightCoverage.tests, report.coverage.playwright.tests, limit);
      playwrightCoverage.applicationContexts = addBounded(
        playwrightCoverage.applicationContexts,
        report.coverage.playwright.applicationContexts,
        limit,
      );
      playwrightCoverage.pages = addBounded(
        playwrightCoverage.pages,
        report.coverage.playwright.pages,
        limit,
      );
    } else {
      playwrightCoverage.tests.unavailable = addBounded(
        playwrightCoverage.tests.unavailable,
        report.run.tests.observed,
        limit,
      );
    }
    if (report.coverage.network !== undefined) {
      sawNetworkCoverage = true;
      addCounts(networkCoverage.requests, report.coverage.network.requests, limit);
    }
    if (part.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION) {
      addCounts(browserEngineCoverage.tests, part.report.coverage.browserEngines.tests, limit);
      for (const engine of ["chromium", "firefox", "webkit"] as const) {
        const target = browserEngineCoverage.engines[engine];
        const incoming = part.report.coverage.browserEngines.engines[engine];
        const hadTests = target.tests > 0;
        target.tests = addBounded(target.tests, incoming.tests, limit);
        if (incoming.tests > 0) {
          if (!hadTests || supportRank[incoming.support] > supportRank[target.support]) {
            target.support = incoming.support;
          }
          for (const capability of Object.keys(target.capabilities) as Array<
            keyof typeof target.capabilities
          >) {
            const incomingState = incoming.capabilities[capability];
            if (
              !hadTests ||
              capabilityRank[incomingState] > capabilityRank[target.capabilities[capability]]
            ) {
              target.capabilities[capability] = incomingState;
            }
          }
        }
      }
      addCounts(apiRequestCoverage.tests, part.report.coverage.apiRequests.tests, limit);
      addCounts(apiRequestCoverage.calls, part.report.coverage.apiRequests.calls, limit);
      addCounts(apiRequestCoverage.skipped, part.report.coverage.apiRequests.skipped, limit);
    } else {
      browserEngineCoverage.tests.unavailable = addBounded(
        browserEngineCoverage.tests.unavailable,
        report.run.tests.observed,
        limit,
      );
      apiRequestCoverage.tests.unavailable = addBounded(
        apiRequestCoverage.tests.unavailable,
        report.run.tests.observed,
        limit,
      );
    }
    if (mergeDependencyInventory(dependencyInventory, report.analysis.dependencies.inventory)) {
      limit.reached = true;
    }
    if (mergeSecurityInventory(securityInventory, report.analysis.security.inventory)) {
      limit.reached = true;
    }
    if (mergeRuntimeFailureInventory(runtimeInventory, report.analysis.runtimeErrors.inventory)) {
      limit.reached = true;
    }
  }

  responseCoverage.discoveredSources.total = Object.values(
    responseCoverage.discoveredSources.byName,
  ).reduce((total, count) => addBounded(total, count, limit), 0);

  const legacyCapabilitiesUnavailable = first.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION_V1;
  if (legacyCapabilitiesUnavailable) {
    observationCoverage.status = leastObservationCoverage(observationCoverage.status, "incomplete");
    observationDiagnostics.push({
      code: "COVERAGE_RESULT_UNAVAILABLE",
      message: "Legacy run parts do not contain browser-engine or API-request coverage.",
    });
  }

  if (!scopeComplete) {
    observationCoverage.status = leastObservationCoverage(observationCoverage.status, "incomplete");
    observationDiagnostics.push({
      code: "COVERAGE_TEST_SCOPE_INCOMPLETE",
      message: `Run scope is incomplete: received ${parts.length} of ${first.scope.total} expected parts.`,
    });
    topLevelDiagnostics.push({
      code: "PS_RUN_SCOPE_INCOMPLETE",
      message: `Run scope is incomplete: missing part coordinates ${missingParts.join(",")}.`,
    });
  }

  const flows = deduplicateBounded(allFlows, limit);
  const findings = deduplicateBounded(allFindings, limit);
  const testDataObservations = deduplicateBounded(allTestData, limit);
  if (tests.total === 0 || tests.observed === 0) {
    observationCoverage.status = leastObservationCoverage(observationCoverage.status, "incomplete");
    observationDiagnostics.push({
      code: "COVERAGE_TEST_SCOPE_INCOMPLETE",
      message: "The aggregate run scope did not contain an observed Playwright test.",
    });
  }
  observationCoverage.diagnostics = deduplicateBounded(
    observationDiagnostics,
    limit,
    MAX_AGGREGATE_DIAGNOSTICS,
  );

  if (limit.reached) {
    observationCoverage.status = leastObservationCoverage(observationCoverage.status, "partial");
    topLevelDiagnostics.push({
      code: "PS_AGGREGATE_LIMIT_REACHED",
      message:
        "A bounded run aggregation limit was reached; omitted observations make the result inconclusive.",
    });
  }

  const baselineClassifierConfiguration =
    baselines.privacy === undefined
      ? undefined
      : classifierConfigurationForBaseline(baselines.privacy);
  const classifierConfigurationCompatible =
    classifierConfiguration.mode !== "unavailable" &&
    baselineClassifierConfiguration?.mode !== "unavailable" &&
    (baselineClassifierConfiguration === undefined ||
      classifierConfigurationsEqual(classifierConfiguration, baselineClassifierConfiguration));
  if (!classifierConfigurationCompatible) {
    topLevelDiagnostics.push({
      code: "PS_CLASSIFIER_CONFIGURATION_INCOMPATIBLE",
      message:
        "Classifier configuration is unavailable or incompatible; privacy baseline comparison is inconclusive.",
    });
  }

  const canonicalDiagnostics = deduplicateBounded(
    topLevelDiagnostics,
    limit,
    MAX_AGGREGATE_DIAGNOSTICS,
  );
  const canonicalIntegrationErrors = deduplicateBounded(
    integrationErrors,
    limit,
    MAX_AGGREGATE_DIAGNOSTICS,
  );
  const dependency = sortedDependencyInventory(dependencyInventory);
  const security = sortedSecurityInventory(securityInventory);
  const runtimeErrors = sortedRuntimeFailureInventory(runtimeInventory);

  let dependencyCoverage = moduleCoverage<DependencyCoverageStatus | "unavailable">(
    parts,
    (part) => part.report.analysis.dependencies.coverage,
    leastCompleteDependencyCoverage,
    scopeComplete,
  );
  let securityCoverage = moduleCoverage<SecurityCoverageStatus | "unavailable">(
    parts,
    (part) => part.report.analysis.security.coverage,
    leastCompleteSecurityCoverage,
    scopeComplete,
  );
  let runtimeCoverage = moduleCoverage<RuntimeFailureCoverageStatus | "unavailable">(
    parts,
    (part) => part.report.analysis.runtimeErrors.coverage,
    leastCompleteRuntimeFailureCoverage,
    scopeComplete,
  );
  if (legacyCapabilitiesUnavailable) {
    if (dependencyCoverage !== "unavailable") {
      dependencyCoverage = leastCompleteDependencyCoverage(dependencyCoverage, "incomplete");
    }
    if (securityCoverage !== "unavailable") {
      securityCoverage = leastCompleteSecurityCoverage(securityCoverage, "incomplete");
    }
    if (runtimeCoverage !== "unavailable") {
      runtimeCoverage = leastCompleteRuntimeFailureCoverage(runtimeCoverage, "incomplete");
    }
  }
  const functionalStatus = playwrightStatus(parts);
  const hasTests = tests.total > 0 && tests.observed > 0;
  const noIntegrationErrors = canonicalIntegrationErrors.length === 0;
  const privacyObservationComplete =
    scopeComplete &&
    first.runPartSchemaVersion !== RUN_PART_SCHEMA_VERSION_V1 &&
    hasTests &&
    functionalStatus === "passed" &&
    parts.every((part) => part.completeness.privacy) &&
    observationCoverage.status === "complete" &&
    !limit.reached &&
    noIntegrationErrors;
  const privacyComplete = privacyObservationComplete && classifierConfigurationCompatible;
  const dependencyComplete =
    scopeComplete &&
    !legacyCapabilitiesUnavailable &&
    hasTests &&
    functionalStatus === "passed" &&
    parts.every((part) => part.completeness.dependencies) &&
    dependencyCoverage === "complete" &&
    !limit.reached &&
    noIntegrationErrors;
  const securityComplete =
    scopeComplete &&
    !legacyCapabilitiesUnavailable &&
    hasTests &&
    functionalStatus === "passed" &&
    parts.every((part) => part.completeness.security) &&
    securityCoverage === "complete" &&
    !limit.reached &&
    noIntegrationErrors;
  const runtimeComplete =
    scopeComplete &&
    !legacyCapabilitiesUnavailable &&
    hasTests &&
    functionalStatus === "passed" &&
    parts.every((part) => part.completeness.runtimeErrors) &&
    runtimeCoverage === "complete" &&
    !limit.reached &&
    noIntegrationErrors;

  const comparedPrivacy = compareBaseline(findings, baselines.privacy);
  const privacyComparison = privacyComplete
    ? comparedPrivacy
    : incompletePrivacyComparison(findings);
  const comparedDependencies = compareDependencyBaseline(dependency, baselines.dependencies);
  const dependencyComparison = dependencyComplete
    ? comparedDependencies
    : { ...comparedDependencies, known: [], new: [], resolved: [], findings: [] };
  const comparedSecurity = compareSecurityBaseline(security, baselines.security);
  const securityComparison = securityComplete
    ? comparedSecurity
    : {
        ...comparedSecurity,
        known: [],
        newTargets: [],
        changed: [],
        resolved: [],
        findings: [],
      };
  const comparedRuntime = compareRuntimeFailureBaseline(runtimeErrors, baselines.runtimeErrors);
  const runtimeComparison = runtimeComplete
    ? comparedRuntime
    : { ...comparedRuntime, known: [], new: [], resolved: [], findings: [] };

  const technicalPrivacyFailures = findings.filter(
    (finding) => finding.classification === "technical_failure",
  ).length;
  const privacyReviewChanges = privacyComparison.new.length;
  let privacySpecStatus: PrivacySpecRunStatus;
  if (
    technicalPrivacyFailures > 0 ||
    canonicalIntegrationErrors.length > 0 ||
    (first.scope.failOnNewReviewFindings && privacyReviewChanges > 0)
  ) {
    privacySpecStatus = "failed";
  } else if (!privacyComplete) {
    privacySpecStatus = "incomplete";
  } else if (privacyReviewChanges > 0) {
    privacySpecStatus = "review";
  } else {
    privacySpecStatus = "passed";
  }

  const generatedAt = parts
    .map((part) => part.report.generatedAt)
    .sort(compareCanonicalStrings)
    .at(-1) as string;
  const startedAt = parts
    .map((part) => part.report.run.startedAt)
    .sort(compareCanonicalStrings)[0] as string;
  const suiteDurationMilliseconds = Math.max(0, Date.parse(generatedAt) - Date.parse(startedAt));
  const dependencyReport: DependencyReport = {
    schemaVersion: DEPENDENCY_REPORT_SCHEMA_VERSION,
    generatedAt,
    complete: dependencyComplete,
    coverage: dependencyCoverage,
    inventory: dependency,
    findings: dependencyComparison.findings,
    baseline: {
      exists: baselines.dependencies !== undefined,
      known: dependencyComparison.known.length,
      new: dependencyComparison.new.length,
      resolved: dependencyComparison.resolved.length,
    },
    diagnostics: deduplicateBounded(dependencyDiagnostics, limit, MAX_AGGREGATE_DIAGNOSTICS),
  };
  const securityReport: SecurityReport = {
    schemaVersion: SECURITY_SCHEMA_VERSION,
    generatedAt,
    complete: securityComplete,
    coverage: securityCoverage,
    inventory: security,
    findings: securityComparison.findings,
    baseline: {
      exists: baselines.security !== undefined,
      known: securityComparison.known.length,
      changed: securityComparison.changed.length,
      newTargets: securityComparison.newTargets.length,
      resolved: securityComparison.resolved.length,
    },
    diagnostics: deduplicateBounded(securityDiagnostics, limit, MAX_AGGREGATE_DIAGNOSTICS),
  };
  const runtimeReport: RuntimeFailureReport = {
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    generatedAt,
    complete: runtimeComplete,
    coverage: runtimeCoverage,
    inventory: runtimeErrors,
    findings: runtimeComparison.findings,
    baseline: {
      exists: baselines.runtimeErrors !== undefined,
      known: runtimeComparison.known.length,
      new: runtimeComparison.new.length,
      resolved: runtimeComparison.resolved.length,
    },
    diagnostics: deduplicateBounded(runtimeDiagnostics, limit, MAX_AGGREGATE_DIAGNOSTICS),
  };
  const ruleMappings = Array.from(new Set(findings.map((finding) => finding.ruleId)))
    .sort(compareCanonicalStrings)
    .map((ruleId) => RULE_LEGAL_MAPPINGS[ruleId]);
  const profileMappings = first.scope.nis2EvidenceProfile
    ? [REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690]
    : [];
  const report = createPrivacySpecReport({
    generatedAt,
    startedAt,
    playwrightStatus: functionalStatus,
    privacyspecStatus: privacySpecStatus,
    complete: privacyComplete,
    projects: first.report.run.projects,
    tests,
    sourceCounts,
    sinkCounts,
    suiteDurationMilliseconds,
    cumulativeTestDurationMilliseconds,
    flows,
    findings,
    comparison: privacyComparison,
    baselineExists: baselines.privacy !== undefined,
    diagnostics: canonicalDiagnostics,
    integrationErrors: canonicalIntegrationErrors,
    ruleMappings,
    profileMappings,
    responseCoverage,
    playwrightCoverage: sawPlaywrightCoverage ? playwrightCoverage : undefined,
    networkCoverage: sawNetworkCoverage ? networkCoverage : undefined,
    observationCoverage,
    browserEngineCoverage,
    apiRequestCoverage,
    testDataObservations,
    secondaryAnalysis: {
      dependencies: dependencyReport,
      security: securityReport,
      runtimeErrors: runtimeReport,
    },
  });

  return {
    scope,
    report,
    latestRuns: {
      privacy: {
        complete:
          privacyObservationComplete &&
          classifierConfiguration.mode !== "unavailable" &&
          technicalPrivacyFailures === 0,
        classifierConfiguration,
        entries: comparedPrivacy.observed,
      },
      dependencies: { complete: dependencyComplete, entries: comparedDependencies.observed },
      security: { complete: securityComplete, entries: comparedSecurity.observed },
      runtimeErrors: { complete: runtimeComplete, entries: comparedRuntime.observed },
    },
  };
};
