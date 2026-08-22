import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SENSITIVE_SOURCES_PER_TEST,
  SensitiveValueRegistry,
} from "../dist/discovery/sensitive-registry.js";

const source = (raw, category = "personal.email") => ({
  raw,
  category,
  confidence: "high",
  evidence: [{ kind: "input-type", value: category === "personal.phone" ? "tel" : "email" }],
  control: {
    elementKind: "input",
    type: category === "personal.phone" ? "tel" : "email",
  },
  pageUrl: "https://app.example.test/form",
  timestamp: Date.now(),
  observedBy: "event",
});

test("registries accept only their own stream token and erase values on disposal", () => {
  const registryA = new SensitiveValueRegistry();
  const registryB = new SensitiveValueRegistry();
  const rawA = ["worker-a", "example.test"].join("@");
  const rawB = ["worker-b", "example.test"].join("@");

  registryA.recordStreamEvent({
    version: 1,
    token: registryA.streamToken,
    kind: "source",
    source: source(rawA),
  });
  registryB.recordStreamEvent({
    version: 1,
    token: registryB.streamToken,
    kind: "source",
    source: source(rawB),
  });
  registryA.recordStreamEvent({
    version: 1,
    token: registryB.streamToken,
    kind: "source",
    source: source(rawB),
  });

  assert.equal(registryA.snapshot().sources.length, 1);
  assert.equal(registryB.snapshot().sources.length, 1);
  assert.equal(registryA.snapshot().sources[0]?.raw === rawA, true);
  assert.equal(registryB.snapshot().sources[0]?.raw === rawB, true);

  registryA.dispose();
  registryA.add(source(rawB));
  assert.deepEqual(registryA.snapshot(), { sources: [], limitReached: false });
  assert.equal(registryB.snapshot().sources[0]?.raw === rawB, true);
  registryB.dispose();
});

test("streamed control sources retain the browser's captured native event time", () => {
  const registry = new SensitiveValueRegistry();
  const streamed = source(["streamed", "example.test"].join("@"));
  registry.recordStreamEvent({
    version: 1,
    token: registry.streamToken,
    kind: "source",
    source: { ...streamed, timestamp: 10 },
  });
  registry.add({
    ...source(["fallback", "example.test"].join("@")),
    observedBy: "fallback",
    timestamp: 20,
  });

  assert.deepEqual(
    registry.snapshot().sources.map((source) => source.timestamp),
    [10, 20],
  );
  registry.dispose();
});

test("duplicate response sources retain the earliest event regardless of parse order", () => {
  const registry = new SensitiveValueRegistry();
  const raw = ["response", "example.test"].join("@");
  const responseSource = (timestamp) => ({
    kind: "response-json",
    raw,
    category: "personal.email",
    confidence: "high",
    evidence: [{ kind: "json-key", value: "email" }],
    provenance: {
      origin: "https://app.example.test",
      endpoint: "/api/profile",
      location: "json.email",
    },
    timestamp,
    observedBy: "response",
  });

  assert.equal(registry.addResponse(responseSource(50)), "added");
  assert.equal(registry.addResponse(responseSource(10)), "duplicate");
  assert.equal(registry.snapshot().sources[0]?.timestamp, 10);
  registry.dispose();
});

test("registry validates page payloads, deduplicates values, and reports its safety limit", () => {
  const registry = new SensitiveValueRegistry();
  const duplicate = ["duplicate", "example.test"].join("@");
  registry.add(source(duplicate));
  registry.add(source(duplicate));
  registry.add({ raw: "not enough structure" });

  for (let index = 1; index <= MAX_SENSITIVE_SOURCES_PER_TEST; index += 1) {
    registry.add(source(`bounded-${index}@example.test`));
  }

  const snapshot = registry.snapshot();
  assert.equal(snapshot.sources.length, MAX_SENSITIVE_SOURCES_PER_TEST);
  assert.equal(snapshot.limitReached, true);
  registry.dispose();
});

test("registry recomputes classification instead of trusting page evidence", () => {
  const registry = new SensitiveValueRegistry();
  const raw = ["recomputed", "example.test"].join("@");
  registry.add({
    ...source(raw),
    category: "secret.api_token",
    confidence: "low",
    evidence: [{ kind: "label", value: raw }],
  });

  const captured = registry.snapshot().sources[0];
  assert.equal(captured?.category, "personal.email");
  assert.equal(captured?.confidence, "high");
  assert.deepEqual(captured?.evidence, [{ kind: "input-type", value: "email" }]);
  registry.dispose();
});
