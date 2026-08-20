import type { PrivacySpecObservation } from "../observation-model.js";

export const PRIVACYSPEC_ATTACHMENT_NAME = "privacyspec-result";
export const PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE = "application/json";

export interface PrivacySpecResult {
  schemaVersion: 1;
  observations: PrivacySpecObservation[];
}

export const createPrivacySpecResult = (
  observations: PrivacySpecObservation[] = [],
): PrivacySpecResult => ({
  schemaVersion: 1,
  observations,
});

export const createEmptyPrivacySpecResult = (): PrivacySpecResult => createPrivacySpecResult();

export const isPrivacySpecResult = (value: unknown): value is PrivacySpecResult => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<PrivacySpecResult>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.observations);
};
