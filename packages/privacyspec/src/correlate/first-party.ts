import type { FirstPartyConfig } from "./model.js";

export interface ClassifiedRecipient {
  origin: string;
  host: string;
  firstParty: boolean;
  valid: boolean;
}

const normalizeOrigin = (value: string): string | undefined => {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? undefined : origin.toLowerCase();
  } catch {
    return undefined;
  }
};

const normalizeHost = (value: string): string | undefined => {
  const candidate = value.includes("://") ? value : `http://${value}`;
  try {
    const hostname = new URL(candidate).hostname.toLowerCase().replace(/\.$/u, "");
    return hostname || undefined;
  } catch {
    return undefined;
  }
};

export const classifyRecipient = (
  rawUrl: string,
  config: FirstPartyConfig = {},
): ClassifiedRecipient => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { origin: "unknown", host: "unknown", firstParty: false, valid: false };
  }

  const origin = url.origin === "null" ? "opaque" : url.origin;
  const host = url.hostname || "unknown";
  const configuredOrigins = new Set(
    (config.origins ?? []).map(normalizeOrigin).filter((value) => value !== undefined),
  );
  const configuredHosts = new Set(
    (config.hosts ?? []).map(normalizeHost).filter((value) => value !== undefined),
  );
  const normalizedRecipientHost = normalizeHost(host);
  const firstParty =
    (origin !== "opaque" && configuredOrigins.has(origin.toLowerCase())) ||
    (normalizedRecipientHost !== undefined && configuredHosts.has(normalizedRecipientHost));

  return { origin, host, firstParty, valid: true };
};
