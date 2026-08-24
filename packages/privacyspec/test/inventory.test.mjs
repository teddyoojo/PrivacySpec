import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compareBaseline, createBaselineFlowCandidate } from "../dist/baseline/compare.js";
import { createBaselineFile } from "../dist/baseline/write.js";
import { createPrivacyInventory } from "../dist/inventory/create.js";
import { INVENTORY_SCHEMA_VERSION } from "../dist/inventory/model.js";
import {
  InventoryFormatError,
  parsePrivacyInventory,
  readPrivacyInventoryFile,
} from "../dist/inventory/read.js";
import {
  renderInventoryCsv,
  renderInventoryMarkdown,
  renderInventoryTerminal,
  renderPrivacyInventory,
} from "../dist/inventory/render.js";
import { writeInventoryOutput } from "../dist/inventory/write.js";
import { writePrivacySpecReport } from "../dist/report/json.js";
import { createPrivacySpecReport } from "../dist/report/model.js";
import {
  parsePrivacySpecReport,
  parsePrivacySpecReportV1,
  parsePrivacySpecReportV2,
  parsePrivacySpecReportV3,
  parsePrivacySpecReportV4,
  parsePrivacySpecReportV5,
  ReportFormatError,
  readPrivacySpecReport,
} from "../dist/report/read.js";
import { evaluateDataFlows } from "../dist/rules/engine.js";
import { RULE_LEGAL_MAPPINGS } from "../dist/rules/legal-map.js";

const CREATED_AT = "2026-08-20T12:00:00.000Z";

const flow = (overrides = {}) => ({
  kind: "data-flow",
  dataCategory: "personal.email",
  sourceKind: "form-input",
  sourceConfidence: "high",
  sinkKind: "request-body",
  requestSurface: "browser",
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
  const repeatedFirstParty = flow({
    transform: "BASE64",
    test: {
      file: "tests/customer.spec.ts",
      title: '=HYPERLINK("https://example.test")',
      project: "chromium",
    },
  });
  const externalEmail = flow({
    sinkKind: "external-request",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
    endpoint: "/collect",
  });
  const externalPassword = flow({
    dataCategory: "secret.password",
    sinkKind: "external-request",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
    endpoint: "/collect",
    location: "json.password",
    test: {
      file: "tests/auth.spec.ts",
      title: "user can log in",
      project: "chromium",
    },
  });
  const findings = evaluateDataFlows([externalEmail, externalPassword]);
  const acceptedPhoneFinding = evaluateDataFlows([
    flow({
      dataCategory: "personal.phone",
      sinkKind: "external-request",
      recipient: externalEmail.recipient,
      endpoint: "/collect",
      location: "json.phone",
    }),
  ])[0];
  assert.ok(acceptedPhoneFinding);
  const acceptedPhone = createBaselineFlowCandidate(acceptedPhoneFinding);
  assert.ok(acceptedPhone);
  const baseline = createBaselineFile([acceptedPhone], { createdAt: CREATED_AT });
  const comparison = compareBaseline(findings, baseline);
  return createPrivacySpecReport({
    generatedAt: CREATED_AT,
    startedAt: "2026-08-20T11:59:59.000Z",
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
    flows: [firstParty, repeatedFirstParty, externalEmail, externalPassword],
    findings,
    comparison,
    baselineExists: true,
    diagnostics: [],
    integrationErrors: [],
    ruleMappings: [RULE_LEGAL_MAPPINGS.PS1003, RULE_LEGAL_MAPPINGS.PS1004],
    profileMappings: [],
  });
};

const asSchemaV1 = (report) => {
  const {
    analysis: _analysis,
    coverage: _coverage,
    testData: _testData,
    ...common
  } = structuredClone(report);
  const copy = { ...common, schemaVersion: 1 };
  removeRequestSurfaces(copy);
  return copy;
};

const removeRequestSurfaces = (report) => {
  for (const observedFlow of report.flows) delete observedFlow.requestSurface;
  for (const entry of report.findings) delete entry.finding.flow.requestSurface;
  for (const group of [...report.baseline.known, ...report.baseline.new]) {
    for (const finding of group.findings) delete finding.flow.requestSurface;
  }
  return report;
};

const asSchemaV4 = (report) => {
  const copy = structuredClone(report);
  copy.schemaVersion = 4;
  delete copy.coverage.browserEngines;
  delete copy.coverage.apiRequests;
  return removeRequestSurfaces(copy);
};

const asSchemaV2 = (report) => {
  const copy = asSchemaV4(report);
  copy.schemaVersion = 2;
  delete copy.coverage.observation;
  delete copy.analysis;
  return copy;
};

const asSchemaV3 = (report) => {
  const copy = asSchemaV4(report);
  copy.schemaVersion = 3;
  delete copy.analysis;
  return copy;
};

test("strict union report reader accepts schema v1/v2/v3/v4/v5 and rejects malformed input", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-report-read-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "report.json");
  const report = createReport();
  await writePrivacySpecReport(path, report);
  const reportV1 = asSchemaV1(report);
  const reportV2 = asSchemaV2(report);
  const reportV3 = asSchemaV3(report);
  const reportV4 = asSchemaV4(report);

  assert.deepEqual(await readPrivacySpecReport(path), report);
  const symlinkPath = join(directory, "report-link.json");
  await symlink(path, symlinkPath);
  await assert.rejects(readPrivacySpecReport(symlinkPath), /bounded regular file/u);
  assert.deepEqual(parsePrivacySpecReportV5(structuredClone(report)), report);
  assert.deepEqual(parsePrivacySpecReportV4(structuredClone(reportV4)), reportV4);
  assert.deepEqual(parsePrivacySpecReport(structuredClone(report)), report);
  assert.deepEqual(parsePrivacySpecReportV3(structuredClone(reportV3)), reportV3);
  assert.deepEqual(parsePrivacySpecReportV2(structuredClone(reportV2)), reportV2);
  const phase15Report = structuredClone(reportV2);
  delete phase15Report.testData;
  assert.deepEqual(parsePrivacySpecReportV2(structuredClone(phase15Report)), phase15Report);
  assert.deepEqual(parsePrivacySpecReportV1(structuredClone(reportV1)), reportV1);
  assert.deepEqual(parsePrivacySpecReport(structuredClone(reportV1)), reportV1);
  assert.equal(
    parsePrivacySpecReportV1({
      ...structuredClone(reportV1),
      tool: { name: "privacyspec", version: "0.0.0" },
    }).tool.version,
    "0.0.0",
  );

  for (const malformed of [
    { ...structuredClone(report), schemaVersion: 6 },
    { ...structuredClone(report), unexpected: true },
    {
      ...structuredClone(report),
      coverage: {
        firstPartyJsonResponses: {
          ...structuredClone(report.coverage.firstPartyJsonResponses),
          tests: { enabled: 99, disabled: 0, unavailable: 0 },
        },
      },
    },
    {
      ...structuredClone(report),
      coverage: {
        ...structuredClone(report.coverage),
        observation: {
          ...structuredClone(report.coverage.observation),
          pages: { seen: 1, instrumented: 2, storageCapable: 1 },
        },
      },
    },
    { ...structuredClone(report), summary: { ...report.summary, dataFlows: 999 } },
    {
      ...structuredClone(report),
      testData: {
        ...structuredClone(report.testData),
        summary: { ...report.testData.summary, total: 99 },
      },
    },
    {
      ...structuredClone(report),
      findings: report.findings.map((entry, index) =>
        index === 0 ? { ...entry, baselineState: "known" } : entry,
      ),
    },
    {
      ...structuredClone(report),
      flows: report.flows.map((entry, index) =>
        index === 0 ? { ...entry, test: { ...entry.test, file: "/private/test.spec.ts" } } : entry,
      ),
    },
    {
      ...structuredClone(report),
      analysis: {
        ...structuredClone(report.analysis),
        changes: { ...report.analysis.changes, total: 999 },
      },
    },
    {
      ...structuredClone(report),
      analysis: {
        ...structuredClone(report.analysis),
        privacy: { ...structuredClone(report.analysis.privacy), status: "pass" },
      },
    },
    {
      ...structuredClone(report),
      analysis: {
        ...structuredClone(report.analysis),
        dependencies: {
          ...structuredClone(report.analysis.dependencies),
          rawPayload: "must not be accepted",
        },
      },
    },
  ]) {
    assert.throws(() => parsePrivacySpecReport(malformed), ReportFormatError);
  }

  await writeFile(path, "not-json", "utf8");
  await assert.rejects(readPrivacySpecReport(path), /not valid JSON/u);
  await assert.rejects(readPrivacySpecReport(join(directory, "missing.json")), /No PrivacySpec/u);
});

test("current inventory preserves response provenance while schema v1 rejects it", () => {
  const report = createReport();
  const responseFlow = flow({
    sourceKind: "response-json",
    sourceProvenance: {
      origin: "https://app.example.test",
      endpoint: "/api/customers/:number",
      location: "json.customer.email",
    },
    endpoint: "/api/customers",
  });
  report.flows.push(responseFlow);
  report.summary.dataFlows += 1;
  report.analysis.privacy.summary.dataFlows += 1;

  const parsed = parsePrivacySpecReportV5(report);
  const inventory = createPrivacyInventory(parsed);
  const entry = inventory.entries.find((candidate) =>
    candidate.sourceKinds.includes("response-json"),
  );
  assert.deepEqual(entry?.sourceProvenance, responseFlow.sourceProvenance);
  assert.equal(
    inventory.entries.filter((candidate) => candidate.endpoint === "/api/customers").length,
    2,
  );
  assert.match(
    renderInventoryTerminal(inventory),
    /response source: https:\/\/app\.example\.test\/api\/customers\/:number :: json\.customer\.email/u,
  );
  assert.match(
    renderInventoryMarkdown(inventory),
    /response-json \(https:\/\/app\.example\.test\/api\/customers\/:number :: json\.customer\.email\)/u,
  );
  assert.match(renderInventoryCsv(inventory), /sourceOrigin,sourceEndpoint,sourceLocation/u);
  assert.match(renderInventoryCsv(inventory), /https:\/\/app\.example\.test/u);

  const reportV1 = asSchemaV1(report);
  assert.throws(() => parsePrivacySpecReportV1(reportV1), ReportFormatError);
});

test("inventory aggregates occurrences and assigns technical, baseline, and change states", () => {
  const inventory = createPrivacyInventory(createReport());
  assert.equal(inventory.inventorySchemaVersion, INVENTORY_SCHEMA_VERSION);
  assert.deepEqual(inventory.summary, {
    entries: 3,
    occurrences: 4,
    categories: 2,
    externalRecipients: 1,
    byState: {
      OBSERVED: 1,
      KNOWN_REVIEW: 0,
      NEW_REVIEW: 1,
      TECHNICAL_FAILURE: 1,
    },
  });

  const observed = inventory.entries.find((entry) => entry.state === "OBSERVED");
  assert.equal(observed?.occurrences, 2);
  assert.deepEqual(observed?.transforms, ["BASE64", "EXACT"]);
  assert.equal(observed?.tests.length, 2);

  const review = inventory.entries.find((entry) => entry.state === "NEW_REVIEW");
  assert.deepEqual(review?.changeReasons, ["NEW_CATEGORY"]);
  assert.equal(review?.boundary, "EXTERNAL");

  const technical = inventory.entries.find((entry) => entry.state === "TECHNICAL_FAILURE");
  assert.equal(technical?.dataCategory, "secret.password");
  assert.deepEqual(technical?.severities, ["critical"]);
  assert.equal(inventory.resolved.length, 1);
  assert.match(inventory.limitations.join(" "), /not a complete record of processing/u);
});

test("inventory preserves every expanded DOM category", () => {
  const categories = [
    "personal.name",
    "personal.postal_address",
    "personal.date_of_birth",
    "personal.account_identifier",
    "personal.payment_card",
    "personal.gender_identity",
    "personal.job_title",
  ];
  const report = createReport();
  for (const category of categories) {
    report.flows.push(
      flow({
        dataCategory: category,
        endpoint: `/profile/${category.replaceAll(".", "-")}`,
        location: `json.${category.replaceAll(".", "_")}`,
      }),
    );
  }

  const inventory = createPrivacyInventory(report);
  const expanded = inventory.entries
    .filter((entry) => categories.includes(entry.dataCategory))
    .map((entry) => entry.dataCategory)
    .toSorted();
  assert.deepEqual(expanded, categories.toSorted());
  const markdown = renderInventoryMarkdown(inventory);
  for (const category of categories)
    assert.match(markdown, new RegExp(category.replace(".", "\\."), "u"));
});

test("inventory associates findings by semantics rather than JSON property order", () => {
  const report = createReport();
  report.findings = report.findings.map((entry) => ({
    baselineState: entry.baselineState,
    finding: {
      ...entry.finding,
      flow: {
        test: entry.finding.flow.test,
        transform: entry.finding.flow.transform,
        ...entry.finding.flow,
      },
    },
  }));

  assert.deepEqual(createPrivacyInventory(report).summary.byState, {
    OBSERVED: 1,
    KNOWN_REVIEW: 0,
    NEW_REVIEW: 1,
    TECHNICAL_FAILURE: 1,
  });
});

test("inventory normalizes dynamic endpoint segments before aggregation", () => {
  const report = createReport();
  report.flows.push(
    flow({
      endpoint: "/api/customers/12345",
      location: "json.email",
    }),
    flow({
      endpoint: "/api/customers/67890",
      location: "json.email",
    }),
  );
  report.summary.dataFlows += 2;

  const entry = createPrivacyInventory(report).entries.find(
    (candidate) => candidate.endpoint === "/api/customers/:number",
  );
  assert.equal(entry?.occurrences, 2);
});

test("inventory keeps browser and API-request flow surfaces distinct", () => {
  const report = createReport();
  report.flows.push(flow({ requestSurface: "api-request" }));
  report.summary.dataFlows += 1;

  const entries = createPrivacyInventory(report).entries.filter(
    (entry) => entry.endpoint === "/api/customers",
  );
  assert.deepEqual(entries.map((entry) => entry.requestSurface).toSorted(), [
    "api-request",
    "browser",
  ]);
});

test("inventory labels baseline matches as known review without implying legal approval", () => {
  const report = createReport();
  const knownFinding = report.findings.find(
    (entry) => entry.finding.ruleId === "PS1004" && entry.baselineState === "new",
  );
  assert.ok(knownFinding);
  const knownFlow = createBaselineFlowCandidate(knownFinding.finding);
  assert.ok(knownFlow);
  knownFinding.baselineState = "known";
  report.baseline.known = [{ flow: knownFlow, findings: [knownFinding.finding] }];
  report.baseline.new = [];
  report.baseline.resolved = [];
  report.summary.findings.newReviewRequired = 0;
  report.summary.findings.knownReviewRequired = 1;
  report.summary.baseline = { known: 1, new: 0, resolved: 0 };

  const inventory = createPrivacyInventory(parsePrivacySpecReportV3(asSchemaV3(report)));
  assert.equal(
    inventory.entries.find((entry) => entry.boundary === "EXTERNAL")?.state,
    "KNOWN_REVIEW",
  );
  assert.doesNotMatch(renderInventoryTerminal(inventory), /legally approved/u);
});

test("incomplete inventory is explicit and never presents resolved baseline candidates", () => {
  const inventory = createPrivacyInventory(createReport({ complete: false }));
  assert.equal(inventory.sourceReport.complete, false);
  assert.deepEqual(inventory.resolved, []);
  assert.match(inventory.limitations[0], /source run is incomplete/u);
  assert.match(renderInventoryTerminal(inventory), /Source run: INCOMPLETE/u);
  assert.match(renderInventoryCsv(inventory), /SUMMARY,INCOMPLETE,INCOMPLETE/u);
});

test("inventory renderers are deterministic, machine-readable, and spreadsheet safe", () => {
  const inventory = createPrivacyInventory(createReport());
  const formulaInventory = structuredClone(inventory);
  formulaInventory.entries[0].method = '=HYPERLINK("https://example.test")';
  const terminal = renderInventoryTerminal(inventory);
  const markdown = renderInventoryMarkdown(inventory);
  const csv = renderInventoryCsv(inventory);
  const formulaCsv = renderInventoryCsv(formulaInventory);
  const json = renderPrivacyInventory(inventory, "json");

  assert.match(terminal, /Runtime Privacy Inventory/u);
  assert.match(terminal, /NEW_REVIEW \[NEW_CATEGORY\]/u);
  assert.match(markdown, /\| personal\.email \| browser \| EXTERNAL/u);
  assert.match(csv, /HYPERLINK/u);
  assert.match(formulaCsv, /'=HYPERLINK/u);
  assert.deepEqual(JSON.parse(json), inventory);
  assert.equal(renderPrivacyInventory(inventory, "terminal"), terminal);
  assert.equal(renderPrivacyInventory(inventory, "markdown"), markdown);
  assert.equal(renderPrivacyInventory(inventory, "csv"), csv);
});

test("terminal and Markdown summarize static-asset Referer fan-out without changing JSON or CSV", () => {
  const report = createReport();
  report.flows.push(
    flow({
      sinkKind: "request-header",
      method: "GET",
      endpoint: "/assets/app-a1b2c3.js",
      location: "header.referer",
      transform: "URL_ENCODED",
    }),
    flow({
      sinkKind: "request-header",
      method: "GET",
      endpoint: "/assets/styles-d4e5f6.css",
      location: "header.referer",
      transform: "URL_ENCODED",
    }),
  );
  report.summary.dataFlows += 2;
  const inventory = createPrivacyInventory(report);
  const terminal = renderInventoryTerminal(inventory);
  const markdown = renderInventoryMarkdown(inventory);
  const csv = renderInventoryCsv(inventory);
  const json = renderPrivacyInventory(inventory, "json");

  assert.equal(inventory.entries.length, 5);
  assert.match(terminal, /2 static-asset Referer inventory rows summarized/u);
  assert.match(markdown, /2 static-asset Referer inventory rows summarized/u);
  assert.doesNotMatch(terminal, /app-a1b2c3|styles-d4e5f6/u);
  assert.doesNotMatch(markdown, /app-a1b2c3|styles-d4e5f6/u);
  assert.match(csv, /app-a1b2c3/u);
  assert.match(csv, /styles-d4e5f6/u);
  assert.deepEqual(JSON.parse(json), inventory);
  assert.equal(JSON.parse(json).entries.length, 5);
});

test("terminal and Markdown distinguish semantic review decisions from inventory rows", () => {
  const report = createReport();
  const reviewFinding = report.findings.find(
    (entry) => entry.finding.ruleId === "PS1004" && entry.baselineState === "new",
  );
  assert.ok(reviewFinding);
  const repeatedByMethod = structuredClone(reviewFinding.finding.flow);
  repeatedByMethod.method = "PUT";
  repeatedByMethod.test = {
    file: "tests/customer-update.spec.ts",
    title: "customer can be updated",
    project: "chromium",
  };
  report.flows.push(repeatedByMethod);
  report.findings.push({
    baselineState: "new",
    finding: { ...reviewFinding.finding, flow: repeatedByMethod },
  });
  report.summary.dataFlows += 1;
  report.summary.findings.total += 1;
  report.summary.findings.reviewRequired += 1;
  report.summary.findings.newReviewRequired += 1;
  const inventory = createPrivacyInventory(report);

  assert.equal(inventory.summary.byState.NEW_REVIEW, 2);
  assert.match(
    renderInventoryTerminal(inventory),
    /1 review decision \/ 2 observed inventory rows/u,
  );
  assert.match(
    renderInventoryMarkdown(inventory),
    /1 review decision \/ 2 observed inventory rows/u,
  );
});

test("payment-card review findings remain baseline-eligible in inventory summaries", () => {
  const report = createReport();
  const paymentFlow = flow({
    dataCategory: "personal.payment_card",
    sinkKind: "external-request",
    recipient: {
      origin: "https://payments.example.test",
      host: "payments.example.test",
      firstParty: false,
    },
    endpoint: "/authorize",
    location: "json.card",
  });
  const [finding] = evaluateDataFlows([paymentFlow]);
  assert.equal(finding?.ruleId, "PS1004");
  report.flows.push(paymentFlow);
  report.findings.push({ baselineState: "new", finding });

  const inventory = createPrivacyInventory(report);
  const payment = inventory.entries.find((entry) => entry.dataCategory === "personal.payment_card");
  assert.equal(payment?.state, "NEW_REVIEW");
  assert.match(
    renderInventoryTerminal(inventory),
    /2 review decisions \/ 2 observed inventory rows/u,
  );
});

test("inventory file output is atomic, private, and contains no raw payload field", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-inventory-write-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "inventory.json");
  const output = renderPrivacyInventory(createPrivacyInventory(createReport()), "json");
  await writeInventoryOutput(path, output);

  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await readFile(path, "utf8"), output);
  assert.equal(/"(?:raw|value|payload)"\s*:/u.test(output), false);
});

test("strict inventory reader accepts v1/v2 and rejects malformed object and file artifacts", async (context) => {
  const current = createPrivacyInventory(createReport());
  const legacy = structuredClone(current);
  legacy.inventorySchemaVersion = 1;
  delete legacy.experimentalCoverage;
  for (const entry of legacy.entries) delete entry.requestSurface;

  assert.deepEqual(parsePrivacyInventory(structuredClone(current)), current);
  assert.deepEqual(parsePrivacyInventory(structuredClone(legacy)), legacy);
  const cyclic = structuredClone(current);
  cyclic.self = cyclic;
  const accessor = structuredClone(current);
  let getterCalls = 0;
  Object.defineProperty(accessor, "entries", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });
  for (const malformed of [
    { ...structuredClone(current), inventorySchemaVersion: 3 },
    { ...structuredClone(current), unknown: true },
    {
      ...structuredClone(current),
      sourceReport: { ...current.sourceReport, unknown: true },
    },
    {
      ...structuredClone(current),
      summary: { ...current.summary, entries: current.summary.entries + 1 },
    },
    { ...structuredClone(current), entries: current.entries.toReversed() },
    cyclic,
    accessor,
  ]) {
    assert.throws(() => parsePrivacyInventory(malformed), InventoryFormatError);
  }
  assert.equal(getterCalls, 0);

  const directory = await mkdtemp(join(tmpdir(), "privacyspec-inventory-read-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "inventory.json");
  await writeFile(path, JSON.stringify(current), "utf8");
  assert.deepEqual(await readPrivacyInventoryFile(path), current);
  const linkPath = join(directory, "inventory-link.json");
  await symlink(path, linkPath);
  await assert.rejects(readPrivacyInventoryFile(linkPath), /bounded regular file/u);
  await writeFile(path, "not-json", "utf8");
  await assert.rejects(readPrivacyInventoryFile(path), /not valid JSON/u);
});
