#!/usr/bin/env node

import { execFile } from "node:child_process";
import { appendFile, chmod, copyFile, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ACTION_FAILURE_SUMMARY =
  "# PrivacySpec Secondary Coverage\n\nPrivacySpec summary unavailable. See the action log for details.\n";
export const MAX_ACTION_SUMMARY_BYTES = 64 * 1024;
export const MAX_ACTION_REPORT_BYTES = 64 * 1024 * 1024;

const hasUnsafeControlCharacter = (value) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code < 32 || (code >= 127 && code <= 159));
  });

const containsGlobSyntax = (value) => /[*?[\]{}!]/u.test(value);

const isContained = (root, candidate) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

const requireEnvironment = (environment, name) => {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The GitHub Action environment is missing ${name}.`);
  }
  return value;
};

const requireSafeRelativePath = (value, name, { allowDot = false } = {}) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    isAbsolute(value) ||
    /^(?:[A-Za-z]:[\\/]|[\\/]{2})/u.test(value) ||
    containsGlobSyntax(value) ||
    hasUnsafeControlCharacter(value) ||
    value.split(/[\\/]+/u).includes("..") ||
    (!allowDot && value === ".")
  ) {
    throw new Error(`${name} must be a bounded relative path without traversal or glob syntax.`);
  }
  return value;
};

const rejectSymbolicLinkComponents = async (root, relativePath) => {
  let candidate = root;
  for (const component of relativePath.split("/")) {
    candidate = join(candidate, component);
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw new Error("report-path must not contain symbolic links.");
    }
  }
};

const parseBooleanInput = (value, name) => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

const validateArtifactName = (value) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new Error("artifact-name must be a bounded printable string.");
  }
};

const validateRetentionDays = (value) => {
  if (!/^[1-9][0-9]?$/u.test(value) || Number(value) > 90) {
    throw new Error("retention-days must be an integer from 1 through 90.");
  }
};

export const resolveActionInputs = async (environment) => {
  const workspace = await realpath(requireEnvironment(environment, "GITHUB_WORKSPACE"));
  const workingInput = requireSafeRelativePath(
    requireEnvironment(environment, "PRIVACYSPEC_WORKING_DIRECTORY"),
    "working-directory",
    { allowDot: true },
  );
  const reportInput = requireSafeRelativePath(
    requireEnvironment(environment, "PRIVACYSPEC_REPORT_PATH"),
    "report-path",
  );
  const workingDirectory = await realpath(resolve(workspace, workingInput));
  if (!isContained(workspace, workingDirectory)) {
    throw new Error("working-directory must resolve inside GITHUB_WORKSPACE.");
  }
  const reportCandidate = resolve(workingDirectory, reportInput);
  if (!isContained(workingDirectory, reportCandidate)) {
    throw new Error("report-path must resolve inside working-directory.");
  }
  await rejectSymbolicLinkComponents(workingDirectory, reportInput);
  const reportMetadata = await lstat(reportCandidate);
  if (
    reportMetadata.isSymbolicLink() ||
    !reportMetadata.isFile() ||
    reportMetadata.size > MAX_ACTION_REPORT_BYTES
  ) {
    throw new Error("report-path must identify a regular file and must not be a symlink.");
  }
  const reportPath = await realpath(reportCandidate);
  if (!isContained(workingDirectory, reportPath)) {
    throw new Error("report-path must resolve inside working-directory.");
  }

  const uploadArtifact = parseBooleanInput(
    requireEnvironment(environment, "PRIVACYSPEC_UPLOAD_ARTIFACT"),
    "upload-artifact",
  );
  validateArtifactName(requireEnvironment(environment, "PRIVACYSPEC_ARTIFACT_NAME"));
  validateRetentionDays(requireEnvironment(environment, "PRIVACYSPEC_RETENTION_DAYS"));

  return {
    workspace,
    workingDirectory,
    reportPath,
    uploadArtifact,
    githubOutput: requireEnvironment(environment, "GITHUB_OUTPUT"),
    githubStepSummary: requireEnvironment(environment, "GITHUB_STEP_SUMMARY"),
    runnerTemp: await realpath(requireEnvironment(environment, "RUNNER_TEMP")),
  };
};

export const executeSummaryCli = async ({ workingDirectory, reportPath, environment }) => {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const localCli = join(workingDirectory, "node_modules", ".bin", "privacyspec");
  try {
    const localCliMetadata = await lstat(localCli);
    if (!localCliMetadata.isFile() && !localCliMetadata.isSymbolicLink()) {
      throw new Error("The local PrivacySpec CLI is unavailable.");
    }
    const result = await execFileAsync(
      executable,
      ["--no-install", "privacyspec", "summary", "--report", reportPath, "--format", "markdown"],
      {
        cwd: workingDirectory,
        encoding: "utf8",
        env: environment,
        maxBuffer: MAX_ACTION_SUMMARY_BYTES * 2,
      },
    );
    if (Buffer.byteLength(result.stdout, "utf8") > MAX_ACTION_SUMMARY_BYTES) {
      throw new Error("PrivacySpec CLI produced an oversized GitHub summary.");
    }
    return result.stdout;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.length > 0
    ) {
      process.stderr.write(error.stderr.slice(0, MAX_ACTION_SUMMARY_BYTES));
    }
    throw new Error("The locally installed PrivacySpec CLI could not render the report.");
  }
};

export const runSummaryAction = async (environment = process.env, execute = executeSummaryCli) => {
  let stepSummary = environment.GITHUB_STEP_SUMMARY;
  let stagingDirectory = "";
  try {
    const input = await resolveActionInputs(environment);
    stepSummary = input.githubStepSummary;
    let stagedReport = "";
    let reportToValidate = input.reportPath;
    if (input.uploadArtifact) {
      stagingDirectory = await mkdtemp(join(input.runnerTemp, "privacyspec-action-"));
      stagedReport = join(stagingDirectory, "privacyspec-report.json");
      await copyFile(input.reportPath, stagedReport);
      await chmod(stagedReport, 0o600);
      reportToValidate = stagedReport;
    }
    const markdown = await execute({
      workingDirectory: input.workingDirectory,
      reportPath: reportToValidate,
      environment,
    });
    if (Buffer.byteLength(markdown, "utf8") > MAX_ACTION_SUMMARY_BYTES) {
      throw new Error("PrivacySpec CLI produced an oversized GitHub summary.");
    }
    await appendFile(input.githubStepSummary, markdown, "utf8");

    await appendFile(
      input.githubOutput,
      `staged-report=${stagedReport}\nsummary-written=true\n`,
      "utf8",
    );
    return { stagedReport };
  } catch (error) {
    if (stagingDirectory.length > 0) {
      try {
        await rm(stagingDirectory, { recursive: true, force: true });
      } catch {
        // Preserve the validation failure when temporary cleanup is unavailable.
      }
    }
    if (typeof stepSummary === "string" && stepSummary.length > 0) {
      try {
        await appendFile(stepSummary, ACTION_FAILURE_SUMMARY, "utf8");
      } catch {
        // Preserve the original action failure when the GitHub summary file is unavailable.
      }
    }
    throw error;
  }
};

export const cleanupStagedReport = async (environment = process.env) => {
  const stagedReport = environment.PRIVACYSPEC_STAGED_REPORT;
  if (typeof stagedReport !== "string" || stagedReport.length === 0) return;
  const runnerTemp = await realpath(requireEnvironment(environment, "RUNNER_TEMP"));
  const stagingDirectory = resolve(stagedReport, "..");
  if (
    !isContained(runnerTemp, stagingDirectory) ||
    !stagingDirectory.split(sep).at(-1)?.startsWith("privacyspec-action-")
  ) {
    throw new Error("Refusing to clean an invalid PrivacySpec staging path.");
  }
  await rm(stagingDirectory, { recursive: true, force: true });
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  try {
    if (process.argv[2] === "cleanup") await cleanupStagedReport();
    else await runSummaryAction();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GitHub Action failure.";
    process.stderr.write(`PrivacySpec Action error: ${message}\n`);
    process.exitCode = 1;
  }
}
