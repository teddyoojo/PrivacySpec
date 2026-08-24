import type {
  ClassificationEvidence,
  ControlClassification,
  ControlClassificationInput,
  CustomDataCategory,
  DataCategoryFamily,
  SourceConfidence,
} from "./source-model.js";
import { getDataCategoryFamily, isDataCategory } from "./source-model.js";

export const MAX_CUSTOM_SOURCE_CLASSIFIERS = 64;
export const MAX_CUSTOM_CLASSIFIER_ALTERNATIVES = 32;
export const MAX_CUSTOM_CLASSIFIER_TOTAL_ALTERNATIVES = 512;
export const MAX_CUSTOM_CLASSIFIER_METADATA_LENGTH = 200;

export type ExactMachineSignal = {
  field: "name" | "id";
  equals: string;
};

export type ExactAccessibleSignal = {
  field: "associatedLabel" | "ariaLabel" | "placeholder";
  equals: string;
};

export type ExactControlSignal = ExactMachineSignal | ExactAccessibleSignal;

export interface CustomDataCategoryDescriptor {
  id: CustomDataCategory;
  family: DataCategoryFamily;
}

interface CustomDomSourceClassifierBase {
  category: CustomDataCategoryDescriptor;
  sourceSurface: "dom-control";
  sanitization: "bounded-control-metadata";
  value: {
    minLength: number;
    maxLength: number;
  };
}

export interface HighConfidenceCustomDomSourceClassifier extends CustomDomSourceClassifierBase {
  confidence: "high";
  match: {
    kind: "corroborated";
    alternatives: Array<{
      machine: ExactMachineSignal;
      accessible: ExactAccessibleSignal;
    }>;
  };
}

export interface MediumConfidenceCustomDomSourceClassifier extends CustomDomSourceClassifierBase {
  confidence: "medium";
  match: {
    kind: "exact";
    alternatives: ExactControlSignal[];
  };
}

export type CustomDomSourceClassifier =
  | HighConfidenceCustomDomSourceClassifier
  | MediumConfidenceCustomDomSourceClassifier;

export type NormalizedCustomDomSourceClassifier = Readonly<CustomDomSourceClassifier>;

export interface CustomControlClassificationResult {
  classification?: ControlClassification | undefined;
  ambiguous: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

const containsUnsafeCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    ) {
      return true;
    }
  }
  return false;
};

const normalizeMetadataValue = (value: string): string =>
  value
    .slice(0, MAX_CUSTOM_CLASSIFIER_METADATA_LENGTH)
    .normalize("NFKC")
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z\d]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");

const parseSignal = (
  value: unknown,
  fields: readonly ExactControlSignal["field"][],
): ExactControlSignal | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["field", "equals"]) ||
    typeof value.field !== "string" ||
    !fields.includes(value.field as ExactControlSignal["field"]) ||
    typeof value.equals !== "string" ||
    value.equals.length === 0 ||
    value.equals.length > MAX_CUSTOM_CLASSIFIER_METADATA_LENGTH ||
    containsUnsafeCharacter(value.equals)
  ) {
    return undefined;
  }
  const equals = normalizeMetadataValue(value.equals);
  if (equals.length === 0) return undefined;
  return { field: value.field as ExactControlSignal["field"], equals } as ExactControlSignal;
};

const cloneClassifier = (
  value: unknown,
): { classifier: CustomDomSourceClassifier; alternatives: number } | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "category",
      "sourceSurface",
      "confidence",
      "sanitization",
      "match",
      "value",
    ]) ||
    value.sourceSurface !== "dom-control" ||
    value.sanitization !== "bounded-control-metadata" ||
    !isRecord(value.category) ||
    !hasExactKeys(value.category, ["id", "family"]) ||
    !isDataCategory(value.category.id) ||
    !String(value.category.id).startsWith("custom.") ||
    (value.category.family !== "personal" && value.category.family !== "secret") ||
    getDataCategoryFamily(value.category.id) !== value.category.family ||
    !isRecord(value.value) ||
    !hasExactKeys(value.value, ["minLength", "maxLength"]) ||
    !Number.isSafeInteger(value.value.minLength) ||
    !Number.isSafeInteger(value.value.maxLength) ||
    Number(value.value.minLength) < 6 ||
    Number(value.value.maxLength) > 4_096 ||
    Number(value.value.minLength) > Number(value.value.maxLength) ||
    !isRecord(value.match) ||
    !Array.isArray(value.match.alternatives) ||
    value.match.alternatives.length === 0 ||
    value.match.alternatives.length > MAX_CUSTOM_CLASSIFIER_ALTERNATIVES
  ) {
    return undefined;
  }

  const category: CustomDataCategoryDescriptor = {
    id: value.category.id as CustomDataCategory,
    family: value.category.family,
  };
  const sourceValue = {
    minLength: Number(value.value.minLength),
    maxLength: Number(value.value.maxLength),
  };

  if (value.confidence === "high" && value.match.kind === "corroborated") {
    const alternatives: HighConfidenceCustomDomSourceClassifier["match"]["alternatives"] = [];
    for (const alternative of value.match.alternatives) {
      if (!isRecord(alternative) || !hasExactKeys(alternative, ["machine", "accessible"])) {
        return undefined;
      }
      const machine = parseSignal(alternative.machine, ["name", "id"]);
      const accessible = parseSignal(alternative.accessible, [
        "associatedLabel",
        "ariaLabel",
        "placeholder",
      ]);
      if (machine === undefined || accessible === undefined) return undefined;
      alternatives.push({
        machine: machine as ExactMachineSignal,
        accessible: accessible as ExactAccessibleSignal,
      });
    }
    return {
      alternatives: alternatives.length,
      classifier: {
        category,
        sourceSurface: "dom-control",
        confidence: "high",
        sanitization: "bounded-control-metadata",
        match: { kind: "corroborated", alternatives },
        value: sourceValue,
      },
    };
  }

  if (
    value.confidence === "medium" &&
    value.match.kind === "exact" &&
    category.family === "personal"
  ) {
    const alternatives: ExactControlSignal[] = [];
    for (const alternative of value.match.alternatives) {
      const signal = parseSignal(alternative, [
        "name",
        "id",
        "associatedLabel",
        "ariaLabel",
        "placeholder",
      ]);
      if (signal === undefined) return undefined;
      alternatives.push(signal);
    }
    return {
      alternatives: alternatives.length,
      classifier: {
        category,
        sourceSurface: "dom-control",
        confidence: "medium",
        sanitization: "bounded-control-metadata",
        match: { kind: "exact", alternatives },
        value: sourceValue,
      },
    };
  }

  return undefined;
};

export const normalizeCustomDomSourceClassifiers = (
  value: readonly CustomDomSourceClassifier[] | undefined,
): readonly NormalizedCustomDomSourceClassifier[] => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_SOURCE_CLASSIFIERS) {
    throw new TypeError("Invalid PrivacySpec custom source classifier configuration.");
  }
  const categories = new Set<string>();
  const classifiers: CustomDomSourceClassifier[] = [];
  let totalAlternatives = 0;
  for (const candidate of value) {
    const parsed = cloneClassifier(candidate);
    if (parsed === undefined || categories.has(parsed.classifier.category.id)) {
      throw new TypeError("Invalid PrivacySpec custom source classifier configuration.");
    }
    totalAlternatives += parsed.alternatives;
    if (totalAlternatives > MAX_CUSTOM_CLASSIFIER_TOTAL_ALTERNATIVES) {
      throw new TypeError("Invalid PrivacySpec custom source classifier configuration.");
    }
    categories.add(parsed.classifier.category.id);
    classifiers.push(parsed.classifier);
  }
  return Object.freeze(classifiers);
};

export const classifyCustomSensitiveControl = (
  control: ControlClassificationInput,
  classifiers: readonly NormalizedCustomDomSourceClassifier[],
): CustomControlClassificationResult => {
  const normalize = (value: string | undefined): string =>
    (value ?? "")
      .slice(0, 200)
      .normalize("NFKC")
      .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z\d]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  const evidenceKind = (field: ExactControlSignal["field"]): ClassificationEvidence["kind"] => {
    if (field === "name") return "name-attribute";
    if (field === "id") return "id-attribute";
    if (field === "associatedLabel") return "label";
    if (field === "ariaLabel") return "aria-label";
    return "placeholder";
  };
  const matchSignal = (signal: ExactControlSignal): ClassificationEvidence | undefined => {
    const actual = normalize(control[signal.field]);
    return actual.length > 0 && actual === signal.equals
      ? { kind: evidenceKind(signal.field), value: actual }
      : undefined;
  };

  const matches: Array<{
    category: CustomDataCategory;
    confidence: SourceConfidence;
    evidence: ClassificationEvidence[];
  }> = [];
  for (const classifier of classifiers) {
    const normalizedValue = control.value.trim();
    if (
      normalizedValue.length < classifier.value.minLength ||
      normalizedValue.length > classifier.value.maxLength
    ) {
      continue;
    }
    if (classifier.confidence === "high") {
      for (const alternative of classifier.match.alternatives) {
        const machine = matchSignal(alternative.machine);
        const accessible = matchSignal(alternative.accessible);
        if (machine !== undefined && accessible !== undefined) {
          matches.push({
            category: classifier.category.id,
            confidence: "high",
            evidence: [machine, accessible],
          });
          break;
        }
      }
    } else {
      for (const alternative of classifier.match.alternatives) {
        const evidence = matchSignal(alternative);
        if (evidence !== undefined) {
          matches.push({
            category: classifier.category.id,
            confidence: "medium",
            evidence: [evidence],
          });
          break;
        }
      }
    }
  }

  if (matches.length > 1) return { ambiguous: true };
  const [match] = matches;
  return match === undefined
    ? { ambiguous: false }
    : {
        ambiguous: false,
        classification: {
          category: match.category,
          confidence: match.confidence,
          evidence: match.evidence,
        },
      };
};
