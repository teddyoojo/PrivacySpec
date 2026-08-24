import { canonicalizeEndpointPath, redactSensitive, sanitizeLabel } from "../correlate/redact.js";
import { createRedactionValues } from "../correlate/transforms.js";
import type {
  ClassificationEvidence,
  ControlSensitiveSourceObservation,
  RawSensitiveSource,
  ResponseSensitiveSourceObservation,
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
): { origin: string; path: string } => {
  try {
    const url = new URL(pageUrl);
    return {
      origin:
        url.origin === "null"
          ? "opaque"
          : redactSensitive(url.origin, sensitiveValues).slice(0, 2_048),
      path: canonicalizeEndpointPath(url.pathname, sensitiveValues),
    };
  } catch {
    return { origin: "unknown", path: "/" };
  }
};

export const sanitizeSensitiveSources = (
  sources: RawSensitiveSource[],
  limitReached: boolean,
  customClassificationAmbiguous = false,
): SourceObservation[] => {
  const sensitiveValues = createRedactionValues(sources);
  const observations: SourceObservation[] = [];
  const identities = new Set<string>();

  for (const source of sources) {
    let observation: SensitiveSourceObservation;
    if (source.kind === "response-json") {
      const responseObservation: ResponseSensitiveSourceObservation = {
        kind: "sensitive-source",
        category: source.category,
        confidence: source.confidence,
        evidence: sanitizeEvidence(source.evidence, sensitiveValues),
        sourceKind: "response-json",
        provenance: {
          origin: redactSensitive(source.provenance.origin, sensitiveValues).slice(0, 2_048),
          endpoint: canonicalizeEndpointPath(source.provenance.endpoint, sensitiveValues),
          location: sanitizeLabel(source.provenance.location, sensitiveValues, 1_024),
        },
        observedBy: "response",
      };
      observation = responseObservation;
    } else {
      const controlObservation: ControlSensitiveSourceObservation = {
        kind: "sensitive-source",
        category: source.category,
        confidence: source.confidence,
        evidence: sanitizeEvidence(source.evidence, sensitiveValues),
        sourceKind: source.control.elementKind === "contenteditable" ? "dom-control" : "form-input",
        control: sanitizeControl(source.control, sensitiveValues),
        page: sanitizePage(source.pageUrl, sensitiveValues),
        observedBy: source.observedBy,
      };
      observation = controlObservation;
    }
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

  if (customClassificationAmbiguous) {
    observations.push({
      kind: "diagnostic",
      code: "PS_CUSTOM_SOURCE_AMBIGUOUS",
      classification: "informational",
      message: "Multiple custom source categories matched a browser control.",
    });
  }

  return observations;
};
