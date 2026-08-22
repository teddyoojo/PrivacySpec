import type { AnalyzerCapabilityCoverage } from "../../runtime/capabilities.js";

export const DEPENDENCY_ANALYZER_ID = "dependency" as const;
export const DEPENDENCY_ATTACHMENT_SCHEMA_VERSION = 1 as const;
export const DEPENDENCY_BASELINE_SCHEMA_VERSION = 1 as const;
export const DEPENDENCY_LATEST_RUN_SCHEMA_VERSION = 1 as const;
export const DEPENDENCY_REPORT_SCHEMA_VERSION = 1 as const;

export const DEFAULT_DEPENDENCY_BASELINE_PATH = "privacyspec-dependencies-baseline.json";
export const DEFAULT_DEPENDENCY_LATEST_RUN_PATH = ".privacyspec/latest-dependencies.json";
export const DEFAULT_DEPENDENCY_REPORT_PATH = ".privacyspec/dependencies-report.json";

export type DependencyBoundary = "first-party" | "external";
export type DependencyResourceType =
  | "script"
  | "stylesheet"
  | "font"
  | "image"
  | "fetch/xhr"
  | "iframe"
  | "websocket"
  | "other";
export type DependencySemanticCategory = "origin" | DependencyResourceType;

export type DependencyRuleId =
  | "NEW_EXTERNAL_ORIGIN"
  | "NEW_EXTERNAL_SCRIPT"
  | "NEW_EXTERNAL_IFRAME"
  | "NEW_EXTERNAL_API";

export interface DependencyTestReference {
  file: string;
  project: string;
}

export interface RuntimeDependencyInventoryEntry {
  kind: "runtime-dependency";
  origin: string;
  host: string;
  boundary: DependencyBoundary;
  resourceTypes: DependencyResourceType[];
  requestMethods: string[];
  firstSeenTests: DependencyTestReference[];
  occurrenceCount: number;
}

export interface DependencySemanticCandidate {
  key: string;
  boundary: "external";
  category: DependencySemanticCategory;
  host: string;
}

export interface AcceptedDependencySemantic extends DependencySemanticCandidate {
  status: "accepted";
}

export interface DependencyFinding {
  kind: "dependency-finding";
  ruleId: DependencyRuleId;
  classification: "REVIEW_REQUIRED";
  identity: string;
  host: string;
  origin: string;
  observedAs: DependencySemanticCategory;
  firstSeenTest: DependencyTestReference;
}

export type DependencyCoverageStatus = AnalyzerCapabilityCoverage["status"];

export type DependencyDiagnosticCode =
  | "DEPENDENCY_ANALYZER_FAILED"
  | "DEPENDENCY_ANALYSIS_INCOMPLETE"
  | "DEPENDENCY_LIMIT_REACHED";

export interface DependencyDiagnostic {
  code: DependencyDiagnosticCode;
  message: string;
}

export interface DependencyAnalyzerTestResult {
  analyzerId: typeof DEPENDENCY_ANALYZER_ID;
  coverage: DependencyCoverageStatus;
  inventory: RuntimeDependencyInventoryEntry[];
  diagnostics: DependencyDiagnostic[];
}

export interface DependencyAttachment extends DependencyAnalyzerTestResult {
  schemaVersion: typeof DEPENDENCY_ATTACHMENT_SCHEMA_VERSION;
}

export interface DependencyBaselineFile {
  schemaVersion: typeof DEPENDENCY_BASELINE_SCHEMA_VERSION;
  createdAt: string;
  dependencies: AcceptedDependencySemantic[];
}

export interface DependencyLatestRunFile {
  schemaVersion: typeof DEPENDENCY_LATEST_RUN_SCHEMA_VERSION;
  createdAt: string;
  complete: boolean;
  dependencies: DependencySemanticCandidate[];
}

export interface DependencyBaselineComparison {
  observed: DependencySemanticCandidate[];
  known: DependencySemanticCandidate[];
  new: DependencySemanticCandidate[];
  resolved: AcceptedDependencySemantic[];
  findings: DependencyFinding[];
}

export interface DependencyReport {
  schemaVersion: typeof DEPENDENCY_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  complete: boolean;
  coverage: DependencyCoverageStatus | "unavailable";
  inventory: RuntimeDependencyInventoryEntry[];
  findings: DependencyFinding[];
  baseline: {
    exists: boolean;
    known: number;
    new: number;
    resolved: number;
  };
  diagnostics: DependencyDiagnostic[];
}
