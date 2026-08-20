import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { PrivacySpecJsonReport } from "./model.js";

export const MAX_REPORT_FILE_BYTES = 64 * 1024 * 1024;

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

export const removePrivacySpecReportSync = (path: string): void => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
};

export const writePrivacySpecReport = async (
  path: string,
  report: PrivacySpecJsonReport,
): Promise<void> => {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_FILE_BYTES) {
    throw new Error("PrivacySpec JSON report exceeds the size limit.");
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
