import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createBaselineKey } from "../dist/baseline/compare.js";
import { DEFAULT_BASELINE_PATH, DEFAULT_LATEST_RUN_PATH } from "../dist/baseline/schema.js";
import { readBaselineFile, writeLatestRunFile } from "../dist/baseline/write.js";
import { runCli } from "../dist/cli/run.js";

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

const temporaryDirectory = async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
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
  assert.deepEqual(manifest.bin, { privacyspec: "./dist/cli/index.js" });

  const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, "--help"], {
    cwd: packageDirectory,
  });
  assert.match(stdout, /privacyspec explain <rule-id>/u);
  assert.match(stdout, /privacyspec baseline show/u);
  assert.equal(stderr, "");

  const explanation = await execFileAsync(process.execPath, [cliEntry, "explain", "PS1001"], {
    cwd: packageDirectory,
  });
  assert.match(explanation.stdout, /PrivacySpec PS1001: Personal data or secret in URL/u);
  assert.equal(explanation.stderr, "");
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

test("explain supports every rule mapping", async () => {
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
  ];

  for (const testCase of cases) {
    const result = await invoke(testCase.args, { cwd });
    assert.equal(result.exitCode, 1, testCase.args.join(" "));
    assert.match(result.stderr, testCase.message, testCase.args.join(" "));
    assert.match(result.stderr, /Usage:/u, testCase.args.join(" "));
  }
});
