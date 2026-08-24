import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { correlateSensitiveData } from "../dist/correlate/match.js";
import { finalizationDiagnostics, PendingWorkRegistry } from "../dist/playwright/finalization.js";
import { evaluateDataFlows } from "../dist/rules/engine.js";

test("pending observer work drains once and reports bounded failure states", async () => {
  const complete = new PendingWorkRegistry(100);
  complete.track("network", Promise.resolve());
  complete.track("storage-snapshot", Promise.resolve());
  assert.deepEqual(await complete.drain(), {
    complete: true,
    failed: [],
    pending: [],
    timedOut: false,
  });

  const failed = new PendingWorkRegistry(100);
  failed.track("source-fallback", Promise.reject(new Error("fixture failure")));
  const failedResult = await failed.drain();
  assert.deepEqual(failedResult, {
    complete: false,
    failed: ["source-fallback"],
    pending: [],
    timedOut: false,
  });
  assert.deepEqual(finalizationDiagnostics(failedResult), [
    {
      kind: "diagnostic",
      code: "PS_OBSERVER_FINALIZATION_FAILED",
      classification: "informational",
      message: "Observer finalization failed before the event set could be completed.",
    },
  ]);

  const timedOut = new PendingWorkRegistry(10);
  timedOut.track("responses", new Promise(() => {}));
  const timeoutResult = await timedOut.drain();
  assert.deepEqual(timeoutResult, {
    complete: false,
    failed: [],
    pending: ["responses"],
    timedOut: true,
  });
  assert.equal(finalizationDiagnostics(timeoutResult)[0]?.code, "PS_OBSERVER_FINALIZATION_TIMEOUT");
});

const controlSource = (raw, category, pageUrl, type) => ({
  kind: "control",
  raw,
  category,
  confidence: "high",
  evidence: [{ kind: "input-type", value: type }],
  control: { elementKind: "input", type },
  pageUrl,
  timestamp: 2,
  observedBy: "event",
});

const networkSink = (overrides = {}) => ({
  kind: "network",
  url: "https://app.example.test/collect",
  method: "POST",
  resourceType: "fetch",
  headers: {},
  bodyKind: "json",
  bodySize: 0,
  bodyTruncated: false,
  materials: [],
  pageUrl: "https://app.example.test/form",
  timestamp: 10,
  ...overrides,
});

const rotate = (values, offset) =>
  values.map((_, index) => values[(index + offset) % values.length]);

test("semantic digest is stable across 25 lifecycle-order permutations", () => {
  const email = ["repeatable", "example.test"].join("@");
  const phone = ["+49", "170", "1234567"].join("");
  const popupSecret = ["popup", "secret", "fixture"].join("-");
  const sources = [
    controlSource(email, "personal.email", "https://app.example.test/form", "email"),
    controlSource(popupSecret, "secret.password", "https://app.example.test/popup", "password"),
    {
      kind: "response-json",
      raw: phone,
      category: "personal.phone",
      confidence: "high",
      evidence: [{ kind: "json-key", value: "phone" }],
      provenance: {
        origin: "https://app.example.test",
        endpoint: "/api/customer",
        location: "json.customer.phone",
      },
      timestamp: 20,
      observedBy: "response",
      requestIdentity: 7,
    },
  ];
  const sinks = [
    networkSink({
      bodySize: email.length,
      materials: [{ location: "json.email", value: email }],
    }),
    networkSink({
      url: "https://app.example.test/api/customer",
      requestIdentity: 7,
      materials: [{ location: "json.phone", value: phone }],
    }),
    networkSink({
      url: "https://receiver.example.test/event",
      timestamp: 30,
      materials: [{ location: "json.phone", value: phone }],
    }),
    {
      kind: "storage",
      storageType: "local-storage",
      key: "draft",
      value: popupSecret,
      pageUrl: "https://app.example.test/popup",
      observedBy: "write",
      timestamp: 12,
    },
    {
      kind: "storage",
      storageType: "cookie",
      key: "profile",
      value: phone,
      pageUrl: "https://app.example.test/",
      observedBy: "snapshot",
      timestamp: 0,
    },
  ];
  const digests = new Set();
  let representative;

  for (let iteration = 0; iteration < 25; iteration += 1) {
    const result = correlateSensitiveData({
      sources: rotate(sources, iteration % sources.length),
      sinks: rotate(sinks, iteration % sinks.length),
      pageUrls: [`https://app.example.test/customers?email=${encodeURIComponent(email)}`],
      firstParty: { origins: ["https://app.example.test"] },
      test: {
        file: "tests/repeatability.spec.ts",
        title: "navigation and popup lifecycle",
        project: "chromium",
      },
    });
    const findings = evaluateDataFlows(result.flows);
    const semantic = JSON.stringify({ flows: result.flows, findings });
    representative ??= { result, findings, semantic };
    digests.add(createHash("sha256").update(semantic).digest("hex"));
  }

  assert.equal(digests.size, 1);
  assert.deepEqual(Array.from(digests), [
    "92b9abd77210e85dd2d5489ded3a2159e300d4d34d49982e05403306bc15110c",
  ]);
  assert.equal(representative.result.limitReached, false);
  assert.deepEqual(
    Array.from(new Set(representative.result.flows.map((flow) => flow.sinkKind))).sort(),
    ["cookie", "external-request", "local-storage", "request-body", "request-url"],
  );
  assert.equal(
    representative.findings.some((finding) => finding.ruleId === "PS1005"),
    true,
  );
  for (const raw of [email, phone, popupSecret]) {
    assert.equal(representative.semantic.includes(raw), false);
  }
});
