import { createHash } from "node:crypto";
import type { RawSensitiveSource } from "../discovery/source-model.js";
import type { TransformKind } from "./model.js";

export interface MatchVariant {
  kind: TransformKind;
  value: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const addVariant = (
  variants: MatchVariant[],
  identities: Set<string>,
  kind: TransformKind,
  value: string,
): void => {
  if (value.length === 0 || identities.has(value)) return;
  identities.add(value);
  variants.push({ kind, value });
};

const urlEncodings = (value: string): string[] => {
  const encodings = new Set<string>();
  try {
    const encoded = encodeURIComponent(value);
    encodings.add(encoded);
    encodings.add(encoded.replaceAll(/%[0-9A-F]{2}/gu, (match) => match.toLowerCase()));
  } catch {
    // Ignore malformed surrogate input instead of failing fixture teardown.
  }
  try {
    const form = new URLSearchParams([["value", value]]).toString().slice("value=".length);
    encodings.add(form);
  } catch {
    // The exact representation is still available.
  }
  return Array.from(encodings);
};

const base64 = (value: string): string => Buffer.from(value, "utf8").toString("base64");

export const createMatchVariants = (source: RawSensitiveSource): MatchVariant[] => {
  const variants: MatchVariant[] = [];
  const identities = new Set<string>();
  const caseVariants =
    source.category === "personal.email"
      ? [
          { kind: "LOWERCASE" as const, value: source.raw.toLowerCase() },
          { kind: "UPPERCASE" as const, value: source.raw.toUpperCase() },
        ]
      : [];

  addVariant(variants, identities, "EXACT", source.raw);
  for (const variant of caseVariants) {
    addVariant(variants, identities, variant.kind, variant.value);
  }
  for (const value of [source.raw, ...caseVariants.map((variant) => variant.value)]) {
    for (const encoded of urlEncodings(value)) {
      addVariant(variants, identities, "URL_ENCODED", encoded);
    }
  }
  addVariant(variants, identities, "BASE64", base64(source.raw));
  addVariant(variants, identities, "SHA256", sha256(source.raw));
  if (source.category === "personal.email") {
    addVariant(variants, identities, "SHA256_NORMALIZED", sha256(source.raw.toLowerCase()));
  }
  return variants;
};

export const createRedactionValues = (sources: readonly RawSensitiveSource[]): string[] => {
  const values = new Set<string>();
  for (const source of sources) {
    const rawVariants = [source.raw, source.raw.toLowerCase(), source.raw.toUpperCase()];
    for (const raw of rawVariants) {
      if (raw.length === 0) continue;
      values.add(raw);
      for (const encoded of urlEncodings(raw)) values.add(encoded);
      values.add(base64(raw));
      values.add(sha256(raw));
    }
    for (const variant of createMatchVariants(source)) values.add(variant.value);
  }
  values.delete("");
  return Array.from(values).sort((left, right) => right.length - left.length);
};
