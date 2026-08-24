import { randomUUID } from "node:crypto";
import { classifySensitiveControl } from "./classify-control.js";
import {
  classifyCustomSensitiveControl,
  type NormalizedCustomDomSourceClassifier,
} from "./custom-classifiers.js";
import type {
  RawControlSensitiveSource,
  RawResponseSensitiveSource,
  RawSensitiveSource,
  SourceControlMetadata,
} from "./source-model.js";

export const MAX_SENSITIVE_SOURCES_PER_TEST = 500;

const MAX_RAW_VALUE_LENGTH = 4_096;
const MAX_URL_LENGTH = 8_192;
const MAX_METADATA_LENGTH = 200;

export interface SensitiveSourceStreamEvent {
  version: 1;
  token: string;
  kind: "source" | "limit-reached" | "classification-ambiguous";
  source?: RawControlSensitiveSource | undefined;
}

export interface SensitiveRegistrySnapshot {
  sources: RawSensitiveSource[];
  limitReached: boolean;
  customClassificationAmbiguous: boolean;
}

export type ParsedSensitiveSourceStreamEvent =
  | { kind: "source"; source: RawControlSensitiveSource }
  | { kind: "limit-reached" }
  | { kind: "classification-ambiguous" };

const elementKinds = new Set<SourceControlMetadata["elementKind"]>([
  "input",
  "textarea",
  "select",
  "contenteditable",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBoundedString = (
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  required: boolean,
): string | undefined => {
  const value = record[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
};

const parseControl = (value: unknown): SourceControlMetadata | undefined => {
  if (
    !isRecord(value) ||
    !elementKinds.has(value.elementKind as SourceControlMetadata["elementKind"])
  ) {
    return undefined;
  }

  const control: SourceControlMetadata = {
    elementKind: value.elementKind as SourceControlMetadata["elementKind"],
  };
  for (const key of [
    "type",
    "name",
    "id",
    "autocomplete",
    "ariaLabel",
    "associatedLabel",
    "placeholder",
  ] as const) {
    if (value[key] === undefined) continue;
    const metadata = readBoundedString(value, key, MAX_METADATA_LENGTH, false);
    if (metadata === undefined) return undefined;
    control[key] = metadata;
  }
  return control;
};

type ParsedRawControlSourceResult =
  | { kind: "source"; source: RawControlSensitiveSource }
  | { kind: "classification-ambiguous" };

const parseRawControlSourceResult = (
  value: unknown,
  customClassifiers: readonly NormalizedCustomDomSourceClassifier[] = [],
): ParsedRawControlSourceResult | undefined => {
  if (!isRecord(value)) return undefined;

  const raw = readBoundedString(value, "raw", MAX_RAW_VALUE_LENGTH, true);
  const pageUrl = readBoundedString(value, "pageUrl", MAX_URL_LENGTH, true);
  const control = parseControl(value.control);
  if (
    raw === undefined ||
    raw.length < 6 ||
    raw.trim().length === 0 ||
    pageUrl === undefined ||
    control === undefined ||
    (value.observedBy !== "event" && value.observedBy !== "fallback") ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp)
  ) {
    return undefined;
  }

  const input = {
    value: raw,
    type: control.type,
    autocomplete: control.autocomplete,
    name: control.name,
    id: control.id,
    ariaLabel: control.ariaLabel,
    associatedLabel: control.associatedLabel,
    placeholder: control.placeholder,
  };
  const builtInClassification = classifySensitiveControl(input);
  const customResult =
    builtInClassification === undefined
      ? classifyCustomSensitiveControl(input, customClassifiers)
      : { ambiguous: false };
  if (customResult.ambiguous) return { kind: "classification-ambiguous" };
  const classification = builtInClassification ?? customResult.classification;
  if (classification === undefined) return undefined;

  return {
    kind: "source",
    source: {
      kind: "control",
      raw,
      ...classification,
      control,
      pageUrl,
      timestamp: value.timestamp,
      observedBy: value.observedBy,
    },
  };
};

export const parseRawControlSource = (
  value: unknown,
  customClassifiers: readonly NormalizedCustomDomSourceClassifier[] = [],
): RawControlSensitiveSource | undefined => {
  const result = parseRawControlSourceResult(value, customClassifiers);
  return result?.kind === "source" ? result.source : undefined;
};

export const parseSensitiveSourceStreamEvent = (
  value: unknown,
  token: string,
  customClassifiers: readonly NormalizedCustomDomSourceClassifier[] = [],
): ParsedSensitiveSourceStreamEvent | undefined => {
  if (!isRecord(value) || value.version !== 1 || value.token !== token) return undefined;
  if (value.kind === "limit-reached") return { kind: "limit-reached" };
  if (value.kind === "classification-ambiguous") return { kind: "classification-ambiguous" };
  if (value.kind !== "source") return undefined;
  return parseRawControlSourceResult(value.source, customClassifiers);
};

const cloneSource = (source: RawSensitiveSource): RawSensitiveSource =>
  source.kind === "response-json"
    ? {
        ...source,
        evidence: source.evidence.map((item) => ({ ...item })),
        provenance: { ...source.provenance },
      }
    : {
        ...source,
        evidence: source.evidence.map((item) => ({ ...item })),
        control: { ...source.control },
      };

export type SensitiveSourceAddResult = "added" | "duplicate" | "limit-reached";

export class SensitiveValueRegistry {
  readonly #sources: RawSensitiveSource[] = [];
  readonly #identityIndexes = new Map<string, number>();
  #active = true;
  #limitReached = false;
  #customClassificationAmbiguous = false;
  #streamToken: string = randomUUID();

  constructor(
    private readonly customClassifiers: readonly NormalizedCustomDomSourceClassifier[] = [],
  ) {}

  get streamToken(): string {
    return this.#streamToken;
  }

  hasSources(): boolean {
    return this.#sources.length > 0;
  }

  recordStreamEvent(value: unknown): void {
    if (!this.#active) return;
    const event = parseSensitiveSourceStreamEvent(value, this.#streamToken, this.customClassifiers);
    if (event?.kind === "limit-reached") this.#limitReached = true;
    else if (event?.kind === "classification-ambiguous") {
      this.#customClassificationAmbiguous = true;
    } else if (event?.kind === "source") this.#addParsed(event.source);
  }

  markLimitReached(): void {
    if (this.#active) this.#limitReached = true;
  }

  markCustomClassificationAmbiguous(): void {
    if (this.#active) this.#customClassificationAmbiguous = true;
  }

  add(value: unknown): void {
    if (!this.#active) return;
    const result = parseRawControlSourceResult(value, this.customClassifiers);
    if (result?.kind === "classification-ambiguous") {
      this.#customClassificationAmbiguous = true;
      return;
    }
    if (result?.kind !== "source") return;

    this.#addParsed(result.source);
  }

  addResponse(source: RawResponseSensitiveSource): SensitiveSourceAddResult {
    if (!this.#active) return "limit-reached";
    return this.#addParsed(cloneSource(source) as RawResponseSensitiveSource);
  }

  #addParsed(source: RawSensitiveSource): SensitiveSourceAddResult {
    const identity =
      source.kind === "response-json"
        ? JSON.stringify([
            source.category,
            source.raw,
            source.kind,
            source.provenance.origin,
            source.provenance.endpoint,
            source.provenance.location,
          ])
        : JSON.stringify([source.category, source.raw]);
    const existingIndex = this.#identityIndexes.get(identity);
    if (existingIndex !== undefined) {
      const existing = this.#sources[existingIndex];
      if (
        existing?.kind === "response-json" &&
        source.kind === "response-json" &&
        source.timestamp < existing.timestamp
      ) {
        this.#sources[existingIndex] = cloneSource(source);
      }
      return "duplicate";
    }
    if (this.#sources.length >= MAX_SENSITIVE_SOURCES_PER_TEST) {
      this.#limitReached = true;
      return "limit-reached";
    }

    this.#identityIndexes.set(identity, this.#sources.length);
    this.#sources.push(source);
    return "added";
  }

  snapshot(): SensitiveRegistrySnapshot {
    return {
      sources: this.#sources.map(cloneSource),
      limitReached: this.#limitReached,
      customClassificationAmbiguous: this.#customClassificationAmbiguous,
    };
  }

  dispose(): void {
    this.#active = false;
    this.#sources.length = 0;
    this.#identityIndexes.clear();
    this.#limitReached = false;
    this.#customClassificationAmbiguous = false;
    this.#streamToken = "";
  }
}
