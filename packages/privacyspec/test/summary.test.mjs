import assert from "node:assert/strict";
import test from "node:test";

import { compareBaseline } from "../dist/baseline/compare.js";
import { createPrivacySpecReport } from "../dist/report/model.js";
import { parsePrivacySpecReport, ReportFormatError } from "../dist/report/read.js";
import {
  MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES,
  MAX_SECONDARY_COVERAGE_TERMINAL_ITEMS,
  renderSecondaryCoverageMarkdown,
  renderSecondaryCoverageSummary,
} from "../dist/report/terminal.js";
import { evaluateDataFlows } from "../dist/rules/engine.js";

const GENERATED_AT = "2026-08-22T12:00:00.000Z";

const completeModules = ({ runtimeFindings = [] } = {}) => ({
  dependencies: {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    complete: true,
    coverage: "complete",
    inventory: [],
    findings: [],
    baseline: { exists: true, known: 2, new: 0, resolved: 1 },
    diagnostics: [],
  },
  security: {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    complete: true,
    coverage: "complete",
    inventory: [],
    findings: [],
    baseline: { exists: true, known: 3, changed: 0, newTargets: 0, resolved: 1 },
    diagnostics: [],
  },
  runtimeErrors: {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    complete: true,
    coverage: "complete",
    inventory: [],
    findings: runtimeFindings,
    baseline: { exists: true, known: 1, new: runtimeFindings.length, resolved: 1 },
    diagnostics: [],
  },
});

const flow = ({ category = "personal.email", rawTestTitle = "customer can be created" } = {}) => ({
  kind: "data-flow",
  dataCategory: category,
  sourceKind: "form-input",
  sourceConfidence: "high",
  sinkKind: "external-request",
  recipient: {
    origin: "https://analytics.example.test",
    host: "analytics.example.test",
    firstParty: false,
  },
  method: "POST",
  endpoint: "/collect",
  location: category === "secret.password" ? "json.password" : "json.email",
  transform: "EXACT",
  test: {
    file: "tests/customer.spec.ts",
    title: rawTestTitle,
    project: "chromium",
  },
});

const createReport = ({
  status = "pass",
  runtimeFindings = [],
  rawTestTitle,
  integrationErrors = [],
} = {}) => {
  const complete = status !== "inconclusive";
  const observedFlow =
    status === "review"
      ? flow({ rawTestTitle })
      : status === "fail"
        ? flow({ category: "secret.password", rawTestTitle })
        : undefined;
  const flows = observedFlow === undefined ? [] : [observedFlow];
  const findings = evaluateDataFlows(flows);
  return createPrivacySpecReport({
    generatedAt: GENERATED_AT,
    startedAt: "2026-08-22T11:59:59.000Z",
    playwrightStatus: complete ? "passed" : "failed",
    privacyspecStatus:
      status === "review"
        ? "review"
        : status === "fail"
          ? "failed"
          : complete
            ? "passed"
            : "incomplete",
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
    flows,
    findings,
    comparison: compareBaseline(findings, undefined),
    baselineExists: false,
    diagnostics: [],
    integrationErrors,
    ruleMappings: [],
    profileMappings: [],
    secondaryAnalysis: completeModules({ runtimeFindings }),
  });
};

const dependencyFinding = (index, value = `vendor-${index}.example.test`) => ({
  kind: "dependency-finding",
  ruleId: "NEW_EXTERNAL_SCRIPT",
  classification: "REVIEW_REQUIRED",
  identity: `dependency:external-script|${value}`,
  host: value,
  origin: `https://${value}`,
  observedAs: "script",
  firstSeenTest: { file: "tests/dependency.spec.ts", project: "chromium" },
});

test("terminal compatibility and Markdown expose every secondary status", () => {
  const pass = createReport();
  const terminal = renderSecondaryCoverageSummary(pass);
  assert.match(terminal, /^PrivacySpec Secondary Coverage\n\n/u);
  assert.match(terminal, /Functional tests\s+PASS\s+1\/1 passed; 1 observed/u);
  assert.match(terminal, /Observation coverage\s+COMPLETE/u);
  assert.match(terminal, /Secondary coverage\s+PASS/u);
  assert.match(terminal, /Privacy\s+PASS/u);
  assert.match(terminal, /Dependencies\s+PASS/u);
  assert.match(terminal, /Security\s+PASS/u);
  assert.match(terminal, /Runtime\s+PASS/u);
  assert.match(terminal, /No new secondary findings require action/u);
  assert.match(terminal, /Baseline tracking: 3\/4 modules configured/u);

  for (const status of ["pass", "review", "fail", "inconclusive"]) {
    const report = structuredClone(pass);
    report.analysis.status = status;
    report.analysis.privacy.status = status;
    report.analysis.dependencies.status = status;
    report.analysis.security.status = status;
    report.analysis.runtimeErrors.status = status;
    const markdown = renderSecondaryCoverageMarkdown(report);
    assert.match(
      markdown,
      new RegExp(`\\| Secondary coverage \\| ${status.toUpperCase()} \\|`, "u"),
    );
    for (const module of ["Privacy", "Dependencies", "Security", "Runtime"]) {
      assert.match(markdown, new RegExp(`\\| ${module} \\| ${status.toUpperCase()} \\|`, "u"));
    }
  }
});

test("terminal output globally prioritizes and caps actionable semantic groups", () => {
  const report = createReport({ status: "review" });
  const dependencyFindings = Array.from({ length: 7 }, (_, index) => dependencyFinding(index));
  report.analysis.dependencies.findings = [...dependencyFindings].reverse();
  report.analysis.dependencies.baseline.new = dependencyFindings.length;
  report.analysis.changes.dependencies = dependencyFindings.length;
  report.analysis.changes.total += dependencyFindings.length;
  report.coverage.observation.status = "partial";
  report.coverage.observation.diagnostics = [
    {
      code: "COVERAGE_OPTIONAL_OBSERVER_SKIPPED",
      message: "The optional observer skipped bounded work.",
    },
  ];

  const first = renderSecondaryCoverageSummary(report);
  report.analysis.dependencies.findings.reverse();
  const second = renderSecondaryCoverageSummary(report);

  assert.equal(first, second);
  assert.equal(MAX_SECONDARY_COVERAGE_TERMINAL_ITEMS, 5);
  assert.equal((first.match(/^ {2}(?:OBSERVATION|NEW)/gmu) ?? []).length, 5);
  assert.ok(
    first.indexOf("OBSERVATION COVERAGE_OPTIONAL") < first.indexOf("NEW runtime dependency"),
  );
  assert.doesNotMatch(first, /NEW external recipient/u);
  assert.match(first, /4 additional actionable groups omitted/u);
  assert.doesNotMatch(first, /customer can be created/u);
});

test("Markdown uses deterministic module ordering, item limits, and incomplete resolved counts", () => {
  const report = createReport({ status: "inconclusive" });
  const findings = Array.from({ length: 7 }, (_, index) => dependencyFinding(index));
  report.analysis.dependencies.findings = [...findings].reverse();
  report.analysis.dependencies.baseline.new = findings.length;
  report.analysis.changes.dependencies = findings.length;
  report.analysis.changes.total = findings.length;

  const first = renderSecondaryCoverageMarkdown(report);
  report.analysis.dependencies.findings.reverse();
  const second = renderSecondaryCoverageMarkdown(report);

  assert.equal(first, second);
  assert.ok(first.indexOf("| Privacy |") < first.indexOf("| Dependencies |"));
  assert.ok(first.indexOf("| Dependencies |") < first.indexOf("| Security |"));
  assert.ok(first.indexOf("| Security |") < first.indexOf("| Runtime |"));
  assert.equal((first.match(/NEW\\_EXTERNAL\\_SCRIPT/gu) ?? []).length, 5);
  assert.match(first, /- 2 additional items omitted\./u);
  for (const line of first
    .split("\n")
    .filter((entry) => /^\| (?:Privacy|Dependencies|Security|Runtime) \|/u.test(entry))) {
    assert.match(line, /\| — \|$/u);
  }
});

test("strict reports keep raw test evidence out and escape Markdown and HTML payloads", () => {
  const rawFixtureValue = "private.person@example.test";
  const payload = "<details open>|**review**_[link](target)";
  const report = createReport({
    status: "review",
    rawTestTitle: rawFixtureValue,
    integrationErrors: [`${rawFixtureValue}: invalid attachment`],
  });
  report.coverage.observation.diagnostics = [{ code: "COVERAGE_LIMIT_REACHED", message: payload }];
  const parsed = parsePrivacySpecReport(report);
  assert.equal(parsed.schemaVersion, 5);

  const markdown = renderSecondaryCoverageMarkdown(parsed);
  assert.doesNotMatch(markdown, /<details open>/u);
  assert.doesNotMatch(markdown, new RegExp(rawFixtureValue.replaceAll(".", "\\."), "u"));
  assert.match(markdown, /&lt;details open&gt;/u);
  assert.match(markdown, /\\\|\\\*\\\*review\\\*\\\*/u);

  const unsafe = structuredClone(report);
  unsafe.coverage.observation.diagnostics[0].message = "unsafe\nheading";
  assert.throws(() => parsePrivacySpecReport(unsafe), ReportFormatError);
});

test("Markdown keeps API-request findings distinct and labels their request surface", () => {
  const report = createReport({ status: "fail" });
  const [browserFinding] = report.findings;
  assert.ok(browserFinding);
  const apiFinding = structuredClone(browserFinding);
  apiFinding.finding.flow.requestSurface = "api-request";
  report.findings = [browserFinding, apiFinding];

  const markdown = renderSecondaryCoverageMarkdown(report);
  assert.equal((markdown.match(/TECHNICAL\\_FAILURE/gu) ?? []).length, 2);
  assert.equal((markdown.match(/surface: API request fixture/gu) ?? []).length, 1);
});

test("Markdown cap truncates only between complete items and states the omission", () => {
  const report = createReport();
  report.analysis.dependencies.findings = Array.from({ length: 7 }, (_, index) =>
    dependencyFinding(index, `${"x".repeat(20_000)}${index}.example.test`),
  );
  const markdown = renderSecondaryCoverageMarkdown(report);

  assert.ok(Buffer.byteLength(markdown, "utf8") <= MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES);
  assert.match(markdown, /Summary truncated at 64 KiB; additional complete items were omitted\./u);
  assert.equal(markdown.endsWith("\n"), true);
});
