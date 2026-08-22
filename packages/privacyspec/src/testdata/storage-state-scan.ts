import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { PRIVACYSPEC_TOOL_VERSION } from "../report/model.js";
import {
  PLAYWRIGHT_AUTH_STATE_GUIDANCE_URL,
  type PrivacySpecStorageStateScan,
  STORAGE_STATE_SCAN_SCHEMA_VERSION,
  type StorageStateFileObservation,
  type StorageStateFindingStatus,
  type StorageStateRepositoryStatus,
} from "./storage-state-model.js";

export const MAX_STORAGE_STATE_FILES = 32;
export const MAX_STORAGE_STATE_FILE_BYTES = 1024 * 1024;
export const MAX_STORAGE_STATE_JSON_DEPTH = 12;
export const MAX_STORAGE_STATE_JSON_NODES = 50_000;

const MAX_KEY_LENGTH = 1_024;
const MAX_VALUE_LENGTH = 256 * 1_024;
const MAX_ORIGIN_LENGTH = 2_048;
const MAX_GIT_OUTPUT_BYTES = 64 * 1_024;

const execFileAsync = promisify(execFile);

const BASE_LIMITATIONS = [
  "Only explicitly supplied regular Playwright storage-state/auth JSON files are scanned; repository crawling, symlinks, HAR, trace ZIP, HTML report, and test-source scanning are excluded.",
  "Credential-bearing state is a bounded heuristic based on HttpOnly cookies and common credential semantics in cookie names or localStorage keys; false positives and false negatives remain possible.",
  "Personal-data-shaped counts cover only direct email- and phone-shaped cookie/localStorage string values; they do not establish that a value belongs to a real person.",
  "REVIEW_REQUIRED means a credential-bearing file is tracked, unignored, or could not be classified by Git; it is not proof of publication, exposure, account compromise, or a legal conclusion.",
  "IGNORED is informational local Git evidence only; it does not prove that a file was never committed, copied, uploaded, or otherwise exposed.",
  "Git status is evaluated from the local worktree at scan time. GIT_UNAVAILABLE means ignore protection could not be established and credential-bearing state remains review-required.",
  "Only cookie and localStorage structure is classified. Headers, sessionStorage, IndexedDB payloads, and application-specific credential formats are not assessed.",
  "Raw JSON, names, values, domains, origins, and input paths are not returned, logged, or written by PrivacySpec; raw file material is retained only while an input is being classified.",
] as const;

export class StorageStateScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageStateScanError";
  }
}

const inputError = (input: number, message: string): StorageStateScanError =>
  new StorageStateScanError(`Storage-state input ${input} ${message}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum;

const assertNoSymlink = async (path: string, input: number): Promise<void> => {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const segments = absolutePath.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    let status: Awaited<ReturnType<typeof lstat>>;
    try {
      status = await lstat(current);
    } catch {
      throw inputError(input, "could not be opened as an existing regular file.");
    }
    if (status.isSymbolicLink()) {
      throw inputError(input, "is or traverses a symbolic link; symlinks are not followed.");
    }
  }
};

const assertBoundedJsonTree = (value: unknown, input: number): void => {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > MAX_STORAGE_STATE_JSON_NODES) {
      throw inputError(input, `exceeds the JSON node limit of ${MAX_STORAGE_STATE_JSON_NODES}.`);
    }
    if (current.depth > MAX_STORAGE_STATE_JSON_DEPTH) {
      throw inputError(input, `exceeds the JSON depth limit of ${MAX_STORAGE_STATE_JSON_DEPTH}.`);
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
};

const normalizedCredentialName = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");

const hasCredentialNameSemantics = (value: string): boolean => {
  const normalized = normalizedCredentialName(value);
  if (normalized.length === 0) return false;
  return (
    [
      "accesstoken",
      "refreshtoken",
      "idtoken",
      "authorization",
      "credential",
      "password",
      "passwd",
      "session",
      "bearer",
      "secret",
      "token",
      "csrf",
      "xsrf",
    ].some((semantic) => normalized.includes(semantic)) || normalized === "sid"
  );
};

const isEmailShape = (value: string): boolean =>
  value.length >= 6 &&
  value.length <= 320 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u.test(
    value,
  );

const isPhoneShape = (value: string): boolean => {
  if (value.length < 7 || value.length > 32 || !/^\+?[0-9][0-9 ().-]*[0-9]$/u.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 7 && digits.length <= 15;
};

interface ClassifiedState {
  structure: StorageStateFileObservation["structure"];
  credentialEvidence: StorageStateFileObservation["credentialEvidence"];
  personalDataShapes: StorageStateFileObservation["personalDataShapes"];
}

const classifyStorageState = (parsed: unknown, input: number): ClassifiedState => {
  if (!isRecord(parsed) || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
    throw inputError(input, "is not a supported Playwright storage-state JSON object.");
  }

  let credentialNamedCookieCount = 0;
  let httpOnlyCookieCount = 0;
  let credentialNamedLocalStorageEntryCount = 0;
  let localStorageEntryCount = 0;
  let emailValueCount = 0;
  let phoneValueCount = 0;

  const classifyPersonalShape = (value: string): void => {
    if (isEmailShape(value)) emailValueCount += 1;
    else if (isPhoneShape(value)) phoneValueCount += 1;
  };

  for (const cookie of parsed.cookies) {
    if (
      !isRecord(cookie) ||
      !isBoundedString(cookie.name, MAX_KEY_LENGTH) ||
      !isBoundedString(cookie.value, MAX_VALUE_LENGTH) ||
      !isBoundedString(cookie.domain, MAX_ORIGIN_LENGTH) ||
      !isBoundedString(cookie.path, MAX_ORIGIN_LENGTH) ||
      typeof cookie.expires !== "number" ||
      !Number.isFinite(cookie.expires) ||
      typeof cookie.httpOnly !== "boolean" ||
      typeof cookie.secure !== "boolean" ||
      !["Strict", "Lax", "None"].includes(cookie.sameSite as string)
    ) {
      throw inputError(input, "contains an unsupported cookie entry.");
    }
    if (hasCredentialNameSemantics(cookie.name)) credentialNamedCookieCount += 1;
    if (cookie.httpOnly) httpOnlyCookieCount += 1;
    classifyPersonalShape(cookie.value);
  }

  for (const origin of parsed.origins) {
    if (
      !isRecord(origin) ||
      !isBoundedString(origin.origin, MAX_ORIGIN_LENGTH) ||
      !Array.isArray(origin.localStorage)
    ) {
      throw inputError(input, "contains an unsupported origin entry.");
    }
    for (const entry of origin.localStorage) {
      if (
        !isRecord(entry) ||
        !isBoundedString(entry.name, MAX_KEY_LENGTH) ||
        !isBoundedString(entry.value, MAX_VALUE_LENGTH)
      ) {
        throw inputError(input, "contains an unsupported localStorage entry.");
      }
      localStorageEntryCount += 1;
      if (hasCredentialNameSemantics(entry.name)) credentialNamedLocalStorageEntryCount += 1;
      classifyPersonalShape(entry.value);
    }
  }

  const present =
    credentialNamedCookieCount > 0 ||
    httpOnlyCookieCount > 0 ||
    credentialNamedLocalStorageEntryCount > 0;
  return {
    structure: {
      cookieCount: parsed.cookies.length,
      originCount: parsed.origins.length,
      localStorageEntryCount,
    },
    credentialEvidence: {
      present,
      credentialNamedCookieCount,
      httpOnlyCookieCount,
      credentialNamedLocalStorageEntryCount,
    },
    personalDataShapes: { emailValueCount, phoneValueCount },
  };
};

const git = async (
  cwd: string,
  args: readonly string[],
): Promise<{ ok: boolean; stdout: string }> => {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    });
    return { ok: true, stdout: result.stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
};

const repositoryStatus = async (path: string): Promise<StorageStateRepositoryStatus> => {
  const directory = dirname(path);
  const rootResult = await git(directory, ["rev-parse", "--show-toplevel"]);
  if (!rootResult.ok) return "GIT_UNAVAILABLE";
  const repositoryRoot = rootResult.stdout.replace(/[\r\n]+$/u, "");
  if (repositoryRoot.length === 0 || !isAbsolute(repositoryRoot)) return "GIT_UNAVAILABLE";
  const repositoryPath = relative(repositoryRoot, path);
  if (
    repositoryPath.length === 0 ||
    isAbsolute(repositoryPath) ||
    repositoryPath.split(sep).includes("..")
  ) {
    return "GIT_UNAVAILABLE";
  }
  if ((await git(repositoryRoot, ["ls-files", "--error-unmatch", "--", repositoryPath])).ok) {
    return "TRACKED";
  }
  if (
    (await git(repositoryRoot, ["check-ignore", "--quiet", "--no-index", "--", repositoryPath])).ok
  ) {
    return "IGNORED";
  }
  return "UNTRACKED";
};

const findingStatus = (
  credentialsPresent: boolean,
  status: StorageStateRepositoryStatus,
): StorageStateFindingStatus =>
  credentialsPresent && status !== "IGNORED" ? "REVIEW_REQUIRED" : "INFORMATIONAL";

const scanOne = async (path: string, input: number): Promise<StorageStateFileObservation> => {
  await assertNoSymlink(path, input);
  const gitStatus = await repositoryStatus(path);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw inputError(input, "could not be opened as a regular non-symlink file.");
  }

  let raw: Buffer | undefined;
  let parsed: unknown;
  try {
    const status = await handle.stat();
    if (!status.isFile()) throw inputError(input, "is not a regular file.");
    if (status.size > MAX_STORAGE_STATE_FILE_BYTES) {
      throw inputError(
        input,
        `exceeds the file-size limit of ${MAX_STORAGE_STATE_FILE_BYTES} bytes.`,
      );
    }
    raw = await handle.readFile();
    if (raw.byteLength > MAX_STORAGE_STATE_FILE_BYTES) {
      throw inputError(
        input,
        `exceeds the file-size limit of ${MAX_STORAGE_STATE_FILE_BYTES} bytes.`,
      );
    }
    try {
      parsed = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      throw inputError(input, "is not valid JSON.");
    }
    assertBoundedJsonTree(parsed, input);
    const classified = classifyStorageState(parsed, input);
    return {
      input,
      repositoryStatus: gitStatus,
      findingStatus: findingStatus(classified.credentialEvidence.present, gitStatus),
      ...classified,
    };
  } finally {
    parsed = undefined;
    raw?.fill(0);
    await handle.close();
  }
};

const summarize = (files: readonly StorageStateFileObservation[]) => ({
  files: files.length,
  reviewRequired: files.filter((file) => file.findingStatus === "REVIEW_REQUIRED").length,
  informational: files.filter((file) => file.findingStatus === "INFORMATIONAL").length,
  credentialBearingFiles: files.filter((file) => file.credentialEvidence.present).length,
  personalDataShapedFiles: files.filter(
    (file) =>
      file.personalDataShapes.emailValueCount > 0 || file.personalDataShapes.phoneValueCount > 0,
  ).length,
  repositoryStatus: {
    tracked: files.filter((file) => file.repositoryStatus === "TRACKED").length,
    ignored: files.filter((file) => file.repositoryStatus === "IGNORED").length,
    untracked: files.filter((file) => file.repositoryStatus === "UNTRACKED").length,
    gitUnavailable: files.filter((file) => file.repositoryStatus === "GIT_UNAVAILABLE").length,
  },
});

export const scanStorageStateFiles = async (
  paths: readonly string[],
): Promise<PrivacySpecStorageStateScan> => {
  if (paths.length === 0)
    throw new StorageStateScanError("At least one storage-state path is required.");
  if (paths.length > MAX_STORAGE_STATE_FILES) {
    throw new StorageStateScanError(
      `Storage-state scan supports at most ${MAX_STORAGE_STATE_FILES} explicitly supplied files.`,
    );
  }
  const resolvedPaths = paths.map((path) => resolve(path));
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    throw new StorageStateScanError("Each storage-state input path may be supplied only once.");
  }

  const files: StorageStateFileObservation[] = [];
  for (const [index, path] of resolvedPaths.entries()) files.push(await scanOne(path, index + 1));
  return {
    storageStateScanSchemaVersion: STORAGE_STATE_SCAN_SCHEMA_VERSION,
    tool: { name: "privacyspec", version: PRIVACYSPEC_TOOL_VERSION },
    scope: {
      explicitlySuppliedFiles: resolvedPaths.length,
      scannedFiles: files.length,
      repositoryCrawl: false,
      symlinksFollowed: false,
    },
    summary: summarize(files),
    files,
    technicalBasis: {
      source: PLAYWRIGHT_AUTH_STATE_GUIDANCE_URL,
      statement:
        "Playwright warns that authentication-state files can contain sensitive browser state capable of impersonating a test account and advises against committing them.",
    },
    limitations: [...BASE_LIMITATIONS],
  };
};
