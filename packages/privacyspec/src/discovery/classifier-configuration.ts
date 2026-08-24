import type { NormalizedCustomDomSourceClassifier } from "./custom-classifiers.js";

export const MAX_CUSTOM_CLASSIFIER_CONFIGURATION_ID_LENGTH = 128;

export interface BuiltInClassifierConfiguration {
  mode: "builtin-only";
}

export interface CustomClassifierConfiguration {
  mode: "custom";
  id: string;
}

export interface UnavailableClassifierConfiguration {
  mode: "unavailable";
}

export type ClassifierConfiguration =
  | BuiltInClassifierConfiguration
  | CustomClassifierConfiguration;

export type ClassifierConfigurationState =
  | ClassifierConfiguration
  | UnavailableClassifierConfiguration;

export const BUILTIN_ONLY_CLASSIFIER_CONFIGURATION: BuiltInClassifierConfiguration = Object.freeze({
  mode: "builtin-only",
});

export const UNAVAILABLE_CLASSIFIER_CONFIGURATION: UnavailableClassifierConfiguration =
  Object.freeze({ mode: "unavailable" });

export const isCustomClassifierConfigurationId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= MAX_CUSTOM_CLASSIFIER_CONFIGURATION_ID_LENGTH &&
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value);

export const normalizeClassifierConfiguration = (
  classifiers: readonly NormalizedCustomDomSourceClassifier[],
  configurationId: unknown,
): ClassifierConfiguration => {
  if (classifiers.length === 0) {
    if (configurationId !== undefined) {
      throw new TypeError("Invalid PrivacySpec custom classifier configuration ID.");
    }
    return BUILTIN_ONLY_CLASSIFIER_CONFIGURATION;
  }
  if (!isCustomClassifierConfigurationId(configurationId)) {
    throw new TypeError("Invalid PrivacySpec custom classifier configuration ID.");
  }
  return Object.freeze({ mode: "custom", id: configurationId });
};

export const parseClassifierConfiguration = (
  value: unknown,
): ClassifierConfiguration | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === "builtin-only") {
    return Object.keys(candidate).length === 1 ? BUILTIN_ONLY_CLASSIFIER_CONFIGURATION : undefined;
  }
  if (
    candidate.mode === "custom" &&
    Object.keys(candidate).length === 2 &&
    Object.hasOwn(candidate, "id") &&
    isCustomClassifierConfigurationId(candidate.id)
  ) {
    return { mode: "custom", id: candidate.id };
  }
  return undefined;
};

export const parseClassifierConfigurationState = (
  value: unknown,
): ClassifierConfigurationState | undefined => {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).mode === "unavailable" &&
    Object.keys(value).length === 1
  ) {
    return UNAVAILABLE_CLASSIFIER_CONFIGURATION;
  }
  return parseClassifierConfiguration(value);
};

export const classifierConfigurationsEqual = (
  left: ClassifierConfigurationState,
  right: ClassifierConfigurationState,
): boolean =>
  left.mode === right.mode &&
  (left.mode !== "custom" || (right.mode === "custom" && left.id === right.id));
