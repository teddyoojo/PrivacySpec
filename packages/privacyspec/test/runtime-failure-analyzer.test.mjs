import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  leastCompleteRuntimeFailureCoverage,
  mergeRuntimeFailureInventory,
  sortedRuntimeFailureInventory,
} from "../dist/analyzers/runtime-failure/aggregate.js";
import {
  createRuntimeFailureKey,
  normalizeRuntimeFailureMessage,
  RuntimeFailureAnalyzer,
  runtimeFailureMessageSignature,
} from "../dist/analyzers/runtime-failure/analyzer.js";
import {
  createRuntimeFailureAttachment,
  MAX_RUNTIME_FAILURE_ARTIFACT_BYTES,
  parseRuntimeFailureAttachment,
  parseRuntimeFailureBaseline,
  parseRuntimeFailureLatestRun,
  parseRuntimeFailureReport,
  readCompleteRuntimeFailureLatestRunFile,
  readRuntimeFailureBaselineFile,
  readRuntimeFailureReport,
  writeRuntimeFailureBaselineFile,
  writeRuntimeFailureLatestRunFile,
  writeRuntimeFailureReport,
} from "../dist/analyzers/runtime-failure/artifact.js";
import {
  compareRuntimeFailureBaseline,
  createRuntimeFailureBaselineEntries,
} from "../dist/analyzers/runtime-failure/baseline.js";
import { createResponseJsonCoverage } from "../dist/discovery/response-json.js";
import { AnalyzerHost } from "../dist/runtime/analyzer.js";
import { createRuntimeCapabilityModel } from "../dist/runtime/capabilities.js";
import { RuntimeEventMetadataFactory } from "../dist/runtime/events.js";

const capabilities = createRuntimeCapabilityModel({
  observation: {
    browserObjects: { seen: 1 },
    contexts: { seen: 1, instrumented: 1 },
    pages: { seen: 1, instrumented: 1, storageCapable: 1 },
    events: { navigations: 1, network: 4, console: 1 },
  },
  responseJson: createResponseJsonCoverage(false),
  observerWorkFailed: false,
});
const testMetadata = {
  testId: "runtime-failure-test",
  file: "tests/dashboard.spec.ts",
  title: "dashboard renders",
  projectName: "chromium",
};

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

const assetFailureEntry = (endpoint) => {
  const details = {
    boundary: "first-party",
    host: "app.example.test",
    method: "GET",
    endpoint,
    httpStatus: null,
    errorName: null,
    signature: null,
    failureCode: "ERR_CONNECTION_RESET",
  };
  return {
    kind: "runtime-failure",
    key: createRuntimeFailureKey({ failureType: "request-failed", details }),
    failureType: "request-failed",
    severity: "REVIEW",
    summary: "Network request failed",
    ...details,
    firstSeenTests: adversarialTestReferences,
    occurrenceCount: 1,
  };
};

const adversarialRuntimeInventory = () => [
  assetFailureEntry("/assets/app-aB3f09.js"),
  assetFailureEntry("/assets/Überblick.js"),
  assetFailureEntry("/assets/app-Ab3F09.js"),
];

const collectInventory = async () => {
  const analyzer = new RuntimeFailureAnalyzer({ origins: ["https://app.example.test"] });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
  });
  const request = (url, method = "GET") => ({
    url,
    method,
    resourceType: "fetch",
    frameKind: "main",
    timestamp: 0,
  });
  host.emit({
    type: "page-error",
    meta: metadata.create(),
    name: "TypeError",
    message: "Widget 123 failed for person@example.test at 2026-08-21T12:13:14Z",
  });
  host.emit({
    type: "page-error",
    meta: metadata.create(),
    name: "TypeError",
    message: "Widget 987 failed for other@example.test at 2026-08-22T09:10:11Z",
  });
  host.emit({
    type: "console",
    meta: metadata.create(),
    sink: {
      kind: "console",
      level: "error",
      materials: [{ location: "console.text", value: "Secret person@example.test id 12345" }],
      argumentCount: 1,
      timestamp: 0,
    },
  });
  host.emit({
    type: "request-failed",
    meta: metadata.create(),
    request: request("https://telemetry.vendor.test/users/12345?email=person@example.test", "POST"),
    failureCode: "ERR_CONNECTION_RESET",
  });
  host.emit({
    type: "http-response",
    meta: metadata.create(),
    url: "https://app.example.test/api/recommendations/550e8400-e29b-41d4-a716-446655440000?token=private",
    method: "GET",
    resourceType: "fetch",
    frameKind: "main",
    status: 503,
  });
  host.emit({
    type: "http-response",
    meta: metadata.create(),
    url: "https://external.example.test/api/ignored",
    method: "GET",
    resourceType: "fetch",
    frameKind: "main",
    status: 500,
  });
  const result = await host.finalizeTest({ test: testMetadata, capabilities });
  const runtimeFailure = result.results.get("runtime-failure");
  host.dispose();
  return runtimeFailure;
};

const collectRuntimeEvents = async (events) => {
  const analyzer = new RuntimeFailureAnalyzer({ origins: ["https://app.example.test"] });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
  });
  for (const event of events) host.emit({ ...event, meta: metadata.create() });
  const result = await host.finalizeTest({ test: testMetadata, capabilities });
  const runtimeFailure = result.results.get("runtime-failure");
  host.dispose();
  return runtimeFailure;
};

const consoleEvent = (materials) => ({
  type: "console",
  sink: {
    kind: "console",
    level: "error",
    materials,
    argumentCount: materials.filter((material) => material.location !== "console.text").length,
    timestamp: 0,
  },
});

const failedRequestEvent = ({ url, method = "GET", resourceType = "fetch", failureCode }) => ({
  type: "request-failed",
  request: { url, method, resourceType, frameKind: "main", timestamp: 0 },
  failureCode,
});

test("runtime message normalization removes volatile values before semantic hashing", () => {
  const first = "Widget 123 failed for person@example.test at 2026-08-21T12:13:14Z";
  const second = "Widget 987 failed for other@example.test at 2026-08-22T09:10:11Z";
  assert.equal(normalizeRuntimeFailureMessage(first).includes("person@example.test"), false);
  assert.equal(runtimeFailureMessageSignature(first), runtimeFailureMessageSignature(second));
});

test("runtime message normalization removes source locations and embedded bundler hashes", () => {
  const first =
    "Widget failed at app-AbCd1234.js:12:4 line 22, column 7 for 01234567-89ab-cdef-0123-456789abcdef on 2026-08-21T12:13:14Z id deadbeefdeadbeef count 123";
  const second =
    "Widget failed at app-ZyXw9876.js:98:76 line 91, column 3 for fedcba98-7654-3210-fedc-ba9876543210 on 2026-08-22T09:10:11Z id abcdefabcdefabcd count 987";
  assert.equal(normalizeRuntimeFailureMessage(first).includes("AbCd1234"), false);
  assert.equal(normalizeRuntimeFailureMessage(first).includes(":12:4"), false);
  assert.equal(runtimeFailureMessageSignature(first), runtimeFailureMessageSignature(second));
});

test("runtime message normalization collapses incremental parser details by stable family", () => {
  const mermaidParserVariants = [
    "Error: Parsing failed: Parse error on line 9, column 5: Expecting token of type 'EOF' but found `b`.",
    "Error: Parsing failed: Parse error on line 12, column 7: Expecting token of type 'EOF' but found `br`.",
    "Error: Parsing failed: Parse error on line 18, column 2: Expecting token of type 'EOF' but found `branc`.",
  ];
  const unknownDiagramVariants = [
    "UnknownDiagramError: No diagram type detected matching given configuration for text: g",
    "UnknownDiagramError: No diagram type detected matching given configuration for text: graph TD",
  ];
  const jsonParserVariants = [
    "SyntaxError: Expected ':' after property name in JSON at position 13 (line 3 column 1)",
    "SyntaxError: Expected double-quoted property name in JSON at position 38 (line 4 column 1)",
    "SyntaxError: Expected ',' or '}' after property value in JSON at position 22 (line 3 column 1)",
  ];
  const unexpectedTokenVariants = [
    "SyntaxError: Unexpected token '}', partial configuration",
    "SyntaxError: Unexpected token 'x', another partial configuration",
  ];
  const signatures = (messages) => new Set(messages.map(runtimeFailureMessageSignature));

  assert.equal(signatures(mermaidParserVariants).size, 1);
  assert.equal(signatures(unknownDiagramVariants).size, 1);
  assert.equal(signatures(jsonParserVariants).size, 1);
  assert.equal(signatures(unexpectedTokenVariants).size, 1);
  assert.equal(
    normalizeRuntimeFailureMessage(unknownDiagramVariants[1]).includes("graph TD"),
    false,
  );

  const families = [
    mermaidParserVariants[0],
    unknownDiagramVariants[0],
    jsonParserVariants[0],
    unexpectedTokenVariants[0],
    "TypeError: Widget renderer unavailable",
  ].map(runtimeFailureMessageSignature);
  assert.equal(new Set(families).size, families.length);
});

test("console identity uses bounded rendered first lines and never structured handle values", async () => {
  const renderedFamilyA = "Widget 123 failed for first@example.test";
  const renderedFamilyB = "Widget 987 failed for second@example.test";
  const longFirstLine = `Bounded family ${"x".repeat(600)}`;
  const result = await collectRuntimeEvents([
    consoleEvent([
      { location: "console.argument.0", value: renderedFamilyA },
      { location: "console.text", value: `\n${renderedFamilyA}\nstack representation one` },
    ]),
    consoleEvent([
      { location: "console.argument.0", value: '{"message":"different object shape"}' },
      { location: "console.text", value: `${renderedFamilyB}\nstack representation two` },
    ]),
    consoleEvent([
      { location: "console.argument.0", value: "JSHandle@object" },
      { location: "console.text", value: renderedFamilyB },
    ]),
    consoleEvent([{ location: "console.argument.0", value: "JSHandle@object" }]),
    consoleEvent([
      { location: "console.argument.0", value: "[unserializable]" },
      { location: "console.text", value: "   \n\t" },
    ]),
    consoleEvent([{ location: "console.text", value: "Authentication failed" }]),
    consoleEvent([{ location: "console.text", value: "Database unavailable" }]),
    consoleEvent([{ location: "console.text", value: `${longFirstLine}first-tail` }]),
    consoleEvent([{ location: "console.text", value: `${longFirstLine}second-tail` }]),
  ]);

  const consoleFailures = result.inventory.filter((entry) => entry.failureType === "console-error");
  assert.deepEqual(
    consoleFailures.map((entry) => entry.occurrenceCount).sort((left, right) => left - right),
    [1, 1, 2, 2, 3],
  );
  assert.equal(
    consoleFailures.find(
      (entry) => entry.signature === runtimeFailureMessageSignature(renderedFamilyA),
    )?.occurrenceCount,
    3,
  );
  assert.equal(
    new Set(
      consoleFailures
        .filter((entry) => entry.occurrenceCount === 1)
        .map((entry) => entry.signature),
    ).size,
    2,
  );
  const serialized = JSON.stringify(result);
  for (const raw of [
    "first@example.test",
    "second@example.test",
    "different object shape",
    "JSHandle@object",
    "[unserializable]",
    "first-tail",
    "second-tail",
  ]) {
    assert.equal(serialized.includes(raw), false);
  }
});

test("runtime request failures ignore benign aborts and retain stronger failures", async () => {
  const result = await collectRuntimeEvents([
    failedRequestEvent({
      url: "https://app.example.test/navigation",
      method: "GET",
      resourceType: "document",
      failureCode: "ERR_ABORTED",
    }),
    failedRequestEvent({
      url: "https://app.example.test/prefetch",
      method: "HEAD",
      resourceType: "fetch",
      failureCode: "ERR_ABORTED",
    }),
    failedRequestEvent({
      url: "https://cdn.example.test/assets/app-AbCd1234.js",
      method: "POST",
      resourceType: "script",
      failureCode: "ERR_ABORTED",
    }),
    failedRequestEvent({
      url: "https://telemetry.example.test/collect/123",
      method: "POST",
      resourceType: "fetch",
      failureCode: "ERR_ABORTED",
    }),
    failedRequestEvent({
      url: "https://cdn.example.test/assets/app-AbCd1234.js",
      resourceType: "script",
      failureCode: "ERR_CONNECTION_RESET",
    }),
    failedRequestEvent({
      url: "https://cdn.example.test/assets/app-ZyXw9876.js",
      resourceType: "script",
      failureCode: "ERR_CONNECTION_RESET",
    }),
    failedRequestEvent({
      url: "https://dns.example.test/api",
      failureCode: "ERR_NAME_NOT_RESOLVED",
    }),
    failedRequestEvent({
      url: "https://tls.example.test/api",
      failureCode: "ERR_CERT_AUTHORITY_INVALID",
    }),
    failedRequestEvent({
      url: "https://timeout.example.test/api",
      failureCode: "ERR_TIMED_OUT",
    }),
  ]);

  const failures = result.inventory.filter((entry) => entry.failureType === "request-failed");
  assert.equal(failures.length, 5);
  assert.deepEqual(failures.map((entry) => entry.failureCode).sort(), [
    "ERR_ABORTED",
    "ERR_CERT_AUTHORITY_INVALID",
    "ERR_CONNECTION_RESET",
    "ERR_NAME_NOT_RESOLVED",
    "ERR_TIMED_OUT",
  ]);
  const retainedAbort = failures.find((entry) => entry.failureCode === "ERR_ABORTED");
  assert.equal(retainedAbort.method, "POST");
  assert.equal(retainedAbort.endpoint, "/collect/:number");
  const staticFailure = failures.find((entry) => entry.failureCode === "ERR_CONNECTION_RESET");
  assert.equal(staticFailure.endpoint, "/assets/app-:hash.js");
  assert.equal(staticFailure.occurrenceCount, 2);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("AbCd1234"), false);
  assert.equal(serialized.includes("ZyXw9876"), false);
});

test("runtime analyzer detects four hidden failure families with stable sanitized identities", async () => {
  const result = await collectInventory();
  assert.equal(result.coverage, "complete");
  assert.deepEqual(
    result.inventory.map((entry) => [entry.failureType, entry.severity, entry.occurrenceCount]),
    [
      ["console-error", "REVIEW", 1],
      ["http-5xx", "ERROR", 1],
      ["page-error", "ERROR", 2],
      ["request-failed", "REVIEW", 1],
    ],
  );
  const http5xx = result.inventory.find((entry) => entry.failureType === "http-5xx");
  assert.equal(http5xx.endpoint, "/api/recommendations/:uuid");
  const failed = result.inventory.find((entry) => entry.failureType === "request-failed");
  assert.equal(failed.endpoint, "/users/:number");
  assert.equal(failed.boundary, "external");
  const serialized = JSON.stringify(result);
  for (const prohibited of [
    "person@example.test",
    "other@example.test",
    "private",
    "550e8400-e29b-41d4-a716-446655440000",
    "12345",
  ])
    assert.equal(serialized.includes(prohibited), false);
});

test("runtime request identities share endpoint canonicalization across dynamic instances", async () => {
  const analyzer = new RuntimeFailureAnalyzer({ origins: ["https://app.example.test"] });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
  });
  for (const url of [
    "https://app.example.test/members/q7_amber_forest/jobs/cmt3ab4cd5ef6gh7ij8kl9mn0.data",
    "https://app.example.test/members/m2_silver_harbor/jobs/cmx9zy8wv7ut6sr5qp4on3ml2.data",
  ]) {
    host.emit({
      type: "request-failed",
      meta: metadata.create(),
      request: {
        url,
        method: "GET",
        resourceType: "fetch",
        frameKind: "main",
        timestamp: 0,
      },
      failureCode: "ERR_CONNECTION_RESET",
    });
  }

  const result = await host.finalizeTest({ test: testMetadata, capabilities });
  const runtime = result.results.get("runtime-failure");
  assert.equal(runtime.inventory.length, 1);
  assert.equal(runtime.inventory[0].endpoint, "/members/:id/jobs/:id.data");
  assert.equal(runtime.inventory[0].occurrenceCount, 2);
  host.dispose();
});

test("runtime failure baseline keeps known failures quiet and reports resolved identities", async () => {
  const inventory = (await collectInventory()).inventory;
  const first = compareRuntimeFailureBaseline(inventory);
  assert.equal(first.new.length, 4);
  assert.deepEqual(first.findings.map((finding) => finding.classification).sort(), [
    "REVIEW_REQUIRED",
    "REVIEW_REQUIRED",
    "TECHNICAL_FAILURE",
    "TECHNICAL_FAILURE",
  ]);
  const baseline = {
    schemaVersion: 1,
    createdAt: "2026-08-21T12:00:00.000Z",
    entries: createRuntimeFailureBaselineEntries(inventory),
  };
  const known = compareRuntimeFailureBaseline(inventory, baseline);
  assert.equal(known.known.length, 4);
  assert.equal(known.new.length, 0);
  assert.equal(known.findings.length, 0);
  assert.equal(compareRuntimeFailureBaseline([], baseline).resolved.length, 4);
});

test("runtime failure aggregation is deterministic and retains least-complete coverage", async () => {
  const [entry] = (await collectInventory()).inventory;
  const target = new Map();
  mergeRuntimeFailureInventory(target, [entry]);
  mergeRuntimeFailureInventory(target, [
    { ...entry, firstSeenTests: [{ file: "tests/account.spec.ts", project: "chromium" }] },
  ]);
  const merged = sortedRuntimeFailureInventory(target)[0];
  assert.equal(merged.occurrenceCount, 2);
  assert.deepEqual(
    merged.firstSeenTests.map((reference) => reference.file),
    ["tests/account.spec.ts", "tests/dashboard.spec.ts"],
  );
  assert.equal(leastCompleteRuntimeFailureCoverage("complete", "partial"), "partial");
});

test("runtime failure attachments canonically order mixed-case asset identities and test paths", () => {
  const attachment = createRuntimeFailureAttachment(
    {
      analyzerId: "runtime-failure",
      coverage: "complete",
      inventory: adversarialRuntimeInventory(),
      diagnostics: [],
    },
    { failed: false },
  );

  assert.deepEqual(
    attachment.inventory.map((entry) => entry.endpoint),
    ["/assets/Überblick.js", "/assets/app-Ab3F09.js", "/assets/app-aB3f09.js"],
  );
  for (const entry of attachment.inventory) {
    assert.deepEqual(entry.firstSeenTests, canonicalAdversarialTestReferences);
  }
  assert.deepEqual(parseRuntimeFailureAttachment(structuredClone(attachment)), attachment);

  const nonCanonical = structuredClone(attachment);
  nonCanonical.inventory[0].firstSeenTests.reverse();
  assert.equal(parseRuntimeFailureAttachment(nonCanonical), undefined);

  const duplicate = structuredClone(attachment);
  duplicate.inventory.push(structuredClone(duplicate.inventory[0]));
  assert.equal(parseRuntimeFailureAttachment(duplicate), undefined);
});

test("runtime failure artifacts are strict, private, bounded, and mode 0600", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-runtime-failure-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const inventory = adversarialRuntimeInventory();
  const comparison = compareRuntimeFailureBaseline(inventory);
  const attachment = createRuntimeFailureAttachment(
    {
      analyzerId: "runtime-failure",
      coverage: "complete",
      inventory: inventory.slice().reverse(),
      diagnostics: [],
    },
    { failed: false },
  );
  assert.deepEqual(
    parseRuntimeFailureAttachment(JSON.parse(JSON.stringify(attachment))),
    attachment,
  );
  assert.equal(
    parseRuntimeFailureAttachment({ ...attachment, rawStack: "person@example.test" }),
    undefined,
  );
  const latestPath = join(directory, "latest.json");
  const baselinePath = join(directory, "baseline.json");
  const reportPath = join(directory, "report.json");
  const oversizedPath = join(directory, "oversized.json");
  await writeRuntimeFailureLatestRunFile(latestPath, comparison.observed.toReversed(), {
    complete: true,
    createdAt: "2026-08-21T12:00:00.000Z",
  });
  const latest = await readCompleteRuntimeFailureLatestRunFile(latestPath);
  assert.deepEqual(parseRuntimeFailureLatestRun(structuredClone(latest)), latest);
  const baseline = await writeRuntimeFailureBaselineFile(
    baselinePath,
    latest.entries.toReversed(),
    {
      createdAt: "2026-08-21T12:00:00.000Z",
    },
  );
  assert.deepEqual(await readRuntimeFailureBaselineFile(baselinePath), baseline);
  assert.deepEqual(parseRuntimeFailureBaseline(structuredClone(baseline)), baseline);
  assert.throws(
    () => parseRuntimeFailureBaseline({ ...baseline, entries: baseline.entries.toReversed() }),
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
  await writeRuntimeFailureReport(reportPath, report);
  const writtenReport = await readRuntimeFailureReport(reportPath);
  assert.deepEqual(
    parseRuntimeFailureReport(JSON.parse(await readFile(reportPath, "utf8"))),
    writtenReport,
  );
  assert.deepEqual(
    writtenReport.inventory.map((entry) => entry.endpoint),
    ["/assets/Überblick.js", "/assets/app-Ab3F09.js", "/assets/app-aB3f09.js"],
  );
  assert.throws(
    () =>
      parseRuntimeFailureReport({
        ...writtenReport,
        findings: writtenReport.findings.toReversed(),
      }),
    /entries/u,
  );
  assert.throws(() => parseRuntimeFailureReport({ ...writtenReport, schemaVersion: 2 }), /schema/u);
  await writeFile(oversizedPath, Buffer.alloc(MAX_RUNTIME_FAILURE_ARTIFACT_BYTES + 1));
  await assert.rejects(readRuntimeFailureReport(oversizedPath), /bounded regular file/u);
  for (const path of [latestPath, baselinePath, reportPath]) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const serialized = await readFile(path, "utf8");
    assert.equal(serialized.includes("person@example.test"), false);
    assert.equal(serialized.includes("rawStack"), false);
    assert.equal(serialized.includes("token=private"), false);
  }
});

test("runtime semantic key includes normalized details only", () => {
  assert.equal(
    createRuntimeFailureKey({
      failureType: "console-error",
      details: {
        boundary: null,
        host: null,
        method: null,
        endpoint: null,
        httpStatus: null,
        errorName: null,
        signature: "sha256:0123456789abcdef",
        failureCode: null,
      },
    }),
    "runtime-error:console-error|sha256%3A0123456789abcdef",
  );
});
