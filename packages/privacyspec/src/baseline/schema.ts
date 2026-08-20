import type { DataFlowSinkKind, TransformKind } from "../correlate/model.js";
import type { DataCategory } from "../discovery/source-model.js";
import type { RuleId } from "../rules/model.js";

export const BASELINE_SCHEMA_VERSION = 1 as const;
export const LATEST_RUN_SCHEMA_VERSION = 1 as const;

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

export interface BaselineFile {
  schemaVersion: typeof BASELINE_SCHEMA_VERSION;
  createdAt: string;
  flows: BaselineFlow[];
}

export interface LatestRunFile {
  schemaVersion: typeof LATEST_RUN_SCHEMA_VERSION;
  createdAt: string;
  complete: boolean;
  flows: BaselineFlowCandidate[];
}
