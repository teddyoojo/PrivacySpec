import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  ACTION_FAILURE_SUMMARY,
  cleanupStagedReport,
  executeSummaryCli,
  resolveActionInputs,
  runSummaryAction,
} from "../../../scripts/github-action-summary.mjs";

const createActionEnvironment = async (context, overrides = {}) => {
  const root = await mkdtemp(join(tmpdir(), "privacyspec-action-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const workingDirectory = join(workspace, "app");
  const runnerTemp = join(root, "runner-temp");
  await mkdir(workingDirectory, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });
  await writeFile(join(workingDirectory, "privacyspec-report.json"), '{"schemaVersion":4}\n', {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    root,
    workingDirectory,
    environment: {
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: join(root, "github-output"),
      GITHUB_STEP_SUMMARY: join(root, "step-summary"),
      RUNNER_TEMP: runnerTemp,
      PRIVACYSPEC_WORKING_DIRECTORY: "app",
      PRIVACYSPEC_REPORT_PATH: "privacyspec-report.json",
      PRIVACYSPEC_ARTIFACT_NAME: "privacyspec-report",
      PRIVACYSPEC_UPLOAD_ARTIFACT: "true",
      PRIVACYSPEC_RETENTION_DAYS: "7",
      ...overrides,
    },
  };
};

test("Action helper writes the Step Summary and stages the exact report privately", async (context) => {
  const fixture = await createActionEnvironment(context);
  const expectedMarkdown = "# PrivacySpec Secondary Coverage\n\nvalidated marker\n";
  const result = await runSummaryAction(fixture.environment, async (input) => {
    assert.equal(input.workingDirectory, fixture.workingDirectory);
    assert.equal(basename(input.reportPath), "privacyspec-report.json");
    assert.equal(await readFile(input.reportPath, "utf8"), '{"schemaVersion":4}\n');
    return expectedMarkdown;
  });

  assert.equal(await readFile(fixture.environment.GITHUB_STEP_SUMMARY, "utf8"), expectedMarkdown);
  assert.equal(basename(result.stagedReport), "privacyspec-report.json");
  assert.equal((await stat(result.stagedReport)).mode & 0o777, 0o600);
  assert.equal(
    await readFile(result.stagedReport, "utf8"),
    await readFile(join(fixture.workingDirectory, "privacyspec-report.json"), "utf8"),
  );
  const outputs = await readFile(fixture.environment.GITHUB_OUTPUT, "utf8");
  assert.match(
    outputs,
    new RegExp(`staged-report=${result.stagedReport.replaceAll("/", "\\/")}`, "u"),
  );
  assert.match(outputs, /summary-written=true/u);

  await cleanupStagedReport({
    RUNNER_TEMP: fixture.environment.RUNNER_TEMP,
    PRIVACYSPEC_STAGED_REPORT: result.stagedReport,
  });
  await assert.rejects(access(result.stagedReport));
});

test("Action helper skips staging when artifact upload is disabled", async (context) => {
  const fixture = await createActionEnvironment(context, {
    PRIVACYSPEC_UPLOAD_ARTIFACT: "false",
  });
  const result = await runSummaryAction(
    fixture.environment,
    async () => "# PrivacySpec Secondary Coverage\n",
  );

  assert.equal(result.stagedReport, "");
  assert.equal(
    await readFile(fixture.environment.GITHUB_OUTPUT, "utf8"),
    "staged-report=\nsummary-written=true\n",
  );
});

test("Action input resolution rejects traversal, globs, and paths outside the workspace", async (context) => {
  const cases = [
    { PRIVACYSPEC_REPORT_PATH: "../privacyspec-report.json" },
    { PRIVACYSPEC_REPORT_PATH: "reports/*.json" },
    { PRIVACYSPEC_REPORT_PATH: "/tmp/privacyspec-report.json" },
    { PRIVACYSPEC_REPORT_PATH: "C:\\temp\\privacyspec-report.json" },
    { PRIVACYSPEC_WORKING_DIRECTORY: "../outside" },
  ];
  for (const override of cases) {
    const fixture = await createActionEnvironment(context, override);
    await assert.rejects(resolveActionInputs(fixture.environment), /relative path|traversal|glob/u);
  }

  const fixture = await createActionEnvironment(context);
  const outside = join(fixture.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(fixture.root, "workspace", "linked-app"));
  await assert.rejects(
    resolveActionInputs({
      ...fixture.environment,
      PRIVACYSPEC_WORKING_DIRECTORY: "linked-app",
    }),
    /inside GITHUB_WORKSPACE/u,
  );
});

test("Action input resolution rejects symlink reports", async (context) => {
  const fixture = await createActionEnvironment(context);
  await symlink("privacyspec-report.json", join(fixture.workingDirectory, "linked-report.json"));
  await assert.rejects(
    resolveActionInputs({
      ...fixture.environment,
      PRIVACYSPEC_REPORT_PATH: "linked-report.json",
    }),
    /must not contain symbolic links/u,
  );

  await mkdir(join(fixture.workingDirectory, "reports"));
  await writeFile(join(fixture.workingDirectory, "reports", "nested.json"), "{}\n", "utf8");
  await symlink("reports", join(fixture.workingDirectory, "linked-reports"));
  await assert.rejects(
    resolveActionInputs({
      ...fixture.environment,
      PRIVACYSPEC_REPORT_PATH: "linked-reports/nested.json",
    }),
    /must not contain symbolic links/u,
  );
});

test("missing local CLI and invalid report failures append only the fixed summary", async (context) => {
  const missingCli = await createActionEnvironment(context);
  await assert.rejects(
    runSummaryAction(missingCli.environment),
    /locally installed PrivacySpec CLI/u,
  );
  assert.equal(
    await readFile(missingCli.environment.GITHUB_STEP_SUMMARY, "utf8"),
    ACTION_FAILURE_SUMMARY,
  );

  const invalidReport = await createActionEnvironment(context);
  const privateParserDetail = "parser detail private.person@example.test";
  await assert.rejects(
    runSummaryAction(invalidReport.environment, async () => {
      throw new Error(privateParserDetail);
    }),
    new RegExp(privateParserDetail.replaceAll(".", "\\."), "u"),
  );
  const summary = await readFile(invalidReport.environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.equal(summary, ACTION_FAILURE_SUMMARY);
  assert.doesNotMatch(summary, /private\.person@example\.test/u);

  await assert.rejects(
    executeSummaryCli({
      workingDirectory: invalidReport.workingDirectory,
      reportPath: join(invalidReport.workingDirectory, "privacyspec-report.json"),
      environment: invalidReport.environment,
    }),
    /locally installed PrivacySpec CLI/u,
  );
});

test("composite Action manifest preserves the post-processing contract", async () => {
  const manifest = await readFile(new URL("../../../action.yml", import.meta.url), "utf8");
  assert.match(manifest, /working-directory:[\s\S]*default: \./u);
  assert.match(manifest, /report-path:[\s\S]*default: privacyspec-report\.json/u);
  assert.match(manifest, /upload-artifact:[\s\S]*default: "true"/u);
  assert.match(manifest, /retention-days:[\s\S]*default: "7"/u);
  assert.match(manifest, /uses: actions\/upload-artifact@v4/u);
  assert.doesNotMatch(manifest, /pnpm install|npm install|playwright install/u);
});
