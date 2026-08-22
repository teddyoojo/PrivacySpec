import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVACY_ANALYZER_ID,
  PrivacyRuntimeAnalyzer,
  privacyAnalyzerFailureDiagnostics,
} from "../dist/analyzers/privacy/analyzer.js";
import { createResponseJsonCoverage } from "../dist/discovery/response-json.js";
import { PendingWorkRegistry } from "../dist/playwright/finalization.js";
import { AnalyzerHost } from "../dist/runtime/analyzer.js";
import {
  createRuntimeCapabilityModel,
  resolveAnalyzerCapabilityCoverage,
} from "../dist/runtime/capabilities.js";
import { RuntimeEventMetadataFactory } from "../dist/runtime/events.js";
import { namespacedAnalysisIdentity, PRIVACY_ANALYSIS_MODULE } from "../dist/runtime/modules.js";

const observationCoverage = {
  browserObjects: { seen: 1 },
  contexts: { seen: 1, instrumented: 1 },
  pages: { seen: 1, instrumented: 1, storageCapable: 1 },
  events: { navigations: 1, network: 1, console: 0 },
};

const completeCapabilities = () =>
  createRuntimeCapabilityModel({
    observation: observationCoverage,
    responseJson: createResponseJsonCoverage(false),
    observerWorkFailed: false,
  });

test("runtime metadata keeps stable test/project/object identities and monotonic sequences", () => {
  const contextA = {};
  const contextB = {};
  const pageA = {};
  const factory = new RuntimeEventMetadataFactory(
    { testId: "stable-test-id", projectName: "chromium" },
    () => 1_234,
  );

  const first = factory.create({ context: contextA, page: pageA });
  const second = factory.create({ context: contextA, page: pageA });
  const third = factory.create({ context: contextB });

  assert.deepEqual([first.seq, second.seq, third.seq], [1, 2, 3]);
  assert.equal(first.testId, "stable-test-id");
  assert.equal(first.projectName, "chromium");
  assert.equal(first.contextId, second.contextId);
  assert.equal(first.pageId, second.pageId);
  assert.notEqual(first.contextId, third.contextId);
  assert.equal(first.timestamp, 1_234);
  assert.equal(Object.isFrozen(first), true);
});

test("capability requirements distinguish required coverage from optional disabled observers", () => {
  const capabilities = completeCapabilities();
  const coverage = resolveAnalyzerCapabilityCoverage(capabilities, {
    required: ["network", "sensitive-sources"],
    optional: ["responses", "response-bodies"],
  });

  assert.equal(coverage.status, "complete");
  assert.equal(coverage.optional.responses, "disabled");
  assert.equal(coverage.optional["response-bodies"], "disabled");

  const unsupported = createRuntimeCapabilityModel({
    observation: {
      ...observationCoverage,
      contexts: { seen: 2, instrumented: 1 },
      pages: { seen: 2, instrumented: 1, storageCapable: 2 },
    },
    responseJson: createResponseJsonCoverage(false),
    observerWorkFailed: false,
  });
  assert.equal(
    resolveAnalyzerCapabilityCoverage(unsupported, { required: ["custom-contexts"] }).status,
    "unsupported",
  );
});

test("analyzer failures are isolated and diagnostics are namespaced without error text", async () => {
  const healthyEvents = [];
  const host = new AnalyzerHost([
    {
      id: "failing",
      capabilities: { required: ["network"] },
      onEvent() {
        throw new Error("private runtime material must not become a diagnostic");
      },
    },
    {
      id: "healthy",
      capabilities: { required: ["network"] },
      onEvent(event) {
        healthyEvents.push(event.meta.seq);
      },
      finalizeTest() {
        return { eventCount: healthyEvents.length };
      },
    },
  ]);
  const meta = new RuntimeEventMetadataFactory({ testId: "test", projectName: "chromium" });
  host.emit({
    type: "context-created",
    meta: meta.create({ context: {} }),
    instrumented: true,
  });

  const result = await host.finalizeTest({
    test: {
      testId: "test",
      file: "tests/runtime.spec.ts",
      title: "runtime abstraction",
      projectName: "chromium",
    },
    capabilities: completeCapabilities(),
  });
  assert.deepEqual(result.results.get("healthy"), { eventCount: 1 });
  assert.deepEqual(result.diagnostics, [
    {
      analyzerId: "failing",
      code: "analyzer.failing.event",
      phase: "event",
    },
  ]);
  assert.equal(JSON.stringify(result.diagnostics).includes("private runtime material"), false);
  host.dispose();
});

test("asynchronous analyzer work remains inside bounded observer finalization", async () => {
  const host = new AnalyzerHost([
    {
      id: "async-analyzer",
      capabilities: { required: ["network"] },
      onEvent() {
        return new Promise(() => {});
      },
    },
  ]);
  const metadata = new RuntimeEventMetadataFactory({ testId: "test", projectName: "chromium" });
  host.emit({
    type: "context-created",
    meta: metadata.create({ context: {} }),
    instrumented: true,
  });
  const pending = new PendingWorkRegistry(10);
  pending.track(
    "analyzers",
    host.finalizeTest({
      test: {
        testId: "test",
        file: "tests/runtime.spec.ts",
        title: "bounded analyzer work",
        projectName: "chromium",
      },
      capabilities: completeCapabilities(),
    }),
  );

  const result = await pending.drain();
  assert.equal(result.complete, false);
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.pending, ["analyzers"]);
  host.dispose();
});

test("privacy observation, correlation, and rules run behind the analyzer boundary", async () => {
  const privateEmail = ["runtime-boundary", "example.test"].join("@");
  const analyzer = new PrivacyRuntimeAnalyzer({
    firstParty: { origins: ["https://app.example.test"] },
    syntheticEmailDomains: [],
  });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: "privacy-test",
    projectName: "chromium",
  });
  const context = {};
  const page = {};
  host.emit({
    type: "sensitive-source",
    meta: metadata.create({ context, page }),
    source: {
      kind: "control",
      raw: privateEmail,
      category: "personal.email",
      confidence: "high",
      evidence: [{ kind: "input-type", value: "email" }],
      control: { elementKind: "input", type: "email" },
      pageUrl: "https://app.example.test/customer",
      timestamp: 0,
      observedBy: "event",
    },
  });
  host.emit({
    type: "request",
    meta: metadata.create({ context, page }),
    sink: {
      kind: "network",
      url: "https://analytics.example.test/event",
      method: "POST",
      resourceType: "fetch",
      headers: {},
      bodyKind: "json",
      bodySize: privateEmail.length,
      bodyTruncated: false,
      materials: [{ location: "json.email", value: privateEmail }],
      pageUrl: "https://app.example.test/customer",
      timestamp: 0,
    },
  });

  const result = await host.finalizeTest({
    test: {
      testId: "privacy-test",
      file: "tests/customer.spec.ts",
      title: "customer can be created",
      projectName: "chromium",
    },
    capabilities: completeCapabilities(),
  });
  const privacy = result.results.get(PRIVACY_ANALYZER_ID);
  assert.ok(privacy);
  assert.equal(
    privacy.observations.some(
      (observation) => observation.kind === "finding" && observation.ruleId === "PS1004",
    ),
    true,
  );
  assert.equal(JSON.stringify(privacy).includes(privateEmail), false);
  host.dispose();
});

test("privacy module ownership is namespaced internally but not added to persisted identities", () => {
  const persistedIdentity = '["PS1004","personal.email"]';
  assert.equal(
    namespacedAnalysisIdentity(PRIVACY_ANALYSIS_MODULE, persistedIdentity),
    `privacy:${persistedIdentity}`,
  );
  assert.equal(persistedIdentity.startsWith("privacy:"), false);
});

test("privacy analyzer host failures map to one fixed fail-closed diagnostic", () => {
  assert.deepEqual(
    privacyAnalyzerFailureDiagnostics([
      {
        analyzerId: "privacy",
        code: "analyzer.privacy.event",
        phase: "event",
      },
      {
        analyzerId: "privacy",
        code: "analyzer.privacy.finalize-test",
        phase: "finalize-test",
      },
    ]),
    [
      {
        kind: "diagnostic",
        code: "PS_ANALYZER_PRIVACY_FAILED",
        classification: "informational",
        message: "The privacy analyzer failed inside the bounded runtime analyzer host.",
      },
    ],
  );
});
