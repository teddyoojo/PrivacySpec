import type { PrivacySpecJsonReportV5 } from "../report/model.js";

export const DOCTOR_SCHEMA_VERSION = 1 as const;
export const MAX_DOCTOR_TERMINAL_DIAGNOSTICS = 5;

export type DoctorFormat = "json" | "terminal";
export type DoctorSetupConfidence = "limited" | "not-established" | "ready";
export type DoctorBrowserCoverageStatus =
  | "experimental"
  | "not-observed"
  | "supported"
  | "unavailable"
  | "unsupported";
export type DoctorApiRequestStatus =
  | "not-used"
  | "observed"
  | "partial"
  | "unavailable"
  | "unsupported";

export type DoctorCoverageDiagnosticCode =
  PrivacySpecJsonReportV5["coverage"]["observation"]["diagnostics"][number]["code"];

export interface PrivacySpecDoctorReport {
  doctorSchemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  setupConfidence: DoctorSetupConfidence;
  reporterArtifact: {
    readable: true;
    reportSchemaVersion: 5;
  };
  fixtureObservations: {
    status: "absent" | "present";
    attempts: number;
    observed: number;
  };
  runScope: {
    status: "complete" | "incomplete";
    playwrightStatus: PrivacySpecJsonReportV5["run"]["playwrightStatus"];
    tests: number;
  };
  observation: {
    status: PrivacySpecJsonReportV5["coverage"]["observation"]["status"];
    contexts: {
      seen: number;
      instrumented: number;
    };
    pages: {
      seen: number;
      instrumented: number;
    };
  };
  browserCoverage: {
    status: DoctorBrowserCoverageStatus;
    tests: PrivacySpecJsonReportV5["coverage"]["browserEngines"]["tests"];
    engines: {
      chromium: {
        tests: number;
        support: "experimental" | "supported" | "unsupported";
      };
      firefox: {
        tests: number;
        support: "experimental" | "supported" | "unsupported";
      };
      webkit: {
        tests: number;
        support: "experimental" | "supported" | "unsupported";
      };
    };
  };
  apiRequestFixture: {
    status: DoctorApiRequestStatus;
    tests: {
      enabled: number;
      disabled: number;
      unavailable: number;
      complete: number;
      partial: number;
      unsupported: number;
    };
    calls: {
      seen: number;
      observed: number;
    };
  };
  baselines: {
    optionalForFirstValue: true;
    modules: {
      privacy: "absent" | "present";
      dependencies: "absent" | "present";
      security: "absent" | "present";
      runtime: "absent" | "present";
    };
  };
  integrationErrors: {
    count: number;
  };
  diagnostics: {
    coverageCodes: DoctorCoverageDiagnosticCode[];
    reportCount: number;
    analyzerCount: number;
  };
}
