import type { RawSensitiveSource } from "../discovery/source-model.js";
import type {
  RawConsoleSink,
  RawNetworkSink,
  RawSink,
  RawStorageSink,
  StorageType,
} from "../observe/sink-model.js";
import { type ClassifiedRecipient, classifyRecipient } from "./first-party.js";
import type {
  CorrelationInput,
  CorrelationResult,
  DataFlow,
  DataFlowSinkKind,
  DataFlowTestMetadata,
  FirstPartyConfig,
} from "./model.js";
import { canonicalizeEndpointPath, redactSensitive, sanitizeLabel } from "./redact.js";
import { createMatchVariants, createRedactionValues, type MatchVariant } from "./transforms.js";

export const MAX_DATA_FLOWS_PER_TEST = 2_000;
export const MAX_CORRELATION_COMPARISONS_PER_TEST = 1_000_000;
export const MAX_CORRELATION_SCANNED_BYTES_PER_TEST = 67_108_864;
export const MAX_PAGE_URLS_PER_TEST = 100;
export const MAX_PAGE_URL_LENGTH = 8_192;
const MAX_CORRELATION_URL_LENGTH = 8_192;
const MAX_BASE64_CONTAINER_LENGTH = 65_536;
const MAX_BASE64_TOKENS_PER_CANDIDATE = 32;
const BASE64_TOKEN_PATTERN = /[A-Za-z0-9+/_-]{16,}={0,2}/gu;

interface CorrelationState {
  comparisons: number;
  scannedBytes: number;
  limitReached: boolean;
  stopped: boolean;
}

type DecodedCandidateCache = Map<string, readonly string[]>;

interface FlowDestination {
  sinkKind: DataFlowSinkKind;
  recipient?: ClassifiedRecipient | undefined;
  method?: string | undefined;
  endpoint?: string | undefined;
  location: string;
}

interface UrlCandidate {
  value: string;
  location: string;
}

interface PreparedUrlDestination {
  recipient: ClassifiedRecipient;
  endpoint: string;
  candidates: UrlCandidate[];
}

const findMatch = (
  value: string,
  variants: readonly MatchVariant[],
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): MatchVariant | undefined => {
  for (const variant of variants) {
    state.comparisons += 1;
    state.scannedBytes += value.length;
    if (
      state.comparisons > MAX_CORRELATION_COMPARISONS_PER_TEST ||
      state.scannedBytes > MAX_CORRELATION_SCANNED_BYTES_PER_TEST
    ) {
      state.limitReached = true;
      state.stopped = true;
      return undefined;
    }
    if (value.includes(variant.value)) return variant;
  }

  const decodedCandidates = decodeBase64Candidates(value, decodedCandidateCache);
  const decodedNeedles = variants.filter((variant) =>
    ["EXACT", "LOWERCASE", "UPPERCASE"].includes(variant.kind),
  );
  for (const decoded of decodedCandidates) {
    for (const needle of decodedNeedles) {
      state.comparisons += 1;
      state.scannedBytes += decoded.length;
      if (
        state.comparisons > MAX_CORRELATION_COMPARISONS_PER_TEST ||
        state.scannedBytes > MAX_CORRELATION_SCANNED_BYTES_PER_TEST
      ) {
        state.limitReached = true;
        state.stopped = true;
        return undefined;
      }
      if (decoded.includes(needle.value)) return { kind: "BASE64", value: needle.value };
    }
  }
  return undefined;
};

const decodeBase64Token = (token: string): string | undefined => {
  if (token.length > MAX_BASE64_CONTAINER_LENGTH || token.length % 4 === 1) return undefined;
  const normalized = token.replaceAll("-", "+").replaceAll("_", "/");
  const unpadded = normalized.replace(/=+$/u, "");
  const padded = `${unpadded}${"=".repeat((4 - (unpadded.length % 4)) % 4)}`;
  try {
    const bytes = Buffer.from(padded, "base64");
    if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/u, "") !== unpadded) {
      return undefined;
    }
    const decoded = bytes.toString("utf8");
    return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const decodeBase64Candidates = (value: string, cache: DecodedCandidateCache): readonly string[] => {
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  if (value.length > MAX_BASE64_CONTAINER_LENGTH) {
    cache.set(value, []);
    return [];
  }

  const decoded = new Set<string>();
  let tokenCount = 0;
  for (const match of value.matchAll(BASE64_TOKEN_PATTERN)) {
    if (tokenCount >= MAX_BASE64_TOKENS_PER_CANDIDATE) break;
    tokenCount += 1;
    const candidate = decodeBase64Token(match[0]);
    if (candidate !== undefined) decoded.add(candidate);
  }
  const result = Array.from(decoded);
  cache.set(value, result);
  return result;
};

const decodeQueryName = (value: string): string => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
};

const extractUrlCandidates = (rawUrl: string): UrlCandidate[] => {
  try {
    const url = new URL(rawUrl);
    const candidates: UrlCandidate[] = [
      { value: url.pathname, location: "url.path" },
      { value: url.hostname, location: "url.host" },
    ];
    if (url.username.length > 0) {
      candidates.push({ value: url.username, location: "url.username" });
    }
    if (url.password.length > 0) {
      candidates.push({ value: url.password, location: "url.password" });
    }
    if (url.hash.length > 1) {
      candidates.push({ value: url.hash.slice(1), location: "url.fragment" });
    }

    for (const pair of url.search.slice(1).split("&")) {
      if (pair.length === 0) continue;
      const separator = pair.indexOf("=");
      const rawName = separator < 0 ? pair : pair.slice(0, separator);
      const rawValue = separator < 0 ? "" : pair.slice(separator + 1);
      const location = `url.query.${decodeQueryName(rawName)}`;
      candidates.push({ value: rawName, location: "url.query-name" });
      candidates.push({ value: rawValue, location });
    }
    return candidates;
  } catch {
    return [{ value: rawUrl, location: "url.raw" }];
  }
};

const physicalNetworkSink = (location: string): DataFlowSinkKind => {
  if (location.startsWith("url.")) return "request-url";
  if (location.startsWith("header.")) return "request-header";
  return "request-body";
};

const storageSinkKind = (storageType: StorageType): DataFlowSinkKind => {
  if (storageType === "local-storage") return "local-storage";
  if (storageType === "session-storage") return "session-storage";
  return "cookie";
};

const sourceKind = (source: RawSensitiveSource): DataFlow["sourceKind"] => {
  if (source.kind === "response-json") return "response-json";
  return source.control.elementKind === "contenteditable" ? "dom-control" : "form-input";
};

const sanitizeTestMetadata = (
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
): DataFlowTestMetadata => ({
  file: sanitizeLabel(test.file, sensitiveValues, 2_048),
  title: sanitizeLabel(test.title, sensitiveValues, 2_048),
  project: sanitizeLabel(test.project, sensitiveValues, 512),
});

const sanitizeRecipient = (
  recipient: ClassifiedRecipient,
  sensitiveValues: readonly string[],
): NonNullable<DataFlow["recipient"]> => ({
  origin: redactSensitive(recipient.origin, sensitiveValues).slice(0, 2_048),
  host: redactSensitive(recipient.host, sensitiveValues).slice(0, 255),
  firstParty: recipient.firstParty,
});

const endpointFromUrl = (rawUrl: string, sensitiveValues: readonly string[]): string => {
  try {
    return canonicalizeEndpointPath(new URL(rawUrl).pathname, sensitiveValues);
  } catch {
    return "/";
  }
};

const prepareUrlDestination = (
  rawUrl: string,
  firstParty: FirstPartyConfig,
  sensitiveValues: readonly string[],
  state: CorrelationState,
): PreparedUrlDestination => {
  const boundedUrl = rawUrl.slice(0, MAX_CORRELATION_URL_LENGTH);
  if (boundedUrl.length < rawUrl.length) state.limitReached = true;
  return {
    recipient: classifyRecipient(boundedUrl, firstParty),
    endpoint: endpointFromUrl(boundedUrl, sensitiveValues),
    candidates: extractUrlCandidates(boundedUrl),
  };
};

const flowIdentity = (flow: DataFlow): string =>
  JSON.stringify([
    flow.dataCategory,
    flow.sourceKind,
    flow.sourceConfidence,
    flow.sourceProvenance?.origin,
    flow.sourceProvenance?.endpoint,
    flow.sourceProvenance?.location,
    flow.sinkKind,
    flow.recipient?.origin,
    flow.recipient?.host,
    flow.recipient?.firstParty,
    flow.method,
    flow.endpoint,
    flow.location,
    flow.transform,
    flow.test.file,
    flow.test.title,
    flow.test.project,
  ]);

const createFlow = (
  source: RawSensitiveSource,
  match: MatchVariant,
  destination: FlowDestination,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
): DataFlow => {
  const flow: DataFlow = {
    kind: "data-flow",
    dataCategory: source.category,
    sourceKind: sourceKind(source),
    sourceConfidence: source.confidence,
    sinkKind: destination.sinkKind,
    location: sanitizeLabel(destination.location, sensitiveValues),
    transform: match.kind,
    test,
  };
  if (source.kind === "response-json") {
    flow.sourceProvenance = {
      origin: redactSensitive(source.provenance.origin, sensitiveValues).slice(0, 2_048),
      endpoint: canonicalizeEndpointPath(source.provenance.endpoint, sensitiveValues),
      location: sanitizeLabel(source.provenance.location, sensitiveValues, 1_024),
    };
  }
  if (destination.recipient !== undefined) {
    flow.recipient = sanitizeRecipient(destination.recipient, sensitiveValues);
  }
  if (destination.method !== undefined) {
    flow.method = sanitizeLabel(destination.method, sensitiveValues, 32);
  }
  if (destination.endpoint !== undefined) {
    flow.endpoint = destination.endpoint;
  }
  return flow;
};

const addCandidateFlow = (
  source: RawSensitiveSource,
  variants: readonly MatchVariant[],
  candidateValue: string,
  destination: FlowDestination,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
  flows: DataFlow[],
  identities: Set<string>,
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): boolean => {
  if (state.stopped) return false;
  const match = findMatch(candidateValue, variants, state, decodedCandidateCache);
  if (match === undefined) return false;
  const flow = createFlow(source, match, destination, test, sensitiveValues);
  const identity = flowIdentity(flow);
  if (identities.has(identity)) return true;
  if (flows.length >= MAX_DATA_FLOWS_PER_TEST) {
    state.limitReached = true;
    state.stopped = true;
    return false;
  }
  identities.add(identity);
  flows.push(flow);
  return true;
};

const networkSinkKind = (recipient: ClassifiedRecipient, location: string): DataFlowSinkKind =>
  recipient.valid && !recipient.firstParty ? "external-request" : physicalNetworkSink(location);

const isAmbientCookieLocation = (location: string): boolean =>
  location.startsWith("header.cookie.");

const correlateNetwork = (
  source: RawSensitiveSource,
  variants: readonly MatchVariant[],
  sink: RawNetworkSink,
  prepared: PreparedUrlDestination,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
  flows: DataFlow[],
  identities: Set<string>,
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): void => {
  const add = (value: string, location: string): boolean =>
    addCandidateFlow(
      source,
      variants,
      value,
      {
        sinkKind: networkSinkKind(prepared.recipient, location),
        recipient: prepared.recipient,
        method: isAmbientCookieLocation(location) ? undefined : sink.method,
        endpoint: isAmbientCookieLocation(location) ? undefined : prepared.endpoint,
        location,
      },
      test,
      sensitiveValues,
      flows,
      identities,
      state,
      decodedCandidateCache,
    );

  for (const candidate of prepared.candidates) {
    add(candidate.value, candidate.location);
    if (state.stopped) return;
  }
  for (const [name, value] of Object.entries(sink.headers)) {
    if (name === "cookie") continue;
    const location = `header.${name}`;
    add(name, location);
    add(value, location);
    if (state.stopped) return;
  }
  for (const material of sink.materials) {
    if (
      material.location.startsWith("url.") ||
      (material.location.startsWith("header.") && !isAmbientCookieLocation(material.location))
    ) {
      continue;
    }
    add(material.location, material.location);
    add(material.value, material.location);
    if (state.stopped) return;
  }
};

const correlateConsole = (
  source: RawSensitiveSource,
  variants: readonly MatchVariant[],
  sink: RawConsoleSink,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
  flows: DataFlow[],
  identities: Set<string>,
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): void => {
  const add = (value: string, location: string): boolean =>
    addCandidateFlow(
      source,
      variants,
      value,
      { sinkKind: "console", location },
      test,
      sensitiveValues,
      flows,
      identities,
      state,
      decodedCandidateCache,
    );
  const structured = sink.materials.filter((material) => material.location !== "console.text");
  let structuredMatch = false;
  for (const material of structured) {
    structuredMatch = add(material.location, material.location) || structuredMatch;
    structuredMatch = add(material.value, material.location) || structuredMatch;
    if (state.stopped) return;
  }
  if (structuredMatch) return;
  for (const material of sink.materials) {
    if (material.location !== "console.text") continue;
    add(material.value, material.location);
    if (state.stopped) return;
  }
};

const correlateStorage = (
  source: RawSensitiveSource,
  variants: readonly MatchVariant[],
  sink: RawStorageSink,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
  flows: DataFlow[],
  identities: Set<string>,
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): void => {
  const kind = storageSinkKind(sink.storageType);
  addCandidateFlow(
    source,
    variants,
    sink.key,
    { sinkKind: kind, location: "storage.key" },
    test,
    sensitiveValues,
    flows,
    identities,
    state,
    decodedCandidateCache,
  );
  addCandidateFlow(
    source,
    variants,
    sink.value,
    { sinkKind: kind, location: sink.key },
    test,
    sensitiveValues,
    flows,
    identities,
    state,
    decodedCandidateCache,
  );
};

const correlatePageUrl = (
  source: RawSensitiveSource,
  variants: readonly MatchVariant[],
  prepared: PreparedUrlDestination,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
  flows: DataFlow[],
  identities: Set<string>,
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): void => {
  for (const candidate of prepared.candidates) {
    addCandidateFlow(
      source,
      variants,
      candidate.value,
      {
        sinkKind: "request-url",
        recipient: prepared.recipient,
        endpoint: prepared.endpoint,
        location: candidate.location,
      },
      test,
      sensitiveValues,
      flows,
      identities,
      state,
      decodedCandidateCache,
    );
    if (state.stopped) return;
  }
};

const correlateSink = (
  source: RawSensitiveSource,
  variants: readonly MatchVariant[],
  sink: RawSink,
  preparedNetwork: ReadonlyMap<RawNetworkSink, PreparedUrlDestination>,
  test: DataFlowTestMetadata,
  sensitiveValues: readonly string[],
  flows: DataFlow[],
  identities: Set<string>,
  state: CorrelationState,
  decodedCandidateCache: DecodedCandidateCache,
): void => {
  if (sink.kind === "network") {
    const prepared = preparedNetwork.get(sink);
    if (prepared === undefined) return;
    correlateNetwork(
      source,
      variants,
      sink,
      prepared,
      test,
      sensitiveValues,
      flows,
      identities,
      state,
      decodedCandidateCache,
    );
    return;
  }
  if (sink.kind === "console") {
    correlateConsole(
      source,
      variants,
      sink,
      test,
      sensitiveValues,
      flows,
      identities,
      state,
      decodedCandidateCache,
    );
    return;
  }
  correlateStorage(
    source,
    variants,
    sink,
    test,
    sensitiveValues,
    flows,
    identities,
    state,
    decodedCandidateCache,
  );
};

export const correlateSensitiveData = (input: CorrelationInput): CorrelationResult => {
  const flows: DataFlow[] = [];
  const identities = new Set<string>();
  const decodedCandidateCache: DecodedCandidateCache = new Map();
  const state: CorrelationState = {
    comparisons: 0,
    scannedBytes: 0,
    limitReached: false,
    stopped: false,
  };
  const sensitiveValues = createRedactionValues(input.sources);
  const test = sanitizeTestMetadata(input.test, sensitiveValues);
  const firstParty = input.firstParty ?? {};
  const pageUrls = (input.pageUrls ?? [])
    .slice(0, MAX_PAGE_URLS_PER_TEST)
    .filter((url) => url.length <= MAX_PAGE_URL_LENGTH);
  if ((input.pageUrls?.length ?? 0) > pageUrls.length) state.limitReached = true;
  const preparedNetwork = new Map<RawNetworkSink, PreparedUrlDestination>();
  for (const sink of input.sinks) {
    if (sink.kind !== "network") continue;
    preparedNetwork.set(sink, prepareUrlDestination(sink.url, firstParty, sensitiveValues, state));
  }
  const preparedPageUrls = pageUrls.map((url) =>
    prepareUrlDestination(url, firstParty, sensitiveValues, state),
  );

  for (const source of input.sources) {
    const variants = createMatchVariants(source);
    for (const sink of input.sinks) {
      // Browser-to-worker delivery order is not a causal clock. Control sources
      // therefore correlate across their isolated test, like teardown fallback
      // samples. Response values are different: the browser cannot expose them to
      // later code until the response event, so retain strict response ordering.
      const isFinalStorageSnapshot = sink.kind === "storage" && sink.observedBy === "snapshot";
      const isOriginatingRequest =
        source.kind === "response-json" &&
        source.requestIdentity !== undefined &&
        sink.kind === "network" &&
        sink.requestIdentity === source.requestIdentity;
      if (
        isOriginatingRequest ||
        (source.observedBy === "response" &&
          !isFinalStorageSnapshot &&
          sink.timestamp <= source.timestamp)
      ) {
        continue;
      }
      correlateSink(
        source,
        variants,
        sink,
        preparedNetwork,
        test,
        sensitiveValues,
        flows,
        identities,
        state,
        decodedCandidateCache,
      );
      if (state.stopped) break;
    }
    if (!state.stopped) {
      for (const preparedPageUrl of preparedPageUrls) {
        correlatePageUrl(
          source,
          variants,
          preparedPageUrl,
          test,
          sensitiveValues,
          flows,
          identities,
          state,
          decodedCandidateCache,
        );
        if (state.stopped) break;
      }
    }
    if (state.stopped) break;
  }

  flows.sort((left, right) => flowIdentity(left).localeCompare(flowIdentity(right)));
  return { flows, limitReached: state.limitReached };
};
