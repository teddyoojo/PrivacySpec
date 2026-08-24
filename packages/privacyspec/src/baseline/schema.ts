import type { DataFlowSinkKind, TransformKind } from "../correlate/model.js";
import type {
  ClassifierConfiguration,
  ClassifierConfigurationState,
} from "../discovery/classifier-configuration.js";
import type { DataCategory } from "../discovery/source-model.js";
import type { RuleId } from "../rules/model.js";

export const BASELINE_SCHEMA_VERSION_V1 = 1 as const;
export const BASELINE_SCHEMA_VERSION = 2 as const;
export const LATEST_RUN_SCHEMA_VERSION_V1 = 1 as const;
export const LATEST_RUN_SCHEMA_VERSION = 2 as const;

export const DEFAULT_BASELINE_PATH = "privacyspec-baseline.json";
export const DEFAULT_LATEST_RUN_PATH = ".privacyspec/latest-run.json";

export interface BaselineFlowIdentity {
  ruleId: RuleId;
  dataCategory: DataCategory;
  sinkKind: DataFlowSinkKind;
  recipient?: string | undefined;
  endpoint?: string | undefined;
  location?: string | undefined;
  transform: TransformKind;
}

export interface BaselineFlowCandidate extends BaselineFlowIdentity {
  key: string;
}

export interface BaselineFlow extends BaselineFlowCandidate {
  status: "accepted";
}

export interface BaselineFileV1 {
  schemaVersion: typeof BASELINE_SCHEMA_VERSION_V1;
  createdAt: string;
  flows: BaselineFlow[];
}

export interface BaselineFileV2 {
  schemaVersion: typeof BASELINE_SCHEMA_VERSION;
  createdAt: string;
  classifierConfiguration: ClassifierConfiguration;
  flows: BaselineFlow[];
}

export type BaselineFile = BaselineFileV1 | BaselineFileV2;

export interface LatestRunFileV1 {
  schemaVersion: typeof LATEST_RUN_SCHEMA_VERSION_V1;
  createdAt: string;
  complete: boolean;
  flows: BaselineFlowCandidate[];
}

export interface LatestRunFileV2 {
  schemaVersion: typeof LATEST_RUN_SCHEMA_VERSION;
  createdAt: string;
  complete: boolean;
  classifierConfiguration: ClassifierConfigurationState;
  flows: BaselineFlowCandidate[];
}

export type LatestRunFile = LatestRunFileV1 | LatestRunFileV2;
