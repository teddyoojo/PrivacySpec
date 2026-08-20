import { expect, test as playwrightTest } from "@playwright/test";
import { withPrivacySpec } from "./playwright/fixture.js";

export type {
  DataFlow,
  DataFlowSinkKind,
  DataFlowTestMetadata,
  FirstPartyConfig,
  TransformKind,
} from "./correlate/model.js";
export type {
  ClassificationEvidence,
  ControlClassification,
  ControlClassificationInput,
  DataCategory,
  SensitiveSourceObservation,
  SourceConfidence,
} from "./discovery/source-model.js";
export type { PrivacySpecObservation } from "./observation-model.js";
export type {
  ConsoleSinkObservation,
  NetworkSinkObservation,
  SinkObservation,
  StorageSinkObservation,
} from "./observe/sink-model.js";
export { type PrivacySpecOptions, withPrivacySpec } from "./playwright/fixture.js";
export {
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
  type PrivacySpecResult,
} from "./playwright/result.js";
export {
  DEFAULT_REPORT_PATH,
  type FindingBaselineState,
  PRIVACYSPEC_TOOL_VERSION,
  type PrivacySpecJsonReport,
  type PrivacySpecRunStatus,
  REPORT_SCHEMA_VERSION,
} from "./report/model.js";
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

export const test = withPrivacySpec(playwrightTest);
export { expect };
