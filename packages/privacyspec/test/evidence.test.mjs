import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compareBaseline, createBaselineFlowCandidate } from "../dist/baseline/compare.js";
import { createBaselineFile } from "../dist/baseline/write.js";
import { createPrivacySpecEvidence, validateEvidenceIdentifier } from "../dist/evidence/create.js";
import { EVIDENCE_SCHEMA_VERSION } from "../dist/evidence/model.js";
import { renderEvidenceMarkdown, renderPrivacySpecEvidence } from "../dist/evidence/render.js";
import { writeEvidenceOutput } from "../dist/evidence/write.js";
import { createPrivacySpecReport } from "../dist/report/model.js";
import { evaluateDataFlows } from "../dist/rules/engine.js";
import { REPORT_LEVEL_LEGAL_MAPPINGS, RULE_LEGAL_MAPPINGS } from "../dist/rules/legal-map.js";

const GENERATED_AT = "2026-08-20T12:00:00.000Z";
const EVIDENCE_AT = "2026-08-20T12:01:00.000Z";

const flow = (overrides = {}) => ({
  kind: "data-flow",
  dataCategory: "personal.email",
  sourceKind: "form-input",
  sourceConfidence: "high",
  sinkKind: "request-body",
  recipient: {
    origin: "https://app.example.test",
    host: "app.example.test",
    firstParty: true,
  },
  method: "POST",
  endpoint: "/api/customers",
  location: "json.email",
  transform: "EXACT",
  test: {
    file: "tests/customer.spec.ts",
    title: "customer can be created",
    project: "chromium",
  },
  ...overrides,
});

const createReport = ({ complete = true } = {}) => {
  const firstParty = flow();
  const externalRecipient = {
    origin: "https://analytics.example.test",
    host: "analytics.example.test",
    firstParty: false,
  };
  const knownEmail = flow({
    sinkKind: "external-request",
    recipient: externalRecipient,
    endpoint: "/known",
  });
  const newEmail = flow({
    sinkKind: "external-request",
    recipient: externalRecipient,
    endpoint: "/new",
  });
  const externalPassword = flow({
    dataCategory: "secret.password",
    sinkKind: "external-request",
    recipient: externalRecipient,
    endpoint: "/secret",
    location: "json.password",
    test: {
      file: "tests/auth.spec.ts",
      title: "user can log in",
      project: "chromium",
    },
  });
  const findings = evaluateDataFlows([knownEmail, newEmail, externalPassword]);
  const knownFinding = evaluateDataFlows([knownEmail])[0];
  const resolvedFinding = evaluateDataFlows([
    flow({
      dataCategory: "personal.phone",
      sinkKind: "external-request",
      recipient: externalRecipient,
      endpoint: "/resolved",
      location: "json.phone",
    }),
  ])[0];
  assert.ok(knownFinding);
  assert.ok(resolvedFinding);
  const known = createBaselineFlowCandidate(knownFinding);
  const resolved = createBaselineFlowCandidate(resolvedFinding);
  assert.ok(known);
  assert.ok(resolved);
  const baseline = createBaselineFile([known, resolved], { createdAt: GENERATED_AT });
  const comparison = compareBaseline(findings, baseline);

  return createPrivacySpecReport({
    generatedAt: GENERATED_AT,
    startedAt: "2026-08-20T11:59:00.000Z",
    playwrightStatus: complete ? "passed" : "failed",
    privacyspecStatus: complete ? "failed" : "incomplete",
    complete,
    projects: ["chromium"],
    tests: {
      total: 2,
      observed: 2,
      passed: complete ? 2 : 1,
      failed: complete ? 0 : 1,
      timedOut: 0,
      skipped: 0,
      interrupted: 0,
    },
    sourceCounts: new Map([
      ["personal.email", 2],
      ["secret.password", 1],
    ]),
    sinkCounts: new Map([["network", 4]]),
    suiteDurationMilliseconds: 1_000,
    cumulativeTestDurationMilliseconds: 500,
    flows: [firstParty, knownEmail, newEmail, externalPassword],
    findings,
    comparison,
    baselineExists: true,
    diagnostics: [{ code: "PS_TEST_LIMIT", message: "A sanitized coverage limit was reached." }],
    integrationErrors: [],
    ruleMappings: [RULE_LEGAL_MAPPINGS.PS1003, RULE_LEGAL_MAPPINGS.PS1004],
    profileMappings: [REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690],
    testDataObservations: [
      {
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
      },
    ],
  });
};

test("evidence emits deterministic audit-supporting technical observations and mappings", () => {
  const evidence = createPrivacySpecEvidence(createReport(), {
    generatedAt: EVIDENCE_AT,
    commit: "6d7a6b0",
    buildId: "ci-1701",
  });

  assert.equal(evidence.evidenceSchemaVersion, EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.evidenceKind, "AUDIT_SUPPORTING_TECHNICAL_EVIDENCE");
  assert.deepEqual(evidence.build, { commit: "6d7a6b0", buildId: "ci-1701" });
  assert.equal(evidence.execution.evidenceGeneratedAt, EVIDENCE_AT);
  assert.equal(evidence.execution.sourceRunState, "COMPLETE");
  assert.equal(evidence.scope.projectCount, 1);
  assert.deepEqual(
    evidence.observations.categories.map((item) => [
      item.category,
      item.sourceObservations,
      item.flowOccurrences,
    ]),
    [
      ["personal.email", 2, 3],
      ["secret.password", 1, 1],
    ],
  );
  assert.deepEqual(evidence.observations.externalRecipients, [
    {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      flowOccurrences: 3,
      categories: ["personal.email", "secret.password"],
    },
  ]);
  assert.deepEqual(evidence.observations.baselineReview, {
    exists: true,
    known: 1,
    new: 1,
    resolved: 1,
    resolvedStatus: "CONCLUSIVE",
  });
  assert.equal(evidence.observations.findingOccurrences.technicalFailures, 1);
  assert.equal(evidence.observations.findingOccurrences.reviewRequired, 2);
  assert.equal(evidence.coverage.diagnosticCount, 1);
  assert.equal(evidence.observations.testDataHygiene.reviewRequired, 1);
  assert.deepEqual(
    evidence.technicalRelevance.map((item) => item.ruleId),
    ["PS1003", "PS1004"],
  );
  assert.deepEqual(
    evidence.regulatoryRelevance.rules.map((item) => item.ruleId),
    ["PS1003", "PS1004"],
  );
  assert.equal(evidence.regulatoryRelevance.reportLevel[0].profileId, "nis2_2024_2690");

  const json = renderPrivacySpecEvidence(evidence, "json");
  const markdown = renderPrivacySpecEvidence(evidence, "markdown");
  assert.equal(json, renderPrivacySpecEvidence(evidence, "json"));
  assert.equal(markdown, renderEvidenceMarkdown(evidence));
  assert.match(markdown, /## 1\. Observed technical facts/u);
  assert.match(markdown, /## 3\. Technical-control relevance/u);
  assert.match(markdown, /## 4\. Regulatory relevance/u);
  assert.ok(
    markdown.indexOf("Observed technical facts") <
      markdown.indexOf("Technical-control relevance") &&
      markdown.indexOf("Technical-control relevance") < markdown.indexOf("Regulatory relevance"),
  );
  assert.doesNotMatch(
    `${json}${markdown}`,
    /audit[- ]ready|certif(?:ied|ication)|\bcompliant\b|non-compliant/iu,
  );
});

test("incomplete evidence prominently marks absence and suppresses resolved conclusions", () => {
  const evidence = createPrivacySpecEvidence(createReport({ complete: false }), {
    generatedAt: EVIDENCE_AT,
  });
  assert.equal(evidence.execution.sourceRunState, "INCOMPLETE");
  assert.equal(evidence.observations.baselineReview.resolved, null);
  assert.equal(evidence.observations.baselineReview.resolvedStatus, "INCONCLUSIVE");
  assert.match(evidence.limitations.coverage[0], /^INCOMPLETE SOURCE RUN/u);
  const markdown = renderEvidenceMarkdown(evidence);
  assert.match(markdown, /\*\*INCOMPLETE SOURCE RUN/u);
  assert.match(markdown, /resolved inconclusive/u);
  assert.doesNotMatch(markdown, /1 resolved/u);
  assert.match(markdown, /No build identifiers were supplied/u);
});

test("legacy reports expose unavailable response and hygiene coverage without inference", () => {
  const { coverage: _coverage, testData: _testData, ...common } = createReport();
  const evidence = createPrivacySpecEvidence(
    { ...common, schemaVersion: 1 },
    { generatedAt: EVIDENCE_AT },
  );
  assert.deepEqual(evidence.coverage.firstPartyJsonResponses, { available: false });
  assert.deepEqual(evidence.observations.testDataHygiene, {
    available: false,
    total: null,
    synthetic: null,
    reviewRequired: null,
    unassessed: null,
  });
  assert.match(evidence.limitations.coverage.join("\n"), /predates schema-v2/u);
});

test("evidence whitelists mappings and never echoes rejected build identifiers", () => {
  const report = createReport();
  report.legalMappings.rules.push({
    ruleId: "PS1004",
    observationRule: "invalid mapping",
    technicalControls: [],
    regulatoryRelevance: [],
    limitations: [],
    raw: "private-fixture@example.test",
  });
  const evidence = createPrivacySpecEvidence(report, { generatedAt: EVIDENCE_AT });
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /private-fixture|"raw"/u);
  assert.equal(
    evidence.technicalRelevance.find((item) => item.ruleId === "PS1004")?.controls.length,
    1,
  );
  assert.match(evidence.limitations.coverage.join("\n"), /1 malformed or duplicate/u);

  for (const value of ["private@example.test", "../secret", "a".repeat(129)]) {
    assert.throws(
      () => validateEvidenceIdentifier(value, "build ID"),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(value.slice(0, 12), "u"));
        return /build ID is invalid/u.test(error.message);
      },
    );
  }
});

test("evidence output is atomic, private, and contains no raw source fields", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-evidence-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "evidence.json");
  const evidence = createPrivacySpecEvidence(createReport(), {
    generatedAt: EVIDENCE_AT,
    commit: "6d7a6b0",
  });
  const output = renderPrivacySpecEvidence(evidence, "json");
  await writeEvidenceOutput(path, output);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await readFile(path, "utf8"), output);
  assert.doesNotMatch(output, /"(?:raw|value|payload|domain)"\s*:/u);
  assert.doesNotMatch(output, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
});
