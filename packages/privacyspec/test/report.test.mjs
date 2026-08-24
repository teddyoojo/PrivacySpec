import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
  DEPENDENCY_ATTACHMENT_NAME,
} from "../dist/analyzers/dependency/artifact.js";
import {
  RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
  RUNTIME_FAILURE_ATTACHMENT_NAME,
} from "../dist/analyzers/runtime-failure/artifact.js";
import {
  SECURITY_ATTACHMENT_CONTENT_TYPE,
  SECURITY_ATTACHMENT_NAME,
} from "../dist/analyzers/security/artifact.js";
import PrivacySpecReporter from "../dist/playwright/reporter.js";
import {
  createEmptyPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "../dist/playwright/result.js";
import { readPrivacySpecReport } from "../dist/report/read.js";

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
    requestSurface: "browser",
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
  if (
    observations.some(
      (observation) =>
        observation?.category?.startsWith?.("custom.") ||
        observation?.dataCategory?.startsWith?.("custom.") ||
        observation?.flow?.dataCategory?.startsWith?.("custom."),
    )
  ) {
    result.classifierConfiguration = { mode: "custom", id: "test-custom-classifiers-v1" };
  }
  return {
    name: PRIVACYSPEC_ATTACHMENT_NAME,
    contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
    body: Buffer.from(JSON.stringify(result)),
  };
};

const analyzerAttachment = (name, contentType, analyzerId) => ({
  name,
  contentType,
  body: Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      analyzerId,
      coverage: "complete",
      inventory: [],
      diagnostics: [],
    }),
  ),
});

const completeAttachments = (privacyAttachment) => [
  privacyAttachment,
  analyzerAttachment(DEPENDENCY_ATTACHMENT_NAME, DEPENDENCY_ATTACHMENT_CONTENT_TYPE, "dependency"),
  analyzerAttachment(SECURITY_ATTACHMENT_NAME, SECURITY_ATTACHMENT_CONTENT_TYPE, "security"),
  analyzerAttachment(
    RUNTIME_FAILURE_ATTACHMENT_NAME,
    RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
    "runtime-failure",
  ),
];

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

test("schema-v5 JSON report unifies module outcomes with privacy evidence and performance", async (t) => {
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
    testResult(
      completeAttachments(
        attachmentWith(
          {
            kind: "sensitive-source",
            category: "personal.email",
            confidence: "high",
            evidence: [{ kind: "input-type", value: "email" }],
            sourceKind: "form-input",
            control: { elementKind: "input", type: "email" },
            page: { origin: "https://app.example.test", path: "/customers/new" },
            observedBy: "event",
          },
          {
            kind: "sink",
            sink: "network",
            requestSurface: "browser",
            method: "POST",
            resourceType: "fetch",
            recipient: {
              origin: finding.flow.recipient.origin,
              host: finding.flow.recipient.host,
            },
            endpoint: "/event",
            locations: ["json.email"],
            body: { kind: "json", size: 42, truncated: false },
          },
          finding.flow,
          finding,
        ),
      ),
    ),
  );

  assert.equal(await reporter.onEnd(fullResult()), undefined);
  const serialized = await readFile(reportPath, "utf8");
  const report = JSON.parse(serialized);
  const metadata = await stat(reportPath);

  assert.equal(report.schemaVersion, 5);
  assert.deepEqual(report.tool, { name: "privacyspec", version: "0.1.0-beta.3" });
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
  assert.deepEqual(report.coverage.firstPartyJsonResponses.tests, {
    enabled: 0,
    disabled: 1,
    unavailable: 0,
  });
  assert.deepEqual(report.coverage.playwright, {
    tests: { compatible: 1, incompatible: 0, unavailable: 0 },
    applicationContexts: 1,
    pages: 1,
  });
  assert.deepEqual(report.coverage.network, {
    requests: { seen: 0, accepted: 0, filteredLowValueStatic: 0 },
  });
  assert.equal(report.coverage.observation.status, "complete");
  assert.deepEqual(report.coverage.observation.contexts, { seen: 1, instrumented: 1 });
  assert.deepEqual(report.coverage.observation.pages, {
    seen: 1,
    instrumented: 1,
    storageCapable: 1,
  });
  assert.equal(report.coverage.firstPartyJsonResponses.experimental, true);
  assert.equal(report.testData.testDataSchemaVersion, 1);
  assert.deepEqual(report.testData.summary, {
    total: 0,
    synthetic: 0,
    reviewRequired: 0,
    unassessed: 0,
  });
  assert.equal(report.summary.sensitiveSources.byName["personal.email"], 1);
  assert.equal(report.summary.sinks.byName.network, 1);
  assert.equal(report.summary.dataFlows, 1);
  assert.equal(report.summary.findings.newReviewRequired, 1);
  assert.equal(report.analysis.status, "review");
  assert.deepEqual(report.analysis.changes, {
    total: 1,
    privacy: 1,
    dependencies: 0,
    security: 0,
    runtimeErrors: 0,
  });
  assert.equal(report.analysis.privacy.status, "review");
  assert.equal(report.analysis.dependencies.status, "pass");
  assert.equal(report.analysis.security.status, "pass");
  assert.equal(report.analysis.runtimeErrors.status, "pass");
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
  assert.match(rendered, /PrivacySpec Secondary Coverage/u);
  assert.match(rendered, /Functional tests: PASS/u);
  assert.match(rendered, /Observation coverage: COMPLETE \(contexts=1\/1, pages=1\/1/u);
  assert.match(rendered, /Secondary coverage: REVIEW/u);
  assert.match(rendered, /privacy\s+REVIEW \(coverage=COMPLETE, changes=1, flows=1\)/u);
  assert.match(rendered, /dependencies\s+PASS/u);
  assert.match(rendered, /technical relevance PS1004: OWASP ASVS 5\.0\.0 V14\.2\.3/u);
  assert.match(rendered, /EU relevance PS1004: GDPR Article 5\(1\)\(c\)/u);
  assert.match(rendered, /authoritative sources PS1004: .*github\.com.*eur-lex/u);
  assert.match(rendered, /performance: suite=500ms, cumulative test duration=125ms/u);
  assert.match(rendered, /JSON report: .*privacyspec-report\.json \(schema v5\)/u);
  assert.match(
    rendered,
    /result: REVIEW \(functional tests=PASS, changes=1, technical failures=0, review findings=1\)/u,
  );

  const inconsistentCountsPath = join(directory, "inconsistent-engine-counts.json");
  const inconsistentCounts = structuredClone(report);
  inconsistentCounts.coverage.browserEngines.tests.supported = 0;
  inconsistentCounts.coverage.browserEngines.tests.experimental = 1;
  await writeFile(inconsistentCountsPath, JSON.stringify(inconsistentCounts), "utf8");
  await assert.rejects(() => readPrivacySpecReport(inconsistentCountsPath));

  const limitedCapabilityPath = join(directory, "limited-engine-capability.json");
  const limitedCapability = structuredClone(report);
  limitedCapability.coverage.browserEngines.engines.chromium.capabilities.network = "partial";
  await writeFile(limitedCapabilityPath, JSON.stringify(limitedCapability), "utf8");
  await assert.rejects(() => readPrivacySpecReport(limitedCapabilityPath));
});

test("schema-v5 strict reporting accepts built-in and validated custom DOM data categories", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-expanded-taxonomy-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const categories = [
    "personal.name",
    "personal.postal_address",
    "personal.date_of_birth",
    "personal.account_identifier",
    "personal.payment_card",
    "personal.gender_identity",
    "personal.job_title",
    "custom.personal.acme.benefit_code",
    "custom.secret.acme.employee_pin",
  ];
  const flowTemplate = reviewFinding().flow;
  const observations = categories.flatMap((category) => [
    {
      kind: "sensitive-source",
      category,
      confidence: "high",
      evidence: [{ kind: "autocomplete", value: "semantic-fixture" }],
      sourceKind: "form-input",
      control: { elementKind: "input" },
      page: { origin: "https://app.example.test", path: "/profile" },
      observedBy: "event",
    },
    {
      ...flowTemplate,
      dataCategory: category,
      sinkKind: "request-body",
      recipient: {
        origin: "https://app.example.test",
        host: "app.example.test",
        firstParty: true,
      },
      endpoint: "/profile",
      location: `json.${category.replaceAll(".", "_")}`,
    },
  ]);
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    write: () => {},
  });

  reporter.onBegin({ projects: [{ name: "chromium" }] });
  reporter.onTestEnd(testCase, testResult(completeAttachments(attachmentWith(...observations))));
  assert.equal(await reporter.onEnd(fullResult()), undefined);

  const report = await readPrivacySpecReport(reportPath);
  assert.deepEqual(
    report.flows.map((flow) => flow.dataCategory),
    categories.toSorted(),
  );
  for (const category of categories) {
    assert.equal(report.summary.sensitiveSources.byName[category], 1, category);
  }
});

test("bounded optional observer skips produce partial inconclusive coverage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-partial-coverage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const output = [];
  const result = createEmptyPrivacySpecResult();
  result.coverage.firstPartyJsonResponses.enabled = true;
  result.coverage.firstPartyJsonResponses.responses = {
    seen: 1,
    firstParty: 1,
    json: 1,
    parsed: 0,
    withSources: 0,
  };
  result.coverage.firstPartyJsonResponses.skipped.unknownLength = 1;
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    write: (message) => output.push(message),
  });
  reporter.onBegin({ projects: [{ name: "chromium" }] });
  reporter.onTestEnd(
    testCase,
    testResult(
      completeAttachments({
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      }),
    ),
  );

  assert.equal(await reporter.onEnd(fullResult()), undefined);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.run.complete, false);
  assert.equal(report.run.privacyspecStatus, "incomplete");
  assert.equal(report.coverage.observation.status, "partial");
  assert.deepEqual(report.coverage.observation.diagnostics, [
    {
      code: "COVERAGE_OPTIONAL_OBSERVER_SKIPPED",
      message: "The optional first-party JSON response observer skipped bounded work.",
    },
  ]);
  assert.match(output.join(""), /Observation coverage: PARTIAL/u);
  assert.match(output.join(""), /Secondary coverage: INCONCLUSIVE/u);
});

test("observer finalization timeout makes coverage incomplete", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-finalization-timeout-"));
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
  reporter.onTestEnd(
    testCase,
    testResult(
      completeAttachments(
        attachmentWith({
          kind: "diagnostic",
          code: "PS_OBSERVER_FINALIZATION_TIMEOUT",
          classification: "informational",
          message:
            "Observer finalization exceeded its bounded wait before the event set was complete.",
        }),
      ),
    ),
  );

  assert.equal(await reporter.onEnd(fullResult()), undefined);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.run.complete, false);
  assert.equal(report.run.privacyspecStatus, "incomplete");
  assert.equal(report.coverage.observation.status, "incomplete");
  assert.deepEqual(await readPrivacySpecReport(reportPath), report);
  assert.equal(
    report.coverage.observation.diagnostics.some(
      (diagnostic) => diagnostic.code === "COVERAGE_OBSERVER_FINALIZATION_INCOMPLETE",
    ),
    true,
  );
  assert.match(output.join(""), /Observation coverage: INCOMPLETE/u);
  assert.match(output.join(""), /Secondary coverage: INCONCLUSIVE/u);
});

test("schema-v5 report persists only sanitized test-data hygiene semantics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-testdata-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const rawValue = "private@phase16-report.dev";
  const result = createEmptyPrivacySpecResult();
  result.testData.observations.push({
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
  });
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    write: () => {},
  });
  reporter.onBegin({ projects: [{ name: "chromium" }] });
  reporter.onTestEnd(
    testCase,
    testResult(
      completeAttachments({
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      }),
    ),
  );
  assert.equal(await reporter.onEnd(fullResult()), undefined);
  const serialized = await readFile(reportPath, "utf8");
  const report = JSON.parse(serialized);
  assert.deepEqual(report.testData.summary, {
    total: 1,
    synthetic: 0,
    reviewRequired: 1,
    unassessed: 0,
  });
  assert.equal(report.run.privacyspecStatus, "passed");
  assert.equal(serialized.includes(rawValue), false);
  assert.equal(serialized.includes("phase16-report.dev"), false);
  assert.doesNotMatch(serialized, /"(?:raw|value|domain)"\s*:/u);
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
  reporter.onTestEnd(testCase, testResult(completeAttachments(attachmentWith()), "failed", 75));

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
  reporter.onTestEnd(testCase, testResult(completeAttachments(attachmentWith())));

  assert.deepEqual(await reporter.onEnd(fullResult()), { status: "failed" });
  assert.match(output.join(""), /could not write JSON report/u);
  assert.match(output.join(""), /result: FAIL/u);
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
});
