import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  leastCompleteDependencyCoverage,
  mergeDependencyInventory,
  sortedDependencyInventory,
} from "../dist/analyzers/dependency/aggregate.js";
import {
  classifyDependencyResource,
  DependencyRuntimeAnalyzer,
  normalizeDependencyMethod,
  normalizeDependencyTarget,
  sanitizeDependencyTestReference,
} from "../dist/analyzers/dependency/analyzer.js";
import {
  createDependencyAttachment,
  MAX_DEPENDENCY_ARTIFACT_BYTES,
  parseDependencyAttachment,
  parseDependencyReport,
  readCompleteDependencyLatestRunFile,
  readDependencyBaselineFile,
  readDependencyReport,
  writeDependencyBaselineFile,
  writeDependencyLatestRunFile,
  writeDependencyReport,
} from "../dist/analyzers/dependency/artifact.js";
import {
  compareDependencyBaseline,
  createDependencySemanticCandidates,
  createDependencySemanticKey,
  parseDependencyBaseline,
  parseDependencyLatestRun,
} from "../dist/analyzers/dependency/baseline.js";
import { createResponseJsonCoverage } from "../dist/discovery/response-json.js";
import { AnalyzerHost } from "../dist/runtime/analyzer.js";
import { createRuntimeCapabilityModel } from "../dist/runtime/capabilities.js";
import { RuntimeEventMetadataFactory } from "../dist/runtime/events.js";

const observationCoverage = {
  browserObjects: { seen: 1 },
  contexts: { seen: 1, instrumented: 1 },
  pages: { seen: 1, instrumented: 1, storageCapable: 1 },
  events: { navigations: 1, network: 1, console: 0 },
};

const capabilities = createRuntimeCapabilityModel({
  observation: observationCoverage,
  responseJson: createResponseJsonCoverage(false),
  observerWorkFailed: false,
});

const testMetadata = {
  testId: "dependency-test",
  file: "tests/checkout.spec.ts",
  title: "checkout works",
  projectName: "chromium",
};

const inventoryEntry = (overrides = {}) => ({
  kind: "runtime-dependency",
  origin: "https://cdn.vendor.test",
  host: "cdn.vendor.test",
  boundary: "external",
  resourceTypes: ["fetch/xhr", "script"],
  requestMethods: ["GET", "POST"],
  firstSeenTests: [{ file: "tests/checkout.spec.ts", project: "chromium" }],
  occurrenceCount: 3,
  ...overrides,
});

const adversarialTestReferences = [
  { file: "tests/routes/Überblick.spec.ts", project: "chromium" },
  { file: "tests/routes/.account.spec.ts", project: "chromium" },
  { file: "tests/routes/%24user.spec.ts", project: ".project" },
  { file: "tests/routes/%24user.spec.ts", project: "%project" },
];

const canonicalAdversarialTestReferences = [
  { file: "tests/routes/%24user.spec.ts", project: "%project" },
  { file: "tests/routes/%24user.spec.ts", project: ".project" },
  { file: "tests/routes/.account.spec.ts", project: "chromium" },
  { file: "tests/routes/Überblick.spec.ts", project: "chromium" },
];

test("dependency normalization is deterministic and excludes unsupported targets", () => {
  assert.deepEqual(
    normalizeDependencyTarget("https://CDN.VENDOR.test:443/path?token=private", {
      origins: ["https://app.example.test"],
    }),
    {
      origin: "https://cdn.vendor.test",
      host: "cdn.vendor.test",
      boundary: "external",
    },
  );
  assert.equal(
    normalizeDependencyTarget("https://app.example.test/private", {
      origins: ["https://app.example.test"],
    }).boundary,
    "first-party",
  );
  assert.equal(normalizeDependencyTarget("data:text/plain,private", {}), undefined);
  assert.equal(
    classifyDependencyResource({ resourceType: "document", frameKind: "child" }),
    "iframe",
  );
  assert.equal(classifyDependencyResource({ resourceType: "xhr", frameKind: "main" }), "fetch/xhr");
  assert.equal(normalizeDependencyMethod("post"), "POST");
  assert.equal(normalizeDependencyMethod("bad method"), "OTHER");
  assert.deepEqual(
    sanitizeDependencyTestReference({
      file: "tests/person@example.test.spec.ts",
      projectName: "person@example.test",
    }),
    { file: "tests/:value", project: ":redacted" },
  );
});

test("dependency analyzer aggregates metadata-only requests without retaining paths or payloads", async () => {
  const analyzer = new DependencyRuntimeAnalyzer({ origins: ["https://app.example.test"] });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
  });
  const privatePath = "person@example.test";
  for (const request of [
    {
      url: `https://cdn.vendor.test/assets/${privatePath}.js?token=raw-secret`,
      method: "GET",
      resourceType: "script",
      frameKind: "main",
      timestamp: 0,
    },
    {
      url: `https://cdn.vendor.test/collect?email=${privatePath}`,
      method: "POST",
      resourceType: "fetch",
      frameKind: "main",
      timestamp: 0,
    },
  ]) {
    host.emit({ type: "request", meta: metadata.create(), request });
  }

  const result = await host.finalizeTest({ test: testMetadata, capabilities });
  const dependency = result.results.get("dependency");
  assert.equal(dependency.coverage, "complete");
  assert.deepEqual(dependency.inventory, [inventoryEntry({ occurrenceCount: 2 })]);
  const serialized = JSON.stringify(dependency);
  assert.equal(serialized.includes(privatePath), false);
  assert.equal(serialized.includes("raw-secret"), false);
  assert.equal(serialized.includes("/assets/"), false);
  host.dispose();
});

test("dependency identities and review rules compare independently from privacy baselines", () => {
  const inventory = [inventoryEntry()];
  const candidates = createDependencySemanticCandidates(inventory);
  assert.deepEqual(
    candidates.map((candidate) => candidate.key),
    [
      "dependency:external-api|cdn.vendor.test",
      "dependency:external-origin|cdn.vendor.test",
      "dependency:external-script|cdn.vendor.test",
    ],
  );
  assert.equal(
    createDependencySemanticKey("script", "cdn.vendor.test"),
    "dependency:external-script|cdn.vendor.test",
  );

  const initial = compareDependencyBaseline(inventory);
  assert.deepEqual(initial.findings.map((finding) => finding.ruleId).sort(), [
    "NEW_EXTERNAL_API",
    "NEW_EXTERNAL_ORIGIN",
    "NEW_EXTERNAL_SCRIPT",
  ]);
  const baseline = {
    schemaVersion: 1,
    createdAt: "2026-08-21T12:00:00.000Z",
    dependencies: candidates.map((candidate) => ({ ...candidate, status: "accepted" })),
  };
  const known = compareDependencyBaseline(inventory, baseline);
  assert.equal(known.known.length, 3);
  assert.equal(known.new.length, 0);
  assert.equal(known.findings.length, 0);

  const resolved = compareDependencyBaseline([], baseline);
  assert.equal(resolved.resolved.length, 3);
});

test("dependency aggregation is bounded, deterministic, and keeps the least-complete coverage", () => {
  const target = new Map();
  mergeDependencyInventory(target, [inventoryEntry({ occurrenceCount: 2 })]);
  mergeDependencyInventory(target, [
    inventoryEntry({
      resourceTypes: ["font", "script"],
      requestMethods: ["GET"],
      firstSeenTests: [{ file: "tests/account.spec.ts", project: "chromium" }],
      occurrenceCount: 4,
    }),
  ]);
  assert.deepEqual(sortedDependencyInventory(target), [
    inventoryEntry({
      resourceTypes: ["fetch/xhr", "font", "script"],
      firstSeenTests: [
        { file: "tests/account.spec.ts", project: "chromium" },
        { file: "tests/checkout.spec.ts", project: "chromium" },
      ],
      occurrenceCount: 6,
    }),
  ]);
  assert.equal(leastCompleteDependencyCoverage("complete", "partial"), "partial");
  assert.equal(leastCompleteDependencyCoverage("incomplete", "partial"), "incomplete");
});

test("dependency attachments use strict locale-independent canonical ordering", () => {
  const attachment = createDependencyAttachment(
    {
      analyzerId: "dependency",
      coverage: "complete",
      inventory: [
        inventoryEntry({
          resourceTypes: ["script", "fetch/xhr"],
          requestMethods: [".METHOD", "%METHOD"],
          firstSeenTests: adversarialTestReferences,
        }),
      ],
      diagnostics: [],
    },
    { failed: false },
  );

  assert.deepEqual(attachment.inventory[0].requestMethods, ["%METHOD", ".METHOD"]);
  assert.deepEqual(attachment.inventory[0].firstSeenTests, canonicalAdversarialTestReferences);
  assert.deepEqual(parseDependencyAttachment(structuredClone(attachment)), attachment);

  const nonCanonical = structuredClone(attachment);
  nonCanonical.inventory[0].firstSeenTests.reverse();
  assert.equal(parseDependencyAttachment(nonCanonical), undefined);

  const duplicate = structuredClone(attachment);
  duplicate.inventory.push(structuredClone(duplicate.inventory[0]));
  assert.equal(parseDependencyAttachment(duplicate), undefined);
});

test("dependency artifacts are strict, private, and round-trip without raw request data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-dependency-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const latestPath = join(directory, ".privacyspec", "latest-dependencies.json");
  const baselinePath = join(directory, "privacyspec-dependencies-baseline.json");
  const reportPath = join(directory, ".privacyspec", "dependencies-report.json");
  const oversizedPath = join(directory, "oversized.json");
  const inventory = [
    inventoryEntry({
      origin: "https://z.vendor.test",
      host: "z.vendor.test",
      resourceTypes: ["script", "fetch/xhr"],
      requestMethods: [".METHOD", "%METHOD"],
      firstSeenTests: adversarialTestReferences,
    }),
    inventoryEntry({ origin: "https://a.vendor.test", host: "a.vendor.test" }),
  ];
  const comparison = compareDependencyBaseline(inventory);
  const attachment = createDependencyAttachment(
    {
      analyzerId: "dependency",
      coverage: "complete",
      inventory: inventory.slice().reverse(),
      diagnostics: [],
    },
    { failed: false },
  );
  assert.deepEqual(parseDependencyAttachment(JSON.parse(JSON.stringify(attachment))), attachment);
  assert.equal(
    parseDependencyAttachment({ ...attachment, rawRequestBody: "person@example.test" }),
    undefined,
  );

  await writeDependencyLatestRunFile(latestPath, comparison.observed, {
    complete: true,
    createdAt: "2026-08-21T12:00:00.000Z",
  });
  const latest = await readCompleteDependencyLatestRunFile(latestPath);
  assert.deepEqual(parseDependencyLatestRun(structuredClone(latest)), latest);
  const baseline = await writeDependencyBaselineFile(
    baselinePath,
    latest.dependencies.toReversed(),
    {
      createdAt: "2026-08-21T12:00:00.000Z",
    },
  );
  assert.deepEqual(await readDependencyBaselineFile(baselinePath), baseline);
  assert.deepEqual(parseDependencyBaseline(structuredClone(baseline)), baseline);
  assert.throws(
    () =>
      parseDependencyBaseline({
        ...baseline,
        dependencies: baseline.dependencies.toReversed(),
      }),
    /entries/u,
  );

  const report = {
    schemaVersion: 1,
    generatedAt: "2026-08-21T12:00:00.000Z",
    complete: true,
    coverage: "complete",
    inventory: inventory.slice().reverse(),
    findings: comparison.findings.toReversed(),
    baseline: { exists: false, known: 0, new: comparison.new.length, resolved: 0 },
    diagnostics: [],
  };
  await writeDependencyReport(reportPath, report);
  const writtenReport = await readDependencyReport(reportPath);
  assert.deepEqual(
    parseDependencyReport(JSON.parse(await readFile(reportPath, "utf8"))),
    writtenReport,
  );
  assert.deepEqual(
    writtenReport.inventory.map((entry) => entry.origin),
    ["https://a.vendor.test", "https://z.vendor.test"],
  );
  assert.throws(
    () =>
      parseDependencyReport({ ...writtenReport, findings: writtenReport.findings.toReversed() }),
    /content/u,
  );
  assert.throws(() => parseDependencyReport({ ...writtenReport, schemaVersion: 2 }), /schema/u);
  await writeFile(oversizedPath, Buffer.alloc(MAX_DEPENDENCY_ARTIFACT_BYTES + 1));
  await assert.rejects(readDependencyReport(oversizedPath), /bounded regular file/u);
  for (const path of [latestPath, baselinePath, reportPath]) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const serialized = await readFile(path, "utf8");
    assert.equal(serialized.includes("person@example.test"), false);
    assert.equal(serialized.includes("requestBody"), false);
    assert.equal(serialized.includes("responseBody"), false);
  }
});

test("missing analyzer output becomes a fixed sanitized incomplete attachment", () => {
  assert.deepEqual(createDependencyAttachment(undefined, { failed: true }), {
    schemaVersion: 1,
    analyzerId: "dependency",
    coverage: "incomplete",
    inventory: [],
    diagnostics: [
      {
        code: "DEPENDENCY_ANALYZER_FAILED",
        message: "The dependency analyzer failed inside the bounded runtime analyzer host.",
      },
    ],
  });
});
