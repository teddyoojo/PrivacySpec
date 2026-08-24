import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  readDependencyBaselineFile,
  writeDependencyLatestRunFile,
} from "../dist/analyzers/dependency/artifact.js";
import { createDependencySemanticKey } from "../dist/analyzers/dependency/baseline.js";
import { createRuntimeFailureKey } from "../dist/analyzers/runtime-failure/analyzer.js";
import {
  readRuntimeFailureBaselineFile,
  writeRuntimeFailureLatestRunFile,
} from "../dist/analyzers/runtime-failure/artifact.js";
import { createSecurityTargetKey } from "../dist/analyzers/security/analyzer.js";
import {
  readSecurityBaselineFile,
  writeSecurityLatestRunFile,
} from "../dist/analyzers/security/artifact.js";
import { createBaselineKey } from "../dist/baseline/compare.js";
import { readBaselineProposalFile } from "../dist/baseline/proposal.js";
import { DEFAULT_BASELINE_PROPOSAL_PATH } from "../dist/baseline/proposal-model.js";
import { DEFAULT_BASELINE_PATH, DEFAULT_LATEST_RUN_PATH } from "../dist/baseline/schema.js";
import { readBaselineFile, writeBaselineFile, writeLatestRunFile } from "../dist/baseline/write.js";
import { runCli } from "../dist/cli/run.js";
import { writePrivacySpecReport } from "../dist/report/json.js";
import { createPrivacySpecReport, DEFAULT_REPORT_PATH } from "../dist/report/model.js";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));
const cliLauncher = fileURLToPath(new URL("../bin/privacyspec.js", import.meta.url));

const identity = {
  ruleId: "PS1004",
  dataCategory: "personal.email",
  sinkKind: "external-request",
  recipient: "https://analytics.example.test",
  endpoint: "/event",
  location: "json.email",
  transform: "EXACT",
};
const candidate = { key: createBaselineKey(identity), ...identity };
const privacyCandidateAt = (location) => {
  const value = { ...identity, location };
  return { key: createBaselineKey(value), ...value };
};
const dependencyCandidate = {
  key: createDependencySemanticKey("script", "cdn.vendor.test"),
  boundary: "external",
  category: "script",
  host: "cdn.vendor.test",
};
const securityCandidate = {
  key: createSecurityTargetKey({
    host: "app.example.test",
    endpoint: "/dashboard",
    responseKind: "document",
    method: "GET",
  }),
  host: "app.example.test",
  endpoint: "/dashboard",
  responseKind: "document",
  method: "GET",
  fingerprints: [
    {
      transport: "secure",
      csp: "present:sha256:1234567890abcdef",
      hsts: "max-age=31536000;includeSubDomains=true;preload=false",
      xContentTypeOptions: "nosniff",
      cors: "origin=none;credentials=none;methods=none",
      cookies: [],
    },
  ],
  status: "accepted",
};
const runtimeFailureCandidate = {
  key: createRuntimeFailureKey({
    failureType: "http-5xx",
    details: {
      boundary: "first-party",
      host: "app.example.test",
      method: "GET",
      endpoint: "/api/recommendations/:number",
      httpStatus: 503,
      errorName: null,
      signature: null,
      failureCode: null,
    },
  }),
  failureType: "http-5xx",
  severity: "ERROR",
  summary: "First-party HTTP 503",
  boundary: "first-party",
  host: "app.example.test",
  method: "GET",
  endpoint: "/api/recommendations/:number",
  httpStatus: 503,
  errorName: null,
  signature: null,
  failureCode: null,
  status: "accepted",
};

const temporaryDirectory = async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

const emptyReport = ({ complete = true, testDataObservations = [], secondaryAnalysis } = {}) =>
  createPrivacySpecReport({
    generatedAt: "2026-08-20T12:00:00.000Z",
    startedAt: "2026-08-20T11:59:59.000Z",
    playwrightStatus: complete ? "passed" : "failed",
    privacyspecStatus: complete ? "passed" : "incomplete",
    complete,
    projects: ["chromium"],
    tests: {
      total: 1,
      observed: 1,
      passed: complete ? 1 : 0,
      failed: complete ? 0 : 1,
      timedOut: 0,
      skipped: 0,
      interrupted: 0,
    },
    sourceCounts: new Map(),
    sinkCounts: new Map(),
    suiteDurationMilliseconds: 100,
    cumulativeTestDurationMilliseconds: 50,
    flows: [],
    findings: [],
    comparison: { observed: [], known: [], new: [], resolved: [] },
    baselineExists: false,
    diagnostics: [],
    integrationErrors: [],
    ruleMappings: [],
    profileMappings: [],
    testDataObservations,
    secondaryAnalysis,
  });

const completeSecondaryAnalysis = ({ dependencyFindings = [], runtimeFindings = [] } = {}) => ({
  dependencies: {
    schemaVersion: 1,
    generatedAt: "2026-08-20T12:00:00.000Z",
    complete: true,
    coverage: "complete",
    inventory: [],
    findings: dependencyFindings,
    baseline: { exists: true, known: 0, new: dependencyFindings.length, resolved: 0 },
    diagnostics: [],
  },
  security: {
    schemaVersion: 1,
    generatedAt: "2026-08-20T12:00:00.000Z",
    complete: true,
    coverage: "complete",
    inventory: [],
    findings: [],
    baseline: { exists: true, known: 0, changed: 0, newTargets: 0, resolved: 0 },
    diagnostics: [],
  },
  runtimeErrors: {
    schemaVersion: 1,
    generatedAt: "2026-08-20T12:00:00.000Z",
    complete: true,
    coverage: "complete",
    inventory: [],
    findings: runtimeFindings,
    baseline: { exists: true, known: 0, new: runtimeFindings.length, resolved: 0 },
    diagnostics: [],
  },
});

const summaryReport = (status) => {
  if (status === "inconclusive") return emptyReport();
  const dependencyFindings =
    status === "review"
      ? [
          {
            kind: "dependency-finding",
            ruleId: "NEW_EXTERNAL_SCRIPT",
            classification: "REVIEW_REQUIRED",
            identity: createDependencySemanticKey("script", "cdn.new-vendor.test"),
            host: "cdn.new-vendor.test",
            origin: "https://cdn.new-vendor.test",
            observedAs: "script",
            firstSeenTest: { file: "tests/dependency.spec.ts", project: "chromium" },
          },
        ]
      : [];
  const runtimeFindings =
    status === "fail"
      ? [
          {
            kind: "runtime-failure-finding",
            ruleId: "RUNTIME_HTTP_5XX",
            classification: "TECHNICAL_FAILURE",
            identity: runtimeFailureCandidate.key,
            failureType: runtimeFailureCandidate.failureType,
            severity: runtimeFailureCandidate.severity,
            summary: runtimeFailureCandidate.summary,
            boundary: runtimeFailureCandidate.boundary,
            host: runtimeFailureCandidate.host,
            method: runtimeFailureCandidate.method,
            endpoint: runtimeFailureCandidate.endpoint,
            httpStatus: runtimeFailureCandidate.httpStatus,
            errorName: runtimeFailureCandidate.errorName,
            signature: runtimeFailureCandidate.signature,
            failureCode: runtimeFailureCandidate.failureCode,
            firstSeenTest: { file: "tests/runtime.spec.ts", project: "chromium" },
            occurrenceCount: 1,
          },
        ]
      : [];
  return emptyReport({
    secondaryAnalysis: completeSecondaryAnalysis({ dependencyFindings, runtimeFindings }),
  });
};

const invoke = async (args, { cwd, env = {}, interactive = false, confirm } = {}) => {
  const stdout = [];
  const stderr = [];
  const questions = [];
  const exitCode = await runCli(args, {
    cwd,
    env,
    interactive,
    writeOut: (message) => stdout.push(message),
    writeError: (message) => stderr.push(message),
    confirm:
      confirm === undefined
        ? undefined
        : async (question) => {
            questions.push(question);
            return confirm;
          },
  });
  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    questions,
  };
};

test("package exposes a working privacyspec binary", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.bin, { privacyspec: "./bin/privacyspec.js" });

  const { stdout, stderr } = await execFileAsync(process.execPath, [cliLauncher, "--help"], {
    cwd: packageDirectory,
  });
  assert.match(stdout, /privacyspec explain <rule-id>/u);
  assert.match(stdout, /privacyspec baseline show/u);
  assert.match(stdout, /privacyspec baseline propose/u);
  assert.match(stdout, /privacyspec baseline accept/u);
  assert.match(stdout, /privacyspec summary/u);
  assert.match(stdout, /privacyspec inventory/u);
  assert.match(stdout, /privacyspec testdata/u);
  assert.match(stdout, /privacyspec testdata scan <path\.\.\.>/u);
  assert.match(stdout, /privacyspec evidence/u);
  assert.equal(stderr, "");

  const explanation = await execFileAsync(process.execPath, [cliEntry, "explain", "PS1001"], {
    cwd: packageDirectory,
  });
  assert.match(explanation.stdout, /PrivacySpec PS1001: Personal data or secret in URL/u);
  assert.equal(explanation.stderr, "");
});

test("summary supports defaults, Markdown stdout, and private atomic output", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writePrivacySpecReport(join(cwd, DEFAULT_REPORT_PATH), summaryReport("pass"));

  const terminal = await invoke(["summary"], { cwd });
  assert.equal(terminal.exitCode, 0);
  assert.equal(terminal.stderr, "");
  assert.match(terminal.stdout, /^PrivacySpec Secondary Coverage\n/u);

  const markdown = await invoke(["summary", "--format", "markdown"], { cwd });
  assert.equal(markdown.exitCode, 0);
  assert.equal(markdown.stderr, "");
  assert.match(markdown.stdout, /^# PrivacySpec Secondary Coverage\n/u);

  const outputPath = join(cwd, "nested", "summary.md");
  const written = await invoke(
    ["summary", "--format", "markdown", "--output", "nested/summary.md"],
    { cwd },
  );
  assert.equal(written.exitCode, 0);
  assert.match(written.stdout, /summary written/u);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.match(await readFile(outputPath, "utf8"), /^# PrivacySpec Secondary Coverage\n/u);

  const collision = await invoke(
    ["summary", "--report", DEFAULT_REPORT_PATH, "--output", DEFAULT_REPORT_PATH],
    { cwd },
  );
  assert.equal(collision.exitCode, 1);
  assert.match(collision.stderr, /must not overwrite its source JSON report/u);

  await symlink(".", join(cwd, "report-alias"));
  const aliasCollision = await invoke(
    ["summary", "--output", "report-alias/privacyspec-report.json"],
    { cwd },
  );
  assert.equal(aliasCollision.exitCode, 1);
  assert.match(aliasCollision.stderr, /must not overwrite its source JSON report/u);

  const unwritable = await invoke(["summary", "--output", "nested"], { cwd });
  assert.equal(unwritable.exitCode, 1);
  assert.match(unwritable.stderr, /PrivacySpec CLI error:/u);
});

test("summary accepts every valid semantic status without imposing reporter policy", async (context) => {
  const cwd = await temporaryDirectory(context);
  for (const status of ["pass", "review", "fail", "inconclusive"]) {
    await writePrivacySpecReport(join(cwd, DEFAULT_REPORT_PATH), summaryReport(status));
    const result = await invoke(["summary", "--format", "markdown"], { cwd });
    assert.equal(result.exitCode, 0, status);
    assert.equal(result.stderr, "", status);
    assert.match(
      result.stdout,
      new RegExp(`\\| Secondary coverage \\| ${status.toUpperCase()} \\|`, "u"),
    );
  }
});

test("summary rejects legacy, malformed, missing, and unsupported reports", async (context) => {
  const cwd = await temporaryDirectory(context);
  const current = summaryReport("pass");
  const schemaV4 = structuredClone(current);
  schemaV4.schemaVersion = 4;
  delete schemaV4.coverage.browserEngines;
  delete schemaV4.coverage.apiRequests;
  const { analysis: _analysis, ...schemaV3 } = structuredClone(schemaV4);
  const { observation: _observation, ...schemaV2Coverage } = schemaV3.coverage;
  const schemaV2 = { ...schemaV3, schemaVersion: 2, coverage: schemaV2Coverage };
  const { coverage: _coverage, testData: _testData, ...schemaV1Common } = schemaV2;
  const legacyReports = [
    { ...schemaV1Common, schemaVersion: 1 },
    schemaV2,
    { ...schemaV3, schemaVersion: 3 },
    schemaV4,
  ];
  for (const report of legacyReports) {
    await writeFile(join(cwd, DEFAULT_REPORT_PATH), `${JSON.stringify(report)}\n`, "utf8");
    const result = await invoke(["summary"], { cwd });
    assert.equal(result.exitCode, 1, `schema v${report.schemaVersion}`);
    assert.match(result.stderr, /requires the current unified report schema v5/u);
    assert.match(result.stderr, /rerun PrivacySpec with the current package/u);
  }

  await writeFile(join(cwd, DEFAULT_REPORT_PATH), "not-json", "utf8");
  const malformed = await invoke(["summary"], { cwd });
  assert.equal(malformed.exitCode, 1);
  assert.match(malformed.stderr, /not valid JSON/u);

  await rm(join(cwd, DEFAULT_REPORT_PATH));
  const missing = await invoke(["summary"], { cwd });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /No PrivacySpec JSON report/u);

  await writeFile(
    join(cwd, DEFAULT_REPORT_PATH),
    JSON.stringify({ ...current, schemaVersion: 6 }),
    "utf8",
  );
  const unsupported = await invoke(["summary"], { cwd });
  assert.equal(unsupported.exitCode, 1);
  assert.match(unsupported.stderr, /unsupported PrivacySpec JSON report schema/u);
});

test("testdata scan supports every format and private atomic output", async (context) => {
  const cwd = await temporaryDirectory(context);
  const statePath = join(cwd, "auth-state.json");
  const rawCredential = ["phase18", "runtime", "credential"].join("-");
  await writeFile(
    statePath,
    JSON.stringify({
      cookies: [
        {
          name: ["session", "token"].join("_"),
          value: rawCredential,
          domain: "app.example.test",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    "utf8",
  );

  for (const testCase of [
    { args: ["testdata", "scan", "auth-state.json"], pattern: /Storage-State Hygiene Scan/u },
    {
      args: ["testdata", "scan", "auth-state.json", "--format", "json"],
      pattern: /"storageStateScanSchemaVersion": 1/u,
    },
    {
      args: ["testdata", "scan", "auth-state.json", "--format", "markdown"],
      pattern: /# PrivacySpec Storage-State Hygiene Scan/u,
    },
  ]) {
    const result = await invoke(testCase.args, { cwd });
    assert.equal(result.exitCode, 0, testCase.args.join(" "));
    assert.equal(result.stderr, "", testCase.args.join(" "));
    assert.match(result.stdout, testCase.pattern, testCase.args.join(" "));
    assert.doesNotMatch(result.stdout, new RegExp(rawCredential, "u"));
    assert.doesNotMatch(result.stdout, /session_token|app\.example\.test|auth-state\.json/u);
  }

  const written = await invoke(
    [
      "testdata",
      "scan",
      "auth-state.json",
      "--format",
      "markdown",
      "--output",
      "nested/storage-state.md",
    ],
    { cwd },
  );
  assert.equal(written.exitCode, 0);
  assert.equal(written.stderr, "");
  const outputPath = join(cwd, "nested", "storage-state.md");
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(outputPath, "utf8"), new RegExp(rawCredential, "u"));
});

test("inventory reads the default report and supports every stdout format", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writePrivacySpecReport(join(cwd, DEFAULT_REPORT_PATH), emptyReport());

  const expected = [
    { args: ["inventory"], pattern: /Runtime Privacy Inventory/u },
    { args: ["inventory", "--format", "json"], pattern: /"inventorySchemaVersion": 2/u },
    { args: ["inventory", "--format", "csv"], pattern: /recordType,sourceRun/u },
    {
      args: ["inventory", "--format", "markdown"],
      pattern: /# PrivacySpec Runtime Privacy Inventory/u,
    },
  ];
  for (const testCase of expected) {
    const result = await invoke(testCase.args, { cwd });
    assert.equal(result.exitCode, 0, testCase.args.join(" "));
    assert.equal(result.stderr, "", testCase.args.join(" "));
    assert.match(result.stdout, testCase.pattern, testCase.args.join(" "));
  }
});

test("inventory writes atomic private output and marks incomplete reports", async (context) => {
  const cwd = await temporaryDirectory(context);
  const reportPath = join(cwd, "source.json");
  const outputPath = join(cwd, "nested", "inventory.md");
  await writePrivacySpecReport(reportPath, emptyReport({ complete: false }));

  const result = await invoke(
    [
      "inventory",
      "--report",
      "source.json",
      "--format",
      "markdown",
      "--output",
      "nested/inventory.md",
    ],
    { cwd },
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /inventory written/u);
  assert.equal(result.stderr, "");
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.match(await readFile(outputPath, "utf8"), /\*\*INCOMPLETE\*\*/u);
});

test("inventory rejects missing, malformed, and unsupported source reports", async (context) => {
  const cwd = await temporaryDirectory(context);

  const missing = await invoke(["inventory"], { cwd });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /No PrivacySpec JSON report/u);

  await writeFile(join(cwd, DEFAULT_REPORT_PATH), "not-json", "utf8");
  const malformed = await invoke(["inventory"], { cwd });
  assert.equal(malformed.exitCode, 1);
  assert.match(malformed.stderr, /not valid JSON/u);

  await writeFile(
    join(cwd, DEFAULT_REPORT_PATH),
    JSON.stringify({ ...emptyReport(), schemaVersion: 6 }),
    "utf8",
  );
  const unsupported = await invoke(["inventory"], { cwd });
  assert.equal(unsupported.exitCode, 1);
  assert.match(unsupported.stderr, /unsupported PrivacySpec JSON report schema/u);
});

test("testdata reads schema-v2 reports and supports every stdout format", async (context) => {
  const cwd = await temporaryDirectory(context);
  const observation = {
    verdict: "REVIEW_REQUIRED",
    signal: "EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC",
    category: "personal.email",
    sourceKind: "form-input",
    attribution: {
      test: {
        file: "tests/customer.spec.ts",
        title: "customer can be created",
        project: "chromium",
      },
      control: { elementKind: "input", observedBy: "event" },
    },
  };
  await writePrivacySpecReport(
    join(cwd, DEFAULT_REPORT_PATH),
    emptyReport({ testDataObservations: [observation] }),
  );

  for (const testCase of [
    { args: ["testdata"], pattern: /PrivacySpec Test-Data Hygiene/u },
    { args: ["testdata", "--format", "json"], pattern: /"testDataSchemaVersion": 1/u },
    {
      args: ["testdata", "--format", "markdown"],
      pattern: /# PrivacySpec Test-Data Hygiene/u,
    },
  ]) {
    const result = await invoke(testCase.args, { cwd });
    assert.equal(result.exitCode, 0, testCase.args.join(" "));
    assert.equal(result.stderr, "", testCase.args.join(" "));
    assert.match(result.stdout, testCase.pattern, testCase.args.join(" "));
    assert.doesNotMatch(result.stdout, /phase16-corporate\.dev|review@/u);
  }
});

test("testdata writes private output and marks incomplete or legacy reports", async (context) => {
  const cwd = await temporaryDirectory(context);
  const reportPath = join(cwd, "source.json");
  const outputPath = join(cwd, "nested", "testdata.md");
  await writePrivacySpecReport(reportPath, emptyReport({ complete: false }));
  const written = await invoke(
    [
      "testdata",
      "--report",
      "source.json",
      "--format",
      "markdown",
      "--output",
      "nested/testdata.md",
    ],
    { cwd },
  );
  assert.equal(written.exitCode, 0);
  assert.match(written.stdout, /test-data hygiene written/u);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.match(await readFile(outputPath, "utf8"), /\*\*INCOMPLETE\*\*/u);

  const {
    analysis: _analysis,
    coverage: _coverage,
    testData: _testData,
    ...common
  } = emptyReport();
  await writeFile(reportPath, `${JSON.stringify({ ...common, schemaVersion: 1 })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const legacy = await invoke(["testdata", "--report", "source.json"], { cwd });
  assert.equal(legacy.exitCode, 0);
  assert.match(legacy.stdout, /Hygiene data: UNAVAILABLE/u);
  assert.match(legacy.stdout, /absence is inconclusive/u);
});

test("evidence supports Markdown and JSON with only explicit build identifiers", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writePrivacySpecReport(join(cwd, DEFAULT_REPORT_PATH), emptyReport());

  const markdown = await invoke(["evidence"], { cwd });
  assert.equal(markdown.exitCode, 0);
  assert.equal(markdown.stderr, "");
  assert.match(markdown.stdout, /# PrivacySpec Audit-Supporting Technical Evidence/u);
  assert.match(markdown.stdout, /AUDIT-SUPPORTING TECHNICAL EVIDENCE/u);
  assert.match(markdown.stdout, /Commit: not supplied/u);
  assert.match(markdown.stdout, /Build ID: not supplied/u);

  const json = await invoke(
    ["evidence", "--format", "json", "--commit", "6d7a6b0", "--build-id", "ci-1701"],
    { cwd },
  );
  assert.equal(json.exitCode, 0);
  assert.equal(json.stderr, "");
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.evidenceSchemaVersion, 2);
  assert.equal(parsed.evidenceKind, "AUDIT_SUPPORTING_TECHNICAL_EVIDENCE");
  assert.deepEqual(parsed.build, { commit: "6d7a6b0", buildId: "ci-1701" });
  assert.equal(parsed.execution.sourceRunState, "COMPLETE");
  assert.doesNotMatch(
    json.stdout,
    /\baudit[- ]ready\b|\bcertified\b|\bnon[- ]?compliant\b|\bcompliant\b/iu,
  );
});

test("evidence writes private output and makes incomplete scope prominent", async (context) => {
  const cwd = await temporaryDirectory(context);
  const reportPath = join(cwd, "source.json");
  const outputPath = join(cwd, "nested", "evidence.md");
  await writePrivacySpecReport(reportPath, emptyReport({ complete: false }));

  const result = await invoke(
    [
      "evidence",
      "--report",
      "source.json",
      "--format",
      "markdown",
      "--output",
      "nested/evidence.md",
    ],
    { cwd },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /evidence written/u);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  const output = await readFile(outputPath, "utf8");
  assert.match(output, /\*\*INCOMPLETE SOURCE RUN/u);
  assert.match(output, /resolved inconclusive/u);
  assert.doesNotMatch(output, /\b\d+ resolved\b/u);
});

test("evidence rejects unsafe identifiers without echoing their values", async (context) => {
  const cwd = await temporaryDirectory(context);
  const unsafe = "private.person@example.test";
  const result = await invoke(["evidence", "--build-id", unsafe], { cwd });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /evidence build ID is invalid/u);
  assert.match(result.stderr, /Usage:/u);
  assert.doesNotMatch(result.stderr, new RegExp(unsafe.replaceAll(".", "\\."), "u"));
});

test("explain prints the observation, technical control, EU relevance, and limitations", async () => {
  const result = await invoke(["explain", "PS1001"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Observation rule:/u);
  assert.match(result.stdout, /REVIEW_REQUIRED \/ WARNING/u);
  assert.match(result.stdout, /OWASP ASVS 5\.0\.0 V14\.2\.1/u);
  assert.match(result.stdout, /v5\.0\.0-14\.2\.1/u);
  assert.match(result.stdout, /\[CONTEXTUAL\]/u);
  assert.match(result.stdout, /classified as sensitive under the application's/u);
  assert.match(result.stdout, /For ordinary personal data such as email or phone/u);
  assert.match(
    result.stdout,
    /Source: https:\/\/github\.com\/OWASP\/ASVS\/blob\/v5\.0\.0_release\/5\.0\/en\/0x23-V14-Data-Protection\.md/u,
  );
  assert.match(result.stdout, /EU regulatory relevance:/u);
  assert.match(result.stdout, /GDPR Article 5\(1\)\(f\)/u);
  assert.match(result.stdout, /GDPR Article 25\(1\)/u);
  assert.match(result.stdout, /GDPR Article 32\(1\)\(b\) and 32\(2\)/u);
  assert.match(result.stdout, /Primary source: https:\/\/eur-lex\.europa\.eu/u);
  assert.match(result.stdout, /Last reviewed: 2026-08-20/u);
  assert.match(result.stdout, /Limitations:/u);
  assert.doesNotMatch(
    result.stdout,
    /\b(?:GDPR|NIS2) violation\b|\bnon[- ]?compliant\b|\bcompliant\b/iu,
  );
});

test("explain preserves contextual wording for external transfer and browser storage", async () => {
  const external = await invoke(["explain", "PS1004"]);
  assert.equal(external.exitCode, 0);
  assert.match(external.stdout, /REVIEW_REQUIRED \/ WARNING/u);
  assert.match(external.stdout, /V14\.2\.3/u);
  assert.match(external.stdout, /External is not synonymous with untrusted/u);
  assert.match(external.stdout, /cannot determine processor status, lawful basis, necessity/u);

  const storage = await invoke(["explain", "PS1005"]);
  assert.equal(storage.exitCode, 0);
  assert.match(storage.stdout, /REVIEW_REQUIRED \/ WARNING/u);
  assert.match(storage.stdout, /V14\.3\.3/u);
  assert.match(storage.stdout, /\[CONTEXTUAL\]/u);
  assert.match(storage.stdout, /processing by default/u);
  assert.match(
    storage.stdout,
    /high-confidence password in browser storage is a critical technical failure/u,
  );
  assert.match(storage.stdout, /explicitly excepts session tokens/u);
  assert.match(storage.stdout, /has no session- or API-token classifier/u);
});

test("explain supports every Phase 9 rule mapping", async () => {
  for (const ruleId of ["PS1001", "PS1002", "PS1003", "PS1004", "PS1005", "PS1006"]) {
    const result = await invoke(["explain", ruleId]);
    assert.equal(result.exitCode, 0, ruleId);
    assert.equal(result.stderr, "", ruleId);
    assert.match(result.stdout, new RegExp(`PrivacySpec ${ruleId}:`, "u"), ruleId);
    assert.match(result.stdout, /Technical controls:/u, ruleId);
    assert.match(result.stdout, /EU regulatory relevance:/u, ruleId);
    assert.match(result.stdout, /Limitations:/u, ruleId);
  }
});

test("explain requires one exact supported rule ID", async () => {
  const cases = [
    { args: ["explain"], message: /requires exactly one rule ID/u },
    { args: ["explain", "PS9999"], message: /Unknown PrivacySpec rule/u },
    { args: ["explain", "ps1001"], message: /Unknown PrivacySpec rule/u },
    { args: ["explain", "PS1001", "extra"], message: /accepts exactly one rule ID/u },
  ];

  for (const testCase of cases) {
    const result = await invoke(testCase.args);
    assert.equal(result.exitCode, 1, testCase.args.join(" "));
    assert.match(result.stderr, testCase.message, testCase.args.join(" "));
    assert.match(result.stderr, /Usage:/u, testCase.args.join(" "));
    assert.equal(result.stdout, "");
  }
});

test("baseline show reports a missing default baseline without failing", async (context) => {
  const cwd = await temporaryDirectory(context);
  const result = await invoke(["baseline", "show"], { cwd });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /No PrivacySpec baseline found/u);
  assert.match(result.stdout, new RegExp(DEFAULT_BASELINE_PATH, "u"));
  assert.equal(result.stderr, "");
});

test("baseline update requires a complete latest run", async (context) => {
  const cwd = await temporaryDirectory(context);
  const reportPath = join(cwd, DEFAULT_LATEST_RUN_PATH);

  const missing = await invoke(["baseline", "update", "--yes"], { cwd });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /No PrivacySpec latest-run artifact/u);

  await writeLatestRunFile(reportPath, [candidate], {
    complete: false,
    createdAt: "2026-08-20T10:00:00.000Z",
  });
  const incomplete = await invoke(["baseline", "update", "--yes"], { cwd });
  assert.equal(incomplete.exitCode, 1);
  assert.match(incomplete.stderr, /incomplete/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);
});

test("baseline update uses exact path flags and show prints accepted flows", async (context) => {
  const cwd = await temporaryDirectory(context);
  const reportPath = join(cwd, "artifacts", "recent.json");
  const baselinePath = join(cwd, "config", "accepted.json");
  await writeLatestRunFile(reportPath, [candidate], {
    complete: true,
    createdAt: "2026-08-20T10:00:00.000Z",
  });

  const update = await invoke(
    [
      "baseline",
      "update",
      "--report",
      "artifacts/recent.json",
      "--baseline",
      "config/accepted.json",
      "--yes",
    ],
    { cwd },
  );
  assert.equal(update.exitCode, 0);
  assert.match(update.stdout, /with 1 accepted review flow\./u);
  assert.equal(update.stderr, "");

  const baseline = await readBaselineFile(baselinePath);
  assert.equal(baseline?.flows.length, 1);
  assert.equal(baseline?.flows[0]?.key, candidate.key);

  const show = await invoke(["baseline", "show", "--baseline", "config/accepted.json"], { cwd });
  assert.equal(show.exitCode, 0);
  assert.match(show.stdout, /PrivacySpec baseline: 1 accepted review flow/u);
  assert.match(show.stdout, /PS1004 personal\.email -> external-request/u);
  assert.match(show.stdout, /recipient=https:\/\/analytics\.example\.test/u);
  assert.equal(show.stderr, "");
});

test("non-interactive updates require --yes", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writeLatestRunFile(join(cwd, DEFAULT_LATEST_RUN_PATH), [candidate], {
    complete: true,
    createdAt: "2026-08-20T10:00:00.000Z",
  });

  const result = await invoke(["baseline", "update"], { cwd });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /requires --yes/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);
});

test("dependency baseline module reuses the guarded acceptance lifecycle", async (context) => {
  const cwd = await temporaryDirectory(context);
  const latestPath = join(cwd, "artifacts", "dependencies.json");
  const baselinePath = join(cwd, "config", "dependencies.json");
  await writeDependencyLatestRunFile(latestPath, [dependencyCandidate], {
    complete: true,
    createdAt: "2026-08-21T12:00:00.000Z",
  });

  const update = await invoke(
    [
      "baseline",
      "update",
      "--module",
      "dependencies",
      "--report",
      "artifacts/dependencies.json",
      "--baseline",
      "config/dependencies.json",
      "--yes",
    ],
    { cwd },
  );
  assert.equal(update.exitCode, 0);
  assert.match(update.stdout, /dependency baseline updated/u);
  assert.equal((await readDependencyBaselineFile(baselinePath))?.dependencies.length, 1);

  const show = await invoke(
    ["baseline", "show", "--module", "dependencies", "--baseline", "config/dependencies.json"],
    { cwd },
  );
  assert.equal(show.exitCode, 0);
  assert.match(show.stdout, /dependency baseline: 1 accepted semantic dependency/u);
  assert.match(show.stdout, /script -> cdn\.vendor\.test/u);
  assert.match(show.stdout, /dependency:external-script\|cdn\.vendor\.test/u);
});

test("security baseline module reuses the guarded acceptance lifecycle", async (context) => {
  const cwd = await temporaryDirectory(context);
  const latestPath = join(cwd, "artifacts", "security.json");
  const baselinePath = join(cwd, "config", "security.json");
  await writeSecurityLatestRunFile(latestPath, [securityCandidate], {
    complete: true,
    createdAt: "2026-08-21T12:00:00.000Z",
  });

  const update = await invoke(
    [
      "baseline",
      "update",
      "--module",
      "security",
      "--report",
      "artifacts/security.json",
      "--baseline",
      "config/security.json",
      "--yes",
    ],
    { cwd },
  );
  assert.equal(update.exitCode, 0);
  assert.match(update.stdout, /security posture baseline updated/u);
  assert.equal((await readSecurityBaselineFile(baselinePath))?.entries.length, 1);

  const show = await invoke(
    ["baseline", "show", "--module", "security", "--baseline", "config/security.json"],
    { cwd },
  );
  assert.equal(show.exitCode, 0);
  assert.match(show.stdout, /security posture baseline: 1 accepted target/u);
  assert.match(show.stdout, /document GET app\.example\.test\/dashboard/u);
});

test("runtime baseline module accepts known failures without raw diagnostics", async (context) => {
  const cwd = await temporaryDirectory(context);
  const latestPath = join(cwd, "artifacts", "runtime.json");
  const baselinePath = join(cwd, "config", "runtime.json");
  await writeRuntimeFailureLatestRunFile(latestPath, [runtimeFailureCandidate], {
    complete: true,
    createdAt: "2026-08-21T12:00:00.000Z",
  });

  const update = await invoke(
    [
      "baseline",
      "update",
      "--module",
      "runtime",
      "--report",
      "artifacts/runtime.json",
      "--baseline",
      "config/runtime.json",
      "--yes",
    ],
    { cwd },
  );
  assert.equal(update.exitCode, 0);
  assert.match(update.stdout, /runtime failure baseline updated/u);
  assert.equal((await readRuntimeFailureBaselineFile(baselinePath))?.entries.length, 1);

  const show = await invoke(
    ["baseline", "show", "--module", "runtime", "--baseline", "config/runtime.json"],
    { cwd },
  );
  assert.equal(show.exitCode, 0);
  assert.match(show.stdout, /runtime failure baseline: 1 accepted failure identity/u);
  assert.match(show.stdout, /ERROR http-5xx/u);
  assert.doesNotMatch(show.stdout, /person@example\.test/u);
});

test("interactive updates require affirmative confirmation", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writeLatestRunFile(join(cwd, DEFAULT_LATEST_RUN_PATH), [candidate], {
    complete: true,
    createdAt: "2026-08-20T10:00:00.000Z",
  });

  const declined = await invoke(["baseline", "update"], {
    cwd,
    interactive: true,
    confirm: false,
  });
  assert.equal(declined.exitCode, 0);
  assert.match(declined.stdout, /cancelled/u);
  assert.equal(declined.questions.length, 1);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);

  const accepted = await invoke(["baseline", "update"], {
    cwd,
    interactive: true,
    confirm: true,
  });
  assert.equal(accepted.exitCode, 0);
  assert.equal(accepted.questions.length, 1);
  assert.equal((await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)))?.flows.length, 1);
});

test("CI refuses baseline mutation even with --yes", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writeLatestRunFile(join(cwd, DEFAULT_LATEST_RUN_PATH), [candidate], {
    complete: true,
    createdAt: "2026-08-20T10:00:00.000Z",
  });

  const result = await invoke(["baseline", "update", "--yes"], {
    cwd,
    env: { CI: "1" },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /disabled when CI is enabled/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);
});

test("baseline propose is read-only and selective acceptance preserves unselected entries", async (context) => {
  const cwd = await temporaryDirectory(context);
  const baselinePath = join(cwd, "config", "privacy.json");
  const latestPath = join(cwd, "artifacts", "privacy.json");
  const proposalPath = join(cwd, "review", "proposal.json");
  const added = privacyCandidateAt("json.added");
  const removed = privacyCandidateAt("json.removed");
  await writeBaselineFile(baselinePath, [candidate, removed], {
    createdAt: "2026-08-23T10:00:00.000Z",
  });
  await writeLatestRunFile(latestPath, [candidate, added], {
    complete: true,
    createdAt: "2026-08-23T10:30:00.000Z",
  });
  const before = await readFile(baselinePath, "utf8");

  const proposed = await invoke(
    [
      "baseline",
      "propose",
      "--baseline",
      "config/privacy.json",
      "--report",
      "artifacts/privacy.json",
      "--proposal",
      "review/proposal.json",
    ],
    { cwd },
  );
  assert.equal(proposed.exitCode, 0);
  assert.match(proposed.stdout, /known=1, add=1, change=0, remove=1/u);
  assert.match(proposed.stdout, /accepted baselines were not changed/u);
  assert.equal(await readFile(baselinePath, "utf8"), before);
  assert.equal((await stat(proposalPath)).mode & 0o777, 0o600);

  const proposal = await readBaselineProposalFile(proposalPath);
  const add = proposal.entries.find((entry) => entry.action === "add");
  assert.ok(add);
  const accepted = await invoke(
    [
      "baseline",
      "accept",
      "--proposal",
      "review/proposal.json",
      "--baseline",
      "config/privacy.json",
      "--report",
      "artifacts/privacy.json",
      "--select",
      add.id,
      "--yes",
    ],
    { cwd },
  );
  assert.equal(accepted.exitCode, 0);
  assert.match(accepted.stdout, /add=1, change=0, remove=0/u);
  assert.match(accepted.stdout, /Unselected accepted baseline entries were preserved/u);
  const afterAdd = await readBaselineFile(baselinePath);
  assert.equal(afterAdd?.flows.length, 3);
  assert.equal(
    afterAdd?.flows.some((entry) => entry.key === removed.key),
    true,
  );
  assert.equal((await stat(baselinePath)).mode & 0o777, 0o600);

  const reproposed = await invoke(
    [
      "baseline",
      "propose",
      "--baseline",
      "config/privacy.json",
      "--report",
      "artifacts/privacy.json",
      "--proposal",
      "review/proposal.json",
    ],
    { cwd },
  );
  assert.equal(reproposed.exitCode, 0);
  const removalProposal = await readBaselineProposalFile(proposalPath);
  const remove = removalProposal.entries.find((entry) => entry.action === "remove");
  assert.ok(remove);
  const acceptedRemoval = await invoke(
    [
      "baseline",
      "accept",
      "--proposal",
      "review/proposal.json",
      "--baseline",
      "config/privacy.json",
      "--report",
      "artifacts/privacy.json",
      "--select",
      remove.id,
      "--yes",
    ],
    { cwd },
  );
  assert.equal(acceptedRemoval.exitCode, 0);
  assert.match(acceptedRemoval.stdout, /add=0, change=0, remove=1/u);
  assert.equal((await readBaselineFile(baselinePath))?.flows.length, 2);
});

test("baseline accept supports several and no selections without display-order semantics", async (context) => {
  const cwd = await temporaryDirectory(context);
  const added = privacyCandidateAt("json.several-added");
  const removed = privacyCandidateAt("json.several-removed");
  await writeBaselineFile(join(cwd, DEFAULT_BASELINE_PATH), [candidate, removed]);
  await writeLatestRunFile(join(cwd, DEFAULT_LATEST_RUN_PATH), [candidate, added], {
    complete: true,
  });
  assert.equal((await invoke(["baseline", "propose"], { cwd })).exitCode, 0);
  const proposalPath = join(cwd, DEFAULT_BASELINE_PROPOSAL_PATH);
  const proposal = await readBaselineProposalFile(proposalPath);
  const before = await readFile(join(cwd, DEFAULT_BASELINE_PATH), "utf8");

  const none = await invoke(["baseline", "accept", "--yes"], { cwd });
  assert.equal(none.exitCode, 0);
  assert.match(none.stdout, /No baseline proposal entries selected/u);
  assert.equal(await readFile(join(cwd, DEFAULT_BASELINE_PATH), "utf8"), before);

  const several = await invoke(
    ["baseline", "accept", ...proposal.entries.flatMap((entry) => ["--select", entry.id]), "--yes"],
    { cwd },
  );
  assert.equal(several.exitCode, 0);
  assert.match(several.stdout, /2 selected proposal entries/u);
  const baseline = await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH));
  assert.deepEqual(
    baseline?.flows.map((entry) => entry.key),
    [candidate.key, added.key].toSorted(),
  );
});

test("baseline proposal and acceptance work for every module", async (context) => {
  const cwd = await temporaryDirectory(context);
  const modules = [
    {
      module: "privacy",
      candidate,
      writeLatest: (path) => writeLatestRunFile(path, [candidate], { complete: true }),
      readBaseline: readBaselineFile,
      count: (baseline) => baseline?.flows.length,
    },
    {
      module: "dependencies",
      candidate: dependencyCandidate,
      writeLatest: (path) =>
        writeDependencyLatestRunFile(path, [dependencyCandidate], { complete: true }),
      readBaseline: readDependencyBaselineFile,
      count: (baseline) => baseline?.dependencies.length,
    },
    {
      module: "security",
      candidate: securityCandidate,
      writeLatest: (path) =>
        writeSecurityLatestRunFile(path, [securityCandidate], { complete: true }),
      readBaseline: readSecurityBaselineFile,
      count: (baseline) => baseline?.entries.length,
    },
    {
      module: "runtime",
      candidate: runtimeFailureCandidate,
      writeLatest: (path) =>
        writeRuntimeFailureLatestRunFile(path, [runtimeFailureCandidate], { complete: true }),
      readBaseline: readRuntimeFailureBaselineFile,
      count: (baseline) => baseline?.entries.length,
    },
  ];

  for (const descriptor of modules) {
    const baseline = `${descriptor.module}-baseline.json`;
    const latest = `${descriptor.module}-latest.json`;
    const proposal = `${descriptor.module}-proposal.json`;
    await descriptor.writeLatest(join(cwd, latest));
    const proposed = await invoke(
      [
        "baseline",
        "propose",
        "--module",
        descriptor.module,
        "--baseline",
        baseline,
        "--report",
        latest,
        "--proposal",
        proposal,
      ],
      { cwd },
    );
    assert.equal(proposed.exitCode, 0, descriptor.module);
    const artifact = await readBaselineProposalFile(join(cwd, proposal));
    assert.equal(artifact.module, descriptor.module);
    assert.equal(artifact.entries[0]?.identity, descriptor.candidate.key);
    const accepted = await invoke(
      [
        "baseline",
        "accept",
        "--proposal",
        proposal,
        "--baseline",
        baseline,
        "--report",
        latest,
        "--select",
        artifact.entries[0].id,
        "--yes",
      ],
      { cwd },
    );
    assert.equal(accepted.exitCode, 0, descriptor.module);
    assert.equal(descriptor.count(await descriptor.readBaseline(join(cwd, baseline))), 1);
  }
});

test("baseline accept confirmation, cancellation, non-interactive, and CI policies are explicit", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writeLatestRunFile(join(cwd, DEFAULT_LATEST_RUN_PATH), [candidate], { complete: true });
  assert.equal((await invoke(["baseline", "propose"], { cwd })).exitCode, 0);
  const proposal = await readBaselineProposalFile(join(cwd, DEFAULT_BASELINE_PROPOSAL_PATH));
  const selection = proposal.entries[0]?.id;
  assert.ok(selection);

  const nonInteractive = await invoke(["baseline", "accept", "--select", selection], { cwd });
  assert.equal(nonInteractive.exitCode, 1);
  assert.match(nonInteractive.stderr, /requires --yes/u);

  const cancelled = await invoke(["baseline", "accept", "--select", selection], {
    cwd,
    interactive: true,
    confirm: false,
  });
  assert.equal(cancelled.exitCode, 0);
  assert.match(cancelled.stdout, /cancelled/u);
  assert.equal(cancelled.questions.length, 1);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);

  const ci = await invoke(["baseline", "accept", "--select", selection, "--yes"], {
    cwd,
    env: { CI: "true" },
  });
  assert.equal(ci.exitCode, 1);
  assert.match(ci.stderr, /acceptance is disabled when CI is enabled/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);

  const confirmed = await invoke(["baseline", "accept", "--select", selection], {
    cwd,
    interactive: true,
    confirm: true,
  });
  assert.equal(confirmed.exitCode, 0);
  assert.equal(confirmed.questions.length, 1);
  assert.equal((await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)))?.flows.length, 1);
});

test("baseline accept rejects unknown, duplicate, cross-module, stale, and tampered selections", async (context) => {
  const cwd = await temporaryDirectory(context);
  const latestPath = join(cwd, DEFAULT_LATEST_RUN_PATH);
  const proposalPath = join(cwd, DEFAULT_BASELINE_PROPOSAL_PATH);
  await writeLatestRunFile(latestPath, [candidate], {
    complete: true,
    createdAt: "2026-08-23T10:00:00.000Z",
  });
  assert.equal((await invoke(["baseline", "propose"], { cwd })).exitCode, 0);
  const proposal = await readBaselineProposalFile(proposalPath);
  const selection = proposal.entries[0]?.id;
  assert.ok(selection);
  const digest = "0".repeat(64);

  for (const selections of [
    [`privacy:add:sha256:${digest}`],
    [selection, selection],
    [`security:add:sha256:${digest}`],
  ]) {
    const result = await invoke(
      ["baseline", "accept", ...selections.flatMap((id) => ["--select", id]), "--yes"],
      { cwd },
    );
    assert.equal(result.exitCode, 1);
    assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);
  }

  const tampered = structuredClone(proposal);
  tampered.counts.add = 99;
  await writeFile(proposalPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
  const rejectedTamper = await invoke(["baseline", "accept", "--select", selection, "--yes"], {
    cwd,
  });
  assert.equal(rejectedTamper.exitCode, 1);
  assert.match(rejectedTamper.stderr, /proposal/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);

  assert.equal((await invoke(["baseline", "propose"], { cwd })).exitCode, 0);
  const fresh = await readBaselineProposalFile(proposalPath);
  await writeLatestRunFile(latestPath, [candidate], {
    complete: true,
    createdAt: "2026-08-23T12:00:00.000Z",
  });
  const stale = await invoke(["baseline", "accept", "--select", fresh.entries[0].id, "--yes"], {
    cwd,
  });
  assert.equal(stale.exitCode, 1);
  assert.match(stale.stderr, /stale, tampered/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);
});

test("baseline proposal paths reject source collisions and symbolic links", async (context) => {
  const cwd = await temporaryDirectory(context);
  const latestPath = join(cwd, "latest.json");
  await writeLatestRunFile(latestPath, [candidate], { complete: true });

  const collision = await invoke(
    ["baseline", "propose", "--report", "latest.json", "--proposal", "latest.json"],
    { cwd },
  );
  assert.equal(collision.exitCode, 1);
  assert.match(collision.stderr, /must be distinct/u);

  const linkedLatest = join(cwd, "linked-latest.json");
  await symlink(latestPath, linkedLatest);
  const linkedSource = await invoke(["baseline", "propose", "--report", "linked-latest.json"], {
    cwd,
  });
  assert.equal(linkedSource.exitCode, 1);
  assert.match(linkedSource.stderr, /symbolic links/u);

  const proposalTarget = join(cwd, "proposal-target.json");
  await writeFile(proposalTarget, "{}\n");
  const linkedProposal = join(cwd, "proposal-link.json");
  await symlink(proposalTarget, linkedProposal);
  const linkedOutput = await invoke(
    ["baseline", "propose", "--report", "latest.json", "--proposal", "proposal-link.json"],
    { cwd },
  );
  assert.equal(linkedOutput.exitCode, 1);
  assert.match(linkedOutput.stderr, /symbolic links/u);
});

test("baseline propose requires complete latest-run eligibility", async (context) => {
  const cwd = await temporaryDirectory(context);
  await writeLatestRunFile(join(cwd, DEFAULT_LATEST_RUN_PATH), [], { complete: false });
  const result = await invoke(["baseline", "propose"], { cwd });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /incomplete/u);
  assert.equal(await readBaselineFile(join(cwd, DEFAULT_BASELINE_PATH)), undefined);
});

test("CLI rejects unknown, duplicate, and missing-value flags", async (context) => {
  const cwd = await temporaryDirectory(context);
  const cases = [
    { args: ["baseline", "show", "--unknown"], message: /Unexpected argument/u },
    { args: ["baseline", "show", "--report", "run.json"], message: /Unexpected argument/u },
    { args: ["baseline", "show", "--yes"], message: /Unexpected argument/u },
    {
      args: ["baseline", "show", "--module", "posture"],
      message: /Unsupported baseline module/u,
    },
    {
      args: ["baseline", "show", "--module", "privacy", "--module", "dependencies"],
      message: /only once/u,
    },
    { args: ["baseline", "show", "--baseline"], message: /requires a path value/u },
    {
      args: ["baseline", "show", "--baseline", "one.json", "--baseline", "two.json"],
      message: /only once/u,
    },
    { args: ["baseline", "update", "--report"], message: /requires a path value/u },
    {
      args: ["baseline", "update", "--report", "one.json", "--report", "two.json"],
      message: /only once/u,
    },
    { args: ["baseline", "update", "--yes", "--yes"], message: /only once/u },
    { args: ["baseline", "update", "extra"], message: /Unexpected argument/u },
    { args: ["baseline", "propose", "--yes"], message: /Unexpected argument/u },
    { args: ["baseline", "propose", "--proposal"], message: /requires a path value/u },
    {
      args: ["baseline", "propose", "--proposal", "one.json", "--proposal", "two.json"],
      message: /only once/u,
    },
    { args: ["baseline", "accept", "--module", "privacy"], message: /Unexpected argument/u },
    { args: ["baseline", "accept", "--select"], message: /requires a proposal ID/u },
    { args: ["baseline", "accept", "--yes", "--yes"], message: /only once/u },
    {
      args: ["baseline", "accept", "--proposal", "one.json", "--proposal", "two.json"],
      message: /only once/u,
    },
    { args: ["inventory", "--report"], message: /requires a path value/u },
    {
      args: ["inventory", "--report", "one.json", "--report", "two.json"],
      message: /only once/u,
    },
    { args: ["inventory", "--format", "xml"], message: /Unsupported inventory format/u },
    { args: ["inventory", "--format"], message: /requires a format value/u },
    { args: ["inventory", "--format", "json", "--format", "csv"], message: /only once/u },
    { args: ["inventory", "--output"], message: /requires a path value/u },
    { args: ["inventory", "--unknown"], message: /Unexpected argument/u },
    {
      args: ["inventory", "--report", "same.json", "--output", "same.json"],
      message: /must not overwrite/u,
    },
    { args: ["testdata", "--report"], message: /requires a path value/u },
    {
      args: ["testdata", "--report", "one.json", "--report", "two.json"],
      message: /only once/u,
    },
    { args: ["testdata", "--format", "csv"], message: /Unsupported testdata format/u },
    { args: ["testdata", "--format"], message: /requires a format value/u },
    { args: ["testdata", "--format", "json", "--format", "markdown"], message: /only once/u },
    { args: ["testdata", "--output"], message: /requires a path value/u },
    { args: ["testdata", "--unknown"], message: /Unexpected argument/u },
    {
      args: ["testdata", "--report", "same.json", "--output", "same.json"],
      message: /must not overwrite/u,
    },
    { args: ["testdata", "scan"], message: /requires at least one/u },
    { args: ["testdata", "scan", "state.json", "--format"], message: /requires a format/u },
    {
      args: ["testdata", "scan", "state.json", "--format", "csv"],
      message: /Unsupported testdata scan format/u,
    },
    {
      args: ["testdata", "scan", "state.json", "--format", "json", "--format", "markdown"],
      message: /only once/u,
    },
    { args: ["testdata", "scan", "state.json", "--output"], message: /requires a path/u },
    { args: ["testdata", "scan", "state.json", "--unknown"], message: /Unexpected argument/u },
    {
      args: ["testdata", "scan", "state.json", "state.json"],
      message: /only once/u,
    },
    {
      args: ["testdata", "scan", "state.json", "--output", "state.json"],
      message: /must not overwrite/u,
    },
    { args: ["evidence", "--report"], message: /requires a path value/u },
    {
      args: ["evidence", "--report", "one.json", "--report", "two.json"],
      message: /only once/u,
    },
    { args: ["evidence", "--format", "csv"], message: /Unsupported evidence format/u },
    { args: ["evidence", "--format"], message: /requires a format value/u },
    {
      args: ["evidence", "--format", "json", "--format", "markdown"],
      message: /only once/u,
    },
    { args: ["evidence", "--output"], message: /requires a path value/u },
    { args: ["evidence", "--unknown"], message: /Unexpected argument/u },
    {
      args: ["evidence", "--report", "same.json", "--output", "same.json"],
      message: /must not overwrite/u,
    },
    { args: ["evidence", "--commit"], message: /requires a build identifier value/u },
    {
      args: ["evidence", "--commit", "abc", "--commit", "def"],
      message: /only once/u,
    },
    { args: ["evidence", "--build-id"], message: /requires a build identifier value/u },
    {
      args: ["evidence", "--build-id", "one", "--build-id", "two"],
      message: /only once/u,
    },
  ];

  for (const testCase of cases) {
    const result = await invoke(testCase.args, { cwd });
    assert.equal(result.exitCode, 1, testCase.args.join(" "));
    assert.match(result.stderr, testCase.message, testCase.args.join(" "));
    assert.match(result.stderr, /Usage:/u, testCase.args.join(" "));
  }
});
