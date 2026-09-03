import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const captureReporter = fileURLToPath(
  new URL("../fixtures/capture-privacyspec-reporter.mjs", import.meta.url),
);
const conformTestCli = fileURLToPath(
  new URL("../../../packages/privacyspec/dist/cli/index.js", import.meta.url),
);

const leakFlags = [
  "DEMO_LEAK_EMAIL_TO_ANALYTICS",
  "DEMO_LEAK_PHONE_TO_ANALYTICS",
  "DEMO_LEAK_EMAIL_IN_URL",
  "DEMO_LEAK_EMAIL_LOCALSTORAGE",
  "DEMO_LEAK_EMAIL_CONSOLE",
  "DEMO_LEAK_PASSWORD_EXTERNAL",
  "DEMO_LEAK_HASHED_EMAIL_EXTERNAL",
  "DEMO_LEAK_HTTP_EXTERNAL",
  "DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL",
];

const customerTest = {
  file: "customer.spec.ts",
  title: "customer can be created",
};
const loginTest = {
  file: "auth.spec.ts",
  title: "user can log in",
};

const cases = [
  {
    flag: "DEMO_LEAK_EMAIL_TO_ANALYTICS",
    test: customerTest,
    expectedRuleIds: ["PS1004"],
    flow: {
      dataCategory: "personal.email",
      sinkKind: "external-request",
      recipientOrigin: "http://127.0.0.1:4100",
      recipientHost: "127.0.0.1",
      firstParty: false,
      method: "POST",
      endpoint: "/event",
      location: "json.email",
      transform: "EXACT",
    },
  },
  {
    flag: "DEMO_LEAK_PHONE_TO_ANALYTICS",
    test: customerTest,
    expectedRuleIds: ["PS1004"],
    flow: {
      dataCategory: "personal.phone",
      sinkKind: "external-request",
      recipientOrigin: "http://127.0.0.1:4100",
      recipientHost: "127.0.0.1",
      firstParty: false,
      method: "POST",
      endpoint: "/event",
      location: "json.phone",
      transform: "EXACT",
    },
  },
  {
    flag: "DEMO_LEAK_EMAIL_IN_URL",
    test: customerTest,
    expectedRuleIds: ["PS1001"],
    flow: {
      dataCategory: "personal.email",
      sinkKind: "request-url",
      recipientOrigin: "http://localhost:3100",
      recipientHost: "localhost",
      firstParty: true,
      endpoint: "/customers",
      location: "url.query.selectedEmail",
      transform: "URL_ENCODED",
    },
  },
  {
    flag: "DEMO_LEAK_EMAIL_LOCALSTORAGE",
    test: customerTest,
    expectedRuleIds: ["PS1005"],
    flow: {
      dataCategory: "personal.email",
      sinkKind: "local-storage",
      location: "lastCustomerEmail",
      transform: "EXACT",
    },
  },
  {
    flag: "DEMO_LEAK_EMAIL_CONSOLE",
    test: customerTest,
    expectedRuleIds: ["PS1006"],
    flow: {
      dataCategory: "personal.email",
      sinkKind: "console",
      location: "console.argument.1",
      transform: "EXACT",
    },
  },
  {
    flag: "DEMO_LEAK_PASSWORD_EXTERNAL",
    test: loginTest,
    expectedRuleIds: ["PS1003"],
    flow: {
      dataCategory: "secret.password",
      sinkKind: "external-request",
      recipientOrigin: "http://127.0.0.1:4100",
      recipientHost: "127.0.0.1",
      firstParty: false,
      method: "POST",
      endpoint: "/event",
      location: "json.password",
      transform: "EXACT",
    },
  },
  {
    flag: "DEMO_LEAK_HASHED_EMAIL_EXTERNAL",
    test: customerTest,
    expectedRuleIds: ["PS1004"],
    flow: {
      dataCategory: "personal.email",
      sinkKind: "external-request",
      recipientOrigin: "http://127.0.0.1:4100",
      recipientHost: "127.0.0.1",
      firstParty: false,
      method: "POST",
      endpoint: "/event",
      location: "json.emailHash",
      transform: "SHA256_NORMALIZED",
    },
  },
  {
    flag: "DEMO_LEAK_HTTP_EXTERNAL",
    test: customerTest,
    expectedRuleIds: ["PS1002", "PS1004"],
    flow: {
      dataCategory: "personal.email",
      sinkKind: "external-request",
      recipientOrigin: "http://127.0.0.1:4200",
      recipientHost: "127.0.0.1",
      firstParty: false,
      method: "POST",
      endpoint: "/event",
      location: "json.email",
      transform: "EXACT",
    },
  },
  {
    flag: "DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL",
    test: customerTest,
    expectedRuleIds: ["PS1004"],
    flow: {
      dataCategory: "personal.email",
      sourceKind: "response-json",
      sourceOrigin: "http://localhost:3100",
      sourceEndpoint: "/api/customers/:number",
      sourceLocation: "json.email",
      sinkKind: "external-request",
      recipientOrigin: "http://127.0.0.1:4100",
      recipientHost: "127.0.0.1",
      firstParty: false,
      method: "POST",
      endpoint: "/event",
      location: "json.email",
      transform: "EXACT",
    },
  },
];

const assertNoSensitiveMaterial = (serialized, label) => {
  const email = /(?:Create|Login)-[a-z0-9-]+@example\.test/iu;
  const encodedEmail = /(?:Create|Login)-[a-z0-9-]+%40example\.test/iu;
  const password = /temporary-[a-z0-9-]+-credential/iu;
  const phone = /(?:\+|%2b)49170\d{9}/iu;

  assert.equal(email.test(serialized), false, `${label}: raw/case-shifted email was persisted`);
  assert.equal(encodedEmail.test(serialized), false, `${label}: URL-encoded email was persisted`);
  assert.equal(password.test(serialized), false, `${label}: raw password was persisted`);
  assert.equal(phone.test(serialized), false, `${label}: raw/URL-encoded phone was persisted`);
  assert.equal(
    /\b[a-f0-9]{64}\b/iu.test(serialized),
    false,
    `${label}: SHA-256 value was persisted`,
  );

  for (const [candidate] of serialized.matchAll(/[a-z0-9+/]{16,}={0,2}/giu)) {
    const decoded = Buffer.from(candidate, "base64").toString("utf8");
    assert.equal(email.test(decoded), false, `${label}: Base64 email was persisted`);
    assert.equal(password.test(decoded), false, `${label}: Base64 password was persisted`);
    assert.equal(/\+49170\d{9}/u.test(decoded), false, `${label}: Base64 phone was persisted`);
  }
};

const matchesExpectedFlow = (flow, expected, expectedTest) =>
  flow.kind === "data-flow" &&
  flow.dataCategory === expected.dataCategory &&
  (expected.sourceKind === undefined || flow.sourceKind === expected.sourceKind) &&
  (expected.sourceOrigin === undefined ||
    flow.sourceProvenance?.origin === expected.sourceOrigin) &&
  (expected.sourceEndpoint === undefined ||
    flow.sourceProvenance?.endpoint === expected.sourceEndpoint) &&
  (expected.sourceLocation === undefined ||
    flow.sourceProvenance?.location === expected.sourceLocation) &&
  flow.sinkKind === expected.sinkKind &&
  flow.location === expected.location &&
  flow.transform === expected.transform &&
  flow.test?.file === expectedTest.file &&
  flow.test?.title === expectedTest.title &&
  flow.test?.project === "chromium" &&
  flow.method === expected.method &&
  flow.endpoint === expected.endpoint &&
  flow.recipient?.origin === expected.recipientOrigin &&
  flow.recipient?.host === expected.recipientHost &&
  flow.recipient?.firstParty === expected.firstParty;

test("each demo leak produces its expected sanitized semantic flow and Phase 7 rules", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "privacyspec-phase6-flows-"));

  try {
    for (const [index, testCase] of cases.entries()) {
      const captureFile = join(temporaryDirectory, `capture-${index}.json`);
      const environment = {
        ...process.env,
        PRIVACYSPEC_CAPTURE_FILE: captureFile,
        NO_COLOR: "1",
      };
      delete environment.FORCE_COLOR;
      for (const flag of leakFlags) environment[flag] = "0";
      environment[testCase.flag] = "1";
      environment.PRIVACYSPEC_FIRST_PARTY_JSON_RESPONSES =
        testCase.flag === "DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL" ? "1" : "0";

      await execFileAsync(
        process.execPath,
        [
          playwrightCli,
          "test",
          testCase.test.file,
          `--grep=${testCase.test.title}`,
          "--workers=1",
          `--reporter=${captureReporter}`,
        ],
        {
          cwd: packageDirectory,
          env: environment,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 60_000,
        },
      );

      const captureText = await readFile(captureFile, "utf8");
      const capture = JSON.parse(captureText);
      assert.equal(capture.schemaVersion, 1, testCase.flag);
      assert.equal(capture.records.length, 1, testCase.flag);
      assert.equal(capture.records[0].status, "passed", testCase.flag);
      assert.equal(capture.records[0].title, testCase.test.title, testCase.flag);
      assert.equal(capture.records[0].result.schemaVersion, 5, testCase.flag);
      assert.equal(capture.records[0].result.testData.testDataSchemaVersion, 1, testCase.flag);
      assert.equal(capture.records[0].result.testData.observations.length > 0, true, testCase.flag);
      assert.equal(
        capture.records[0].result.testData.observations.every(
          (observation) =>
            observation.verdict === "SYNTHETIC" &&
            observation.signal === "IANA_RESERVED_EMAIL_DOMAIN" &&
            observation.category === "personal.email" &&
            observation.sourceKind === "form-input",
        ),
        true,
        testCase.flag,
      );
      assert.ok(Array.isArray(capture.records[0].result.observations), testCase.flag);
      assert.equal(
        capture.records[0].result.coverage.firstPartyJsonResponses.enabled,
        testCase.flag === "DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL",
        testCase.flag,
      );

      const serializedResult = JSON.stringify(capture.records[0].result);
      assertNoSensitiveMaterial(serializedResult, testCase.flag);

      const matchingFlows = capture.records[0].result.observations.filter((observation) =>
        matchesExpectedFlow(observation, testCase.flow, testCase.test),
      );
      assert.equal(
        matchingFlows.length,
        1,
        `${testCase.flag}: expected exactly one matching flow; observed ${JSON.stringify(
          capture.records[0].result.observations.filter(
            (observation) => observation.kind === "data-flow",
          ),
        )}`,
      );

      const matchingFindings = capture.records[0].result.observations.filter(
        (observation) =>
          observation.kind === "finding" &&
          matchesExpectedFlow(observation.flow, testCase.flow, testCase.test),
      );
      assert.deepEqual(
        matchingFindings.map(({ ruleId }) => ruleId),
        testCase.expectedRuleIds,
        `${testCase.flag}: unexpected rule mapping`,
      );
      for (const finding of matchingFindings) {
        assert.equal(
          finding.classification,
          finding.ruleId === "PS1001" || finding.ruleId === "PS1004" || finding.ruleId === "PS1005"
            ? "review_required"
            : "technical_failure",
          testCase.flag,
        );
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("semantic baseline lifecycle classifies unchanged, new, and resolved demo flows", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "privacyspec-phase8-baseline-"));
  const baselinePath = join(temporaryDirectory, "privacyspec-baseline.json");
  const latestRunPath = join(temporaryDirectory, "latest-run.json");
  const jsonReportPath = join(temporaryDirectory, "privacyspec-report.json");

  // This isolated acceptance baseline intentionally scopes itself to exactly
  // one ordinary customer test; production updates require the full chosen scope.
  const runCustomerTest = async (emailLeak) => {
    const environment = {
      ...process.env,
      PRIVACYSPEC_BASELINE_PATH: baselinePath,
      PRIVACYSPEC_LATEST_RUN_PATH: latestRunPath,
      PRIVACYSPEC_REPORT_PATH: jsonReportPath,
      NO_COLOR: "1",
    };
    delete environment.FORCE_COLOR;
    for (const flag of leakFlags) environment[flag] = "0";
    environment.DEMO_LEAK_EMAIL_TO_ANALYTICS = emailLeak ? "1" : "0";

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [playwrightCli, "test", customerTest.file, `--grep=${customerTest.title}`, "--workers=1"],
      {
        cwd: packageDirectory,
        env: environment,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 60_000,
      },
    );
    return `${stdout}\n${stderr}`;
  };

  const updateBaseline = async () => {
    const environment = { ...process.env, CI: "0", NO_COLOR: "1" };
    delete environment.FORCE_COLOR;
    await execFileAsync(
      process.execPath,
      [
        conformTestCli,
        "baseline",
        "update",
        "--baseline",
        baselinePath,
        "--report",
        latestRunPath,
        "--yes",
      ],
      { cwd: packageDirectory, env: environment, timeout: 10_000 },
    );
  };

  try {
    const cleanA = await runCustomerTest(false);
    assert.match(cleanA, /1 passed/u);
    const cleanLatest = JSON.parse(await readFile(latestRunPath, "utf8"));
    assert.equal(cleanLatest.complete, true);
    assert.deepEqual(cleanLatest.flows, []);
    const cleanReport = JSON.parse(await readFile(jsonReportPath, "utf8"));
    assert.equal(cleanReport.schemaVersion, 5);
    assert.equal(cleanReport.run.playwrightStatus, "passed");
    assert.equal(cleanReport.run.privacyspecStatus, "passed");
    assert.equal(cleanReport.run.tests.total, 1);
    assert.equal(cleanReport.run.tests.observed, 1);
    assert.equal(cleanReport.performance.suiteDurationMilliseconds > 0, true);
    assert.deepEqual(cleanReport.findings, []);
    assert.equal(cleanReport.analysis.status, "pass");
    assert.deepEqual(Object.keys(cleanReport.analysis).sort(), [
      "changes",
      "dependencies",
      "privacy",
      "runtimeErrors",
      "security",
      "status",
    ]);

    await updateBaseline();
    const cleanB = await runCustomerTest(false);
    assert.match(cleanB, /Privacy\s+PASS\s+0 changes; 3 flows/u);
    assert.match(cleanB, /Baseline tracking: 1\/4 modules configured/u);

    const leakC = await runCustomerTest(true);
    assert.match(leakC, /Privacy\s+REVIEW\s+1 change; 4 flows/u);
    assert.match(leakC, /NEW external recipient: personal\.email → external-request/u);
    assert.match(leakC, /PrivacySpec result: REVIEW \(functional tests=PASS/u);
    const leakLatestText = await readFile(latestRunPath, "utf8");
    const leakLatest = JSON.parse(leakLatestText);
    assert.equal(leakLatest.complete, true);
    assert.equal(leakLatest.flows.length, 1);
    assert.equal(leakLatest.flows[0].ruleId, "PS1004");
    assertNoSensitiveMaterial(leakLatestText, "latest run");
    const leakReportText = await readFile(jsonReportPath, "utf8");
    const leakReport = JSON.parse(leakReportText);
    assert.equal(leakReport.run.privacyspecStatus, "review");
    assert.equal(leakReport.findings[0].baselineState, "new");
    assert.equal(leakReport.findings[0].finding.flow.test.title, customerTest.title);
    assert.equal(
      leakReport.legalMappings.rules[0].technicalControls[0].requirementId,
      "v5.0.0-14.2.3",
    );
    assert.match(leakReport.legalMappings.rules[0].regulatoryRelevance[0].sourceUrl, /eur-lex/u);
    assertNoSensitiveMaterial(leakReportText, "JSON report");

    // Resolved means accepted-but-not-observed, so explicitly accept C before D.
    await updateBaseline();
    const leakRepeat = await runCustomerTest(true);
    assert.match(leakRepeat, /Privacy\s+PASS\s+0 changes; 4 flows/u);
    assert.doesNotMatch(leakRepeat, /NEW external recipient: personal\.email/u);
    const repeatReport = JSON.parse(await readFile(jsonReportPath, "utf8"));
    assert.equal(repeatReport.run.privacyspecStatus, "passed");
    assert.equal(repeatReport.findings[0].baselineState, "known");

    const cleanD = await runCustomerTest(false);
    assert.match(cleanD, /Privacy\s+PASS\s+0 changes; 3 flows/u);
    assert.match(cleanD, /No new secondary findings require action/u);
    const resolvedReport = JSON.parse(await readFile(jsonReportPath, "utf8"));
    assert.equal(resolvedReport.run.privacyspecStatus, "passed");
    assert.equal(resolvedReport.baseline.resolved.length, 1);
    assertNoSensitiveMaterial(await readFile(baselinePath, "utf8"), "baseline");

    const technicalEnvironment = {
      ...process.env,
      PRIVACYSPEC_BASELINE_PATH: baselinePath,
      PRIVACYSPEC_LATEST_RUN_PATH: latestRunPath,
      PRIVACYSPEC_REPORT_PATH: jsonReportPath,
      NO_COLOR: "1",
    };
    delete technicalEnvironment.FORCE_COLOR;
    for (const flag of leakFlags) technicalEnvironment[flag] = "0";
    technicalEnvironment.DEMO_LEAK_HTTP_EXTERNAL = "1";
    let technicalOutput = "";
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [playwrightCli, "test", customerTest.file, `--grep=${customerTest.title}`, "--workers=1"],
        {
          cwd: packageDirectory,
          env: technicalEnvironment,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 60_000,
        },
      ),
      (error) => {
        technicalOutput = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        return error.code === 1;
      },
    );
    assert.match(technicalOutput, /TECHNICAL_FAILURE PS1002:/u);
    assert.match(technicalOutput, /PrivacySpec result: FAIL \(functional tests=PASS/u);
    const technicalReportText = await readFile(jsonReportPath, "utf8");
    const technicalReport = JSON.parse(technicalReportText);
    assert.equal(technicalReport.run.playwrightStatus, "passed");
    assert.equal(technicalReport.run.privacyspecStatus, "failed");
    assert.equal(technicalReport.summary.findings.technicalFailures, 1);
    assert.equal(
      technicalReport.findings.some(
        ({ finding }) =>
          finding.ruleId === "PS1002" && finding.flow.test.title === customerTest.title,
      ),
      true,
    );
    assertNoSensitiveMaterial(technicalReportText, "technical JSON report");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
