import { normalizePath, redactSensitive } from "../correlate/redact.js";
import { createRedactionValues } from "../correlate/transforms.js";
import type {
  ClassificationEvidence,
  RawSensitiveSource,
  SensitiveSourceObservation,
  SourceControlMetadata,
  SourceObservation,
} from "./source-model.js";

const sanitizeMetadataValue = (
  value: string | undefined,
  sensitiveValues: readonly string[],
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const redacted = redactSensitive(value, sensitiveValues, "[redacted]");
  return redacted === value ? value.slice(0, 200) : "[redacted]";
};

const sanitizeEvidence = (
  evidence: ClassificationEvidence[],
  sensitiveValues: readonly string[],
): ClassificationEvidence[] =>
  evidence.map((item) => ({
    ...item,
    value: sanitizeMetadataValue(item.value, sensitiveValues) ?? "[redacted]",
  }));

const sanitizeControl = (
  control: SourceControlMetadata,
  sensitiveValues: readonly string[],
): SourceControlMetadata => {
  const sanitized: SourceControlMetadata = { elementKind: control.elementKind };
  for (const key of [
    "type",
    "name",
    "id",
    "autocomplete",
    "ariaLabel",
    "associatedLabel",
    "placeholder",
  ] as const) {
    const value = sanitizeMetadataValue(control[key], sensitiveValues);
    if (value !== undefined) sanitized[key] = value;
  }
  return sanitized;
};

const sanitizePage = (
  pageUrl: string,
  sensitiveValues: readonly string[],
): SensitiveSourceObservation["page"] => {
  try {
    const url = new URL(pageUrl);
    return {
      origin:
        url.origin === "null"
          ? "opaque"
          : redactSensitive(url.origin, sensitiveValues).slice(0, 2_048),
      path: normalizePath(url.pathname, sensitiveValues),
    };
  } catch {
    return { origin: "unknown", path: "/" };
  }
};

export const sanitizeSensitiveSources = (
  sources: RawSensitiveSource[],
  limitReached: boolean,
): SourceObservation[] => {
  const sensitiveValues = createRedactionValues(sources);
  const observations: SourceObservation[] = [];
  const identities = new Set<string>();

  for (const source of sources) {
    const observation: SensitiveSourceObservation = {
      kind: "sensitive-source",
      category: source.category,
      confidence: source.confidence,
      evidence: sanitizeEvidence(source.evidence, sensitiveValues),
      control: sanitizeControl(source.control, sensitiveValues),
      page: sanitizePage(source.pageUrl, sensitiveValues),
      observedBy: source.observedBy,
    };
    const identity = JSON.stringify(observation);
    if (!identities.has(identity)) {
      identities.add(identity);
      observations.push(observation);
    }
  }

  if (limitReached) {
    observations.push({
      kind: "diagnostic",
      code: "PS_SOURCE_LIMIT_REACHED",
      classification: "informational",
      message: "Sensitive source collection reached its per-test safety limit.",
    });
  }

  return observations;
};
