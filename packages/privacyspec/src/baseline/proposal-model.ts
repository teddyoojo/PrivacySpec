import type {
  DependencyBaselineFile,
  DependencyLatestRunFile,
} from "../analyzers/dependency/model.js";
import type {
  RuntimeFailureBaselineEntry,
  RuntimeFailureBaselineFile,
  RuntimeFailureLatestRunFile,
} from "../analyzers/runtime-failure/model.js";
import type {
  SecurityBaselineEntry,
  SecurityBaselineFile,
  SecurityLatestRunFile,
} from "../analyzers/security/model.js";
import type { ClassifierConfiguration } from "../discovery/classifier-configuration.js";
import type { BaselineFile, BaselineFlowCandidate, LatestRunFile } from "./schema.js";

export const BASELINE_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const DEFAULT_BASELINE_PROPOSAL_PATH = ".privacyspec/baseline-proposal.json";
export const MAX_BASELINE_PROPOSAL_BYTES = 16 * 1024 * 1024;
export const MAX_BASELINE_PROPOSAL_ENTRIES = 100_000;
export const MAX_BASELINE_PROPOSAL_SELECTIONS = 100_000;

export type BaselineProposalModule = "privacy" | "dependencies" | "security" | "runtime";
export type BaselineProposalAction = "add" | "change" | "remove";
export type BaselineProposalDigest = `sha256:${string}`;
export type BaselineProposalId =
  `${BaselineProposalModule}:${BaselineProposalAction}:sha256:${string}`;

export interface BaselineProposalEntry {
  id: BaselineProposalId;
  module: BaselineProposalModule;
  action: BaselineProposalAction;
  identity: string;
}

export interface BaselineProposalCounts {
  known: number;
  add: number;
  change: number;
  remove: number;
}

export interface BaselineProposalSource {
  baseline: {
    state: "missing" | "present";
    digest: BaselineProposalDigest;
  };
  latestRun: {
    digest: BaselineProposalDigest;
  };
}

export interface BaselineProposal {
  proposalSchemaVersion: typeof BASELINE_PROPOSAL_SCHEMA_VERSION;
  createdAt: string;
  module: BaselineProposalModule;
  source: BaselineProposalSource;
  counts: BaselineProposalCounts;
  entries: BaselineProposalEntry[];
  proposalDigest: BaselineProposalDigest;
}

export type BaselineProposalSnapshot =
  | {
      module: "privacy";
      baseline?: BaselineFile | undefined;
      latestRun: LatestRunFile;
    }
  | {
      module: "dependencies";
      baseline?: DependencyBaselineFile | undefined;
      latestRun: DependencyLatestRunFile;
    }
  | {
      module: "security";
      baseline?: SecurityBaselineFile | undefined;
      latestRun: SecurityLatestRunFile;
    }
  | {
      module: "runtime";
      baseline?: RuntimeFailureBaselineFile | undefined;
      latestRun: RuntimeFailureLatestRunFile;
    };

export interface BaselineProposalSelectionCounts {
  add: number;
  change: number;
  remove: number;
}

interface BaselineProposalApplicationBase {
  selectedIds: BaselineProposalId[];
  selectedCounts: BaselineProposalSelectionCounts;
}

export type BaselineProposalApplication =
  | (BaselineProposalApplicationBase & {
      module: "privacy";
      entries: BaselineFlowCandidate[];
      classifierConfiguration: ClassifierConfiguration;
    })
  | (BaselineProposalApplicationBase & {
      module: "dependencies";
      entries: DependencyLatestRunFile["dependencies"];
    })
  | (BaselineProposalApplicationBase & {
      module: "security";
      entries: SecurityBaselineEntry[];
    })
  | (BaselineProposalApplicationBase & {
      module: "runtime";
      entries: RuntimeFailureBaselineEntry[];
    });
