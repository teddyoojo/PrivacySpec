import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBaselineFlowCandidate } from "../dist/baseline/compare.js";
import { writeBaselineFile, writeLatestRunFile } from "../dist/baseline/write.js";
import PrivacySpecReporter from "../dist/playwright/reporter.js";
import {
  createEmptyPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "../dist/playwright/result.js";

const resultWith = (attachments, status = "passed") => ({ attachments, status });
const testCase = { title: "ordinary QA test" };

const reviewFinding = (overrides = {}) => {
  const { flow: flowOverrides = {}, ...findingOverrides } = overrides;
  return {
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
      ...flowOverrides,
    },
    limitations: ["The processing context requires review."],
    ...findingOverrides,
  };
};

const personalUrlFinding = () =>
  reviewFinding({
    ruleId: "PS1001",
    title: "Personal data or secret in URL",
    observation: "High-confidence personal.email was observed in a URL.",
    flow: {
      sinkKind: "request-url",
      recipient: undefined,
      method: undefined,
      endpoint: "/customers",
      location: "url.query.email",
    },
    limitations: [
      "Personal data is not automatically classified as sensitive under the application's ASVS protection requirements.",
    ],
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

test("reporter reads exactly one sanitized PrivacySpec result", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(createEmptyPrivacySpecResult())),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, ["PrivacySpec observed 1 tests\n"]);
});

test("reporter emits NIS2 testing-evidence relevance only for the explicit profile", async () => {
  for (const profiles of [undefined, { nis2_2024_2690: false }]) {
    const output = [];
    const reporter = new PrivacySpecReporter({
      profiles,
      write: (message) => output.push(message),
    });
    reporter.onTestEnd(testCase, resultWith([attachmentWith()]));
    assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
    assert.doesNotMatch(output.join(""), /2024\/2690|nis2/iu);
  }

  const output = [];
  const reporter = new PrivacySpecReporter({
    profiles: { nis2_2024_2690: true },
    write: (message) => output.push(message),
  });
  reporter.onTestEnd(testCase, resultWith([attachmentWith()]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  const rendered = output.join("");
  assert.match(rendered, /report profile: nis2_2024_2690 \[OPT-IN\] \[RUN_COMPLETE\]/u);
  assert.match(rendered, /Commission Implementing Regulation \(EU\) 2024\/2690/u);
  assert.match(rendered, /Annex, points 6\.5\.2\(b\) and 6\.5\.2\(c\)/u);
  assert.match(rendered, /\[SUPPORTING_EVIDENCE\]/u);
  assert.match(rendered, /organisation has confirmed/u);
  assert.match(
    rendered,
    /primary source: https:\/\/eur-lex\.europa\.eu\/eli\/reg_impl\/2024\/2690\/oj\/eng/iu,
  );
  assert.match(rendered, /mapping reviewed: 2026-08-20/u);
  assert.doesNotMatch(
    rendered,
    /\b(?:GDPR|NIS2) violation\b|\bnon[- ]?compliant\b|\bcompliant\b/iu,
  );
});

test("reporter labels an opt-in evidence profile when no test scope completed", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({
    profiles: { nis2_2024_2690: true },
    write: (message) => output.push(message),
  });

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  const rendered = output.join("");
  assert.match(rendered, /\[OPT-IN\] \[RUN_INCOMPLETE\]/u);
  assert.match(rendered, /did not complete its observed test scope/u);
  assert.doesNotMatch(rendered, /\[RUN_COMPLETE\]/u);
});

test("a technical finding can still belong to a complete opt-in evidence run", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({
    profiles: { nis2_2024_2690: true },
    write: (message) => output.push(message),
  });
  reporter.onTestEnd(
    testCase,
    resultWith([
      attachmentWith(
        reviewFinding({
          ruleId: "PS1001",
          severity: "error",
          classification: "technical_failure",
          title: "Personal data or secret in URL",
          flow: {
            dataCategory: "secret.password",
            sinkKind: "request-url",
            location: "url.query.password",
          },
        }),
      ),
    ]),
  );

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  const rendered = output.join("");
  assert.match(rendered, /\[OPT-IN\] \[RUN_COMPLETE\]/u);
  assert.doesNotMatch(rendered, /did not complete its observed test scope/u);
});

test("reporter fails the run when an attempt has no PrivacySpec result", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });

  reporter.onTestEnd(testCase, resultWith([]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.equal(output[0], "PrivacySpec observed 0 tests\n");
  assert.match(output[1], /expected one privacyspec-result attachment/u);
});

test("reporter ignores an attachment-less statically skipped test", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });

  reporter.onTestEnd(testCase, resultWith([], "skipped"));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, ["PrivacySpec observed 0 tests\n"]);
});

test("reporter summarizes sanitized source categories", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push({
    kind: "sensitive-source",
    category: "personal.email",
    confidence: "high",
    evidence: [{ kind: "input-type", value: "email" }],
    control: { elementKind: "input", type: "email" },
    page: { origin: "http://localhost:3100", path: "/customers/new" },
    observedBy: "event",
  });

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec sources: personal.email=1\n",
  ]);
});

test("reporter summarizes collected sink kinds without making rule decisions", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push(
    {
      kind: "sink",
      sink: "console",
      level: "warning",
      argumentCount: 1,
      locations: ["console.argument.0"],
    },
    {
      kind: "sink",
      sink: "storage",
      storageType: "local-storage",
      key: "customer-email",
      observedBy: "write",
      page: { origin: "https://app.example.test", path: "/settings" },
    },
  );

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec sinks: console=1, storage=1\n",
  ]);
});

test("reporter summarizes sanitized semantic flows without rule decisions", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push({
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
  });

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, ["PrivacySpec observed 1 tests\n", "PrivacySpec data flows: 1\n"]);
});

test("reporter deduplicates and prints supported informational limit diagnostics", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const sourceDiagnostic = {
    kind: "diagnostic",
    code: "PS_SOURCE_LIMIT_REACHED",
    classification: "informational",
    message: "Sensitive source collection reached its per-test safety limit.",
  };
  const sinkDiagnostic = {
    kind: "diagnostic",
    code: "PS_SINK_LIMIT_REACHED",
    classification: "informational",
    collector: "network",
    message: "network sink collection reached its per-test safety limit.",
  };
  const correlationDiagnostic = {
    kind: "diagnostic",
    code: "PS_CORRELATION_LIMIT_REACHED",
    classification: "informational",
    message: "Sensitive data correlation reached its per-test safety limit.",
  };
  const first = createEmptyPrivacySpecResult();
  first.observations.push(
    sourceDiagnostic,
    sinkDiagnostic,
    correlationDiagnostic,
    sourceDiagnostic,
  );
  const second = createEmptyPrivacySpecResult();
  second.observations.push(sourceDiagnostic, sinkDiagnostic, correlationDiagnostic);

  for (const result of [first, second]) {
    reporter.onTestEnd(
      testCase,
      resultWith([
        {
          name: PRIVACYSPEC_ATTACHMENT_NAME,
          contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
          body: Buffer.from(JSON.stringify(result)),
        },
      ]),
    );
  }

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 2 tests\n",
    "PrivacySpec informational: PS_CORRELATION_LIMIT_REACHED: Sensitive data correlation reached its per-test safety limit.\n",
    "PrivacySpec informational: PS_SINK_LIMIT_REACHED: network sink collection reached its per-test safety limit.\n",
    "PrivacySpec informational: PS_SOURCE_LIMIT_REACHED: Sensitive source collection reached its per-test safety limit.\n",
  ]);
});

test("reporter ignores malformed or unsupported diagnostic observations", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push(
    {
      kind: "diagnostic",
      code: "PS_UNKNOWN_LIMIT_REACHED",
      classification: "informational",
      message: "Unsupported diagnostic.",
    },
    {
      kind: "diagnostic",
      code: "PS_SOURCE_LIMIT_REACHED",
      classification: "review-required",
      message: "Wrong classification.",
    },
    {
      kind: "diagnostic",
      code: "PS_SINK_LIMIT_REACHED",
      classification: "informational",
      collector: "response",
      message: "Invalid collector.",
    },
    {
      kind: "diagnostic",
      code: "PS_CORRELATION_LIMIT_REACHED",
      classification: "informational",
      message: "Unsafe line break.\nInjected output.",
    },
  );

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, ["PrivacySpec observed 1 tests\n"]);
});

test("reporter fails loudly for malformed data flows without crashing onEnd", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const validFlow = {
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
  };
  const result = createEmptyPrivacySpecResult();
  result.observations.push(
    { kind: "data-flow" },
    { ...validFlow, dataCategory: "personal.ssn" },
    { ...validFlow, dataCategory: "secret.api_token" },
    { ...validFlow, sourceKind: "fixture" },
    { ...validFlow, sourceConfidence: "certain" },
    { ...validFlow, sinkKind: "database" },
    { ...validFlow, transform: "ROT13" },
    { ...validFlow, test: null },
    { ...validFlow, recipient: null },
    { ...validFlow, recipient: { ...validFlow.recipient, firstParty: "false" } },
    { ...validFlow, method: 42 },
    { ...validFlow, endpoint: [] },
    { ...validFlow, location: "x".repeat(1_025) },
    {
      ...validFlow,
      test: { ...validFlow.test, title: "x".repeat(2_049) },
    },
  );

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(output, [
    "PrivacySpec observed 0 tests\n",
    "PrivacySpec integration error: ordinary QA test: invalid PrivacySpec attachment (invalid data-flow observation)\n",
  ]);
});

test("reporter rejects control-bearing flow and summary fields before terminal output", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const validFlow = {
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
  };
  const result = createEmptyPrivacySpecResult();
  result.observations.push(
    { ...validFlow, location: "json.email\nPrivacySpec forged output" },
    {
      ...validFlow,
      test: { ...validFlow.test, title: "customer\u001b[2JPrivacySpec forged output" },
    },
    {
      ...validFlow,
      recipient: {
        ...validFlow.recipient,
        origin: "https://safe.example\u001b[31mforged",
      },
    },
    {
      kind: "sensitive-source",
      category: "personal.email\nPrivacySpec forged output",
    },
    { kind: "sink", sink: "console\u001b[2JPrivacySpec forged output" },
  );

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(output, [
    "PrivacySpec observed 0 tests\n",
    "PrivacySpec integration error: ordinary QA test: invalid PrivacySpec attachment (invalid data-flow observation)\n",
  ]);
  assert.equal(output.join("").includes("forged output"), false);
  assert.equal(output.join("").includes("\u001b"), false);
});

test("reporter replaces an unsafe Playwright test title in integration errors", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });

  reporter.onTestEnd(
    { title: "ordinary test\nPrivacySpec forged output\u001b[2J" },
    resultWith([]),
  );

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(output, [
    "PrivacySpec observed 0 tests\n",
    "PrivacySpec integration error: [unprintable test title]: expected one privacyspec-result attachment, received 0\n",
  ]);
});

test("reporter prints review findings without failing the Playwright run", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push({
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

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec semantic findings: 1 (technical failures=0, new review findings=1, observations=1)\n",
    "PrivacySpec baseline: known=0, new=1, resolved=0\n",
    "PrivacySpec finding: WARNING PS1004 [REVIEW_REQUIRED] [NEW] Personal data sent to external recipient :: personal.email -> external-request external https://analytics.example.test :: /event :: json.email [EXACT] (observations: 1; tests: customer can be created)\n",
  ]);
});

test("reporter treats an ordinary personal-data URL as a new review finding", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  reporter.onTestEnd(testCase, resultWith([attachmentWith(personalUrlFinding())]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec semantic findings: 1 (technical failures=0, new review findings=1, observations=1)\n",
    "PrivacySpec baseline: known=0, new=1, resolved=0\n",
    "PrivacySpec finding: WARNING PS1001 [REVIEW_REQUIRED] [NEW] Personal data or secret in URL :: personal.email -> request-url :: /customers :: url.query.email [EXACT] (observations: 1; tests: customer can be created)\n",
  ]);
});

test("reporter aggregates duplicate terminal findings while retaining JSON occurrences", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-semantic-terminal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    write: (message) => output.push(message),
  });
  const linkNavigation = personalUrlFinding();
  const shortCodeSubmission = reviewFinding({
    ruleId: "PS1001",
    title: "Personal data or secret in URL",
    observation: "High-confidence personal.email was observed in a URL.",
    flow: {
      sinkKind: "request-url",
      recipient: undefined,
      method: "POST",
      endpoint: "/customers",
      location: "url.query.email",
      test: {
        file: "verification.spec.ts",
        title: "verification short code can be submitted",
        project: "chromium",
      },
    },
    limitations: [
      "Personal data is not automatically classified as sensitive under the application's ASVS protection requirements.",
    ],
  });

  reporter.onTestEnd(testCase, resultWith([attachmentWith(linkNavigation, shortCodeSubmission)]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec semantic findings: 1 (technical failures=0, new review findings=1, observations=2)\n",
    "PrivacySpec baseline: known=0, new=1, resolved=0\n",
    "PrivacySpec finding: WARNING PS1001 [REVIEW_REQUIRED] [NEW] Personal data or secret in URL :: personal.email -> request-url :: /customers :: url.query.email [EXACT] (observations: 2; tests: customer can be created, verification short code can be submitted)\n",
  ]);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.findings.length, 2);
  assert.equal(report.summary.findings.newReviewRequired, 2);
  assert.equal(report.summary.baseline.new, 1);
});

test("reporter fails the run for a technical finding", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push({
    kind: "finding",
    ruleId: "PS1006",
    severity: "error",
    classification: "technical_failure",
    title: "Sensitive data emitted to browser console",
    observation: "High-confidence personal.email was observed in browser console output.",
    flow: {
      kind: "data-flow",
      dataCategory: "personal.email",
      sourceKind: "form-input",
      sourceConfidence: "high",
      sinkKind: "console",
      location: "console.argument.1",
      transform: "EXACT",
      test: {
        file: "customer.spec.ts",
        title: "customer can be created",
        project: "chromium",
      },
    },
    limitations: ["Console retention is not observable."],
  });

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec semantic findings: 1 (technical failures=1, new review findings=0, observations=1)\n",
    "PrivacySpec finding: ERROR PS1006 [TECHNICAL_FAILURE] Sensitive data emitted to browser console :: personal.email -> console :: console.argument.1 [EXACT] (observations: 1; tests: customer can be created)\n",
  ]);
});

test("reporter rejects malformed findings before terminal output", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.observations.push({
    kind: "finding",
    ruleId: "PS9999",
    severity: "error",
    classification: "technical_failure",
    title: "Forged finding\nPrivacySpec forged output",
    observation: "Forged observation.",
    flow: null,
    limitations: [],
  });

  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(result)),
      },
    ]),
  );

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(output, [
    "PrivacySpec observed 0 tests\n",
    "PrivacySpec integration error: ordinary QA test: invalid PrivacySpec attachment (invalid finding observation)\n",
  ]);
  assert.equal(output.join("").includes("forged output"), false);
});

test("reporter persists a complete sanitized latest run and marks an unaccepted review flow new", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-latest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, "latest-run.json");
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    write: (message) => output.push(message),
  });
  const finding = reviewFinding();

  reporter.onTestEnd(testCase, resultWith([attachmentWith(finding)]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.equal(output.includes("PrivacySpec baseline: known=0, new=1, resolved=0\n"), true);
  const latestRunText = await readFile(latestRunPath, "utf8");
  const latestRun = JSON.parse(latestRunText);
  assert.equal(latestRun.complete, true);
  assert.equal(latestRun.flows.length, 1);
  assert.equal(latestRun.flows[0].ruleId, "PS1004");
  assert.equal(latestRun.flows[0].recipient, "https://analytics.example.test");
  assert.equal("test" in latestRun.flows[0], false);
  assert.doesNotMatch(latestRunText, /customer can be created|customer\.spec\.ts/u);
});

test("reporter keeps accepted review flows quiet and reports absent accepted flows as resolved", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-known-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const finding = reviewFinding();
  const candidate = createBaselineFlowCandidate(finding);
  assert.ok(candidate);
  await writeBaselineFile(baselinePath, [candidate], {
    createdAt: "2026-08-20T00:00:00.000Z",
  });

  const knownOutput = [];
  const knownReporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath: false,
    write: (message) => knownOutput.push(message),
  });
  knownReporter.onTestEnd(testCase, resultWith([attachmentWith(finding.flow, finding)]));
  assert.equal(await knownReporter.onEnd({ status: "passed" }), undefined);
  assert.equal(knownOutput.includes("PrivacySpec baseline: known=1, new=0, resolved=0\n"), true);
  assert.equal(
    knownOutput.some((line) => line.startsWith("PrivacySpec finding:")),
    false,
  );
  assert.equal(knownOutput.includes("PrivacySpec data flows: 1\n"), true);
  assert.equal(
    knownOutput.some((line) => line.startsWith("PrivacySpec semantic findings:")),
    false,
  );

  const resolvedOutput = [];
  const resolvedReporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath: false,
    write: (message) => resolvedOutput.push(message),
  });
  resolvedReporter.onTestEnd(testCase, resultWith([attachmentWith()]));
  assert.equal(await resolvedReporter.onEnd({ status: "passed" }), undefined);
  assert.equal(resolvedOutput.includes("PrivacySpec baseline: known=0, new=0, resolved=1\n"), true);
  assert.equal(
    resolvedOutput.includes(
      "PrivacySpec resolved: PS1004 personal.email -> external-request https://analytics.example.test :: /event :: json.email [EXACT]\n",
    ),
    true,
  );
});

test("reporter excludes known reviews from mixed actionable finding counts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-mixed-findings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const known = reviewFinding();
  const accepted = createBaselineFlowCandidate(known);
  assert.ok(accepted);
  await writeBaselineFile(baselinePath, [accepted], {
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  const newlyObserved = reviewFinding({
    flow: {
      dataCategory: "personal.phone",
      location: "json.phone",
    },
    observation: "personal.phone was observed leaving the configured first-party boundary.",
  });
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath: false,
    write: (message) => output.push(message),
  });
  reporter.onTestEnd(testCase, resultWith([attachmentWith(known, newlyObserved)]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.equal(
    output.includes(
      "PrivacySpec semantic findings: 1 (technical failures=0, new review findings=1, observations=1)\n",
    ),
    true,
  );
  assert.equal(output.includes("PrivacySpec baseline: known=1, new=1, resolved=0\n"), true);
});

test("reporter rejects a malformed baseline and marks its latest run incomplete", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, "latest-run.json");
  await writeFile(baselinePath, "{}\n", "utf8");
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    write: (message) => output.push(message),
  });
  reporter.onTestEnd(testCase, resultWith([attachmentWith(reviewFinding())]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.equal(
    output.some((line) => /could not read semantic baseline/u.test(line)),
    true,
  );
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
});

test("reporter can opt into failing on new review findings without baselining failures", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    failOnNewReviewFindings: true,
    latestRunPath: false,
    write: (message) => output.push(message),
  });
  reporter.onTestEnd(testCase, resultWith([attachmentWith(personalUrlFinding())]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.equal(output.includes("PrivacySpec baseline: known=0, new=1, resolved=0\n"), true);
});

test("reporter invalidates a stale complete latest run before tests begin", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-stale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const latestRunPath = join(directory, "latest-run.json");
  const candidate = createBaselineFlowCandidate(reviewFinding());
  assert.ok(candidate);
  await writeLatestRunFile(latestRunPath, [candidate], {
    complete: true,
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath,
    write: () => {},
  });

  reporter.onBegin();

  const invalidated = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(invalidated.complete, false);
  assert.deepEqual(invalidated.flows, []);
});

test("reporter marks a zero-execution run incomplete and never resolves accepted flows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-zero-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, "latest-run.json");
  const candidate = createBaselineFlowCandidate(reviewFinding());
  assert.ok(candidate);
  await writeBaselineFile(baselinePath, [candidate], {
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    write: (message) => output.push(message),
  });
  reporter.onBegin();
  reporter.onTestEnd(testCase, resultWith([], "skipped"));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
  assert.equal(output.includes("PrivacySpec baseline: known=0, new=0, resolved=0\n"), true);
  assert.equal(
    output.some((line) => line.startsWith("PrivacySpec resolved:")),
    false,
  );
});

test("reporter keeps a mixed executed-and-skipped run out of baseline update", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-mixed-skip-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, "latest-run.json");
  const candidate = createBaselineFlowCandidate(reviewFinding());
  assert.ok(candidate);
  await writeBaselineFile(baselinePath, [candidate], {
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    write: (message) => output.push(message),
  });
  reporter.onBegin();
  reporter.onTestEnd(testCase, resultWith([attachmentWith()]));
  reporter.onTestEnd({ title: "conditionally skipped test" }, resultWith([], "skipped"));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
  assert.equal(output.includes("PrivacySpec baseline: known=0, new=0, resolved=0\n"), true);
  assert.equal(
    output.some((line) => line.startsWith("PrivacySpec resolved:")),
    false,
  );
});

test("reporter keeps an attachment-producing runtime skip out of baseline update", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-runtime-skip-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, "latest-run.json");
  const candidate = createBaselineFlowCandidate(reviewFinding());
  assert.ok(candidate);
  await writeBaselineFile(baselinePath, [candidate], {
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    write: (message) => output.push(message),
  });
  reporter.onBegin();
  reporter.onTestEnd(testCase, resultWith([attachmentWith()]));
  reporter.onTestEnd({ title: "runtime-skipped test" }, resultWith([attachmentWith()], "skipped"));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
  assert.equal(output.includes("PrivacySpec baseline: known=0, new=0, resolved=0\n"), true);
  assert.equal(
    output.some((line) => line.startsWith("PrivacySpec resolved:")),
    false,
  );
});

test("reporter keeps a coverage-limited run out of baseline update", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-limit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, "latest-run.json");
  const candidate = createBaselineFlowCandidate(reviewFinding());
  assert.ok(candidate);
  await writeBaselineFile(baselinePath, [candidate], {
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    write: (message) => output.push(message),
  });
  reporter.onBegin();
  reporter.onTestEnd(
    testCase,
    resultWith([
      attachmentWith({
        kind: "diagnostic",
        code: "PS_CORRELATION_LIMIT_REACHED",
        classification: "informational",
        message: "Sensitive data correlation reached its per-test safety limit.",
      }),
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
  assert.equal(output.includes("PrivacySpec baseline: known=0, new=0, resolved=0\n"), true);
  assert.equal(
    output.some((line) => line.startsWith("PrivacySpec resolved:")),
    false,
  );
});

test("reporter never exposes a technical-failure run to baseline update", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-technical-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const latestRunPath = join(directory, "latest-run.json");
  const technicalFinding = reviewFinding({
    ruleId: "PS1006",
    severity: "error",
    classification: "technical_failure",
    title: "Sensitive data emitted to browser console",
    observation: "High-confidence personal.email was observed in browser console output.",
    flow: {
      recipient: undefined,
      method: undefined,
      endpoint: undefined,
      sinkKind: "console",
      location: "console.argument.1",
    },
  });
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath,
    write: () => {},
  });
  reporter.onBegin();
  reporter.onTestEnd(testCase, resultWith([attachmentWith(technicalFinding)]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  const latestRun = JSON.parse(await readFile(latestRunPath, "utf8"));
  assert.equal(latestRun.complete, false);
  assert.deepEqual(latestRun.flows, []);
});
