import type { RawSensitiveSource, SourceConfidence } from "../discovery/source-model.js";
import type { RawSink } from "../observe/sink-model.js";

export type TransformKind =
  | "EXACT"
  | "LOWERCASE"
  | "UPPERCASE"
  | "URL_ENCODED"
  | "BASE64"
  | "SHA256"
  | "SHA256_NORMALIZED";

export type DataFlowSinkKind =
  | "request-url"
  | "request-body"
  | "request-header"
  | "external-request"
  | "local-storage"
  | "session-storage"
  | "cookie"
  | "console";

export interface DataFlowTestMetadata {
  file: string;
  title: string;
  project: string;
}

export interface FirstPartyConfig {
  origins?: readonly string[] | undefined;
  hosts?: readonly string[] | undefined;
}

export interface DataFlow {
  kind: "data-flow";
  dataCategory: RawSensitiveSource["category"];
  sourceKind: "form-input" | "dom-control";
  sourceConfidence: SourceConfidence;
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
  transform: TransformKind;
  test: DataFlowTestMetadata;
}

export interface CorrelationLimitDiagnostic {
  kind: "diagnostic";
  code: "PS_CORRELATION_LIMIT_REACHED";
  classification: "informational";
  message: string;
}

export interface CorrelationInput {
  sources: readonly RawSensitiveSource[];
  sinks: readonly RawSink[];
  pageUrls?: readonly string[] | undefined;
  firstParty?: FirstPartyConfig | undefined;
  test: DataFlowTestMetadata;
}

export interface CorrelationResult {
  flows: DataFlow[];
  limitReached: boolean;
}
