import type { BaselineComparison } from "../baseline/compare.js";
import type { DataFlow } from "../correlate/model.js";
import type { ReportLevelLegalMapping, RuleLegalMapping } from "../rules/legal-map.js";
import type { Finding } from "../rules/model.js";

export const REPORT_SCHEMA_VERSION = 1 as const;
export const PRIVACYSPEC_TOOL_VERSION = "0.1.0-beta.1" as const;
export const DEFAULT_REPORT_PATH = "privacyspec-report.json";

export type PrivacySpecRunStatus = "passed" | "review" | "failed" | "incomplete";
export type PlaywrightRunStatus = "passed" | "failed" | "timedout" | "interrupted";
export type TestAttemptStatus = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
export type FindingBaselineState = "known" | "new" | "not_baseline_eligible";

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

export interface PrivacySpecJsonReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: {
    name: "privacyspec";
    version: typeof PRIVACYSPEC_TOOL_VERSION;
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
  flows: DataFlow[];
  findings: ReportFinding[];
  baseline: {
    exists: boolean;
    known: BaselineComparison["known"];
    new: BaselineComparison["new"];
    resolved: BaselineComparison["resolved"];
  };
  diagnostics: Array<{ code: string; message: string }>;
  integrationErrors: string[];
  legalMappings: {
    rules: RuleLegalMapping[];
    profiles: ReportLevelLegalMapping[];
  };
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
): PrivacySpecJsonReport => {
  const findings = reportFindings(input.findings, input.comparison);
  const technicalFailures = input.findings.filter(
    (finding) => finding.classification === "technical_failure",
  ).length;
  const reviewRequired = input.findings.filter(
    (finding) => finding.classification === "review_required",
  ).length;
  const newReviewRequired = input.comparison.new.reduce(
    (count, observed) => count + observed.findings.length,
    0,
  );
  const knownReviewRequired = input.comparison.known.reduce(
    (count, observed) => count + observed.findings.length,
    0,
  );

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
    summary: {
      sensitiveSources: countSummary(input.sourceCounts),
      sinks: countSummary(input.sinkCounts),
      dataFlows: input.flows.length,
      findings: {
        total: input.findings.length,
        technicalFailures,
        reviewRequired,
        newReviewRequired,
        knownReviewRequired,
      },
      baseline: {
        known: input.comparison.known.length,
        new: input.comparison.new.length,
        resolved: input.comparison.resolved.length,
      },
    },
    performance: {
      suiteDurationMilliseconds: input.suiteDurationMilliseconds,
      cumulativeTestDurationMilliseconds: input.cumulativeTestDurationMilliseconds,
    },
    flows: [...input.flows],
    findings,
    baseline: {
      exists: input.baselineExists,
      known: input.comparison.known,
      new: input.comparison.new,
      resolved: input.comparison.resolved,
    },
    diagnostics: [...input.diagnostics],
    integrationErrors: [...input.integrationErrors],
    legalMappings: {
      rules: [...input.ruleMappings],
      profiles: [...input.profileMappings],
    },
  };
};
