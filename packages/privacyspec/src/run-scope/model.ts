import type { ClassifierConfigurationState } from "../discovery/classifier-configuration.js";
import type { PrivacySpecJsonReportV4, PrivacySpecJsonReportV5 } from "../report/model.js";

export const RUN_PART_SCHEMA_VERSION_V1 = 1 as const;
export const RUN_PART_SCHEMA_VERSION_V2 = 2 as const;
export const RUN_PART_SCHEMA_VERSION = 3 as const;
export const MAX_RUN_PARTS = 128;
export const DEFAULT_RUN_PARTS_DIRECTORY = ".privacyspec-parts";

export interface PrivacySpecRunScopeOptions {
  runId: string;
  configurationId: string;
  part?: number | undefined;
  total?: number | undefined;
  outputDirectory?: string | undefined;
}

export interface ResolvedPrivacySpecRunScope {
  runId: string;
  configurationId: string;
  part: number;
  total: number;
  outputPath: string;
}

export interface PrivacySpecRunPartCompleteness {
  privacy: boolean;
  dependencies: boolean;
  security: boolean;
  runtimeErrors: boolean;
}

interface PrivacySpecRunPartCommon {
  scope: {
    runId: string;
    configurationId: string;
    part: number;
    total: number;
    failOnNewReviewFindings: boolean;
    nis2EvidenceProfile: boolean;
  };
  completeness: PrivacySpecRunPartCompleteness;
}

export interface PrivacySpecRunPartV1 extends PrivacySpecRunPartCommon {
  runPartSchemaVersion: typeof RUN_PART_SCHEMA_VERSION_V1;
  report: PrivacySpecJsonReportV4;
}

export interface PrivacySpecRunPartV2 extends PrivacySpecRunPartCommon {
  runPartSchemaVersion: typeof RUN_PART_SCHEMA_VERSION_V2;
  report: PrivacySpecJsonReportV5;
}

export interface PrivacySpecRunPartV3 extends PrivacySpecRunPartCommon {
  runPartSchemaVersion: typeof RUN_PART_SCHEMA_VERSION;
  classifierConfiguration: ClassifierConfigurationState;
  report: PrivacySpecJsonReportV5;
}

export type PrivacySpecRunPart = PrivacySpecRunPartV1 | PrivacySpecRunPartV2 | PrivacySpecRunPartV3;

export interface PrivacySpecAggregateScope {
  runId: string;
  configurationId: string;
  expectedParts: number;
  receivedParts: number;
  missingParts: number[];
  complete: boolean;
}
