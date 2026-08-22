import type { DataCategory } from "../discovery/source-model.js";
import type {
  FirstPartyJsonResponseReportCoverage,
  PrivacySpecRunStatus,
  TestAttemptCounts,
} from "../report/model.js";
import type { RegulatoryMapping, TechnicalControlMapping } from "../rules/legal-map.js";
import type { RuleId } from "../rules/model.js";

export const EVIDENCE_SCHEMA_VERSION = 1 as const;

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
    sourceReportSchemaVersion: 1 | 2 | 3 | 4;
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
