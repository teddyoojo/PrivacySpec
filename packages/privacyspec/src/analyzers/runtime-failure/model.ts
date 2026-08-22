import type { AnalyzerCapabilityCoverage } from "../../runtime/capabilities.js";

export const RUNTIME_FAILURE_ANALYZER_ID = "runtime-failure" as const;
export const RUNTIME_FAILURE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_RUNTIME_FAILURE_BASELINE_PATH = "privacyspec-runtime-failures-baseline.json";
export const DEFAULT_RUNTIME_FAILURE_LATEST_RUN_PATH = ".privacyspec/latest-runtime-failures.json";
export const DEFAULT_RUNTIME_FAILURE_REPORT_PATH = ".privacyspec/runtime-failures-report.json";

export type RuntimeFailureType = "page-error" | "console-error" | "request-failed" | "http-5xx";
export type RuntimeFailureSeverity = "ERROR" | "REVIEW";
export type RuntimeFailureBoundary = "first-party" | "external";

export interface RuntimeFailureTestReference {
  file: string;
  project: string;
}

export interface RuntimeFailureDetails {
  boundary: RuntimeFailureBoundary | null;
  host: string | null;
  method: string | null;
  endpoint: string | null;
  httpStatus: number | null;
  errorName: string | null;
  signature: string | null;
  failureCode: string | null;
}

export interface RuntimeFailureInventoryEntry extends RuntimeFailureDetails {
  kind: "runtime-failure";
  key: string;
  failureType: RuntimeFailureType;
  severity: RuntimeFailureSeverity;
  summary: string;
  firstSeenTests: RuntimeFailureTestReference[];
  occurrenceCount: number;
}

export interface RuntimeFailureBaselineEntry extends RuntimeFailureDetails {
  key: string;
  failureType: RuntimeFailureType;
  severity: RuntimeFailureSeverity;
  summary: string;
  status: "accepted";
}

export interface RuntimeFailureFinding extends RuntimeFailureDetails {
  kind: "runtime-failure-finding";
  ruleId:
    | "RUNTIME_PAGE_ERROR"
    | "RUNTIME_CONSOLE_ERROR"
    | "RUNTIME_REQUEST_FAILED"
    | "RUNTIME_HTTP_5XX";
  classification: "TECHNICAL_FAILURE" | "REVIEW_REQUIRED";
  identity: string;
  failureType: RuntimeFailureType;
  severity: RuntimeFailureSeverity;
  summary: string;
  firstSeenTest: RuntimeFailureTestReference;
  occurrenceCount: number;
}

export type RuntimeFailureCoverageStatus = AnalyzerCapabilityCoverage["status"];
export type RuntimeFailureDiagnosticCode =
  | "RUNTIME_FAILURE_ANALYZER_FAILED"
  | "RUNTIME_FAILURE_ANALYSIS_INCOMPLETE"
  | "RUNTIME_FAILURE_LIMIT_REACHED";

export interface RuntimeFailureDiagnostic {
  code: RuntimeFailureDiagnosticCode;
  message: string;
}

export interface RuntimeFailureAnalyzerTestResult {
  analyzerId: typeof RUNTIME_FAILURE_ANALYZER_ID;
  coverage: RuntimeFailureCoverageStatus;
  inventory: RuntimeFailureInventoryEntry[];
  diagnostics: RuntimeFailureDiagnostic[];
}

export interface RuntimeFailureAttachment extends RuntimeFailureAnalyzerTestResult {
  schemaVersion: typeof RUNTIME_FAILURE_SCHEMA_VERSION;
}

export interface RuntimeFailureBaselineFile {
  schemaVersion: typeof RUNTIME_FAILURE_SCHEMA_VERSION;
  createdAt: string;
  entries: RuntimeFailureBaselineEntry[];
}

export interface RuntimeFailureLatestRunFile {
  schemaVersion: typeof RUNTIME_FAILURE_SCHEMA_VERSION;
  createdAt: string;
  complete: boolean;
  entries: RuntimeFailureBaselineEntry[];
}

export interface RuntimeFailureBaselineComparison {
  observed: RuntimeFailureBaselineEntry[];
  known: RuntimeFailureBaselineEntry[];
  new: RuntimeFailureBaselineEntry[];
  resolved: RuntimeFailureBaselineEntry[];
  findings: RuntimeFailureFinding[];
}

export interface RuntimeFailureReport {
  schemaVersion: typeof RUNTIME_FAILURE_SCHEMA_VERSION;
  generatedAt: string;
  complete: boolean;
  coverage: RuntimeFailureCoverageStatus | "unavailable";
  inventory: RuntimeFailureInventoryEntry[];
  findings: RuntimeFailureFinding[];
  baseline: {
    exists: boolean;
    known: number;
    new: number;
    resolved: number;
  };
  diagnostics: RuntimeFailureDiagnostic[];
}
