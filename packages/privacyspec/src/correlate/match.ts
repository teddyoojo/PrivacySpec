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
import { normalizePath, redactSensitive, sanitizeLabel } from "./redact.js";
import { createMatchVariants, createRedactionValues, type MatchVariant } from "./transforms.js";

export const MAX_DATA_FLOWS_PER_TEST = 2_000;
export const MAX_CORRELATION_COMPARISONS_PER_TEST = 1_000_000;
export const MAX_CORRELATION_SCANNED_BYTES_PER_TEST = 67_108_864;
export const MAX_PAGE_URLS_PER_TEST = 100;
export const MAX_PAGE_URL_LENGTH = 8_192;
const MAX_CORRELATION_URL_LENGTH = 8_192;

interface CorrelationState {
  comparisons: number;
  scannedBytes: number;
  limitReached: boolean;
  stopped: boolean;
}

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
  return undefined;
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

const sourceKind = (source: RawSensitiveSource): DataFlow["sourceKind"] =>
  source.control.elementKind === "contenteditable" ? "dom-control" : "form-input";

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
    return normalizePath(new URL(rawUrl).pathname, sensitiveValues);
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
): boolean => {
  if (state.stopped) return false;
  const match = findMatch(candidateValue, variants, state);
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
): void => {
  const add = (value: string, location: string): boolean =>
    addCandidateFlow(
      source,
      variants,
      value,
      {
        sinkKind: networkSinkKind(prepared.recipient, location),
        recipient: prepared.recipient,
        method: sink.method,
        endpoint: prepared.endpoint,
        location,
      },
      test,
      sensitiveValues,
      flows,
      identities,
      state,
    );

  for (const candidate of prepared.candidates) {
    add(candidate.value, candidate.location);
    if (state.stopped) return;
  }
  for (const [name, value] of Object.entries(sink.headers)) {
    const location = `header.${name}`;
    add(name, location);
    add(value, location);
    if (state.stopped) return;
  }
  for (const material of sink.materials) {
    if (material.location.startsWith("url.") || material.location.startsWith("header.")) {
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
    );
    return;
  }
  if (sink.kind === "console") {
    correlateConsole(source, variants, sink, test, sensitiveValues, flows, identities, state);
    return;
  }
  correlateStorage(source, variants, sink, test, sensitiveValues, flows, identities, state);
};

export const correlateSensitiveData = (input: CorrelationInput): CorrelationResult => {
  const flows: DataFlow[] = [];
  const identities = new Set<string>();
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
      // Event-observed values cannot have caused an occurrence captured before
      // the user entered them. Fallback sources are final-state samples, so
      // their teardown timestamp does not describe when the value first existed.
      if (source.observedBy === "event" && sink.timestamp < source.timestamp) continue;
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
        );
        if (state.stopped) break;
      }
    }
    if (state.stopped) break;
  }

  flows.sort((left, right) => flowIdentity(left).localeCompare(flowIdentity(right)));
  return { flows, limitReached: state.limitReached };
};
