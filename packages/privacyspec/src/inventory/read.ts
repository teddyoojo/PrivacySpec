import { lstat, readFile } from "node:fs/promises";
import { parseBaselineFile } from "../baseline/write.js";
import { compareCanonicalStrings } from "../canonical-order.js";
import { isDataCategory } from "../discovery/source-model.js";
import { MAX_REPORT_FILE_BYTES } from "../report/json.js";
import { parseAPIRequestReportCoverage, parseBrowserEngineReportCoverage } from "../report/read.js";
import type {
  InventoryEntry,
  InventoryEntryV1,
  PrivacyInventory,
  ReadablePrivacyInventory,
} from "./model.js";

export class InventoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryFormatError";
  }
}

const MAX_ITEMS = 100_000;
const MAX_TEXT = 8_192;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
};

const containsUnsafeCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    ) {
      return true;
    }
  }
  return false;
};

const safeText = (value: unknown, maximum = MAX_TEXT, allowEmpty = false): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (allowEmpty || value.length > 0) &&
  !containsUnsafeCharacter(value);

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const boundedJson = (root: unknown): boolean => {
  const stack: Array<{ value: unknown; depth: number; ancestors: object[] }> = [
    { value: root, depth: 0, ancestors: [] },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > 50_000 || current.depth > 12) return false;
    if (typeof current.value === "string") {
      if (!safeText(current.value, MAX_TEXT, true)) return false;
      continue;
    }
    if (typeof current.value === "number" && !Number.isFinite(current.value)) return false;
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.ancestors.includes(current.value)) return false;
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      if (Object.getOwnPropertySymbols(current.value).length > 0) return false;
      descriptors = Object.getOwnPropertyDescriptors(current.value);
    } catch {
      return false;
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(current.value) && key === "length") continue;
      if (!safeText(key, 512) || !("value" in descriptor) || !descriptor.enumerable) return false;
      stack.push({
        value: descriptor.value,
        depth: current.depth + 1,
        ancestors: [...current.ancestors, current.value],
      });
    }
  }
  return true;
};

const timestamp = (value: unknown): value is string => {
  if (!safeText(value, 64)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const canonicalArray = <T>(
  value: unknown,
  parse: (entry: unknown) => T | undefined,
  identity: (entry: T) => string,
  maximum = MAX_ITEMS,
): T[] | undefined => {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const parsed: T[] = [];
  let previous: string | undefined;
  for (const candidate of value) {
    const entry = parse(candidate);
    if (entry === undefined) return undefined;
    const key = identity(entry);
    if (previous !== undefined && compareCanonicalStrings(previous, key) >= 0) return undefined;
    previous = key;
    parsed.push(entry);
  }
  return parsed;
};

const stringArray = (value: unknown, allowed?: ReadonlySet<string>): string[] | undefined =>
  canonicalArray(
    value,
    (entry) =>
      safeText(entry, 2_048) && (allowed === undefined || allowed.has(entry)) ? entry : undefined,
    (entry) => entry,
    1_000,
  );

const parseTest = (value: unknown): InventoryEntry["tests"][number] | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["file", "title", "project"]) ||
    !safeText(value.file, 2_048) ||
    /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value.file) ||
    value.file.split(/[\\/]/u).includes("..") ||
    !safeText(value.title, 2_048) ||
    !safeText(value.project, 512, true)
  ) {
    return undefined;
  }
  return { file: value.file, title: value.title, project: value.project };
};

const parseEntry = (
  value: unknown,
  version: 1 | 2,
): InventoryEntry | InventoryEntryV1 | undefined => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "dataCategory",
        ...(version === 2 ? ["requestSurface"] : []),
        "boundary",
        "sinkKind",
        "sourceKinds",
        "sourceConfidences",
        "transforms",
        "state",
        "severities",
        "changeReasons",
        "occurrences",
        "tests",
        "testsTruncated",
      ],
      ["recipient", "method", "endpoint", "location", "sourceProvenance"],
    ) ||
    !isDataCategory(value.dataCategory) ||
    (version === 2 &&
      value.requestSurface !== "browser" &&
      value.requestSurface !== "api-request") ||
    !["FIRST_PARTY", "EXTERNAL", "BROWSER", "CONSOLE", "UNKNOWN"].includes(
      String(value.boundary),
    ) ||
    ![
      "request-url",
      "request-body",
      "request-header",
      "external-request",
      "local-storage",
      "session-storage",
      "cookie",
      "console",
    ].includes(String(value.sinkKind)) ||
    !["OBSERVED", "KNOWN_REVIEW", "NEW_REVIEW", "TECHNICAL_FAILURE"].includes(
      String(value.state),
    ) ||
    !count(value.occurrences) ||
    value.occurrences < 1 ||
    !count(value.testsTruncated)
  ) {
    return undefined;
  }
  const sourceKinds = stringArray(
    value.sourceKinds,
    new Set(["form-input", "dom-control", "response-json"]),
  );
  const sourceConfidences = stringArray(
    value.sourceConfidences,
    new Set(["high", "medium", "low"]),
  );
  const transforms = stringArray(
    value.transforms,
    new Set([
      "EXACT",
      "LOWERCASE",
      "UPPERCASE",
      "URL_ENCODED",
      "BASE64",
      "SHA256",
      "SHA256_NORMALIZED",
    ]),
  );
  const severities = stringArray(
    value.severities,
    new Set(["info", "warning", "error", "critical"]),
  );
  const changeReasons = stringArray(
    value.changeReasons,
    new Set([
      "NEW_RECIPIENT",
      "NEW_CATEGORY",
      "NEW_ENDPOINT",
      "NEW_LOCATION",
      "NEW_TRANSFORM",
      "NEW_FLOW",
    ]),
  );
  const tests = canonicalArray(
    value.tests,
    parseTest,
    (entry) => JSON.stringify([entry.file, entry.title, entry.project]),
    100,
  );
  if (
    sourceKinds === undefined ||
    sourceKinds.length === 0 ||
    sourceConfidences === undefined ||
    sourceConfidences.length === 0 ||
    transforms === undefined ||
    transforms.length === 0 ||
    severities === undefined ||
    changeReasons === undefined ||
    tests === undefined ||
    (value.method !== undefined && !safeText(value.method, 32)) ||
    (value.endpoint !== undefined && !safeText(value.endpoint, 8_192, true)) ||
    (value.location !== undefined && !safeText(value.location, 1_024))
  ) {
    return undefined;
  }
  let recipient: InventoryEntry["recipient"];
  if (value.recipient !== undefined) {
    if (
      !isRecord(value.recipient) ||
      !hasExactKeys(value.recipient, ["origin", "host", "firstParty"]) ||
      !safeText(value.recipient.origin, 2_048) ||
      !safeText(value.recipient.host, 255) ||
      typeof value.recipient.firstParty !== "boolean"
    )
      return undefined;
    recipient = value.recipient as unknown as NonNullable<InventoryEntry["recipient"]>;
  }
  let sourceProvenance: InventoryEntry["sourceProvenance"];
  if (value.sourceProvenance !== undefined) {
    if (
      !isRecord(value.sourceProvenance) ||
      !hasExactKeys(value.sourceProvenance, ["origin", "endpoint", "location"]) ||
      !safeText(value.sourceProvenance.origin, 2_048) ||
      !safeText(value.sourceProvenance.endpoint, 8_192, true) ||
      !safeText(value.sourceProvenance.location, 1_024)
    )
      return undefined;
    sourceProvenance = value.sourceProvenance as unknown as NonNullable<
      InventoryEntry["sourceProvenance"]
    >;
  }
  if (sourceKinds.includes("response-json") !== (sourceProvenance !== undefined)) return undefined;
  if (
    (value.boundary === "FIRST_PARTY" && recipient?.firstParty !== true) ||
    (value.boundary === "EXTERNAL" && recipient?.firstParty !== false) ||
    (["BROWSER", "CONSOLE", "UNKNOWN"].includes(String(value.boundary)) && recipient !== undefined)
  )
    return undefined;
  return structuredClone({
    ...value,
    sourceKinds,
    sourceConfidences,
    transforms,
    severities,
    changeReasons,
    tests,
    ...(recipient === undefined ? {} : { recipient }),
    ...(sourceProvenance === undefined ? {} : { sourceProvenance }),
  }) as InventoryEntry | InventoryEntryV1;
};

const entryIdentity = (entry: InventoryEntry | InventoryEntryV1): string =>
  JSON.stringify([
    entry.dataCategory,
    "requestSurface" in entry ? entry.requestSurface : "browser",
    entry.boundary,
    entry.recipient?.origin ?? "",
    entry.method ?? "",
    entry.endpoint ?? "",
    entry.location ?? "",
    entry.sinkKind,
  ]);

const parseSourceReport = (value: unknown) => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "generatedAt",
      "complete",
      "status",
      "projects",
      "tests",
    ]) ||
    ![1, 2, 3, 4, 5].includes(Number(value.schemaVersion)) ||
    !timestamp(value.generatedAt) ||
    typeof value.complete !== "boolean" ||
    !["passed", "review", "failed", "incomplete"].includes(String(value.status)) ||
    !isRecord(value.tests) ||
    !hasExactKeys(value.tests, [
      "total",
      "observed",
      "passed",
      "failed",
      "timedOut",
      "skipped",
      "interrupted",
    ])
  )
    return undefined;
  const projects = stringArray(value.projects);
  const tests = value.tests as Record<string, unknown>;
  if (projects === undefined || !Object.values(tests).every(count)) return undefined;
  const attempted =
    Number(tests.passed) +
    Number(tests.failed) +
    Number(tests.timedOut) +
    Number(tests.skipped) +
    Number(tests.interrupted);
  if (attempted !== tests.total || Number(tests.observed) > Number(tests.total)) return undefined;
  return structuredClone({ ...value, projects, tests }) as unknown as {
    generatedAt: string;
    complete: boolean;
    tests: Record<string, unknown>;
    [key: string]: unknown;
  };
};

const parseAvailability = (
  value: unknown,
  observedTests: number,
  parseDetails: (details: unknown, observed: number) => boolean,
): boolean =>
  isRecord(value) &&
  ((hasExactKeys(value, ["available"]) && value.available === false) ||
    (hasExactKeys(value, ["available", "details"]) &&
      value.available === true &&
      parseDetails(value.details, observedTests)));

export const parsePrivacyInventory = (value: unknown): ReadablePrivacyInventory => {
  if (
    !boundedJson(value) ||
    !isRecord(value) ||
    (value.inventorySchemaVersion !== 1 && value.inventorySchemaVersion !== 2)
  ) {
    throw new InventoryFormatError("Invalid or unsupported PrivacySpec inventory schema.");
  }
  const version = value.inventorySchemaVersion;
  if (
    !hasExactKeys(value, [
      "inventorySchemaVersion",
      "tool",
      "sourceReport",
      "summary",
      "entries",
      "resolved",
      ...(version === 2 ? ["experimentalCoverage"] : []),
      "limitations",
    ])
  )
    throw new InventoryFormatError("Invalid PrivacySpec inventory fields.");
  if (
    !isRecord(value.tool) ||
    !hasExactKeys(value.tool, ["name", "version"]) ||
    value.tool.name !== "privacyspec" ||
    !safeText(value.tool.version, 64)
  ) {
    throw new InventoryFormatError("Invalid PrivacySpec inventory tool metadata.");
  }
  const sourceReport = parseSourceReport(value.sourceReport);
  const entries = canonicalArray(
    value.entries,
    (entry) => parseEntry(entry, version),
    entryIdentity,
  );
  if (sourceReport === undefined || entries === undefined || !isRecord(value.summary)) {
    throw new InventoryFormatError("Invalid PrivacySpec inventory summary.");
  }
  const summary = value.summary;
  if (
    !hasExactKeys(summary, [
      "entries",
      "occurrences",
      "categories",
      "externalRecipients",
      "byState",
    ]) ||
    !isRecord(summary.byState) ||
    !hasExactKeys(summary.byState, [
      "OBSERVED",
      "KNOWN_REVIEW",
      "NEW_REVIEW",
      "TECHNICAL_FAILURE",
    ]) ||
    !Object.values(summary).every((entry) => entry === summary.byState || count(entry)) ||
    !Object.values(summary.byState).every(count)
  ) {
    throw new InventoryFormatError("Invalid PrivacySpec inventory summary.");
  }
  let resolved: ReturnType<typeof parseBaselineFile>["flows"];
  try {
    resolved = parseBaselineFile({
      schemaVersion: 1,
      createdAt: sourceReport.generatedAt,
      flows: value.resolved,
    }).flows;
  } catch {
    throw new InventoryFormatError("Invalid PrivacySpec inventory resolved entries.");
  }
  const byState = Object.fromEntries(
    ["OBSERVED", "KNOWN_REVIEW", "NEW_REVIEW", "TECHNICAL_FAILURE"].map((state) => [
      state,
      entries.filter((entry) => entry.state === state).length,
    ]),
  );
  const occurrences = entries.reduce((total, entry) => total + entry.occurrences, 0);
  const categories = new Set(entries.map((entry) => entry.dataCategory)).size;
  const externalRecipients = new Set(
    entries
      .filter((entry) => entry.boundary === "EXTERNAL")
      .map((entry) => entry.recipient?.origin),
  ).size;
  if (
    summary.entries !== entries.length ||
    summary.occurrences !== occurrences ||
    summary.categories !== categories ||
    summary.externalRecipients !== externalRecipients ||
    JSON.stringify(summary.byState) !== JSON.stringify(byState) ||
    (!sourceReport.complete && resolved.length > 0)
  ) {
    throw new InventoryFormatError("Inconsistent PrivacySpec inventory summary.");
  }
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.length > 100 ||
    !value.limitations.every((entry) => safeText(entry))
  ) {
    throw new InventoryFormatError("Invalid PrivacySpec inventory limitations.");
  }
  if (version === 2) {
    if (
      !isRecord(value.experimentalCoverage) ||
      !hasExactKeys(value.experimentalCoverage, ["browserEngines", "apiRequests"]) ||
      !parseAvailability(
        value.experimentalCoverage.browserEngines,
        Number(sourceReport.tests.observed),
        parseBrowserEngineReportCoverage,
      ) ||
      !parseAvailability(
        value.experimentalCoverage.apiRequests,
        Number(sourceReport.tests.observed),
        parseAPIRequestReportCoverage,
      )
    ) {
      throw new InventoryFormatError("Invalid PrivacySpec inventory experimental coverage.");
    }
    return structuredClone({ ...value, sourceReport, entries, resolved }) as PrivacyInventory;
  }
  return structuredClone({ ...value, sourceReport, entries, resolved }) as ReadablePrivacyInventory;
};

const missing = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";

export const readPrivacyInventoryFile = async (path: string): Promise<ReadablePrivacyInventory> => {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (missing(error)) throw new InventoryFormatError("No PrivacySpec inventory is available.");
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_REPORT_FILE_BYTES) {
    throw new InventoryFormatError("PrivacySpec inventory is not a bounded regular file.");
  }
  const serialized = await readFile(path, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_FILE_BYTES)
    throw new InventoryFormatError("PrivacySpec inventory exceeds the size limit.");
  try {
    return parsePrivacyInventory(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof InventoryFormatError) throw error;
    throw new InventoryFormatError("PrivacySpec inventory is not valid JSON.");
  }
};
