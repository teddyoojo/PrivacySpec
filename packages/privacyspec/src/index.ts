import { expect, test as playwrightTest } from "@playwright/test";
import { withPrivacySpec } from "./playwright/fixture.js";

export type { BaselineChangeReason } from "./baseline/compare.js";
export {
  applyBaselineProposal,
  BaselineProposalEligibilityError,
  BaselineProposalFormatError,
  BaselineProposalSelectionError,
  BaselineProposalStaleError,
  createBaselineProposal,
  parseBaselineProposal,
  readBaselineProposalFile,
  writeBaselineProposalFile,
} from "./baseline/proposal.js";
export {
  BASELINE_PROPOSAL_SCHEMA_VERSION,
  type BaselineProposal,
  type BaselineProposalAction,
  type BaselineProposalApplication,
  type BaselineProposalCounts,
  type BaselineProposalDigest,
  type BaselineProposalEntry,
  type BaselineProposalId,
  type BaselineProposalModule,
  type BaselineProposalSelectionCounts,
  type BaselineProposalSnapshot,
  type BaselineProposalSource,
  DEFAULT_BASELINE_PROPOSAL_PATH,
  MAX_BASELINE_PROPOSAL_BYTES,
  MAX_BASELINE_PROPOSAL_ENTRIES,
  MAX_BASELINE_PROPOSAL_SELECTIONS,
} from "./baseline/proposal-model.js";
export type {
  DataFlow,
  DataFlowSinkKind,
  DataFlowSourceKind,
  DataFlowTestMetadata,
  FirstPartyConfig,
  TransformKind,
} from "./correlate/model.js";
export {
  BUILTIN_ONLY_CLASSIFIER_CONFIGURATION,
  type BuiltInClassifierConfiguration,
  type ClassifierConfiguration,
  type ClassifierConfigurationState,
  type CustomClassifierConfiguration,
  classifierConfigurationsEqual,
  isCustomClassifierConfigurationId,
  MAX_CUSTOM_CLASSIFIER_CONFIGURATION_ID_LENGTH,
  normalizeClassifierConfiguration,
  parseClassifierConfiguration,
  parseClassifierConfigurationState,
  UNAVAILABLE_CLASSIFIER_CONFIGURATION,
  type UnavailableClassifierConfiguration,
} from "./discovery/classifier-configuration.js";
export type {
  CustomDataCategoryDescriptor,
  CustomDomSourceClassifier,
  ExactAccessibleSignal,
  ExactControlSignal,
  ExactMachineSignal,
  HighConfidenceCustomDomSourceClassifier,
  MediumConfidenceCustomDomSourceClassifier,
  NormalizedCustomDomSourceClassifier,
} from "./discovery/custom-classifiers.js";
export {
  MAX_CUSTOM_CLASSIFIER_ALTERNATIVES,
  MAX_CUSTOM_CLASSIFIER_METADATA_LENGTH,
  MAX_CUSTOM_CLASSIFIER_TOTAL_ALTERNATIVES,
  MAX_CUSTOM_SOURCE_CLASSIFIERS,
  normalizeCustomDomSourceClassifiers,
} from "./discovery/custom-classifiers.js";
export type {
  BuiltInDataCategory,
  ClassificationEvidence,
  ControlClassification,
  ControlClassificationInput,
  CustomDataCategory,
  DataCategory,
  DataCategoryFamily,
  ResponseSensitiveSourceObservation,
  ResponseSourceProvenance,
  SensitiveSourceObservation,
  SourceConfidence,
} from "./discovery/source-model.js";
export { getDataCategoryFamily, isDataCategory } from "./discovery/source-model.js";
export { createPrivacySpecEvidence } from "./evidence/create.js";
export {
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SCHEMA_VERSION_V1,
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
  type PrivacySpecEvidenceV1,
  type ReadablePrivacySpecEvidence,
} from "./evidence/model.js";
export {
  EvidenceFormatError,
  parsePrivacySpecEvidence,
  readPrivacySpecEvidenceFile,
} from "./evidence/read.js";
export { renderPrivacySpecEvidence } from "./evidence/render.js";
export { createPrivacyInventory } from "./inventory/create.js";
export {
  INVENTORY_SCHEMA_VERSION,
  INVENTORY_SCHEMA_VERSION_V1,
  type InventoryBoundary,
  type InventoryEntry,
  type InventoryEntryV1,
  type InventoryFormat,
  type InventoryState,
  type PrivacyInventory,
  type PrivacyInventoryV1,
  type ReadablePrivacyInventory,
} from "./inventory/model.js";
export {
  InventoryFormatError,
  parsePrivacyInventory,
  readPrivacyInventoryFile,
} from "./inventory/read.js";
export { renderPrivacyInventory } from "./inventory/render.js";
export type { PrivacySpecObservation } from "./observation-model.js";
export type {
  ConsoleSinkObservation,
  NetworkSinkObservation,
  RequestSurface,
  SinkObservation,
  StorageSinkObservation,
} from "./observe/sink-model.js";
export type { PlaywrightObservationCounters } from "./playwright/coverage.js";
export type {
  APIRequestCoverage,
  BrowserEngineCapability,
  BrowserEngineCoverage,
  ExperimentalBrowserEngine,
  PrivacySpecBrowserEngine,
  PrivacySpecExperimentalOptions,
} from "./playwright/experimental-coverage.js";
export { type PrivacySpecOptions, withPrivacySpec } from "./playwright/fixture.js";
export {
  ATTACHMENT_SCHEMA_VERSION,
  ATTACHMENT_SCHEMA_VERSION_V2,
  ATTACHMENT_SCHEMA_VERSION_V3,
  ATTACHMENT_SCHEMA_VERSION_V4,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
  type PrivacySpecResult,
  type PrivacySpecResultV1,
  type PrivacySpecResultV2,
  type PrivacySpecResultV3,
  type PrivacySpecResultV4,
  type PrivacySpecResultV5,
  parsePrivacySpecResult,
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
  type PrivacySpecJsonReportV5,
  type PrivacySpecRunStatus,
  REPORT_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION_V1,
  REPORT_SCHEMA_VERSION_V2,
  REPORT_SCHEMA_VERSION_V3,
  REPORT_SCHEMA_VERSION_V4,
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
  parsePrivacySpecReportV5,
  ReportFormatError,
  readPrivacySpecReport,
} from "./report/read.js";
export {
  renderSecondaryCoverageMarkdown,
  renderSecondaryCoverageSummary,
  type SecondaryCoverageSummaryFormat,
} from "./report/terminal.js";
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
export {
  aggregatePrivacySpecRunParts,
  type PrivacySpecAggregationBaselines,
  type PrivacySpecAggregationResult,
  RunAggregationError,
} from "./run-scope/aggregate.js";
export {
  parsePrivacySpecRunPart,
  RunPartFormatError,
  readPrivacySpecRunPart,
} from "./run-scope/artifact.js";
export {
  DEFAULT_RUN_PARTS_DIRECTORY,
  MAX_RUN_PARTS,
  type PrivacySpecAggregateScope,
  type PrivacySpecRunPart,
  type PrivacySpecRunPartCompleteness,
  type PrivacySpecRunPartV1,
  type PrivacySpecRunPartV2,
  type PrivacySpecRunPartV3,
  type PrivacySpecRunScopeOptions,
  RUN_PART_SCHEMA_VERSION,
  RUN_PART_SCHEMA_VERSION_V1,
  RUN_PART_SCHEMA_VERSION_V2,
} from "./run-scope/model.js";
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
