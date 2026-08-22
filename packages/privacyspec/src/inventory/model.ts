import type { BaselineChangeReason } from "../baseline/compare.js";
import type { BaselineFlow } from "../baseline/schema.js";
import type { DataFlowSinkKind, DataFlowTestMetadata, TransformKind } from "../correlate/model.js";
import type {
  DataCategory,
  ResponseSourceProvenance,
  SourceConfidence,
} from "../discovery/source-model.js";
import type { FindingSeverity } from "../rules/model.js";

export const INVENTORY_SCHEMA_VERSION = 1 as const;

export type InventoryBoundary = "FIRST_PARTY" | "EXTERNAL" | "BROWSER" | "CONSOLE" | "UNKNOWN";

export type InventoryState = "OBSERVED" | "KNOWN_REVIEW" | "NEW_REVIEW" | "TECHNICAL_FAILURE";

export interface InventoryEntry {
  dataCategory: DataCategory;
  boundary: InventoryBoundary;
  sinkKind: DataFlowSinkKind;
  recipient?:
    | {
        origin: string;
        host: string;
        firstParty: boolean;
      }
    | undefined;
  method?: string | undefined;
  endpoint?: string | undefined;
  location?: string | undefined;
  sourceKinds: Array<"form-input" | "dom-control" | "response-json">;
  sourceProvenance?: ResponseSourceProvenance | undefined;
  sourceConfidences: SourceConfidence[];
  transforms: TransformKind[];
  state: InventoryState;
  severities: FindingSeverity[];
  changeReasons: BaselineChangeReason[];
  occurrences: number;
  tests: DataFlowTestMetadata[];
  testsTruncated: number;
}

export interface PrivacyInventory {
  inventorySchemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  tool: {
    name: "privacyspec";
    version: string;
  };
  sourceReport: {
    schemaVersion: 1 | 2 | 3 | 4;
    generatedAt: string;
    complete: boolean;
    status: "passed" | "review" | "failed" | "incomplete";
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
  summary: {
    entries: number;
    occurrences: number;
    categories: number;
    externalRecipients: number;
    byState: Record<InventoryState, number>;
  };
  entries: InventoryEntry[];
  resolved: BaselineFlow[];
  limitations: string[];
}

export type InventoryFormat = "terminal" | "json" | "csv" | "markdown";
