import type { DataFlowSourceKind, DataFlowTestMetadata } from "../correlate/model.js";
import type { DataCategory, SourceControlMetadata } from "../discovery/source-model.js";

export const TEST_DATA_SCHEMA_VERSION = 1 as const;

export type TestDataVerdict = "SYNTHETIC" | "REVIEW_REQUIRED" | "UNASSESSED";

export type TestDataSignal =
  | "IANA_RESERVED_EMAIL_DOMAIN"
  | "CONFIGURED_SYNTHETIC_EMAIL_DOMAIN"
  | "EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC"
  | "EMAIL_SHAPE_UNSUPPORTED"
  | "UNSUPPORTED_CATEGORY"
  | "UNSUPPORTED_SOURCE_KIND";

export interface TestDataControlAttribution {
  elementKind: SourceControlMetadata["elementKind"];
  observedBy: "event" | "fallback";
}

export interface TestDataAttribution {
  test: DataFlowTestMetadata;
  control?: TestDataControlAttribution | undefined;
}

export interface TestDataObservation {
  verdict: TestDataVerdict;
  signal: TestDataSignal;
  category: DataCategory;
  sourceKind: DataFlowSourceKind;
  attribution: TestDataAttribution;
}

export interface TestDataSummary {
  total: number;
  synthetic: number;
  reviewRequired: number;
  unassessed: number;
}

export interface PrivacySpecTestDataAttachment {
  testDataSchemaVersion: typeof TEST_DATA_SCHEMA_VERSION;
  observations: TestDataObservation[];
}

export interface PrivacySpecTestDataSection {
  testDataSchemaVersion: typeof TEST_DATA_SCHEMA_VERSION;
  summary: TestDataSummary;
  observations: TestDataObservation[];
  limitations: string[];
}

export interface PrivacySpecTestDataReport extends PrivacySpecTestDataSection {
  tool: {
    name: "privacyspec";
    version: string;
  };
  sourceReport: {
    schemaVersion: 1 | 2 | 3 | 4;
    generatedAt: string;
    complete: boolean;
    status: "passed" | "review" | "failed" | "incomplete";
    testDataAvailable: boolean;
    projects: string[];
    tests: {
      total: number;
      observed: number;
      passed: number;
      failed: number;
      timedOut: number;
      skipped: number;
      interrupted: number;
    };
  };
}

export type TestDataFormat = "terminal" | "json" | "markdown";
