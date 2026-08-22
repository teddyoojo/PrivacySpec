import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  readCompleteDependencyLatestRunFile,
  readDependencyReport,
  writeDependencyBaselineFile,
} from "../dist/analyzers/dependency/artifact.js";
import {
  readCompleteRuntimeFailureLatestRunFile,
  readRuntimeFailureReport,
  writeRuntimeFailureBaselineFile,
} from "../dist/analyzers/runtime-failure/artifact.js";
import {
  readCompleteSecurityLatestRunFile,
  readSecurityReport,
  writeSecurityBaselineFile,
} from "../dist/analyzers/security/artifact.js";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const configPath = fileURLToPath(
  new URL("../fixtures/reporter-skip/playwright.config.mjs", import.meta.url),
);
const incompatibleContextConfigPath = fileURLToPath(
  new URL("../fixtures/reporter-incompatible-context/playwright.config.mjs", import.meta.url),
);
const mixedContextConfigPath = fileURLToPath(
  new URL("../fixtures/reporter-mixed-context/playwright.config.mjs", import.meta.url),
);
const dependencyConfigPath = fileURLToPath(
  new URL("../fixtures/dependency-observer/playwright.config.mjs", import.meta.url),
);
const securityConfigPath = fileURLToPath(
  new URL("../fixtures/security-posture/playwright.config.mjs", import.meta.url),
);
const runtimeFailureConfigPath = fileURLToPath(
  new URL("../fixtures/runtime-failure/playwright.config.mjs", import.meta.url),
);

const runDependencyFixture = async ({ baselinePath, latestRunPath, reportPath, mode }) => {
  const environment = {
    ...process.env,
    NO_COLOR: "1",
    PRIVACYSPEC_DEPENDENCY_BASELINE_PATH: baselinePath,
    PRIVACYSPEC_DEPENDENCY_LATEST_RUN_PATH: latestRunPath,
    PRIVACYSPEC_DEPENDENCY_REPORT_PATH: reportPath,
    PRIVACYSPEC_DEPENDENCY_FIXTURE_MODE: mode,
  };
  delete environment.FORCE_COLOR;
  delete environment.NODE_TEST_CONTEXT;
  return execFileAsync(
    process.execPath,
    [playwrightCli, "test", `--config=${dependencyConfigPath}`],
    {
      cwd: packageDirectory,
      env: environment,
    },
  );
};

const runSecurityFixture = async ({ baselinePath, latestRunPath, reportPath, mode }) => {
  const environment = {
    ...process.env,
    NO_COLOR: "1",
    PRIVACYSPEC_SECURITY_BASELINE_PATH: baselinePath,
    PRIVACYSPEC_SECURITY_LATEST_RUN_PATH: latestRunPath,
    PRIVACYSPEC_SECURITY_REPORT_PATH: reportPath,
    PRIVACYSPEC_SECURITY_FIXTURE_MODE: mode,
  };
  delete environment.FORCE_COLOR;
  delete environment.NODE_TEST_CONTEXT;
  return execFileAsync(
    process.execPath,
    [playwrightCli, "test", `--config=${securityConfigPath}`],
    { cwd: packageDirectory, env: environment },
  );
};

const runRuntimeFailureFixture = async ({ baselinePath, latestRunPath, reportPath, mode }) => {
  const environment = {
    ...process.env,
    NO_COLOR: "1",
    PRIVACYSPEC_RUNTIME_FAILURE_BASELINE_PATH: baselinePath,
    PRIVACYSPEC_RUNTIME_FAILURE_LATEST_RUN_PATH: latestRunPath,
    PRIVACYSPEC_RUNTIME_FAILURE_REPORT_PATH: reportPath,
    PRIVACYSPEC_RUNTIME_FAILURE_FIXTURE_MODE: mode,
  };
  delete environment.FORCE_COLOR;
  delete environment.NODE_TEST_CONTEXT;
  return execFileAsync(
    process.execPath,
    [playwrightCli, "test", `--config=${runtimeFailureConfigPath}`],
    { cwd: packageDirectory, env: environment },
  );
};

test("a static Playwright skip does not become a PrivacySpec failure", async () => {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  delete environment.NODE_TEST_CONTEXT;
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [playwrightCli, "test", `--config=${configPath}`],
    {
      cwd: packageDirectory,
      env: environment,
    },
  );
  const output = `${stdout}\n${stderr}`;
  assert.match(output, /1 skipped/u);
  assert.match(output, /Functional tests: PASS \(0\/1 passed; 0 observed\)/u);
  assert.match(output, /Secondary coverage: INCONCLUSIVE/u);
  assert.doesNotMatch(output, /PrivacySpec integration error/u);
});

test("browser.newPage outside the fixture context fails coverage integrity", async () => {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  delete environment.NODE_TEST_CONTEXT;
  let failure;
  try {
    await execFileAsync(
      process.execPath,
      [playwrightCli, "test", `--config=${incompatibleContextConfigPath}`],
      {
        cwd: packageDirectory,
        env: environment,
      },
    );
  } catch (error) {
    failure = error;
  }

  assert.ok(failure);
  assert.equal(failure.code, 1);
  const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
  assert.match(output, /1 passed/u);
  assert.match(
    output,
    /COVERAGE_INCOMPATIBLE: 1 Playwright tests ran but no application BrowserContexts were instrumented/u,
  );
  assert.match(output, /Observation coverage: UNSUPPORTED/u);
  assert.match(output, /PrivacySpec result: FAIL \(functional tests=PASS/u);
});

test("mixed fixture and independent pages cannot produce false complete coverage", async () => {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  delete environment.NODE_TEST_CONTEXT;
  let failure;
  try {
    await execFileAsync(
      process.execPath,
      [playwrightCli, "test", `--config=${mixedContextConfigPath}`],
      {
        cwd: packageDirectory,
        env: environment,
      },
    );
  } catch (error) {
    failure = error;
  }

  assert.ok(failure);
  assert.equal(failure.code, 1);
  const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
  assert.match(output, /1 passed/u);
  assert.match(output, /Observation coverage: UNSUPPORTED \(contexts=1\/3, pages=1\/3/u);
  assert.match(
    output,
    /detected application BrowserContexts or pages outside the instrumented test context/u,
  );
  assert.match(output, /Secondary coverage: FAIL/u);
  assert.match(output, /privacy\s+INCONCLUSIVE \(coverage=UNSUPPORTED/u);
});

test("controlled dependency fixture covers new, known, and resolved runtime dependencies", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-dependency-browser-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const baselinePath = join(directory, "dependencies-baseline.json");
  const latestRunPath = join(directory, "latest-dependencies.json");
  const reportPath = join(directory, "dependencies-report.json");

  const first = await runDependencyFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "external",
  });
  const firstOutput = `${first.stdout}\n${first.stderr}`;
  assert.match(firstOutput, /2 passed/u);
  assert.match(firstOutput, /dependencies\s+REVIEW \(coverage=COMPLETE/u);
  assert.match(firstOutput, /PrivacySpec result: REVIEW \(functional tests=PASS/u);
  const firstReport = await readDependencyReport(reportPath);
  assert.equal(firstReport.complete, true);
  assert.deepEqual(firstReport.findings.map((finding) => finding.ruleId).sort(), [
    "NEW_EXTERNAL_API",
    "NEW_EXTERNAL_IFRAME",
    "NEW_EXTERNAL_ORIGIN",
    "NEW_EXTERNAL_ORIGIN",
    "NEW_EXTERNAL_SCRIPT",
  ]);
  const latestRun = await readCompleteDependencyLatestRunFile(latestRunPath);
  await writeDependencyBaselineFile(baselinePath, latestRun.dependencies, {
    createdAt: "2026-08-21T12:00:00.000Z",
  });

  const known = await runDependencyFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "external",
  });
  assert.match(`${known.stdout}\n${known.stderr}`, /dependencies\s+PASS \(coverage=COMPLETE/u);
  const knownReport = await readDependencyReport(reportPath);
  assert.equal(knownReport.baseline.new, 0);
  assert.equal(knownReport.baseline.known, latestRun.dependencies.length);

  const resolved = await runDependencyFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "none",
  });
  assert.match(
    `${resolved.stdout}\n${resolved.stderr}`,
    /dependencies\s+PASS \(coverage=COMPLETE/u,
  );
  const resolvedReport = await readDependencyReport(reportPath);
  assert.equal(resolvedReport.inventory.length, 0);
  assert.equal(resolvedReport.baseline.resolved, latestRun.dependencies.length);
});

test("controlled security fixture detects a hidden posture regression and baseline lifecycle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-security-browser-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const baselinePath = join(directory, "security-baseline.json");
  const latestRunPath = join(directory, "latest-security.json");
  const reportPath = join(directory, "security-report.json");

  const initial = await runSecurityFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "strong",
  });
  assert.match(`${initial.stdout}\n${initial.stderr}`, /2 passed/u);
  const initialReport = await readSecurityReport(reportPath);
  assert.equal(initialReport.baseline.newTargets, 2);
  assert.equal(initialReport.findings.length, 0);
  const latest = await readCompleteSecurityLatestRunFile(latestRunPath);
  await writeSecurityBaselineFile(baselinePath, latest.entries, {
    createdAt: "2026-08-21T12:00:00.000Z",
  });

  const known = await runSecurityFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "strong",
  });
  assert.match(`${known.stdout}\n${known.stderr}`, /security\s+PASS \(coverage=COMPLETE/u);
  assert.equal((await readSecurityReport(reportPath)).baseline.known, 2);

  const changed = await runSecurityFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "weak",
  });
  const changedOutput = `${changed.stdout}\n${changed.stderr}`;
  assert.match(changedOutput, /2 passed/u);
  assert.match(changedOutput, /security\s+REVIEW \(coverage=COMPLETE/u);
  assert.match(changedOutput, /PrivacySpec result: REVIEW \(functional tests=PASS/u);
  const changedReport = await readSecurityReport(reportPath);
  assert.equal(changedReport.baseline.changed, 2);
  assert.deepEqual(changedReport.findings.map((finding) => finding.ruleId).sort(), [
    "SECURITY_COOKIE_CHANGED",
    "SECURITY_CORS_CHANGED",
    "SECURITY_CSP_CHANGED",
    "SECURITY_HSTS_CHANGED",
    "SECURITY_XCTO_CHANGED",
  ]);

  const resolved = await runSecurityFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "absent",
  });
  assert.match(`${resolved.stdout}\n${resolved.stderr}`, /security\s+PASS \(coverage=COMPLETE/u);
  assert.equal((await readSecurityReport(reportPath)).baseline.resolved, 2);
});

test("controlled hidden runtime failures stay functionally green and follow baseline lifecycle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-runtime-failure-browser-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const baselinePath = join(directory, "runtime-failures-baseline.json");
  const latestRunPath = join(directory, "latest-runtime-failures.json");
  const reportPath = join(directory, "runtime-failures-report.json");

  let firstFailure;
  try {
    await runRuntimeFailureFixture({
      baselinePath,
      latestRunPath,
      reportPath,
      mode: "failures",
    });
  } catch (error) {
    firstFailure = error;
  }
  assert.ok(firstFailure);
  assert.equal(firstFailure.code, 1);
  const firstOutput = `${firstFailure.stdout ?? ""}\n${firstFailure.stderr ?? ""}`;
  assert.match(firstOutput, /1 passed/u);
  assert.match(firstOutput, /runtime\s+FAIL \(coverage=COMPLETE/u);
  assert.match(firstOutput, /RUNTIME_PAGE_ERROR/u);
  assert.match(firstOutput, /RUNTIME_HTTP_5XX/u);
  const firstReport = await readRuntimeFailureReport(reportPath);
  assert.equal(firstReport.complete, true);
  assert.deepEqual(firstReport.findings.map((finding) => finding.ruleId).sort(), [
    "RUNTIME_CONSOLE_ERROR",
    "RUNTIME_HTTP_5XX",
    "RUNTIME_PAGE_ERROR",
    "RUNTIME_REQUEST_FAILED",
  ]);
  assert.equal(
    firstReport.inventory.some((entry) => entry.httpStatus === 404),
    false,
  );
  const serialized = JSON.stringify(firstReport);
  assert.equal(serialized.includes("person@example.test"), false);
  assert.equal(serialized.includes("99123"), false);
  assert.equal(serialized.includes("55123"), false);
  assert.equal(serialized.toLowerCase().includes("stack"), false);

  const latest = await readCompleteRuntimeFailureLatestRunFile(latestRunPath);
  await writeRuntimeFailureBaselineFile(baselinePath, latest.entries, {
    createdAt: "2026-08-21T12:00:00.000Z",
  });

  const known = await runRuntimeFailureFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "failures",
  });
  const knownOutput = `${known.stdout}\n${known.stderr}`;
  assert.match(knownOutput, /1 passed/u);
  assert.match(knownOutput, /runtime\s+PASS \(coverage=COMPLETE/u);
  assert.match(knownOutput, /dependencies\s+REVIEW \(coverage=COMPLETE/u);
  assert.match(knownOutput, /PrivacySpec result: REVIEW \(functional tests=PASS/u);
  const knownReport = await readRuntimeFailureReport(reportPath);
  assert.equal(knownReport.findings.length, 0);
  assert.equal(knownReport.baseline.known, 4);

  const resolved = await runRuntimeFailureFixture({
    baselinePath,
    latestRunPath,
    reportPath,
    mode: "none",
  });
  assert.match(`${resolved.stdout}\n${resolved.stderr}`, /runtime\s+PASS \(coverage=COMPLETE/u);
  const resolvedReport = await readRuntimeFailureReport(reportPath);
  assert.equal(resolvedReport.inventory.length, 0);
  assert.equal(resolvedReport.baseline.resolved, 4);
});
