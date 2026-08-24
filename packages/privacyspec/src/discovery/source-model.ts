export const DATA_CATEGORIES = [
  "personal.email",
  "personal.phone",
  "personal.name",
  "personal.postal_address",
  "personal.date_of_birth",
  "personal.account_identifier",
  "personal.payment_card",
  "personal.gender_identity",
  "personal.job_title",
  "secret.password",
] as const;

export type BuiltInDataCategory = (typeof DATA_CATEGORIES)[number];
export type DataCategoryFamily = "personal" | "secret";
export type CustomDataCategory = `custom.${DataCategoryFamily}.${string}.${string}`;
export type DataCategory = BuiltInDataCategory | CustomDataCategory;
export type SourceConfidence = "high" | "medium" | "low";

const builtInDataCategories = new Set<string>(DATA_CATEGORIES);
const customDataCategoryPattern =
  /^custom\.(personal|secret)\.([a-z][a-z0-9_]{0,62})\.([a-z][a-z0-9_]{0,62})$/u;

export const isDataCategory = (value: unknown): value is DataCategory =>
  typeof value === "string" &&
  value.length <= 128 &&
  (builtInDataCategories.has(value) || customDataCategoryPattern.test(value));

export const getDataCategoryFamily = (category: DataCategory): DataCategoryFamily => {
  if (category.startsWith("personal.")) return "personal";
  if (category.startsWith("secret.")) return "secret";
  const match = customDataCategoryPattern.exec(category);
  if (match?.[1] === "personal" || match?.[1] === "secret") return match[1];
  throw new TypeError("Invalid PrivacySpec data category.");
};

export type ClassificationEvidence =
  | { kind: "input-type"; value: string }
  | { kind: "autocomplete"; value: string }
  | { kind: "label"; value: string }
  | { kind: "name-attribute"; value: string }
  | { kind: "id-attribute"; value: string }
  | { kind: "aria-label"; value: string }
  | { kind: "placeholder"; value: string }
  | { kind: "pattern"; value: string }
  | { kind: "json-key"; value: string };

export interface ControlClassificationInput {
  value: string;
  type?: string | undefined;
  autocomplete?: string | undefined;
  name?: string | undefined;
  id?: string | undefined;
  ariaLabel?: string | undefined;
  associatedLabel?: string | undefined;
  placeholder?: string | undefined;
}

export interface ControlClassification {
  category: DataCategory;
  confidence: SourceConfidence;
  evidence: ClassificationEvidence[];
}

export interface SourceControlMetadata {
  elementKind: "input" | "textarea" | "select" | "contenteditable";
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
  code: "PS_SOURCE_LIMIT_REACHED" | "PS_CUSTOM_SOURCE_AMBIGUOUS";
  classification: "informational";
  message: string;
}

export type SourceObservation = SensitiveSourceObservation | SourceLimitDiagnostic;
