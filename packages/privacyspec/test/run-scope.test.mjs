import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeFailureKey } from "../dist/analyzers/runtime-failure/analyzer.js";
import { createSecurityTargetKey } from "../dist/analyzers/security/analyzer.js";
import { compareBaseline } from "../dist/baseline/compare.js";
import { readBaselineProposalFile } from "../dist/baseline/proposal.js";
import { runCli } from "../dist/cli/run.js";
import { createPrivacySpecReport } from "../dist/report/model.js";
import { readPrivacySpecReport } from "../dist/report/read.js";
import { aggregatePrivacySpecRunParts, RunAggregationError } from "../dist/run-scope/aggregate.js";
import {
  parsePrivacySpecRunPart,
  RunPartFormatError,
  readPrivacySpecRunPart,
  writePrivacySpecRunPart,
} from "../dist/run-scope/artifact.js";

const observationCoverage = (tests) => ({
  status: "complete",
  tests: { attempts: tests, observed: tests },
  browserObjects: { seen: tests },
  contexts: { seen: tests, instrumented: tests },
  pages: { seen: tests, instrumented: tests, storageCapable: 0 },
  events: { navigations: tests, network: tests, console: 0 },
  diagnostics: [],
});

const privacyFinding = (part) => ({
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
    endpoint: "/events",
    location: "json.email",
    transform: "EXACT",
    test: {
      file: `tests/part-${part}.spec.ts`,
      title: `part ${part} journey`,
      project: "chromium",
    },
  },
  limitations: ["The processing context requires review."],
});

const dependencyEntry = (part) => ({
  kind: "runtime-dependency",
  origin: "https://cdn.vendor.test",
  host: "cdn.vendor.test",
  boundary: "external",
  resourceTypes: [part === 1 ? "script" : "fetch/xhr"],
  requestMethods: [part === 1 ? "GET" : "POST"],
  firstSeenTests: [{ file: `tests/part-${part}.spec.ts`, project: "chromium" }],
  occurrenceCount: part,
});

const securityEntry = (part) => {
  const input = {
    host: "app.example.test",
    endpoint: "/account",
    responseKind: "document",
    method: "GET",
  };
  return {
    kind: "security-posture",
    key: createSecurityTargetKey(input),
    ...input,
    fingerprints: [
      {
        transport: "secure",
        csp: part === 1 ? "present:sha256:aaaaaaaaaaaaaaaa" : "missing",
        hsts: "max-age=31536000;includeSubDomains=true;preload=false",
        xContentTypeOptions: "nosniff",
        cors: "missing",
        cookies: [],
      },
    ],
    firstSeenTests: [{ file: `tests/part-${part}.spec.ts`, project: "chromium" }],
    occurrenceCount: 1,
  };
};

const runtimeEntry = (part) => {
  const details = {
    boundary: "first-party",
    host: "app.example.test",
    method: "GET",
    endpoint: "/api/account",
    httpStatus: 500,
    errorName: null,
    signature: null,
    failureCode: null,
  };
  return {
    kind: "runtime-failure",
    key: createRuntimeFailureKey({ failureType: "http-5xx", details }),
    failureType: "http-5xx",
    severity: "ERROR",
    summary: "First-party HTTP 500",
    ...details,
    firstSeenTests: [{ file: `tests/part-${part}.spec.ts`, project: "chromium" }],
    occurrenceCount: 1,
  };
};

const createPart = ({
  part = 1,
  total = 1,
  tests = 1,
  runId = "run-1",
  configurationId = "config-1",
  projects = ["chromium"],
  observations = false,
  playwrightStatus = "passed",
} = {}) => {
  const findings = [];
  const flows = observations ? [privacyFinding(part).flow] : [];
  const rawComparison = compareBaseline(findings, undefined);
  const generatedAt = `2026-08-23T12:00:0${part}.000Z`;
  const dependencyInventory = observations ? [dependencyEntry(part)] : [];
  const securityInventory = observations ? [securityEntry(part)] : [];
  const runtimeInventory = observations && part === 1 ? [runtimeEntry(part)] : [];
  const report = createPrivacySpecReport({
    generatedAt,
    startedAt: `2026-08-23T12:00:0${part - 1}.000Z`,
    playwrightStatus,
    privacyspecStatus: "incomplete",
    complete: false,
    projects,
    tests: {
      total: tests,
      observed: tests,
      passed: playwrightStatus === "passed" ? tests : 0,
      failed: playwrightStatus === "failed" ? tests : 0,
      timedOut: playwrightStatus === "timedout" ? tests : 0,
      skipped: 0,
      interrupted: playwrightStatus === "interrupted" ? tests : 0,
    },
    sourceCounts: new Map(observations ? [["personal.email", part]] : []),
    sinkCounts: new Map(observations ? [["network", part]] : []),
    suiteDurationMilliseconds: 1_000,
    cumulativeTestDurationMilliseconds: tests * 500,
    flows,
    findings,
    comparison: { observed: rawComparison.observed, known: [], new: [], resolved: [] },
    baselineExists: false,
    diagnostics: [],
    integrationErrors: [],
    ruleMappings: [],
    profileMappings: [],
    observationCoverage: observationCoverage(tests),
    secondaryAnalysis: {
      dependencies: {
        schemaVersion: 1,
        generatedAt,
        complete: false,
        coverage: "complete",
        inventory: dependencyInventory,
        findings: [],
        baseline: { exists: false, known: 0, new: 0, resolved: 0 },
        diagnostics: [],
      },
      security: {
        schemaVersion: 1,
        generatedAt,
        complete: false,
        coverage: "complete",
        inventory: securityInventory,
        findings: [],
        baseline: { exists: false, known: 0, changed: 0, newTargets: 0, resolved: 0 },
        diagnostics: [],
      },
      runtimeErrors: {
        schemaVersion: 1,
        generatedAt,
        complete: false,
        coverage: "complete",
        inventory: runtimeInventory,
        findings: [],
        baseline: { exists: false, known: 0, new: 0, resolved: 0 },
        diagnostics: [],
      },
    },
  });
  return parsePrivacySpecRunPart({
    runPartSchemaVersion: 3,
    classifierConfiguration: { mode: "builtin-only" },
    scope: {
      runId,
      configurationId,
      part,
      total,
      failOnNewReviewFindings: false,
      nis2EvidenceProfile: false,
    },
    completeness: {
      privacy: playwrightStatus === "passed",
      dependencies: playwrightStatus === "passed",
      security: playwrightStatus === "passed",
      runtimeErrors: playwrightStatus === "passed",
    },
    report,
  });
};

const asLegacyPart = (part) => {
  const copy = structuredClone(part);
  copy.runPartSchemaVersion = 1;
  delete copy.classifierConfiguration;
  copy.report.schemaVersion = 4;
  delete copy.report.coverage.browserEngines;
  delete copy.report.coverage.apiRequests;
  for (const flow of copy.report.flows) delete flow.requestSurface;
  for (const entry of copy.report.findings) delete entry.finding.flow.requestSurface;
  for (const group of [...copy.report.baseline.known, ...copy.report.baseline.new]) {
    for (const finding of group.findings) delete finding.flow.requestSurface;
  }
  return parsePrivacySpecRunPart(copy);
};

const asLegacyV2Part = (part) => {
  const copy = structuredClone(part);
  copy.runPartSchemaVersion = 2;
  delete copy.classifierConfiguration;
  return parsePrivacySpecRunPart(copy);
};

const acceptedPrivacyBaseline = {
  schemaVersion: 1,
  createdAt: "2026-08-23T10:00:00.000Z",
  flows: [
    {
      key: '["PS1004","personal.email","external-request","https://old.example.test","/events","json.email","EXACT"]',
      ruleId: "PS1004",
      dataCategory: "personal.email",
      sinkKind: "external-request",
      recipient: "https://old.example.test",
      endpoint: "/events",
      location: "json.email",
      transform: "EXACT",
      status: "accepted",
    },
  ],
};

test("complete ordinary and sharded sets aggregate canonically across input permutations", () => {
  const ordinary = aggregatePrivacySpecRunParts([createPart()]);
  assert.equal(ordinary.scope.complete, true);
  assert.equal(ordinary.report.analysis.status, "pass");
  assert.equal(ordinary.report.run.complete, true);

  const first = createPart({ part: 1, total: 2, observations: true });
  const second = createPart({ part: 2, total: 2, observations: true });
  const forward = aggregatePrivacySpecRunParts([first, second]);
  const reverse = aggregatePrivacySpecRunParts([second, first]);
  assert.deepEqual(reverse, forward);
  assert.equal(forward.scope.complete, true);
  assert.equal(forward.report.run.tests.total, 2);
  assert.equal(forward.report.analysis.dependencies.inventory[0].occurrenceCount, 3);
  assert.equal(forward.report.analysis.security.inventory[0].fingerprints.length, 2);
  assert.equal(forward.report.analysis.runtimeErrors.inventory.length, 1);
  assert.equal(forward.report.analysis.status, "fail");

  const partialWithBaselines = aggregatePrivacySpecRunParts([first], {
    dependencies: {
      schemaVersion: 1,
      createdAt: "2026-08-23T10:00:00.000Z",
      dependencies: forward.latestRuns.dependencies.entries.map((entry) => ({
        ...entry,
        status: "accepted",
      })),
    },
    security: {
      schemaVersion: 1,
      createdAt: "2026-08-23T10:00:00.000Z",
      entries: forward.latestRuns.security.entries,
    },
    runtimeErrors: {
      schemaVersion: 1,
      createdAt: "2026-08-23T10:00:00.000Z",
      entries: forward.latestRuns.runtimeErrors.entries,
    },
  });
  assert.deepEqual(partialWithBaselines.report.analysis.dependencies.baseline, {
    exists: true,
    known: 0,
    new: 0,
    resolved: 0,
  });
  assert.deepEqual(partialWithBaselines.report.analysis.security.baseline, {
    exists: true,
    known: 0,
    changed: 0,
    newTargets: 0,
    resolved: 0,
  });
  assert.deepEqual(partialWithBaselines.report.analysis.runtimeErrors.baseline, {
    exists: true,
    known: 0,
    new: 0,
    resolved: 0,
  });
  assert.equal(partialWithBaselines.report.analysis.dependencies.findings.length, 0);
  assert.equal(partialWithBaselines.report.analysis.security.findings.length, 0);
  assert.equal(partialWithBaselines.report.analysis.runtimeErrors.findings.length, 0);
});

test("missing scope and zero-test parts stay honest and never resolve a baseline", () => {
  const first = createPart({ part: 1, total: 2 });
  const partial = aggregatePrivacySpecRunParts([first], { privacy: acceptedPrivacyBaseline });
  assert.equal(partial.scope.complete, false);
  assert.deepEqual(partial.scope.missingParts, [2]);
  assert.equal(partial.report.analysis.status, "inconclusive");
  assert.equal(partial.report.baseline.resolved.length, 0);
  assert.equal(partial.latestRuns.privacy.complete, false);
  assert.match(JSON.stringify(partial.report.diagnostics), /PS_RUN_SCOPE_INCOMPLETE/u);

  const zero = createPart({ part: 2, total: 2, tests: 0 });
  const complete = aggregatePrivacySpecRunParts([first, zero]);
  assert.equal(complete.scope.complete, true);
  assert.equal(complete.report.analysis.status, "pass");
  assert.equal(complete.report.run.tests.total, 1);
  assert.deepEqual(complete.latestRuns.privacy.classifierConfiguration, {
    mode: "builtin-only",
  });
});

test("interrupted process evidence keeps a complete coordinate set functionally inconclusive", () => {
  const interrupted = aggregatePrivacySpecRunParts([
    createPart({ playwrightStatus: "interrupted" }),
  ]);
  assert.equal(interrupted.scope.complete, true);
  assert.equal(interrupted.report.run.playwrightStatus, "interrupted");
  assert.equal(interrupted.report.run.complete, false);
  assert.equal(interrupted.report.analysis.status, "inconclusive");
  assert.equal(interrupted.latestRuns.runtimeErrors.complete, false);
});

test("duplicate and mismatched part identities are integration errors", () => {
  const first = createPart({ part: 1, total: 2 });
  assert.throws(
    () => aggregatePrivacySpecRunParts([first, structuredClone(first)]),
    RunAggregationError,
  );
  assert.throws(
    () =>
      aggregatePrivacySpecRunParts([
        first,
        createPart({ part: 2, total: 2, runId: "different-run" }),
      ]),
    /mismatched run configuration/u,
  );
  assert.throws(
    () =>
      aggregatePrivacySpecRunParts([
        first,
        createPart({ part: 2, total: 2, projects: ["firefox"] }),
      ]),
    /mismatched Playwright projects/u,
  );
  assert.throws(
    () => aggregatePrivacySpecRunParts(Array.from({ length: 129 }, () => first)),
    /at most 128 parts/u,
  );
  assert.throws(
    () => aggregatePrivacySpecRunParts([first, asLegacyPart(createPart({ part: 2, total: 2 }))]),
    /mixed schema versions/u,
  );
  assert.throws(
    () => aggregatePrivacySpecRunParts([first, asLegacyV2Part(createPart({ part: 2, total: 2 }))]),
    /mixed schema versions/u,
  );
  assert.throws(
    () =>
      aggregatePrivacySpecRunParts(
        [first, createPart({ part: 2, total: 2 })].map((part, index) =>
          index === 0
            ? part
            : {
                ...part,
                classifierConfiguration: { mode: "custom", id: "acme-classifiers-v1" },
              },
        ),
      ),
    /classifier configuration/u,
  );
  const unavailableZero = createPart({ part: 2, total: 2, tests: 0 });
  unavailableZero.classifierConfiguration = { mode: "unavailable" };
  assert.throws(
    () => aggregatePrivacySpecRunParts([first, unavailableZero]),
    /classifier configuration/u,
  );
});

test("legacy v1/v2 run parts remain readable but privacy classifier state is unavailable", () => {
  for (const legacy of [asLegacyPart(createPart()), asLegacyV2Part(createPart())]) {
    const aggregate = aggregatePrivacySpecRunParts([legacy]);
    assert.equal(aggregate.report.schemaVersion, 5);
    assert.equal(aggregate.report.run.complete, false);
    assert.equal(aggregate.report.analysis.privacy.complete, false);
    assert.equal(aggregate.report.analysis.status, "inconclusive");
    assert.equal(aggregate.latestRuns.privacy.complete, false);
    assert.deepEqual(aggregate.latestRuns.privacy.classifierConfiguration, {
      mode: "unavailable",
    });
    assert.match(JSON.stringify(aggregate.report.diagnostics), /CLASSIFIER_CONFIGURATION/u);
    if (legacy.runPartSchemaVersion === 1) {
      assert.equal(aggregate.report.coverage.browserEngines.tests.unavailable, 1);
      assert.equal(aggregate.report.coverage.apiRequests.tests.unavailable, 1);
      assert.match(
        JSON.stringify(aggregate.report.coverage.observation.diagnostics),
        /Legacy run parts/u,
      );
    }
  }
});

test("checked aggregate counters saturate and make bounded omissions inconclusive", () => {
  const first = createPart({ part: 1, total: 2 });
  const second = createPart({ part: 2, total: 2 });
  for (const part of [first, second]) {
    part.report.summary.sensitiveSources = {
      total: Number.MAX_SAFE_INTEGER,
      byName: { "personal.email": Number.MAX_SAFE_INTEGER },
    };
    part.report.analysis.privacy.summary = structuredClone(part.report.summary);
  }
  const aggregate = aggregatePrivacySpecRunParts([first, second]);
  assert.equal(aggregate.report.summary.sensitiveSources.total, Number.MAX_SAFE_INTEGER);
  assert.equal(aggregate.report.analysis.status, "inconclusive");
  assert.match(JSON.stringify(aggregate.report.diagnostics), /PS_AGGREGATE_LIMIT_REACHED/u);
});

test("strict part parsing rejects unknown, unsupported, conclusive, and hostile payloads", () => {
  const valid = createPart();
  assert.throws(() => parsePrivacySpecRunPart({ ...valid, unknown: true }), RunPartFormatError);
  assert.throws(
    () => parsePrivacySpecRunPart({ ...valid, runPartSchemaVersion: 1 }),
    RunPartFormatError,
  );
  assert.throws(
    () => parsePrivacySpecRunPart({ ...valid, runPartSchemaVersion: 4 }),
    RunPartFormatError,
  );
  const conclusive = structuredClone(valid);
  conclusive.report.run.complete = true;
  assert.throws(() => parsePrivacySpecRunPart(conclusive), RunPartFormatError);
  const control = structuredClone(valid);
  control.scope.runId = "run\nmarkdown";
  assert.throws(() => parsePrivacySpecRunPart(control), RunPartFormatError);
  const raw = structuredClone(valid);
  raw.report.diagnostics.push({
    code: "PS_TEST",
    message: "private.person@example.test",
  });
  assert.throws(() => parsePrivacySpecRunPart(raw), /prohibited raw data/u);
  for (const payload of [
    "+491701234567",
    "https://app.example.test/path?access_token=private",
    "password=CorrectHorseBatteryStaple",
  ]) {
    const injected = structuredClone(valid);
    injected.report.diagnostics.push({ code: "PS_TEST", message: payload });
    assert.throws(() => parsePrivacySpecRunPart(injected), /prohibited raw data/u);
  }
});

test("run-part writes are private, create-only, and reject symlinks", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-run-part-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "part-1.json");
  const part = createPart();
  await writePrivacySpecRunPart(path, part);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readPrivacySpecRunPart(path), part);
  await assert.rejects(writePrivacySpecRunPart(path, part), /identity already exists/u);

  const target = join(directory, "target.json");
  await writeFile(target, "{}\n", "utf8");
  const linked = join(directory, "linked.json");
  await symlink(target, linked);
  await assert.rejects(readPrivacySpecRunPart(linked), /symbolic links/u);
});

test("aggregate CLI distinguishes valid inconclusive scope from parser failure", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-aggregate-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const firstPath = join(directory, "part-1.json");
  const secondPath = join(directory, "part-2.json");
  await writePrivacySpecRunPart(firstPath, createPart({ part: 1, total: 2 }));
  await writePrivacySpecRunPart(secondPath, createPart({ part: 2, total: 2 }));
  const stdout = [];
  const stderr = [];
  const partialExit = await runCli(["aggregate", "--part", firstPath], {
    cwd: directory,
    writeOut: (message) => stdout.push(message),
    writeError: (message) => stderr.push(message),
  });
  assert.equal(partialExit, 0, stderr.join(""));
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /INCONCLUSIVE \(parts=1\/2, missing=1\)/u);
  assert.equal(
    (await readPrivacySpecReport(join(directory, "privacyspec-report.json"))).run.complete,
    false,
  );
  for (const latest of [
    "latest-run.json",
    "latest-dependencies.json",
    "latest-security.json",
    "latest-runtime-failures.json",
  ]) {
    assert.equal(
      JSON.parse(await readFile(join(directory, ".privacyspec", latest), "utf8")).complete,
      false,
    );
  }
  const partialProposalErrors = [];
  const partialProposal = await runCli(["baseline", "propose"], {
    cwd: directory,
    writeOut: () => {},
    writeError: (message) => partialProposalErrors.push(message),
  });
  assert.equal(partialProposal, 1);
  assert.match(partialProposalErrors.join(""), /incomplete/u);

  stdout.length = 0;
  const completeExit = await runCli(["aggregate", "--part", secondPath, "--part", firstPath], {
    cwd: directory,
    writeOut: (message) => stdout.push(message),
    writeError: (message) => stderr.push(message),
  });
  assert.equal(completeExit, 0);
  assert.match(stdout.join(""), /PASS \(parts=2\/2, missing=0\)/u);
  assert.equal((await stat(join(directory, "privacyspec-report.json"))).mode & 0o777, 0o600);
  for (const latest of [
    "latest-run.json",
    "latest-dependencies.json",
    "latest-security.json",
    "latest-runtime-failures.json",
  ]) {
    assert.equal(
      JSON.parse(await readFile(join(directory, ".privacyspec", latest), "utf8")).complete,
      true,
    );
  }
  const completeProposal = await runCli(["baseline", "propose"], {
    cwd: directory,
    writeOut: () => {},
    writeError: (message) => stderr.push(message),
  });
  assert.equal(completeProposal, 0);
  assert.equal(
    (await readBaselineProposalFile(join(directory, ".privacyspec", "baseline-proposal.json")))
      .module,
    "privacy",
  );

  await mkdir(join(directory, "blocked-report"));
  const outputFailure = await runCli(
    ["aggregate", "--part", firstPath, "--part", secondPath, "--report", "blocked-report"],
    { cwd: directory, writeOut: () => {}, writeError: () => {} },
  );
  assert.equal(outputFailure, 1);
  assert.equal(
    JSON.parse(await readFile(join(directory, ".privacyspec", "latest-run.json"), "utf8")).complete,
    false,
  );
  for (const latest of [
    "latest-dependencies.json",
    "latest-security.json",
    "latest-runtime-failures.json",
  ]) {
    await assert.rejects(readFile(join(directory, ".privacyspec", latest), "utf8"));
  }

  await writeFile(firstPath, '{"runPartSchemaVersion":99}\n', "utf8");
  const invalidOutput = [];
  const invalidExit = await runCli(["aggregate", "--part", firstPath], {
    cwd: directory,
    writeOut: () => {},
    writeError: (message) => invalidOutput.push(message),
  });
  assert.equal(invalidExit, 1);
  assert.match(invalidOutput.join(""), /Invalid or unsupported PrivacySpec run-part schema/u);
  await assert.rejects(readFile(join(directory, "privacyspec-report.json"), "utf8"));
});
