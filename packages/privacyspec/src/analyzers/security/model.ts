import type { AnalyzerCapabilityCoverage } from "../../runtime/capabilities.js";

export const SECURITY_ANALYZER_ID = "security" as const;
export const SECURITY_SCHEMA_VERSION = 1 as const;

export const DEFAULT_SECURITY_BASELINE_PATH = "privacyspec-security-baseline.json";
export const DEFAULT_SECURITY_LATEST_RUN_PATH = ".privacyspec/latest-security.json";
export const DEFAULT_SECURITY_REPORT_PATH = ".privacyspec/security-report.json";

export type SecurityResponseKind = "document" | "api" | "authentication";
export type SecurityProperty =
  | "csp"
  | "hsts"
  | "x-content-type-options"
  | "cors"
  | "cookie"
  | "transport";
export type SecurityRuleId =
  | "SECURITY_CSP_CHANGED"
  | "SECURITY_HSTS_CHANGED"
  | "SECURITY_XCTO_CHANGED"
  | "SECURITY_CORS_CHANGED"
  | "SECURITY_COOKIE_CHANGED"
  | "SECURITY_TRANSPORT_CHANGED";

export interface SecurityTestReference {
  file: string;
  project: string;
}

export interface SecurityCookieFingerprint {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none" | "unspecified";
}

export interface SecurityFingerprint {
  transport: "secure" | "insecure";
  csp: string;
  hsts: string;
  xContentTypeOptions: string;
  cors: string;
  cookies: SecurityCookieFingerprint[];
}

export interface SecurityPostureInventoryEntry {
  kind: "security-posture";
  key: string;
  host: string;
  endpoint: string;
  responseKind: SecurityResponseKind;
  method: string;
  fingerprints: SecurityFingerprint[];
  firstSeenTests: SecurityTestReference[];
  occurrenceCount: number;
}

export interface SecurityBaselineEntry
  extends Omit<SecurityPostureInventoryEntry, "kind" | "firstSeenTests" | "occurrenceCount"> {
  status: "accepted";
}

export interface SecurityFinding {
  kind: "security-posture-finding";
  ruleId: SecurityRuleId;
  classification: "REVIEW_REQUIRED";
  identity: string;
  host: string;
  endpoint: string;
  property: SecurityProperty;
  previous: string;
  current: string;
  firstSeenTest: SecurityTestReference;
}

export type SecurityCoverageStatus = AnalyzerCapabilityCoverage["status"];
export type SecurityDiagnosticCode =
  | "SECURITY_ANALYZER_FAILED"
  | "SECURITY_ANALYSIS_INCOMPLETE"
  | "SECURITY_LIMIT_REACHED";

export interface SecurityDiagnostic {
  code: SecurityDiagnosticCode;
  message: string;
}

export interface SecurityAnalyzerTestResult {
  analyzerId: typeof SECURITY_ANALYZER_ID;
  coverage: SecurityCoverageStatus;
  inventory: SecurityPostureInventoryEntry[];
  diagnostics: SecurityDiagnostic[];
}

export interface SecurityAttachment extends SecurityAnalyzerTestResult {
  schemaVersion: typeof SECURITY_SCHEMA_VERSION;
}

export interface SecurityBaselineFile {
  schemaVersion: typeof SECURITY_SCHEMA_VERSION;
  createdAt: string;
  entries: SecurityBaselineEntry[];
}

export interface SecurityLatestRunFile {
  schemaVersion: typeof SECURITY_SCHEMA_VERSION;
  createdAt: string;
  complete: boolean;
  entries: SecurityBaselineEntry[];
}

export interface SecurityBaselineComparison {
  observed: SecurityBaselineEntry[];
  known: SecurityBaselineEntry[];
  newTargets: SecurityBaselineEntry[];
  changed: SecurityBaselineEntry[];
  resolved: SecurityBaselineEntry[];
  findings: SecurityFinding[];
}

export interface SecurityReport {
  schemaVersion: typeof SECURITY_SCHEMA_VERSION;
  generatedAt: string;
  complete: boolean;
  coverage: SecurityCoverageStatus | "unavailable";
  inventory: SecurityPostureInventoryEntry[];
  findings: SecurityFinding[];
  baseline: {
    exists: boolean;
    known: number;
    changed: number;
    newTargets: number;
    resolved: number;
  };
  diagnostics: SecurityDiagnostic[];
}
