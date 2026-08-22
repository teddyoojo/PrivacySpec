import { randomUUID } from "node:crypto";
import { classifySensitiveControl } from "./classify-control.js";
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
  kind: "source" | "limit-reached";
  source?: RawControlSensitiveSource | undefined;
}

export interface SensitiveRegistrySnapshot {
  sources: RawSensitiveSource[];
  limitReached: boolean;
}

export type ParsedSensitiveSourceStreamEvent =
  | { kind: "source"; source: RawControlSensitiveSource }
  | { kind: "limit-reached" };

const elementKinds = new Set<SourceControlMetadata["elementKind"]>([
  "input",
  "textarea",
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

export const parseRawControlSource = (value: unknown): RawControlSensitiveSource | undefined => {
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

  const classification = classifySensitiveControl({
    value: raw,
    type: control.type,
    autocomplete: control.autocomplete,
  });
  if (classification === undefined) return undefined;

  return {
    kind: "control",
    raw,
    ...classification,
    control,
    pageUrl,
    timestamp: value.timestamp,
    observedBy: value.observedBy,
  };
};

export const parseSensitiveSourceStreamEvent = (
  value: unknown,
  token: string,
): ParsedSensitiveSourceStreamEvent | undefined => {
  if (!isRecord(value) || value.version !== 1 || value.token !== token) return undefined;
  if (value.kind === "limit-reached") return { kind: "limit-reached" };
  if (value.kind !== "source") return undefined;
  const source = parseRawControlSource(value.source);
  return source === undefined ? undefined : { kind: "source", source };
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
  #streamToken: string = randomUUID();

  get streamToken(): string {
    return this.#streamToken;
  }

  hasSources(): boolean {
    return this.#sources.length > 0;
  }

  recordStreamEvent(value: unknown): void {
    if (!this.#active) return;
    const event = parseSensitiveSourceStreamEvent(value, this.#streamToken);
    if (event?.kind === "limit-reached") this.#limitReached = true;
    else if (event?.kind === "source") this.#addParsed(event.source);
  }

  markLimitReached(): void {
    if (this.#active) this.#limitReached = true;
  }

  add(value: unknown): void {
    if (!this.#active) return;
    const source = parseRawControlSource(value);
    if (source === undefined) return;

    this.#addParsed(source);
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
    };
  }

  dispose(): void {
    this.#active = false;
    this.#sources.length = 0;
    this.#identityIndexes.clear();
    this.#limitReached = false;
    this.#streamToken = "";
  }
}
