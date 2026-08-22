import { expect, test as playwrightTest } from "@playwright/test";
import { withPrivacySpec } from "./playwright/fixture.js";

export type { BaselineChangeReason } from "./baseline/compare.js";
export type {
  DataFlow,
  DataFlowSinkKind,
  DataFlowSourceKind,
  DataFlowTestMetadata,
  FirstPartyConfig,
  TransformKind,
} from "./correlate/model.js";
export type {
  ClassificationEvidence,
  ControlClassification,
  ControlClassificationInput,
  DataCategory,
  ResponseSensitiveSourceObservation,
  ResponseSourceProvenance,
  SensitiveSourceObservation,
  SourceConfidence,
} from "./discovery/source-model.js";
export { createPrivacySpecEvidence } from "./evidence/create.js";
export {
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceBuildIdentifiers,
  type EvidenceCategoryObservation,
  type EvidenceExternalRecipientObservation,
  type EvidenceFormat,
  type EvidenceRegulatoryRelevance,
  type EvidenceReportLevelRegulatoryRelevance,
  type EvidenceRuleObservation,
  type EvidenceSourceRunState,
  type EvidenceTechnicalRelevance,
  type PrivacySpecEvidence,
} from "./evidence/model.js";
export { renderPrivacySpecEvidence } from "./evidence/render.js";
export { createPrivacyInventory } from "./inventory/create.js";
export {
  INVENTORY_SCHEMA_VERSION,
  type InventoryBoundary,
  type InventoryEntry,
  type InventoryFormat,
  type InventoryState,
  type PrivacyInventory,
} from "./inventory/model.js";
export { renderPrivacyInventory } from "./inventory/render.js";
export type { PrivacySpecObservation } from "./observation-model.js";
export type {
  ConsoleSinkObservation,
  NetworkSinkObservation,
  SinkObservation,
  StorageSinkObservation,
} from "./observe/sink-model.js";
export type { PlaywrightObservationCounters } from "./playwright/coverage.js";
export { type PrivacySpecOptions, withPrivacySpec } from "./playwright/fixture.js";
export {
  ATTACHMENT_SCHEMA_VERSION,
  ATTACHMENT_SCHEMA_VERSION_V2,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
  type PrivacySpecResult,
  type PrivacySpecResultV1,
  type PrivacySpecResultV2,
  type PrivacySpecResultV3,
} from "./playwright/result.js";
export {
  DEFAULT_REPORT_PATH,
  type DependencyAnalysisReport,
  type FindingBaselineState,
  type FirstPartyJsonResponseReportCoverage,
  type ObservationCoverageDiagnostic,
  type ObservationCoverageReport,
  type ObservationCoverageStatus,
  PRIVACYSPEC_TOOL_VERSION,
  type PrivacyAnalysisReport,
  type PrivacySpecJsonReport,
  type PrivacySpecJsonReportV1,
  type PrivacySpecJsonReportV2,
  type PrivacySpecJsonReportV3,
  type PrivacySpecJsonReportV4,
  type PrivacySpecRunStatus,
  REPORT_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION_V1,
  REPORT_SCHEMA_VERSION_V2,
  REPORT_SCHEMA_VERSION_V3,
  type RuntimeErrorAnalysisReport,
  type SecondaryAnalysisReport,
  type SecondaryAnalysisStatus,
  type SecurityAnalysisReport,
} from "./report/model.js";
export {
  parsePrivacySpecReport,
  parsePrivacySpecReportV1,
  parsePrivacySpecReportV2,
  parsePrivacySpecReportV3,
  parsePrivacySpecReportV4,
  ReportFormatError,
  readPrivacySpecReport,
} from "./report/read.js";
export { renderSecondaryCoverageSummary } from "./report/terminal.js";
export { RULE_DEFINITIONS, type RuleDefinition } from "./rules/definitions.js";
export { evaluateDataFlows } from "./rules/engine.js";
export {
  getRuleLegalMapping,
  type MappingRelationship,
  REPORT_LEVEL_LEGAL_MAPPINGS,
  type RegulatoryMapping,
  type ReportLevelLegalMapping,
  type ReportLevelMappings,
  RULE_LEGAL_MAPPINGS,
  type RuleLegalMapping,
  type TechnicalControlMapping,
} from "./rules/legal-map.js";
export type {
  Finding,
  FindingClassification,
  FindingSeverity,
  RuleEvaluationConfig,
  RuleId,
} from "./rules/model.js";
export { createTestDataReport } from "./testdata/create.js";
export {
  type PrivacySpecTestDataReport,
  type PrivacySpecTestDataSection,
  TEST_DATA_SCHEMA_VERSION,
  type TestDataAttribution,
  type TestDataControlAttribution,
  type TestDataFormat,
  type TestDataObservation,
  type TestDataSignal,
  type TestDataSummary,
  type TestDataVerdict,
} from "./testdata/model.js";
export { renderPrivacySpecTestData } from "./testdata/render.js";
export {
  PLAYWRIGHT_AUTH_STATE_GUIDANCE_URL,
  type PrivacySpecStorageStateScan,
  STORAGE_STATE_SCAN_SCHEMA_VERSION,
  type StorageStateCredentialEvidence,
  type StorageStateFileObservation,
  type StorageStateFindingStatus,
  type StorageStatePersonalDataShapes,
  type StorageStateRepositoryStatus,
  type StorageStateScanFormat,
  type StorageStateScanSummary,
  type StorageStateStructure,
} from "./testdata/storage-state-model.js";
export { renderStorageStateScan } from "./testdata/storage-state-render.js";
export { scanStorageStateFiles } from "./testdata/storage-state-scan.js";

export const test = withPrivacySpec(playwrightTest);
export { expect };
