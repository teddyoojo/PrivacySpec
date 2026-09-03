import { compareCanonicalStrings } from "../canonical-order.js";
import type { PrivacySpecJsonReportV5 } from "../report/model.js";
import {
  DOCTOR_SCHEMA_VERSION,
  type DoctorApiRequestStatus,
  type DoctorBrowserCoverageStatus,
  type DoctorSetupConfidence,
  type PrivacySpecDoctorReport,
} from "./model.js";

const browserCoverageStatus = (report: PrivacySpecJsonReportV5): DoctorBrowserCoverageStatus => {
  const { tests } = report.coverage.browserEngines;
  if (tests.unsupported > 0) return "unsupported";
  if (tests.unavailable > 0) return "unavailable";
  if (tests.experimental > 0) return "experimental";
  return tests.supported > 0 ? "supported" : "not-observed";
};

const apiRequestStatus = (report: PrivacySpecJsonReportV5): DoctorApiRequestStatus => {
  const { calls, tests } = report.coverage.apiRequests;
  if (tests.unsupported > 0) return "unsupported";
  if (tests.unavailable > 0) return "unavailable";
  if (calls.seen === 0) return "not-used";
  if (tests.partial > 0 || calls.observed < calls.seen) return "partial";
  return "observed";
};

const setupConfidence = (
  report: PrivacySpecJsonReportV5,
  browserStatus: DoctorBrowserCoverageStatus,
  requestStatus: DoctorApiRequestStatus,
  analyzerDiagnosticCount: number,
): DoctorSetupConfidence => {
  const observation = report.coverage.observation;
  if (
    report.run.tests.observed === 0 ||
    observation.contexts.instrumented === 0 ||
    observation.pages.instrumented === 0
  ) {
    return "not-established";
  }
  if (
    !report.run.complete ||
    observation.status !== "complete" ||
    report.analysis.status === "inconclusive" ||
    browserStatus !== "supported" ||
    ["partial", "unavailable", "unsupported"].includes(requestStatus) ||
    report.integrationErrors.length > 0 ||
    report.diagnostics.length > 0 ||
    analyzerDiagnosticCount > 0
  ) {
    return "limited";
  }
  return "ready";
};

const baselineState = (exists: boolean): "absent" | "present" => (exists ? "present" : "absent");

export const createPrivacySpecDoctorReport = (
  report: PrivacySpecJsonReportV5,
): PrivacySpecDoctorReport => {
  const browserStatus = browserCoverageStatus(report);
  const requestStatus = apiRequestStatus(report);
  const observation = report.coverage.observation;
  const browserEngines = report.coverage.browserEngines;
  const apiRequests = report.coverage.apiRequests;
  const analyzerDiagnosticCount =
    report.analysis.dependencies.diagnostics.length +
    report.analysis.security.diagnostics.length +
    report.analysis.runtimeErrors.diagnostics.length;
  const diagnosticCodes = Array.from(
    new Set(observation.diagnostics.map((diagnostic) => diagnostic.code)),
  ).sort(compareCanonicalStrings);

  return {
    doctorSchemaVersion: DOCTOR_SCHEMA_VERSION,
    setupConfidence: setupConfidence(report, browserStatus, requestStatus, analyzerDiagnosticCount),
    reporterArtifact: {
      readable: true,
      reportSchemaVersion: report.schemaVersion,
    },
    fixtureObservations: {
      status: report.run.tests.observed > 0 ? "present" : "absent",
      attempts: observation.tests.attempts,
      observed: observation.tests.observed,
    },
    runScope: {
      status: report.run.complete ? "complete" : "incomplete",
      playwrightStatus: report.run.playwrightStatus,
      tests: report.run.tests.total,
    },
    observation: {
      status: observation.status,
      contexts: {
        seen: observation.contexts.seen,
        instrumented: observation.contexts.instrumented,
      },
      pages: {
        seen: observation.pages.seen,
        instrumented: observation.pages.instrumented,
      },
    },
    browserCoverage: {
      status: browserStatus,
      tests: { ...browserEngines.tests },
      engines: {
        chromium: {
          tests: browserEngines.engines.chromium.tests,
          support: browserEngines.engines.chromium.support,
        },
        firefox: {
          tests: browserEngines.engines.firefox.tests,
          support: browserEngines.engines.firefox.support,
        },
        webkit: {
          tests: browserEngines.engines.webkit.tests,
          support: browserEngines.engines.webkit.support,
        },
      },
    },
    apiRequestFixture: {
      status: requestStatus,
      tests: { ...apiRequests.tests },
      calls: {
        seen: apiRequests.calls.seen,
        observed: apiRequests.calls.observed,
      },
    },
    baselines: {
      optionalForFirstValue: true,
      modules: {
        privacy: baselineState(report.baseline.exists),
        dependencies: baselineState(report.analysis.dependencies.baseline.exists),
        security: baselineState(report.analysis.security.baseline.exists),
        runtime: baselineState(report.analysis.runtimeErrors.baseline.exists),
      },
    },
    integrationErrors: {
      count: report.integrationErrors.length,
    },
    diagnostics: {
      coverageCodes: diagnosticCodes,
      reportCount: report.diagnostics.length,
      analyzerCount: analyzerDiagnosticCount,
    },
  };
};
