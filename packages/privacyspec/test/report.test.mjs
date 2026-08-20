import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import PrivacySpecReporter from "../dist/playwright/reporter.js";
import {
  createEmptyPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "../dist/playwright/result.js";

const testCase = { title: "ordinary QA test" };
const startedAt = new Date("2026-08-20T12:00:00.000Z");

const reviewFinding = () => ({
  kind: "finding",
  ruleId: "PS1004",
  severity: "warning",
  classification: "review_required",
  title: "Personal data sent to external recipient",
  observation: "personal.email was observed leaving the configured first-party boundary.",
  flow: {
    kind: "data-flow",
    dataCategory: "personal.email",
    sourceKind: "form-input",
    sourceConfidence: "high",
    sinkKind: "external-request",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
    method: "POST",
    endpoint: "/event",
    location: "json.email",
    transform: "EXACT",
    test: {
      file: "customer.spec.ts",
      title: "customer can be created",
      project: "chromium",
    },
  },
  limitations: ["The processing context requires review."],
});

const attachmentWith = (...observations) => {
  const result = createEmptyPrivacySpecResult();
  result.observations.push(...observations);
  return {
    name: PRIVACYSPEC_ATTACHMENT_NAME,
    contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
    body: Buffer.from(JSON.stringify(result)),
  };
};

const testResult = (attachments, status = "passed", duration = 125) => ({
  attachments,
  status,
  duration,
});

const fullResult = (status = "passed", duration = 500) => ({
  status,
  startTime: startedAt,
  duration,
});

test("schema-v1 JSON report records CI outcome, mappings, baseline state, and performance", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-json-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const rawFixtureValue = ["report-secret", "example.test"].join("@");
  const output = [];
  const finding = reviewFinding();
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    write: (message) => output.push(message),
  });

  reporter.onBegin({ projects: [{ name: "chromium" }] });
  reporter.onTestEnd(
    testCase,
    testResult([
      attachmentWith(
        {
          kind: "sensitive-source",
          raw: rawFixtureValue,
          category: "personal.email",
          confidence: "high",
          evidence: [{ kind: "input-type", value: "email" }],
          control: { elementKind: "input", type: "email" },
          page: { origin: "https://app.example.test", path: "/customers/new" },
          observedBy: "event",
        },
        {
          kind: "sink",
          sink: "network",
          method: "POST",
          resourceType: "fetch",
          recipient: finding.flow.recipient,
          endpoint: "/event",
          bodyKind: "json",
          bodySize: 42,
          bodyTruncated: false,
          locations: ["json.email"],
        },
        finding.flow,
        finding,
      ),
    ]),
  );

  assert.equal(await reporter.onEnd(fullResult()), undefined);
  const serialized = await readFile(reportPath, "utf8");
  const report = JSON.parse(serialized);
  const metadata = await stat(reportPath);

  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.tool, { name: "privacyspec", version: "0.1.0-beta.1" });
  assert.equal(report.generatedAt, "2026-08-20T12:00:00.500Z");
  assert.equal(report.run.playwrightStatus, "passed");
  assert.equal(report.run.privacyspecStatus, "review");
  assert.equal(report.run.complete, true);
  assert.deepEqual(report.run.projects, ["chromium"]);
  assert.deepEqual(report.run.tests, {
    total: 1,
    observed: 1,
    passed: 1,
    failed: 0,
    timedOut: 0,
    skipped: 0,
    interrupted: 0,
  });
  assert.equal(report.summary.sensitiveSources.byName["personal.email"], 1);
  assert.equal(report.summary.sinks.byName.network, 1);
  assert.equal(report.summary.dataFlows, 1);
  assert.equal(report.summary.findings.newReviewRequired, 1);
  assert.equal(report.performance.suiteDurationMilliseconds, 500);
  assert.equal(report.performance.cumulativeTestDurationMilliseconds, 125);
  assert.equal(report.findings[0].baselineState, "new");
  assert.equal(report.findings[0].finding.flow.test.title, "customer can be created");
  assert.equal(report.baseline.new[0].flow.ruleId, "PS1004");
  assert.equal(report.legalMappings.rules[0].technicalControls[0].requirementId, "v5.0.0-14.2.3");
  assert.equal(report.legalMappings.rules[0].regulatoryRelevance[0].sourceType, "primary");
  assert.match(report.legalMappings.rules[0].regulatoryRelevance[0].sourceUrl, /eur-lex/u);
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(serialized.includes(rawFixtureValue), false);

  const rendered = output.join("");
  assert.match(rendered, /technical relevance PS1004: OWASP ASVS 5\.0\.0 V14\.2\.3/u);
  assert.match(rendered, /EU relevance PS1004: GDPR Article 5\(1\)\(c\)/u);
  assert.match(rendered, /authoritative sources PS1004: .*github\.com.*eur-lex/u);
  assert.match(rendered, /performance: suite=500ms, cumulative test duration=125ms/u);
  assert.match(rendered, /JSON report: .*privacyspec-report\.json \(schema v1\)/u);
  assert.match(
    rendered,
    /result: REVIEW \(functional tests=PASS, technical failures=0, new review findings=1\)/u,
  );
});

test("a non-passing functional run is reported as incomplete without replacing its exit status", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-json-incomplete-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    write: (message) => output.push(message),
  });
  reporter.onBegin({ projects: [{ name: "chromium" }] });
  reporter.onTestEnd(testCase, testResult([attachmentWith()], "failed", 75));

  assert.equal(await reporter.onEnd(fullResult("failed", 200)), undefined);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.run.playwrightStatus, "failed");
  assert.equal(report.run.privacyspecStatus, "incomplete");
  assert.equal(report.run.complete, false);
  assert.equal(report.run.tests.failed, 1);
  assert.match(output.join(""), /result: INCOMPLETE \(functional tests=FAIL/u);
});

test("a JSON report write failure is a PrivacySpec integration failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-json-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "report-target");
  const latestRunPath = join(directory, "latest-run.json");
  await writeFile(reportPath, "occupied", "utf8");
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath,
    reportPath,
    write: (message) => output.push(message),
  });

  // Recreate a conflicting directory after the normal stale-report invalidation.
  reporter.onBegin({ projects: [] });
  await rm(reportPath, { force: true });
  await mkdir(reportPath);
  reporter.onTestEnd(testCase, testResult([attachmentWith()]));

  assert.deepEqual(await reporter.onEnd(fullResult()), { status: "failed" });
  assert.match(output.join(""), /could not write JSON report/u);
  assert.match(output.join(""), /result: FAIL/u);
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
});
