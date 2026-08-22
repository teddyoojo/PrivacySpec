import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import { DEFAULT_BASELINE_PATH, DEFAULT_LATEST_RUN_PATH } from "../dist/baseline/schema.js";
import { readBaselineFile, writeLatestRunFile } from "../dist/baseline/write.js";
import { runCli } from "../dist/cli/run.js";
import { writePrivacySpecReport } from "../dist/report/json.js";
import { createPrivacySpecReport, DEFAULT_REPORT_PATH } from "../dist/report/model.js";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));

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

const emptyReport = ({ complete = true, testDataObservations = [] } = {}) =>
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
  });

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
  assert.deepEqual(manifest.bin, { privacyspec: "./dist/cli/index.js" });

  const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, "--help"], {
    cwd: packageDirectory,
  });
  assert.match(stdout, /privacyspec explain <rule-id>/u);
  assert.match(stdout, /privacyspec baseline show/u);
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
    { args: ["inventory", "--format", "json"], pattern: /"inventorySchemaVersion": 1/u },
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
    JSON.stringify({ ...emptyReport(), schemaVersion: 5 }),
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
  assert.equal(parsed.evidenceSchemaVersion, 1);
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
