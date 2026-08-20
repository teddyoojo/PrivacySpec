export type DataCategory = "personal.email" | "personal.phone" | "secret.password";
export type SourceConfidence = "high" | "medium" | "low";

export type ClassificationEvidence =
  | { kind: "input-type"; value: string }
  | { kind: "autocomplete"; value: string }
  | { kind: "label"; value: string }
  | { kind: "name-attribute"; value: string }
  | { kind: "pattern"; value: string };

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

export interface RawSensitiveSource extends ControlClassification {
  raw: string;
  control: SourceControlMetadata;
  pageUrl: string;
  timestamp: number;
  observedBy: "event" | "fallback";
}

export interface SensitiveSourceObservation extends ControlClassification {
  kind: "sensitive-source";
  control: SourceControlMetadata;
  page: {
    origin: string;
    path: string;
  };
  observedBy: "event" | "fallback";
}

export interface SourceLimitDiagnostic {
  kind: "diagnostic";
  code: "PS_SOURCE_LIMIT_REACHED";
  classification: "informational";
  message: string;
}

export type SourceObservation = SensitiveSourceObservation | SourceLimitDiagnostic;
