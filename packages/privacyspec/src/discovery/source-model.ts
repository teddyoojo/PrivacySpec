export type DataCategory = "personal.email" | "personal.phone" | "secret.password";
export type SourceConfidence = "high" | "medium" | "low";

export type ClassificationEvidence =
  | { kind: "input-type"; value: string }
  | { kind: "autocomplete"; value: string }
  | { kind: "label"; value: string }
  | { kind: "name-attribute"; value: string }
  | { kind: "pattern"; value: string }
  | { kind: "json-key"; value: string };

export interface ControlClassificationInput {
  value: string;
  type?: string | undefined;
  autocomplete?: string | undefined;
}

export interface ControlClassification {
  category: DataCategory;
  confidence: SourceConfidence;
  evidence: ClassificationEvidence[];
}

export interface SourceControlMetadata {
  elementKind: "input" | "textarea" | "contenteditable";
  type?: string | undefined;
  name?: string | undefined;
  id?: string | undefined;
  autocomplete?: string | undefined;
  ariaLabel?: string | undefined;
  associatedLabel?: string | undefined;
  placeholder?: string | undefined;
}

export interface RawControlSensitiveSource extends ControlClassification {
  kind: "control";
  raw: string;
  control: SourceControlMetadata;
  pageUrl: string;
  timestamp: number;
  observedBy: "event" | "fallback";
}

export interface ResponseSourceProvenance {
  origin: string;
  endpoint: string;
  location: string;
}

export interface RawResponseSensitiveSource extends ControlClassification {
  kind: "response-json";
  category: "personal.email" | "personal.phone";
  raw: string;
  provenance: ResponseSourceProvenance;
  timestamp: number;
  observedBy: "response";
  requestIdentity?: number | undefined;
}

export type RawSensitiveSource = RawControlSensitiveSource | RawResponseSensitiveSource;

export interface ControlSensitiveSourceObservation extends ControlClassification {
  kind: "sensitive-source";
  sourceKind: "form-input" | "dom-control";
  control: SourceControlMetadata;
  page: {
    origin: string;
    path: string;
  };
  observedBy: "event" | "fallback";
}

export interface ResponseSensitiveSourceObservation extends ControlClassification {
  kind: "sensitive-source";
  category: "personal.email" | "personal.phone";
  sourceKind: "response-json";
  provenance: ResponseSourceProvenance;
  observedBy: "response";
}

export type SensitiveSourceObservation =
  | ControlSensitiveSourceObservation
  | ResponseSensitiveSourceObservation;

export interface SourceLimitDiagnostic {
  kind: "diagnostic";
  code: "PS_SOURCE_LIMIT_REACHED";
  classification: "informational";
  message: string;
}

export type SourceObservation = SensitiveSourceObservation | SourceLimitDiagnostic;
