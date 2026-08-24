import type { DataCategory } from "../discovery/source-model.js";
import type {
  APIRequestReportCoverage,
  BrowserEngineReportCoverage,
  FirstPartyJsonResponseReportCoverage,
  PrivacySpecRunStatus,
  TestAttemptCounts,
} from "../report/model.js";
import type { RegulatoryMapping, TechnicalControlMapping } from "../rules/legal-map.js";
import type { RuleId } from "../rules/model.js";

export const EVIDENCE_SCHEMA_VERSION = 2 as const;
export const EVIDENCE_SCHEMA_VERSION_V1 = 1 as const;

export type EvidenceFormat = "json" | "markdown";
export type EvidenceSourceRunState = "COMPLETE" | "INCOMPLETE";

export interface EvidenceBuildIdentifiers {
  commit?: string | undefined;
  buildId?: string | undefined;
}

export interface EvidenceCategoryObservation {
  category: DataCategory;
  sourceObservations: number;
  flowOccurrences: number;
}

export interface EvidenceExternalRecipientObservation {
  origin: string;
  host: string;
  flowOccurrences: number;
  categories: DataCategory[];
}

export interface EvidenceRuleObservation {
  ruleId: RuleId;
  title: string;
  observation: string;
  occurrences: number;
  technicalFailures: number;
  reviewRequired: number;
}

export interface EvidenceTechnicalRelevance {
  ruleId: RuleId;
  controls: TechnicalControlMapping[];
  limitations: string[];
}

export interface EvidenceRegulatoryRelevance {
  ruleId: RuleId;
  mappings: RegulatoryMapping[];
  limitations: string[];
}

export interface EvidenceReportLevelRegulatoryRelevance {
  profileId: string;
  title: string;
  observation: string;
  mappings: RegulatoryMapping[];
  limitations: string[];
}

export interface PrivacySpecEvidence {
  evidenceSchemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  evidenceKind: "AUDIT_SUPPORTING_TECHNICAL_EVIDENCE";
  tool: {
    name: "privacyspec";
    version: string;
  };
  execution: {
    evidenceGeneratedAt: string;
    sourceRunStartedAt: string;
    sourceReportGeneratedAt: string;
    sourceReportSchemaVersion: 1 | 2 | 3 | 4 | 5;
    sourceRunState: EvidenceSourceRunState;
    sourceStatus: PrivacySpecRunStatus;
  };
  build: EvidenceBuildIdentifiers;
  scope: {
    complete: boolean;
    projectCount: number;
    projects: string[];
    tests: TestAttemptCounts;
  };
  observations: {
    categories: EvidenceCategoryObservation[];
    externalRecipients: EvidenceExternalRecipientObservation[];
    rules: EvidenceRuleObservation[];
    dataFlowOccurrences: number;
    requestSurfaces: {
      browser: number;
      apiRequest: number;
    };
    findingOccurrences: {
      technicalFailures: number;
      reviewRequired: number;
    };
    baselineReview: {
      exists: boolean;
      known: number;
      new: number;
      resolved: number | null;
      resolvedStatus: "CONCLUSIVE" | "INCONCLUSIVE";
    };
    testDataHygiene: {
      available: boolean;
      total: number | null;
      synthetic: number | null;
      reviewRequired: number | null;
      unassessed: number | null;
    };
  };
  coverage: {
    diagnosticCount: number;
    integrationErrorCount: number;
    firstPartyJsonResponses:
      | { available: false }
      | {
          available: true;
          details: FirstPartyJsonResponseReportCoverage;
        };
    browserEngines:
      | { available: false }
      | { available: true; details: BrowserEngineReportCoverage };
    apiRequests: { available: false } | { available: true; details: APIRequestReportCoverage };
  };
  technicalRelevance: EvidenceTechnicalRelevance[];
  regulatoryRelevance: {
    rules: EvidenceRegulatoryRelevance[];
    reportLevel: EvidenceReportLevelRegulatoryRelevance[];
  };
  limitations: {
    coverage: string[];
    legal: string[];
  };
}

export interface PrivacySpecEvidenceV1
  extends Omit<PrivacySpecEvidence, "evidenceSchemaVersion" | "observations" | "coverage"> {
  evidenceSchemaVersion: typeof EVIDENCE_SCHEMA_VERSION_V1;
  observations: Omit<PrivacySpecEvidence["observations"], "requestSurfaces">;
  coverage: Omit<PrivacySpecEvidence["coverage"], "browserEngines" | "apiRequests">;
}

export type ReadablePrivacySpecEvidence = PrivacySpecEvidenceV1 | PrivacySpecEvidence;
