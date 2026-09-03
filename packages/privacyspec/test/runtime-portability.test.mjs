import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DependencyRuntimeAnalyzer } from "../dist/analyzers/dependency/analyzer.js";
import { PrivacyRuntimeAnalyzer } from "../dist/analyzers/privacy/analyzer.js";
import { RuntimeFailureAnalyzer } from "../dist/analyzers/runtime-failure/analyzer.js";
import { SecurityPostureAnalyzer } from "../dist/analyzers/security/analyzer.js";
import { createResponseJsonCoverage } from "../dist/discovery/response-json.js";
import {
  createAPIRequestCoverage,
  createBrowserEngineCoverage,
} from "../dist/playwright/experimental-coverage.js";
import { createPrivacySpecReport } from "../dist/report/model.js";
import { parsePrivacySpecReportV5 } from "../dist/report/read.js";
import { AnalyzerHost } from "../dist/runtime/analyzer.js";
import { createRuntimeCapabilityModel } from "../dist/runtime/capabilities.js";
import { SyntheticRuntimeAdapter } from "../fixtures/runtime-portability/synthetic-adapter.mjs";

const firstParty = { origins: ["https://app.example.test"] };
const testMetadata = {
  testId: "synthetic-portability",
  projectName: "synthetic-chromium",
  file: "tests/portable.spec.ts",
  title: "portable runtime journey",
};

const observation = (instrumented = true) => ({
  browserObjects: { seen: 1 },
  contexts: { seen: instrumented ? 1 : 2, instrumented: 1 },
  pages: { seen: instrumented ? 1 : 2, instrumented: 1, storageCapable: 1 },
  events: { navigations: 1, network: 4, console: 1 },
});

const capabilities = (instrumented = true) =>
  createRuntimeCapabilityModel({
    observation: observation(instrumented),
    responseJson: createResponseJsonCoverage(false),
    observerWorkFailed: false,
    responseHeaders: { enabled: true, limitReached: false, workFailed: false },
    browserEngine: createBrowserEngineCoverage("chromium", new Set()),
    apiRequests: createAPIRequestCoverage(false),
  });

const scenarioEvents = (privateEmail) => [
  { type: "context-created", contextId: "context-main", instrumented: true },
  {
    type: "page-created",
    contextId: "context-main",
    pageId: "page-main",
    instrumented: true,
  },
  {
    type: "navigation",
    contextId: "context-main",
    pageId: "page-main",
    url: "https://app.example.test/dashboard",
  },
  {
    type: "page-url-snapshot",
    contextId: "context-main",
    pageId: "page-main",
    url: "https://app.example.test/dashboard",
  },
  {
    type: "sensitive-source",
    contextId: "context-main",
    pageId: "page-main",
    source: {
      kind: "control",
      raw: privateEmail,
      category: "personal.email",
      confidence: "high",
      evidence: [{ kind: "input-type", value: "email" }],
      control: { elementKind: "input", type: "email" },
      pageUrl: "https://app.example.test/dashboard",
      timestamp: 0,
      observedBy: "event",
    },
  },
  {
    type: "request",
    contextId: "context-main",
    pageId: "page-main",
    request: {
      url: "https://analytics.example.test/event",
      method: "POST",
      resourceType: "fetch",
      frameKind: "main",
      requestSurface: "browser",
      timestamp: 0,
    },
    sink: {
      kind: "network",
      requestSurface: "browser",
      url: "https://analytics.example.test/event",
      method: "POST",
      resourceType: "fetch",
      headers: {},
      bodyKind: "json",
      bodySize: privateEmail.length,
      bodyTruncated: false,
      materials: [{ location: "json.email", value: privateEmail }],
      pageUrl: "https://app.example.test/dashboard",
      timestamp: 0,
    },
  },
  {
    type: "response",
    contextId: "context-main",
    pageId: "page-main",
    url: "https://app.example.test/api/profile",
    status: 200,
    sources: [],
  },
  {
    type: "security-response",
    contextId: "context-main",
    pageId: "page-main",
    response: {
      url: "https://app.example.test/dashboard",
      method: "GET",
      resourceType: "document",
      frameKind: "main",
      status: 200,
      headers: {
        contentSecurityPolicy: "default-src 'self'",
        strictTransportSecurity: "max-age=31536000; includeSubDomains",
        xContentTypeOptions: "nosniff",
      },
      cookies: [{ name: "session_id", secure: true, httpOnly: true, sameSite: "lax" }],
    },
  },
  {
    type: "http-response",
    contextId: "context-main",
    pageId: "page-main",
    url: "https://app.example.test/api/recommendations/123",
    method: "GET",
    resourceType: "fetch",
    frameKind: "main",
    status: 503,
  },
  {
    type: "console",
    contextId: "context-main",
    pageId: "page-main",
    sink: {
      kind: "console",
      level: "error",
      materials: [{ location: "console.text", value: `Rendering failed for ${privateEmail}` }],
      argumentCount: 1,
      pageUrl: "https://app.example.test/dashboard",
      timestamp: 0,
    },
  },
  {
    type: "page-error",
    contextId: "context-main",
    pageId: "page-main",
    name: "TypeError",
    message: `Widget failed for ${privateEmail}`,
  },
  {
    type: "storage",
    contextId: "context-main",
    pageId: "page-main",
    sink: {
      kind: "storage",
      storageType: "local-storage",
      key: "profile-email",
      value: privateEmail,
      pageUrl: "https://app.example.test/dashboard",
      observedBy: "write",
      timestamp: 0,
    },
  },
  {
    type: "security-cookie",
    contextId: "context-main",
    cookie: {
      name: "session_id",
      domain: "app.example.test",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    },
  },
];

const createHost = () =>
  new AnalyzerHost([
    new PrivacyRuntimeAnalyzer({ firstParty, syntheticEmailDomains: [] }),
    new DependencyRuntimeAnalyzer(firstParty),
    new SecurityPostureAnalyzer(firstParty),
    new RuntimeFailureAnalyzer(firstParty),
  ]);

const runScenario = async (events, runtimeCapabilities = capabilities()) => {
  const host = createHost();
  const adapter = new SyntheticRuntimeAdapter(host, {
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
    capabilities: runtimeCapabilities,
    clock: () => 1_000,
  });
  const metadata = events.map((event) => adapter.emit(event));
  const result = await adapter.finalize(testMetadata);
  adapter.dispose();
  return { metadata, result };
};

const canonicalFlow = (flow) =>
  JSON.stringify([
    flow.dataCategory,
    flow.sourceKind,
    flow.sinkKind,
    flow.recipient?.origin ?? null,
    flow.method ?? null,
    flow.endpoint ?? null,
    flow.location ?? null,
    flow.transform,
    flow.requestSurface,
  ]);

const canonicalProjection = (result) => {
  const privacy = result.results.get("privacy");
  const dependency = result.results.get("dependency");
  const security = result.results.get("security");
  const runtime = result.results.get("runtime-failure");
  const privacyFlows = privacy.observations
    .filter((entry) => entry.kind === "data-flow")
    .map(canonicalFlow)
    .sort();
  return {
    coverage: {
      privacy: privacy.coverage.status,
      dependency: dependency.coverage,
      security: security.coverage,
      runtime: runtime.coverage,
    },
    privacyFlows,
    privacyFindings: privacy.observations
      .filter((entry) => entry.kind === "finding")
      .map((entry) => `${entry.ruleId}:${canonicalFlow(entry.flow)}`)
      .sort(),
    dependencies: dependency.inventory,
    security: security.inventory,
    runtime: runtime.inventory,
  };
};

test("synthetic adapter owns lifecycle metadata without framework object types", async () => {
  const harnessSource = await readFile(
    new URL("../fixtures/runtime-portability/synthetic-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    harnessSource,
    /@playwright|BrowserContext|ConsoleMessage|\bPage\b|\bRequest\b|\bResponse\b/u,
  );

  const privateEmail = ["portable-person", "example.test"].join("@");
  const { metadata } = await runScenario(scenarioEvents(privateEmail));
  assert.deepEqual(
    metadata.slice(0, 3).map(({ seq, contextId, pageId, timestamp }) => ({
      seq,
      contextId,
      pageId,
      timestamp,
    })),
    [
      { seq: 1, contextId: "context-main", pageId: undefined, timestamp: 1_000 },
      { seq: 2, contextId: "context-main", pageId: "page-main", timestamp: 1_000 },
      { seq: 3, contextId: "context-main", pageId: "page-main", timestamp: 1_000 },
    ],
  );
  assert.equal(
    metadata.every((entry) => Object.isFrozen(entry)),
    true,
  );
});

test("core analyzer identities are stable across permitted synthetic event orders", async () => {
  const privateEmail = ["portable-person", "example.test"].join("@");
  const events = scenarioEvents(privateEmail);
  const permutations = [
    events,
    events.toReversed(),
    [...events.slice(4), ...events.slice(0, 4)],
    events.map((_, index) => events[(index * 5) % events.length]),
  ];
  const projections = [];
  for (const permutation of permutations) {
    projections.push(canonicalProjection((await runScenario(permutation)).result));
  }
  for (const projection of projections.slice(1)) assert.deepEqual(projection, projections[0]);

  const reference = projections[0];
  assert.equal(reference.privacyFlows.length >= 3, true);
  assert.equal(
    reference.privacyFindings.some((finding) => finding.startsWith("PS1004:")),
    true,
  );
  assert.equal(
    reference.dependencies.some((entry) => entry.host === "analytics.example.test"),
    true,
  );
  assert.equal(
    reference.security.some((entry) => entry.host === "app.example.test"),
    true,
  );
  assert.equal(
    reference.runtime.some((entry) => entry.failureType === "page-error"),
    true,
  );
  assert.equal(
    reference.runtime.some((entry) => entry.failureType === "http-5xx"),
    true,
  );
  assert.equal(JSON.stringify(reference).includes(privateEmail), false);
});

test("adapter-owned missing capabilities propagate to every module and overall inconclusive", async () => {
  const privateEmail = ["portable-person", "example.test"].join("@");
  const { result } = await runScenario(scenarioEvents(privateEmail), capabilities(false));
  const projection = canonicalProjection(result);
  assert.deepEqual(projection.coverage, {
    privacy: "unsupported",
    dependency: "unsupported",
    security: "unsupported",
    runtime: "unsupported",
  });

  const generatedAt = "2026-08-29T12:00:00.000Z";
  const dependency = result.results.get("dependency");
  const security = result.results.get("security");
  const runtime = result.results.get("runtime-failure");
  const report = createPrivacySpecReport({
    generatedAt,
    startedAt: "2026-08-29T11:59:59.000Z",
    playwrightStatus: "passed",
    privacyspecStatus: "incomplete",
    complete: false,
    projects: [testMetadata.projectName],
    tests: {
      total: 1,
      observed: 1,
      passed: 1,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      interrupted: 0,
    },
    sourceCounts: new Map(),
    sinkCounts: new Map(),
    suiteDurationMilliseconds: 1,
    cumulativeTestDurationMilliseconds: 1,
    flows: [],
    findings: [],
    comparison: { observed: [], known: [], new: [], resolved: [] },
    baselineExists: false,
    diagnostics: [],
    integrationErrors: [],
    ruleMappings: [],
    profileMappings: [],
    observationCoverage: {
      status: "unsupported",
      tests: { attempts: 1, observed: 1 },
      ...observation(false),
      diagnostics: [
        {
          code: "COVERAGE_UNSUPPORTED_CONTEXT",
          message: "Synthetic adapter declared incomplete context and page instrumentation.",
        },
      ],
    },
    secondaryAnalysis: {
      dependencies: {
        schemaVersion: 1,
        generatedAt,
        complete: false,
        coverage: dependency.coverage,
        inventory: dependency.inventory,
        findings: [],
        baseline: { exists: false, known: 0, new: 0, resolved: 0 },
        diagnostics: dependency.diagnostics,
      },
      security: {
        schemaVersion: 1,
        generatedAt,
        complete: false,
        coverage: security.coverage,
        inventory: security.inventory,
        findings: [],
        baseline: { exists: false, known: 0, changed: 0, newTargets: 0, resolved: 0 },
        diagnostics: security.diagnostics,
      },
      runtimeErrors: {
        schemaVersion: 1,
        generatedAt,
        complete: false,
        coverage: runtime.coverage,
        inventory: runtime.inventory,
        findings: [],
        baseline: { exists: false, known: 0, new: 0, resolved: 0 },
        diagnostics: runtime.diagnostics,
      },
    },
  });
  assert.deepEqual(
    [
      report.analysis.privacy.status,
      report.analysis.dependencies.status,
      report.analysis.security.status,
      report.analysis.runtimeErrors.status,
      report.analysis.status,
    ],
    ["inconclusive", "inconclusive", "inconclusive", "inconclusive", "inconclusive"],
  );
  assert.deepEqual(parsePrivacySpecReportV5(structuredClone(report)), report);
});
