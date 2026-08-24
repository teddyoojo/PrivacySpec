import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDependencyAttachment,
  DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
  DEPENDENCY_ATTACHMENT_NAME,
  readCompleteDependencyLatestRunFile,
  readDependencyReport,
  writeDependencyBaselineFile,
} from "../dist/analyzers/dependency/artifact.js";
import { createDependencySemanticCandidates } from "../dist/analyzers/dependency/baseline.js";
import { createRuntimeFailureKey } from "../dist/analyzers/runtime-failure/analyzer.js";
import {
  createRuntimeFailureAttachment,
  RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
  RUNTIME_FAILURE_ATTACHMENT_NAME,
  readCompleteRuntimeFailureLatestRunFile,
  readRuntimeFailureReport,
} from "../dist/analyzers/runtime-failure/artifact.js";
import { createSecurityTargetKey } from "../dist/analyzers/security/analyzer.js";
import {
  createSecurityAttachment,
  readCompleteSecurityLatestRunFile,
  readSecurityReport,
  SECURITY_ATTACHMENT_CONTENT_TYPE,
  SECURITY_ATTACHMENT_NAME,
} from "../dist/analyzers/security/artifact.js";
import { createBaselineFlowCandidate } from "../dist/baseline/compare.js";
import {
  readLatestRunFile,
  writeBaselineFile,
  writeLatestRunFile,
} from "../dist/baseline/write.js";
import PrivacySpecReporter from "../dist/playwright/reporter.js";
import {
  createEmptyPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "../dist/playwright/result.js";
import { readPrivacySpecReport } from "../dist/report/read.js";
import { readPrivacySpecRunPart } from "../dist/run-scope/artifact.js";

const resultWith = (attachments, status = "passed") => ({ attachments, status });
const testCase = { title: "ordinary QA test" };

const testDataObservation = (overrides = {}) => ({
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
  ...overrides,
});

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
  return attachmentWithResult(result);
};

const attachmentWithResult = (result) => ({
  name: PRIVACYSPEC_ATTACHMENT_NAME,
  contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  body: Buffer.from(JSON.stringify(result)),
});

const dependencyAttachmentWith = (inventory, coverage = "complete", diagnostics = []) => ({
  name: DEPENDENCY_ATTACHMENT_NAME,
  contentType: DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
  body: Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      analyzerId: "dependency",
      coverage,
      inventory,
      diagnostics,
    }),
  ),
});

const analyzerAttachmentWith = (name, contentType, value) => ({
  name,
  contentType,
  body: Buffer.from(JSON.stringify(value)),
});

const emptyAnalyzerAttachment = (name, contentType, analyzerId) => ({
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

const dependencyInventoryEntry = (overrides = {}) => ({
  kind: "runtime-dependency",
  origin: "https://cdn.vendor.test",
  host: "cdn.vendor.test",
  boundary: "external",
  resourceTypes: ["script"],
  requestMethods: ["GET"],
  firstSeenTests: [{ file: "tests/checkout.spec.ts", project: "chromium" }],
  occurrenceCount: 2,
  ...overrides,
});

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

test("reporter emits bounded dependency reviews and an independent baseline lifecycle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-dependency-reporter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "dependency-baseline.json");
  const latestRunPath = join(directory, "latest-dependencies.json");
  const reportPath = join(directory, "dependencies-report.json");
  const acceptedInventory = [
    dependencyInventoryEntry(),
    dependencyInventoryEntry({
      origin: "https://old.vendor.test",
      host: "old.vendor.test",
      resourceTypes: ["font"],
    }),
  ];
  await writeDependencyBaselineFile(
    baselinePath,
    createDependencySemanticCandidates(acceptedInventory),
    { createdAt: "2026-08-21T12:00:00.000Z" },
  );
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath: false,
    dependencies: { baselinePath, latestRunPath, reportPath },
    write: (message) => output.push(message),
  });
  reporter.onBegin({ projects: [{ name: "chromium" }] });
  reporter.onTestEnd(testCase, {
    ...resultWith([
      attachmentWithResult(createEmptyPrivacySpecResult()),
      dependencyAttachmentWith([
        dependencyInventoryEntry({
          origin: "https://api.newvendor.test",
          host: "api.newvendor.test",
          resourceTypes: ["fetch/xhr"],
          requestMethods: ["POST"],
          occurrenceCount: 1,
        }),
        dependencyInventoryEntry(),
      ]),
      emptyAnalyzerAttachment(
        SECURITY_ATTACHMENT_NAME,
        SECURITY_ATTACHMENT_CONTENT_TYPE,
        "security",
      ),
      emptyAnalyzerAttachment(
        RUNTIME_FAILURE_ATTACHMENT_NAME,
        RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
        "runtime-failure",
      ),
    ]),
    duration: 25,
  });

  const endResult = await reporter.onEnd({
    status: "passed",
    startTime: new Date("2026-08-21T12:00:00.000Z"),
    duration: 50,
  });
  const rendered = output.join("");
  assert.equal(endResult, undefined, rendered);
  assert.match(rendered, /runtime dependencies: origins=2, external=2, requests=3/u);
  assert.match(rendered, /dependencies\s+REVIEW \(coverage=COMPLETE, changes=2, origins=2\)/u);
  assert.match(rendered, /NEW_EXTERNAL_ORIGIN https:\/\/api\.newvendor\.test as origin/u);
  assert.match(rendered, /NEW_EXTERNAL_API https:\/\/api\.newvendor\.test as fetch\/xhr/u);
  assert.match(rendered, /Secondary coverage: REVIEW/u);
  assert.match(rendered, /PrivacySpec result: REVIEW/u);
  assert.doesNotMatch(rendered, /malicious|untrusted|violation|compromise/iu);

  const report = await readDependencyReport(reportPath);
  assert.equal(report.complete, true);
  assert.deepEqual(report.baseline, { exists: true, known: 2, new: 2, resolved: 2 });
  assert.deepEqual(report.findings.map((finding) => finding.ruleId).sort(), [
    "NEW_EXTERNAL_API",
    "NEW_EXTERNAL_ORIGIN",
  ]);
  assert.equal((await readCompleteDependencyLatestRunFile(latestRunPath)).dependencies.length, 4);
});

test("reporter suite aggregation writes canonically parseable secondary artifacts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-canonical-reporter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "privacyspec-report.json");
  const dependencyReportPath = join(directory, "dependency-report.json");
  const dependencyLatestRunPath = join(directory, "dependency-latest.json");
  const securityReportPath = join(directory, "security-report.json");
  const securityLatestRunPath = join(directory, "security-latest.json");
  const runtimeReportPath = join(directory, "runtime-report.json");
  const runtimeLatestRunPath = join(directory, "runtime-latest.json");
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath,
    dependencies: {
      baselinePath: false,
      latestRunPath: dependencyLatestRunPath,
      reportPath: dependencyReportPath,
    },
    security: {
      baselinePath: false,
      latestRunPath: securityLatestRunPath,
      reportPath: securityReportPath,
    },
    runtimeFailures: {
      baselinePath: false,
      latestRunPath: runtimeLatestRunPath,
      reportPath: runtimeReportPath,
    },
    write: () => {},
  });
  reporter.onBegin({ projects: [{ name: "chromium" }] });

  const securityKey = createSecurityTargetKey({
    host: "app.example.test",
    endpoint: "/assets/app-Ab3F09.js",
    responseKind: "api",
    method: "GET",
  });
  const runtimeDetails = {
    boundary: "first-party",
    host: "app.example.test",
    method: "GET",
    endpoint: "/assets/app-Ab3F09.js",
    httpStatus: null,
    errorName: null,
    signature: null,
    failureCode: "ERR_CONNECTION_RESET",
  };
  const runtimeKey = createRuntimeFailureKey({
    failureType: "request-failed",
    details: runtimeDetails,
  });
  const testReferences = [
    { file: "tests/routes/%24user.spec.ts", project: "%project" },
    { file: "tests/routes/.account.spec.ts", project: ".project" },
  ];

  for (const [index, reference] of testReferences.entries()) {
    const dependencyAttachment = createDependencyAttachment(
      {
        analyzerId: "dependency",
        coverage: "complete",
        inventory: [
          dependencyInventoryEntry({
            requestMethods: [index === 0 ? "%METHOD" : ".METHOD"],
            firstSeenTests: [reference],
            occurrenceCount: 1,
          }),
        ],
        diagnostics: [],
      },
      { failed: false },
    );
    const securityAttachment = createSecurityAttachment(
      {
        analyzerId: "security",
        coverage: "complete",
        inventory: [
          {
            kind: "security-posture",
            key: securityKey,
            host: "app.example.test",
            endpoint: "/assets/app-Ab3F09.js",
            responseKind: "api",
            method: "GET",
            fingerprints: [
              {
                transport: "secure",
                csp: index === 0 ? "present:sha256:Ab3F09" : "present:sha256:aB3f09",
                hsts: "max-age=31536000;includeSubDomains=true;preload=false",
                xContentTypeOptions: "nosniff",
                cors: "none",
                cookies: [
                  {
                    name: index === 0 ? "%session" : ".session",
                    secure: true,
                    httpOnly: true,
                    sameSite: "lax",
                  },
                ],
              },
            ],
            firstSeenTests: [reference],
            occurrenceCount: 1,
          },
        ],
        diagnostics: [],
      },
      { failed: false },
    );
    const runtimeAttachment = createRuntimeFailureAttachment(
      {
        analyzerId: "runtime-failure",
        coverage: "complete",
        inventory: [
          {
            kind: "runtime-failure",
            key: runtimeKey,
            failureType: "request-failed",
            severity: "REVIEW",
            summary: "Network request failed",
            ...runtimeDetails,
            firstSeenTests: [reference],
            occurrenceCount: 1,
          },
        ],
        diagnostics: [],
      },
      { failed: false },
    );
    reporter.onTestEnd(
      { title: `ordinary QA test ${index + 1}` },
      {
        ...resultWith([
          attachmentWithResult(createEmptyPrivacySpecResult()),
          analyzerAttachmentWith(
            DEPENDENCY_ATTACHMENT_NAME,
            DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
            dependencyAttachment,
          ),
          analyzerAttachmentWith(
            SECURITY_ATTACHMENT_NAME,
            SECURITY_ATTACHMENT_CONTENT_TYPE,
            securityAttachment,
          ),
          analyzerAttachmentWith(
            RUNTIME_FAILURE_ATTACHMENT_NAME,
            RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
            runtimeAttachment,
          ),
        ]),
        duration: 10,
      },
    );
  }

  assert.equal(
    await reporter.onEnd({
      status: "passed",
      startTime: new Date("2026-08-21T12:00:00.000Z"),
      duration: 25,
    }),
    undefined,
  );

  const dependencyReport = await readDependencyReport(dependencyReportPath);
  const securityReport = await readSecurityReport(securityReportPath);
  const runtimeReport = await readRuntimeFailureReport(runtimeReportPath);
  const unifiedReport = await readPrivacySpecReport(reportPath);
  assert.deepEqual(dependencyReport.inventory[0].requestMethods, ["%METHOD", ".METHOD"]);
  assert.deepEqual(dependencyReport.inventory[0].firstSeenTests, testReferences);
  assert.deepEqual(
    securityReport.inventory[0].fingerprints.map((fingerprint) => fingerprint.csp),
    ["present:sha256:Ab3F09", "present:sha256:aB3f09"],
  );
  assert.deepEqual(securityReport.inventory[0].firstSeenTests, testReferences);
  assert.deepEqual(runtimeReport.inventory[0].firstSeenTests, testReferences);
  assert.equal(runtimeReport.inventory[0].occurrenceCount, 2);
  const { status: _dependencyStatus, ...embeddedDependencyReport } =
    unifiedReport.analysis.dependencies;
  const { status: _securityStatus, ...embeddedSecurityReport } = unifiedReport.analysis.security;
  const { status: _runtimeStatus, ...embeddedRuntimeReport } = unifiedReport.analysis.runtimeErrors;
  assert.deepEqual(embeddedDependencyReport, dependencyReport);
  assert.deepEqual(embeddedSecurityReport, securityReport);
  assert.deepEqual(embeddedRuntimeReport, runtimeReport);
  assert.deepEqual(
    (await readCompleteDependencyLatestRunFile(dependencyLatestRunPath)).dependencies,
    dependencyReport.findings.map(({ identity, observedAs, host }) => ({
      key: identity,
      boundary: "external",
      category: observedAs,
      host,
    })),
  );
  assert.equal((await readCompleteSecurityLatestRunFile(securityLatestRunPath)).entries.length, 1);
  assert.equal(
    (await readCompleteRuntimeFailureLatestRunFile(runtimeLatestRunPath)).entries.length,
    1,
  );
});

test("incomplete dependency coverage suppresses resolved conclusions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-dependency-incomplete-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "dependency-baseline.json");
  const reportPath = join(directory, "dependencies-report.json");
  await writeDependencyBaselineFile(
    baselinePath,
    createDependencySemanticCandidates([dependencyInventoryEntry()]),
    { createdAt: "2026-08-21T12:00:00.000Z" },
  );
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath: false,
    dependencies: { baselinePath, latestRunPath: false, reportPath },
    write: (message) => output.push(message),
  });
  reporter.onTestEnd(
    testCase,
    resultWith([
      attachmentWithResult(createEmptyPrivacySpecResult()),
      dependencyAttachmentWith([], "incomplete", [
        {
          code: "DEPENDENCY_ANALYSIS_INCOMPLETE",
          message: "Runtime dependency analysis did not complete inside the finalization bound.",
        },
      ]),
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.match(output.join(""), /dependency analysis: INCONCLUSIVE/u);
  const report = await readDependencyReport(reportPath);
  assert.equal(report.complete, false);
  assert.equal(report.baseline.resolved, 0);
});

test("reporter fails closed when executed tests instrument no application context", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  result.coverage.playwright = { applicationContexts: 0, pages: 0 };
  result.coverage.observation.contexts = { seen: 2, instrumented: 1 };
  result.coverage.observation.pages = { seen: 1, instrumented: 0, storageCapable: 0 };

  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(result)]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.match(
    output.join(""),
    /COVERAGE_INCOMPATIBLE: 1 Playwright tests ran but no application BrowserContexts were instrumented/u,
  );
});

test("reporter accepts attachment v1/v2 and summarizes validated experimental response coverage", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const legacy = {
    name: PRIVACYSPEC_ATTACHMENT_NAME,
    contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
    body: Buffer.from(JSON.stringify({ schemaVersion: 1, observations: [] })),
  };
  const current = createEmptyPrivacySpecResult();
  const previous = structuredClone(current);
  previous.schemaVersion = 2;
  delete previous.classifierConfiguration;
  delete previous.coverage.observation;
  delete previous.coverage.browserEngine;
  delete previous.coverage.apiRequests;
  current.coverage.firstPartyJsonResponses.enabled = true;
  current.coverage.firstPartyJsonResponses.responses = {
    seen: 3,
    firstParty: 2,
    json: 2,
    parsed: 1,
    withSources: 1,
  };
  current.coverage.firstPartyJsonResponses.discoveredSources = {
    total: 1,
    byCategory: { "personal.email": 1, "personal.phone": 0 },
  };
  current.coverage.firstPartyJsonResponses.skipped.unknownLength = 1;
  const attachment = {
    name: PRIVACYSPEC_ATTACHMENT_NAME,
    contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
    body: Buffer.from(JSON.stringify(current)),
  };

  reporter.onTestEnd(testCase, resultWith([legacy]));
  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(previous)]));
  reporter.onTestEnd(testCase, resultWith([attachment]));
  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.match(
    output.join(""),
    /experimental JSON response sources: parsed=1, discovered=1, skipped=1/u,
  );
});

test("reporter summarizes validated early network filtering coverage", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const current = createEmptyPrivacySpecResult();
  current.coverage.network.requests = {
    seen: 12,
    accepted: 4,
    filteredLowValueStatic: 8,
  };

  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(current)]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.match(output.join(""), /network filtering: low-value static requests=8/u);
});

test("reporter fails closed for malformed network filtering coverage", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const current = createEmptyPrivacySpecResult();
  current.coverage.network.requests = {
    seen: 1,
    accepted: 1,
    filteredLowValueStatic: 1,
  };

  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(current)]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.match(output.join(""), /invalid PrivacySpec attachment \(invalid coverage\)/u);
});

test("reporter fails closed for malformed observation coverage counters", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const current = createEmptyPrivacySpecResult();
  current.coverage.observation.pages = {
    seen: 1,
    instrumented: 2,
    storageCapable: 1,
  };

  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(current)]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.match(output.join(""), /invalid PrivacySpec attachment \(invalid coverage\)/u);
});

test("test-data hygiene review remains non-failing and prints only a count and command hint", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const current = createEmptyPrivacySpecResult();
  current.testData.observations.push(testDataObservation());
  reporter.onTestEnd(
    testCase,
    resultWith([
      {
        name: PRIVACYSPEC_ATTACHMENT_NAME,
        contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(current)),
      },
    ]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(output, [
    "PrivacySpec observed 1 tests\n",
    "PrivacySpec test-data hygiene: 1 review-required observation; inspect with privacyspec testdata\n",
  ]);
  assert.doesNotMatch(output.join(""), /EMAIL_DOMAIN|customer\.spec/u);
});

test("synthetic hygiene stays quiet and malformed hygiene fails as an integration error", async () => {
  const quietOutput = [];
  const quietReporter = new PrivacySpecReporter({
    write: (message) => quietOutput.push(message),
  });
  const synthetic = createEmptyPrivacySpecResult();
  synthetic.testData.observations.push(
    testDataObservation({
      verdict: "SYNTHETIC",
      signal: "IANA_RESERVED_EMAIL_DOMAIN",
    }),
  );
  quietReporter.onTestEnd(testCase, resultWith([attachmentWithResult(synthetic)]));
  assert.equal(await quietReporter.onEnd({ status: "passed" }), undefined);
  assert.deepEqual(quietOutput, ["PrivacySpec observed 1 tests\n"]);

  const invalidOutput = [];
  const invalidReporter = new PrivacySpecReporter({
    write: (message) => invalidOutput.push(message),
  });
  const malformed = createEmptyPrivacySpecResult();
  malformed.testData.observations.push(
    testDataObservation({
      attribution: {
        test: {
          file: "tests/customer.spec.ts",
          title: "forged@example.test",
          project: "chromium",
        },
        control: { elementKind: "input", observedBy: "event" },
      },
    }),
  );
  invalidReporter.onTestEnd(testCase, resultWith([attachmentWithResult(malformed)]));
  assert.deepEqual(await invalidReporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.match(
    invalidOutput.join(""),
    /invalid PrivacySpec attachment \(invalid test-data hygiene\)/u,
  );
  assert.doesNotMatch(invalidOutput.join(""), /forged@example/u);
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
    sourceKind: "form-input",
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

test("reporter treats a namespaced privacy analyzer failure as inconclusive", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    latestRunPath: false,
    reportPath: false,
    write: (message) => output.push(message),
  });
  const result = createEmptyPrivacySpecResult();
  result.observations.push({
    kind: "diagnostic",
    code: "PS_ANALYZER_PRIVACY_FAILED",
    classification: "informational",
    message: "The privacy analyzer failed inside the bounded runtime analyzer host.",
  });
  reporter.onBegin({ projects: [{ name: "chromium" }] }, { allTests: () => [testCase] });
  reporter.onTestEnd(testCase, {
    ...resultWith([attachmentWithResult(result)]),
    duration: 10,
  });

  assert.equal(
    await reporter.onEnd({
      status: "passed",
      startTime: new Date("2026-08-21T12:00:00.000Z"),
      duration: 20,
    }),
    undefined,
  );
  assert.match(output.join(""), /PS_ANALYZER_PRIVACY_FAILED/u);
  assert.match(output.join(""), /Observation coverage: INCOMPLETE/u);
  assert.match(output.join(""), /Secondary coverage: INCONCLUSIVE/u);
  assert.match(output.join(""), /PrivacySpec result: INCOMPLETE/u);
});

test("reporter rejects malformed or unsupported diagnostic observations", async () => {
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

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  assert.deepEqual(output, [
    "PrivacySpec observed 0 tests\n",
    "PrivacySpec integration error: ordinary QA test: invalid PrivacySpec attachment (invalid bounded JSON)\n",
  ]);
});

test("reporter fails loudly for malformed data flows without crashing onEnd", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const validFlow = {
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
    "PrivacySpec integration error: ordinary QA test: invalid PrivacySpec attachment (invalid bounded JSON)\n",
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
    "PrivacySpec finding: WARNING PS1004 [REVIEW_REQUIRED] [NEW] [CHANGE=NEW_RECIPIENT] Personal data sent to external recipient :: personal.email -> external-request external https://analytics.example.test :: /event :: json.email [EXACT] (observations: 1; tests: customer can be created)\n",
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
    "PrivacySpec finding: WARNING PS1001 [REVIEW_REQUIRED] [NEW] [CHANGE=NEW_ENDPOINT] Personal data or secret in URL :: personal.email -> request-url :: /customers :: url.query.email [EXACT] (observations: 1; tests: customer can be created)\n",
  ]);
});

test("unified terminal details cap privacy findings and report the omitted count", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const findings = Array.from({ length: 25 }, (_, index) =>
    reviewFinding({
      flow: { endpoint: `/event-${String.fromCharCode(97 + index)}` },
    }),
  );
  reporter.onTestEnd(testCase, resultWith([attachmentWith(...findings)]));

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.equal(
    output.filter((line) => /^PrivacySpec finding: WARNING PS1004/u.test(line)).length,
    20,
  );
  assert.ok(
    output.includes(
      "PrivacySpec finding: 5 additional privacy findings omitted from terminal output\n",
    ),
  );
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
    "PrivacySpec finding: WARNING PS1001 [REVIEW_REQUIRED] [NEW] [CHANGE=NEW_ENDPOINT] Personal data or secret in URL :: personal.email -> request-url :: /customers :: url.query.email [EXACT] (observations: 2; tests: customer can be created, verification short code can be submitted)\n",
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
      requestSurface: "browser",
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

test("reporter keeps browser and API-request findings as separate terminal semantics", async () => {
  const output = [];
  const reporter = new PrivacySpecReporter({ write: (message) => output.push(message) });
  const result = createEmptyPrivacySpecResult();
  const browserFinding = reviewFinding({
    ruleId: "PS1002",
    severity: "error",
    classification: "technical_failure",
    title: "Sensitive data over insecure HTTP",
    observation: "High-confidence personal.email was observed over insecure HTTP.",
    flow: {
      requestSurface: "browser",
      recipient: {
        origin: "http://analytics.example.test",
        host: "analytics.example.test",
        firstParty: false,
      },
    },
  });
  const apiFinding = structuredClone(browserFinding);
  apiFinding.flow.requestSurface = "api-request";
  apiFinding.flow.test.title = "API request fixture submits the same semantic flow";
  result.observations.push(browserFinding, apiFinding);
  result.coverage.apiRequests.enabled = true;
  result.coverage.apiRequests.status = "partial";
  result.coverage.apiRequests.calls = { seen: 1, observed: 1, failed: 0, serverErrors: 0 };

  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(result)]));

  assert.deepEqual(await reporter.onEnd({ status: "passed" }), { status: "failed" });
  const findingLines = output.filter((line) => line.startsWith("PrivacySpec finding:"));
  assert.equal(findingLines.length, 2);
  assert.equal(findingLines.filter((line) => line.includes("[surface=api-request]")).length, 1);
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
    "PrivacySpec integration error: ordinary QA test: invalid PrivacySpec attachment (invalid bounded JSON)\n",
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

test("classifier mismatch suppresses only privacy comparison and leaves dependency completeness independent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-classifier-mismatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "privacy-baseline.json");
  const latestRunPath = join(directory, "privacy-latest.json");
  const dependencyLatestRunPath = join(directory, "dependency-latest.json");
  await writeBaselineFile(baselinePath, [], {
    classifierConfiguration: { mode: "custom", id: "acme-classifiers-v1" },
  });
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath,
    latestRunPath,
    reportPath: false,
    dependencies: {
      baselinePath: false,
      latestRunPath: dependencyLatestRunPath,
      reportPath: false,
    },
    write: (message) => output.push(message),
  });
  const result = createEmptyPrivacySpecResult();
  result.classifierConfiguration = { mode: "custom", id: "acme-classifiers-v2" };
  reporter.onTestEnd(
    testCase,
    resultWith([attachmentWithResult(result), dependencyAttachmentWith([])]),
  );

  assert.equal(await reporter.onEnd({ status: "passed" }), undefined);
  assert.match(output.join(""), /privacy baseline comparison suppressed/u);
  const privacyLatest = await readLatestRunFile(latestRunPath);
  assert.equal(privacyLatest?.complete, true);
  assert.deepEqual(privacyLatest?.classifierConfiguration, {
    mode: "custom",
    id: "acme-classifiers-v2",
  });
  assert.equal((await readCompleteDependencyLatestRunFile(dependencyLatestRunPath)).complete, true);
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

test("reporter run-scope mode derives shard identity and emits only a baseline-ineligible part", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-part-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const finalReportPath = join(directory, "must-not-exist-report.json");
  const latestRunPath = join(directory, "must-not-exist-latest.json");
  const output = [];
  const reporter = new PrivacySpecReporter({
    reportPath: finalReportPath,
    latestRunPath,
    runScope: {
      runId: "ci-run-42",
      configurationId: "chromium-config-v1",
      outputDirectory: directory,
    },
    write: (message) => output.push(message),
  });
  reporter.onBegin({
    projects: [{ name: "chromium" }],
    shard: { current: 2, total: 3 },
  });
  reporter.onTestEnd(testCase, {
    ...resultWith([
      attachmentWithResult(createEmptyPrivacySpecResult()),
      emptyAnalyzerAttachment(
        DEPENDENCY_ATTACHMENT_NAME,
        DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
        "dependency",
      ),
      emptyAnalyzerAttachment(
        SECURITY_ATTACHMENT_NAME,
        SECURITY_ATTACHMENT_CONTENT_TYPE,
        "security",
      ),
      emptyAnalyzerAttachment(
        RUNTIME_FAILURE_ATTACHMENT_NAME,
        RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
        "runtime-failure",
      ),
    ]),
    duration: 25,
  });

  assert.equal(
    await reporter.onEnd({
      status: "passed",
      startTime: new Date("2026-08-23T12:00:00.000Z"),
      duration: 50,
    }),
    undefined,
  );
  const partPath = join(directory, "ci-run-42", "part-2-of-3.json");
  const part = await readPrivacySpecRunPart(partPath);
  assert.deepEqual(part.scope, {
    runId: "ci-run-42",
    configurationId: "chromium-config-v1",
    part: 2,
    total: 3,
    failOnNewReviewFindings: false,
    nis2EvidenceProfile: false,
  });
  assert.deepEqual(part.completeness, {
    privacy: true,
    dependencies: true,
    security: true,
    runtimeErrors: true,
  });
  assert.equal(part.report.run.complete, false);
  assert.equal(part.report.analysis.status, "inconclusive");
  assert.equal(part.report.baseline.resolved.length, 0);
  assert.match(output.join(""), /schema v3, 2\/3, baseline-ineligible/u);
  await assert.rejects(readFile(finalReportPath, "utf8"));
  await assert.rejects(readFile(latestRunPath, "utf8"));
});

test("reporter rejects explicit coordinates that disagree with Playwright sharding", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-mismatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reporter = new PrivacySpecReporter({
    runScope: {
      runId: "ci-run-42",
      configurationId: "chromium-config-v1",
      part: 1,
      total: 2,
      outputDirectory: directory,
    },
    write: () => {},
  });
  reporter.onBegin({ projects: [{ name: "chromium" }], shard: { current: 2, total: 2 } });
  assert.deepEqual(
    await reporter.onEnd({
      status: "passed",
      startTime: new Date("2026-08-23T12:00:00.000Z"),
      duration: 1,
    }),
    { status: "failed" },
  );
});

test("reporter disables colliding single-writer outputs for an unconfigured shard", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-reporter-unscoped-shard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = join(directory, "report.json");
  const latestRunPath = join(directory, "latest.json");
  const output = [];
  const reporter = new PrivacySpecReporter({
    baselinePath: false,
    reportPath,
    latestRunPath,
    dependencies: { baselinePath: false, reportPath: false, latestRunPath: false },
    security: { baselinePath: false, reportPath: false, latestRunPath: false },
    runtimeFailures: { baselinePath: false, reportPath: false, latestRunPath: false },
    write: (message) => output.push(message),
  });
  reporter.onBegin({ projects: [{ name: "chromium" }], shard: { current: 1, total: 2 } });
  reporter.onTestEnd(testCase, resultWith([attachmentWithResult(createEmptyPrivacySpecResult())]));
  assert.deepEqual(
    await reporter.onEnd({
      status: "passed",
      startTime: new Date("2026-08-23T12:00:00.000Z"),
      duration: 1,
    }),
    { status: "failed" },
  );
  assert.match(output.join(""), /sharding requires an explicit PrivacySpec runScope/u);
  await assert.rejects(readFile(reportPath, "utf8"));
  await assert.rejects(readFile(latestRunPath, "utf8"));
});
