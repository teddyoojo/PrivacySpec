import type { CorrelationLimitDiagnostic, DataFlow } from "./correlate/model.js";
import type {
  SensitiveSourceObservation,
  SourceLimitDiagnostic,
} from "./discovery/source-model.js";
import type { SinkObservation } from "./observe/sink-model.js";
import type { Finding } from "./rules/model.js";

export type PrivacySpecObservation =
  | SensitiveSourceObservation
  | SourceLimitDiagnostic
  | SinkObservation
  | DataFlow
  | Finding
  | CorrelationLimitDiagnostic;
