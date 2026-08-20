import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DataFlowSinkKind, TransformKind } from "../correlate/model.js";
import { looksSensitive, MAX_NORMALIZED_PATH_LENGTH } from "../correlate/redact.js";
import type { DataCategory } from "../discovery/source-model.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import type { RuleId } from "../rules/model.js";
import {
  createBaselineKey,
  isBaselineEligibleIdentity,
  normalizeBaselineEndpoint,
} from "./compare.js";
import {
  BASELINE_SCHEMA_VERSION,
  type BaselineFile,
  type BaselineFlowCandidate,
  LATEST_RUN_SCHEMA_VERSION,
  type LatestRunFile,
} from "./schema.js";

export const MAX_BASELINE_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_BASELINE_FLOWS = 100_000;

const MAX_CREATED_AT_LENGTH = 64;
const MAX_KEY_LENGTH = 16_384;
const MAX_RECIPIENT_LENGTH = 2_048;
const MAX_LOCATION_LENGTH = 1_024;

const dataCategories = new Set<DataCategory>([
  "personal.email",
  "personal.phone",
  "secret.password",
]);
const sinkKinds = new Set<DataFlowSinkKind>([
  "request-url",
  "request-body",
  "request-header",
  "external-request",
  "local-storage",
  "session-storage",
  "cookie",
  "console",
]);
const transforms = new Set<TransformKind>([
  "EXACT",
  "LOWERCASE",
  "UPPERCASE",
  "URL_ENCODED",
  "BASE64",
  "SHA256",
  "SHA256_NORMALIZED",
]);
const ruleIds = new Set<RuleId>(Object.keys(RULE_DEFINITIONS) as RuleId[]);

export class BaselineFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineFormatError";
  }
}

export class LatestRunIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatestRunIncompleteError";
  }
}

interface FileCreationOptions {
  createdAt?: string | undefined;
}

interface LatestRunCreationOptions extends FileCreationOptions {
  complete: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
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

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  !containsUnsafeCharacter(value);

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (!isBoundedString(value, MAX_CREATED_AT_LENGTH)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isCanonicalOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.origin !== "null" && url.origin === value;
  } catch {
    return false;
  }
};

const decodedValue = (value: string): string => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
};

const hasSensitivePattern = (value: string): boolean =>
  looksSensitive(value) ||
  /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(value) ||
  /(?:^|\D)(?:\+?\d[\d\s().-]{5,}\d)(?:\D|$)/u.test(value) ||
  /(?:^|[^a-f0-9])[a-f0-9]{64}(?:[^a-f0-9]|$)/iu.test(value);

const containsObviousSensitiveMaterial = (value: string): boolean => {
  const decoded = decodedValue(value);
  if (hasSensitivePattern(value) || hasSensitivePattern(decoded)) return true;

  for (const match of decoded.matchAll(/[a-z0-9+/]{12,}={0,2}/giu)) {
    const candidate = match[0];
    if (candidate.length % 4 !== 0) continue;
    const decodedCandidate = Buffer.from(candidate, "base64").toString("utf8");
    if (hasSensitivePattern(decodedCandidate)) return true;
  }
  return false;
};

const parseCandidate = (value: unknown, accepted: boolean): BaselineFlowCandidate | undefined => {
  if (!isRecord(value)) return undefined;
  const required = ["key", "ruleId", "dataCategory", "sinkKind", "transform"];
  if (accepted) required.push("status");
  if (!hasExactKeys(value, required, ["recipient", "endpoint", "location"])) return undefined;
  if (
    !isBoundedString(value.key, MAX_KEY_LENGTH) ||
    typeof value.ruleId !== "string" ||
    !ruleIds.has(value.ruleId as RuleId) ||
    typeof value.dataCategory !== "string" ||
    !dataCategories.has(value.dataCategory as DataCategory) ||
    typeof value.sinkKind !== "string" ||
    !sinkKinds.has(value.sinkKind as DataFlowSinkKind) ||
    typeof value.transform !== "string" ||
    !transforms.has(value.transform as TransformKind) ||
    (accepted && value.status !== "accepted")
  ) {
    return undefined;
  }

  const candidate: BaselineFlowCandidate = {
    key: value.key,
    ruleId: value.ruleId as RuleId,
    dataCategory: value.dataCategory as DataCategory,
    sinkKind: value.sinkKind as DataFlowSinkKind,
    transform: value.transform as TransformKind,
  };
  if (value.recipient !== undefined) {
    if (
      !isBoundedString(value.recipient, MAX_RECIPIENT_LENGTH) ||
      !isCanonicalOrigin(value.recipient)
    ) {
      return undefined;
    }
    candidate.recipient = value.recipient;
  }
  if (value.endpoint !== undefined) {
    if (
      !isBoundedString(value.endpoint, MAX_NORMALIZED_PATH_LENGTH) ||
      normalizeBaselineEndpoint(value.endpoint) !== value.endpoint ||
      containsObviousSensitiveMaterial(value.endpoint)
    ) {
      return undefined;
    }
    candidate.endpoint = value.endpoint;
  }
  if (value.location !== undefined) {
    if (
      !isBoundedString(value.location, MAX_LOCATION_LENGTH) ||
      containsObviousSensitiveMaterial(value.location)
    ) {
      return undefined;
    }
    candidate.location = value.location;
  }
  if (!isBaselineEligibleIdentity(candidate)) return undefined;
  if (createBaselineKey(candidate) !== candidate.key) return undefined;
  return candidate;
};

const parseFlowArray = (value: unknown, accepted: boolean): BaselineFlowCandidate[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_BASELINE_FLOWS) return undefined;
  const flows: BaselineFlowCandidate[] = [];
  const keys = new Set<string>();
  for (const item of value) {
    const flow = parseCandidate(item, accepted);
    if (flow === undefined || keys.has(flow.key)) return undefined;
    keys.add(flow.key);
    flows.push(flow);
  }
  return flows;
};

export const parseBaselineFile = (value: unknown): BaselineFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "flows"]) ||
    value.schemaVersion !== BASELINE_SCHEMA_VERSION ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    throw new BaselineFormatError("Invalid or unsupported PrivacySpec baseline schema.");
  }
  const candidates = parseFlowArray(value.flows, true);
  if (candidates === undefined) {
    throw new BaselineFormatError("Invalid PrivacySpec baseline flow entries.");
  }
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    createdAt: value.createdAt,
    flows: candidates.map((flow) => ({ ...flow, status: "accepted" })),
  };
};

export const parseLatestRunFile = (value: unknown): LatestRunFile => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "createdAt", "complete", "flows"]) ||
    value.schemaVersion !== LATEST_RUN_SCHEMA_VERSION ||
    !isCanonicalTimestamp(value.createdAt) ||
    typeof value.complete !== "boolean"
  ) {
    throw new BaselineFormatError("Invalid or unsupported PrivacySpec latest-run schema.");
  }
  const flows = parseFlowArray(value.flows, false);
  if (flows === undefined) {
    throw new BaselineFormatError("Invalid PrivacySpec latest-run flow entries.");
  }
  return {
    schemaVersion: LATEST_RUN_SCHEMA_VERSION,
    createdAt: value.createdAt,
    complete: value.complete,
    flows,
  };
};

const canonicalCandidate = (value: BaselineFlowCandidate): BaselineFlowCandidate => {
  const candidate: BaselineFlowCandidate = {
    key: "",
    ruleId: value.ruleId,
    dataCategory: value.dataCategory,
    sinkKind: value.sinkKind,
    transform: value.transform,
  };
  if (value.recipient !== undefined) candidate.recipient = value.recipient;
  const endpoint = normalizeBaselineEndpoint(value.endpoint);
  if (endpoint !== undefined) candidate.endpoint = endpoint;
  if (value.location !== undefined) candidate.location = value.location;
  candidate.key = createBaselineKey(candidate);
  return candidate;
};

const uniqueSortedCandidates = (
  values: readonly BaselineFlowCandidate[],
): BaselineFlowCandidate[] => {
  const candidates = new Map<string, BaselineFlowCandidate>();
  for (const value of values) {
    const candidate = canonicalCandidate(value);
    candidates.set(candidate.key, candidate);
  }
  return Array.from(candidates.values()).sort((left, right) => left.key.localeCompare(right.key));
};

const createdAt = (options: FileCreationOptions): string =>
  options.createdAt ?? new Date().toISOString();

export const createBaselineFile = (
  flows: readonly BaselineFlowCandidate[],
  options: FileCreationOptions = {},
): BaselineFile =>
  parseBaselineFile({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    createdAt: createdAt(options),
    flows: uniqueSortedCandidates(flows).map((flow) => ({ ...flow, status: "accepted" })),
  });

export const createLatestRunFile = (
  flows: readonly BaselineFlowCandidate[],
  options: LatestRunCreationOptions,
): LatestRunFile =>
  parseLatestRunFile({
    schemaVersion: LATEST_RUN_SCHEMA_VERSION,
    createdAt: createdAt(options),
    complete: options.complete,
    flows: uniqueSortedCandidates(flows),
  });

const isMissingFileError = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";

const readJsonFile = async (path: string): Promise<unknown | undefined> => {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > MAX_BASELINE_FILE_BYTES) {
    throw new BaselineFormatError("PrivacySpec baseline artifact is not a bounded regular file.");
  }

  const serialized = await readFile(path, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > MAX_BASELINE_FILE_BYTES) {
    throw new BaselineFormatError("PrivacySpec baseline artifact exceeds the size limit.");
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new BaselineFormatError("PrivacySpec baseline artifact is not valid JSON.");
  }
};

export const readBaselineFile = async (path: string): Promise<BaselineFile | undefined> => {
  const value = await readJsonFile(path);
  return value === undefined ? undefined : parseBaselineFile(value);
};

export const readLatestRunFile = async (path: string): Promise<LatestRunFile | undefined> => {
  const value = await readJsonFile(path);
  return value === undefined ? undefined : parseLatestRunFile(value);
};

export const readCompleteLatestRunFile = async (path: string): Promise<LatestRunFile> => {
  const latestRun = await readLatestRunFile(path);
  if (latestRun === undefined) {
    throw new LatestRunIncompleteError("No PrivacySpec latest-run artifact is available.");
  }
  if (!latestRun.complete) {
    throw new LatestRunIncompleteError(
      "The PrivacySpec latest-run artifact is incomplete and cannot update a baseline.",
    );
  }
  return latestRun;
};

const writeJsonAtomically = async (path: string, value: unknown): Promise<void> => {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_BASELINE_FILE_BYTES) {
    throw new BaselineFormatError("PrivacySpec baseline artifact exceeds the size limit.");
  }

  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!isMissingFileError(cleanupError)) throw cleanupError;
    }
    throw error;
  }
};

const writeJsonAtomicallySync = (path: string, value: unknown): void => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_BASELINE_FILE_BYTES) {
    throw new BaselineFormatError("PrivacySpec baseline artifact exceeds the size limit.");
  }

  try {
    writeFileSync(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the operation error. The temporary file contains only
      // sanitized semantics and can be cleaned up on the next local run.
    }
    throw error;
  }
};

export const writeBaselineFile = async (
  path: string,
  flows: readonly BaselineFlowCandidate[],
  options: FileCreationOptions = {},
): Promise<BaselineFile> => {
  const baseline = createBaselineFile(flows, options);
  await writeJsonAtomically(path, baseline);
  return baseline;
};

export const writeLatestRunFile = async (
  path: string,
  flows: readonly BaselineFlowCandidate[],
  options: LatestRunCreationOptions,
): Promise<LatestRunFile> => {
  const latestRun = createLatestRunFile(flows, options);
  await writeJsonAtomically(path, latestRun);
  return latestRun;
};

export const invalidateLatestRunFile = (
  path: string,
  options: FileCreationOptions = {},
): LatestRunFile => {
  const latestRun = createLatestRunFile([], { ...options, complete: false });
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  // Missing and malformed targets are both fail-closed for the CLI. Removing
  // the prior artifact first means a later write failure cannot expose a stale
  // complete run.
  writeJsonAtomicallySync(path, latestRun);
  return latestRun;
};
