import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES } from "./terminal.js";

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

const resolvePotentialPath = async (path: string): Promise<string> => {
  const suffix: string[] = [];
  let candidate = path;
  while (true) {
    try {
      return resolve(await realpath(candidate), ...suffix.reverse());
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      suffix.push(basename(candidate));
      candidate = parent;
    }
  }
};

export const assertDistinctSecondaryCoverageSummaryPaths = async (
  reportPath: string,
  outputPath: string,
): Promise<void> => {
  const [report, output] = await Promise.all([
    resolvePotentialPath(reportPath),
    resolvePotentialPath(outputPath),
  ]);
  if (report === output) {
    throw new Error("Summary output must not overwrite its source JSON report.");
  }
};

export const writeSecondaryCoverageSummary = async (
  path: string,
  output: string,
): Promise<void> => {
  if (Buffer.byteLength(output, "utf8") > MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES) {
    throw new Error("PrivacySpec secondary-coverage summary exceeds the size limit.");
  }
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, output, {
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
