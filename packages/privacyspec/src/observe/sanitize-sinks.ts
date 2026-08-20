import { normalizePath, redactSensitive, sanitizeLabel } from "../correlate/redact.js";
import { createRedactionValues } from "../correlate/transforms.js";
import type { RawSensitiveSource } from "../discovery/source-model.js";
import type {
  ConsoleSinkObservation,
  NetworkSinkObservation,
  RawConsoleSink,
  RawNetworkSink,
  RawStorageSink,
  SanitizedPageLocation,
  SinkObservation,
  StorageSinkObservation,
} from "./sink-model.js";
import type { SinkRegistrySnapshot } from "./sink-registry.js";

const sanitizePage = (
  rawUrl: string | undefined,
  variants: string[],
): SanitizedPageLocation | undefined => {
  if (rawUrl === undefined) return undefined;
  try {
    const url = new URL(rawUrl);
    return {
      origin:
        url.origin === "null" ? "opaque" : redactSensitive(url.origin, variants).slice(0, 2_048),
      path: normalizePath(url.pathname, variants),
    };
  } catch {
    return { origin: "unknown", path: "/" };
  }
};

const sanitizeNetwork = (sink: RawNetworkSink, variants: string[]): NetworkSinkObservation => {
  let recipient = { origin: "unknown", host: "unknown" };
  let endpoint = "/";
  try {
    const url = new URL(sink.url);
    recipient = {
      origin:
        url.origin === "null" ? "opaque" : redactSensitive(url.origin, variants).slice(0, 2_048),
      host: url.hostname ? redactSensitive(url.hostname, variants).slice(0, 255) : "unknown",
    };
    endpoint = normalizePath(url.pathname, variants);
  } catch {
    // Keep conservative placeholders for malformed URLs.
  }

  const observation: NetworkSinkObservation = {
    kind: "sink",
    sink: "network",
    method: sanitizeLabel(sink.method, variants).slice(0, 32),
    resourceType: sanitizeLabel(sink.resourceType, variants).slice(0, 64),
    recipient,
    endpoint,
    locations: Array.from(
      new Set(sink.materials.map((material) => sanitizeLabel(material.location, variants))),
    ).sort(),
    body: {
      kind: sink.bodyKind,
      size: sink.bodySize,
      truncated: sink.bodyTruncated,
    },
  };
  const page = sanitizePage(sink.pageUrl ?? sink.frameUrl, variants);
  if (page !== undefined) observation.page = page;
  return observation;
};

const sanitizeConsole = (sink: RawConsoleSink, variants: string[]): ConsoleSinkObservation => {
  const observation: ConsoleSinkObservation = {
    kind: "sink",
    sink: "console",
    level: sanitizeLabel(sink.level, variants).slice(0, 64),
    argumentCount: sink.argumentCount,
    locations: sink.materials.map((material) => sanitizeLabel(material.location, variants)),
  };
  const page = sanitizePage(sink.pageUrl ?? sink.sourceUrl, variants);
  if (page !== undefined) observation.page = page;
  return observation;
};

const sanitizeStorage = (sink: RawStorageSink, variants: string[]): StorageSinkObservation => ({
  kind: "sink",
  sink: "storage",
  storageType: sink.storageType,
  key: sanitizeLabel(sink.key, variants),
  observedBy: sink.observedBy,
  page: sanitizePage(sink.pageUrl, variants) ?? { origin: "unknown", path: "/" },
});

export const sanitizeSinkSnapshot = (
  snapshot: SinkRegistrySnapshot,
  sources: RawSensitiveSource[],
): SinkObservation[] => {
  const variants = createRedactionValues(sources);
  const observations: SinkObservation[] = [];
  const identities = new Set<string>();
  const add = (observation: SinkObservation): void => {
    const identity = JSON.stringify(observation);
    if (identities.has(identity)) return;
    identities.add(identity);
    observations.push(observation);
  };

  for (const sink of snapshot.network) add(sanitizeNetwork(sink, variants));
  for (const sink of snapshot.console) add(sanitizeConsole(sink, variants));
  for (const sink of snapshot.storage) add(sanitizeStorage(sink, variants));
  for (const collector of snapshot.limitsReached) {
    add({
      kind: "diagnostic",
      code: "PS_SINK_LIMIT_REACHED",
      classification: "informational",
      collector,
      message: `${collector} sink collection reached its per-test safety limit.`,
    });
  }
  return observations;
};
