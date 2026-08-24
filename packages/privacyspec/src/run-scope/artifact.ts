import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { parseClassifierConfigurationState } from "../discovery/classifier-configuration.js";
import { writePrivacySpecReport } from "../report/json.js";
import { PRIVACYSPEC_TOOL_VERSION } from "../report/model.js";
import { parsePrivacySpecReportV4, parsePrivacySpecReportV5 } from "../report/read.js";
import {
  MAX_RUN_PARTS,
  type PrivacySpecRunPart,
  type PrivacySpecRunPartV3,
  RUN_PART_SCHEMA_VERSION,
  RUN_PART_SCHEMA_VERSION_V1,
  RUN_PART_SCHEMA_VERSION_V2,
} from "./model.js";

export const MAX_RUN_PART_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_RUN_SCOPE_ID_LENGTH = 128;

export class RunPartFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunPartFormatError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

export const isRunScopeIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_RUN_SCOPE_ID_LENGTH &&
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value);

const isPartCoordinate = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_RUN_PARTS;

const containsForbiddenRawPayload = (value: unknown): boolean => {
  if (typeof value === "string") {
    return (
      /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(value) ||
      /(?:^|\D)\+\d(?:[\d ().-]{5,}\d)(?:\D|$)/u.test(value) ||
      /[?&][A-Za-z0-9._-]{1,64}=/u.test(value) ||
      /\b(?:authorization|bearer|password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]/iu.test(
        value,
      )
    );
  }
  if (Array.isArray(value)) return value.some(containsForbiddenRawPayload);
  return isRecord(value) && Object.values(value).some(containsForbiddenRawPayload);
};

const isBaselineIneligiblePayload = (report: PrivacySpecRunPart["report"]): boolean =>
  report.run.complete === false &&
  report.run.privacyspecStatus === "incomplete" &&
  report.analysis.status === "inconclusive" &&
  report.analysis.privacy.complete === false &&
  report.analysis.dependencies.complete === false &&
  report.analysis.security.complete === false &&
  report.analysis.runtimeErrors.complete === false &&
  report.baseline.exists === false &&
  report.baseline.known.length === 0 &&
  report.baseline.new.length === 0 &&
  report.baseline.resolved.length === 0 &&
  report.findings.every((finding) => finding.baselineState === "not_baseline_eligible") &&
  [report.analysis.dependencies, report.analysis.runtimeErrors].every(
    (module) =>
      module.findings.length === 0 &&
      module.baseline.exists === false &&
      module.baseline.known === 0 &&
      module.baseline.new === 0 &&
      module.baseline.resolved === 0,
  ) &&
  report.analysis.security.findings.length === 0 &&
  report.analysis.security.baseline.exists === false &&
  report.analysis.security.baseline.known === 0 &&
  report.analysis.security.baseline.changed === 0 &&
  report.analysis.security.baseline.newTargets === 0 &&
  report.analysis.security.baseline.resolved === 0;

export const parsePrivacySpecRunPart = (value: unknown): PrivacySpecRunPart => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      value.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION
        ? ["runPartSchemaVersion", "scope", "completeness", "classifierConfiguration", "report"]
        : ["runPartSchemaVersion", "scope", "completeness", "report"],
    ) ||
    (value.runPartSchemaVersion !== RUN_PART_SCHEMA_VERSION_V1 &&
      value.runPartSchemaVersion !== RUN_PART_SCHEMA_VERSION_V2 &&
      value.runPartSchemaVersion !== RUN_PART_SCHEMA_VERSION) ||
    !isRecord(value.scope) ||
    !hasExactKeys(value.scope, [
      "runId",
      "configurationId",
      "part",
      "total",
      "failOnNewReviewFindings",
      "nis2EvidenceProfile",
    ]) ||
    !isRunScopeIdentifier(value.scope.runId) ||
    !isRunScopeIdentifier(value.scope.configurationId) ||
    !isPartCoordinate(value.scope.part) ||
    !isPartCoordinate(value.scope.total) ||
    value.scope.part > value.scope.total ||
    typeof value.scope.failOnNewReviewFindings !== "boolean" ||
    typeof value.scope.nis2EvidenceProfile !== "boolean" ||
    !isRecord(value.completeness) ||
    !hasExactKeys(value.completeness, ["privacy", "dependencies", "security", "runtimeErrors"]) ||
    !Object.values(value.completeness).every((entry) => typeof entry === "boolean")
  ) {
    throw new RunPartFormatError("Invalid or unsupported PrivacySpec run-part schema.");
  }

  const classifierConfiguration =
    value.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION
      ? parseClassifierConfigurationState(value.classifierConfiguration)
      : undefined;
  if (
    value.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION &&
    classifierConfiguration === undefined
  ) {
    throw new RunPartFormatError("Invalid PrivacySpec run-part classifier configuration.");
  }

  let report: PrivacySpecRunPart["report"];
  try {
    report =
      value.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION_V1
        ? parsePrivacySpecReportV4(value.report)
        : parsePrivacySpecReportV5(value.report);
  } catch {
    throw new RunPartFormatError("Invalid or unsupported PrivacySpec run-part report payload.");
  }
  if (!isBaselineIneligiblePayload(report)) {
    throw new RunPartFormatError(
      "PrivacySpec run-part payload contains a conclusive or baseline-eligible result.",
    );
  }
  if (report.tool.version !== PRIVACYSPEC_TOOL_VERSION) {
    throw new RunPartFormatError("PrivacySpec run-part tool version is unsupported.");
  }
  if (containsForbiddenRawPayload(report)) {
    throw new RunPartFormatError("PrivacySpec run-part payload contains prohibited raw data.");
  }

  const common = {
    scope: {
      runId: value.scope.runId,
      configurationId: value.scope.configurationId,
      part: value.scope.part,
      total: value.scope.total,
      failOnNewReviewFindings: value.scope.failOnNewReviewFindings,
      nis2EvidenceProfile: value.scope.nis2EvidenceProfile,
    },
    completeness: {
      privacy: value.completeness.privacy as boolean,
      dependencies: value.completeness.dependencies as boolean,
      security: value.completeness.security as boolean,
      runtimeErrors: value.completeness.runtimeErrors as boolean,
    },
    report,
  };
  if (value.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION_V1) {
    return structuredClone({
      ...common,
      runPartSchemaVersion: RUN_PART_SCHEMA_VERSION_V1,
      report: report as Extract<PrivacySpecRunPart, { runPartSchemaVersion: 1 }>["report"],
    });
  }
  if (value.runPartSchemaVersion === RUN_PART_SCHEMA_VERSION_V2) {
    return structuredClone({
      ...common,
      runPartSchemaVersion: RUN_PART_SCHEMA_VERSION_V2,
      report: report as Extract<PrivacySpecRunPart, { runPartSchemaVersion: 2 }>["report"],
    });
  }
  return structuredClone({
    ...common,
    runPartSchemaVersion: RUN_PART_SCHEMA_VERSION,
    classifierConfiguration:
      classifierConfiguration as PrivacySpecRunPartV3["classifierConfiguration"],
    report: report as Extract<PrivacySpecRunPart, { runPartSchemaVersion: 3 }>["report"],
  });
};

const isMissingFileError = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";

const assertNoSymbolicLinkComponents = async (path: string): Promise<void> => {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  let candidate = root;
  for (const component of components) {
    candidate = join(candidate, component);
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new RunPartFormatError("PrivacySpec run-part paths must not contain symbolic links.");
      }
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
};

export const readPrivacySpecRunPart = async (path: string): Promise<PrivacySpecRunPart> => {
  await assertNoSymbolicLinkComponents(path);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error))
      throw new RunPartFormatError("No PrivacySpec run part is available.");
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_RUN_PART_FILE_BYTES) {
    throw new RunPartFormatError("PrivacySpec run part is not a bounded regular file.");
  }
  const serialized = await readFile(path, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > MAX_RUN_PART_FILE_BYTES) {
    throw new RunPartFormatError("PrivacySpec run part exceeds the size limit.");
  }
  try {
    return parsePrivacySpecRunPart(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof RunPartFormatError) throw error;
    throw new RunPartFormatError("PrivacySpec run part is not valid JSON.");
  }
};

export const writePrivacySpecRunPart = async (
  path: string,
  part: PrivacySpecRunPartV3,
): Promise<void> => {
  const parsed = parsePrivacySpecRunPart(part);
  if (!isAbsolute(path) && path.split(/[\\/]+/u).includes("..")) {
    throw new RunPartFormatError("PrivacySpec run-part output must not use path traversal.");
  }
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymbolicLinkComponents(directory);
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new RunPartFormatError("PrivacySpec run-part output directory is invalid.");
  }
  await assertNoSymbolicLinkComponents(path);
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RUN_PART_FILE_BYTES) {
    throw new RunPartFormatError("PrivacySpec run part exceeds the size limit.");
  }
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await link(temporaryPath, path);
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      throw new RunPartFormatError("PrivacySpec run-part identity already exists.");
    }
    throw error;
  } finally {
    try {
      await unlink(temporaryPath);
    } catch {
      // Preserve the publication result when best-effort temporary cleanup fails.
    }
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new RunPartFormatError("PrivacySpec run-part output is not a regular file.");
  }
};

export const writePrivacySpecAggregateReport = async (
  path: string,
  report: PrivacySpecRunPartV3["report"],
): Promise<void> => {
  const parsed = parsePrivacySpecReportV5(report);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymbolicLinkComponents(directory);
  await assertNoSymbolicLinkComponents(path);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RunPartFormatError("PrivacySpec aggregate output must be a regular file.");
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  await writePrivacySpecReport(path, parsed);
};

export const invalidatePrivacySpecAggregateReport = async (path: string): Promise<void> => {
  await assertNoSymbolicLinkComponents(path);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RunPartFormatError("PrivacySpec aggregate output must be a regular file.");
    }
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
};
