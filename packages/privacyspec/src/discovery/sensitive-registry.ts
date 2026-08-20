import { randomUUID } from "node:crypto";
import { classifySensitiveControl } from "./classify-control.js";
import type { RawSensitiveSource, SourceControlMetadata } from "./source-model.js";

export const MAX_SENSITIVE_SOURCES_PER_TEST = 500;

const MAX_RAW_VALUE_LENGTH = 4_096;
const MAX_URL_LENGTH = 8_192;
const MAX_METADATA_LENGTH = 200;

export interface SensitiveSourceStreamEvent {
  version: 1;
  token: string;
  kind: "source" | "limit-reached";
  source?: RawSensitiveSource | undefined;
}

export interface SensitiveRegistrySnapshot {
  sources: RawSensitiveSource[];
  limitReached: boolean;
}

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

const parseRawSource = (value: unknown): RawSensitiveSource | undefined => {
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
    raw,
    ...classification,
    control,
    pageUrl,
    timestamp: value.timestamp,
    observedBy: value.observedBy,
  };
};

const cloneSource = (source: RawSensitiveSource): RawSensitiveSource => ({
  ...source,
  evidence: source.evidence.map((item) => ({ ...item })),
  control: { ...source.control },
});

export class SensitiveValueRegistry {
  readonly #sources: RawSensitiveSource[] = [];
  readonly #identities = new Set<string>();
  #active = true;
  #limitReached = false;
  #streamToken: string = randomUUID();

  get streamToken(): string {
    return this.#streamToken;
  }

  recordStreamEvent(value: unknown): void {
    if (
      !this.#active ||
      !isRecord(value) ||
      value.version !== 1 ||
      value.token !== this.#streamToken
    ) {
      return;
    }
    if (value.kind === "limit-reached") {
      this.#limitReached = true;
      return;
    }
    if (value.kind === "source") this.add(value.source);
  }

  add(value: unknown): void {
    if (!this.#active) return;
    const source = parseRawSource(value);
    if (source === undefined) return;

    const identity = JSON.stringify([source.category, source.raw]);
    if (this.#identities.has(identity)) return;
    if (this.#sources.length >= MAX_SENSITIVE_SOURCES_PER_TEST) {
      this.#limitReached = true;
      return;
    }

    this.#identities.add(identity);
    this.#sources.push(source);
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
    this.#identities.clear();
    this.#limitReached = false;
    this.#streamToken = "";
  }
}
