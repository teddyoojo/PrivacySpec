import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { MAX_REPORT_FILE_BYTES } from "../report/json.js";

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

export const writeTestDataOutput = async (path: string, output: string): Promise<void> => {
  if (Buffer.byteLength(output, "utf8") > MAX_REPORT_FILE_BYTES) {
    throw new Error("PrivacySpec test-data output exceeds the size limit.");
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
