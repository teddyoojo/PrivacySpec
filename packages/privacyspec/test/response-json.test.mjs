import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { correlateSensitiveData } from "../dist/correlate/match.js";
import {
  discoverResponseJsonSources,
  isJsonMediaType,
  MAX_RESPONSE_JSON_BYTES,
  MAX_RESPONSE_JSON_CONCURRENCY,
  MAX_RESPONSE_JSON_QUEUE,
} from "../dist/discovery/response-json.js";
import { SensitiveValueRegistry } from "../dist/discovery/sensitive-registry.js";
import { FirstPartyJsonResponseObserver } from "../dist/playwright/response-observer.js";

const provenance = {
  origin: "https://app.example.test",
  endpoint: "/api/customer",
};

test("JSON response discovery requires recognized keys and valid email or phone shapes", () => {
  const email = ["response-user", "example.test"].join("@");
  const result = discoverResponseJsonSources(
    JSON.stringify({
      customer: {
        emailAddress: email,
        phone_number: "+49 170 1234567",
        password: "not-a-response-source",
        name: email,
        postalAddress: ["123", "Fixture", "Avenue"].join(" "),
        dateOfBirth: ["1990", "01", "02"].join("-"),
        accountIdentifier: ["customer", "fixture", "42"].join("-"),
        cardNumber: ["4242", "4242", "4242", "4242"].join(" "),
        genderIdentity: "Nonbinary",
        jobTitle: "Software Engineer",
        identifier: "+49 170 1234567",
        email: "not-an-email",
        secondary: { email: ["unicode-domain", "exam\u212Ale.test"].join("@") },
        phone: "123",
      },
    }),
    provenance,
    42,
  );

  assert.equal(result.invalidJson, false);
  assert.equal(result.traversalLimitReached, false);
  assert.deepEqual(
    result.sources.map((source) => ({
      category: source.category,
      location: source.provenance.location,
      timestamp: source.timestamp,
    })),
    [
      { category: "personal.email", location: "json.customer.emailAddress", timestamp: 42 },
      { category: "personal.phone", location: "json.customer.phone_number", timestamp: 42 },
    ],
  );
  assert.equal(
    result.sources.some((source) => source.category === "secret.password"),
    false,
  );
});

test("JSON response discovery rejects malformed JSON and discards traversal-limited values", () => {
  assert.equal(discoverResponseJsonSources("{", provenance, 1).invalidJson, true);
  let nested = { email: ["deep", "example.test"].join("@") };
  for (let index = 0; index < 12; index += 1) nested = { nested };
  const limited = discoverResponseJsonSources(JSON.stringify(nested), provenance, 1);
  assert.equal(limited.traversalLimitReached, true);
  assert.deepEqual(limited.sources, []);
});

test("JSON media matching accepts application JSON types only", () => {
  assert.equal(isJsonMediaType("application/json; charset=utf-8"), true);
  assert.equal(isJsonMediaType("application/problem+json"), true);
  assert.equal(isJsonMediaType("text/json"), false);
  assert.equal(isJsonMediaType("text/plain; profile=application/json"), false);
});

class FakeContext extends EventEmitter {
  off(name, listener) {
    this.removeListener(name, listener);
    return this;
  }
}

const fakeResponse = ({
  url = "https://app.example.test/api/customer",
  contentType = "application/json",
  payload = JSON.stringify({ email: ["runtime", "example.test"].join("@") }),
  length = "auto",
  body,
} = {}) => {
  let bodyReads = 0;
  const request = {};
  const declaredLength = length === "auto" ? Buffer.byteLength(payload) : length;
  return {
    url: () => url,
    headers: () => ({
      "content-type": contentType,
      ...(declaredLength === null ? {} : { "content-length": String(declaredLength) }),
    }),
    body: async () => {
      bodyReads += 1;
      return body === undefined ? Buffer.from(payload) : body();
    },
    bodyReads: () => bodyReads,
    request: () => request,
  };
};

test("response observer filters boundaries and media types and records sanitized coverage", async () => {
  const registry = new SensitiveValueRegistry();
  const context = new FakeContext();
  const observer = new FirstPartyJsonResponseObserver(registry, {
    origins: ["https://app.example.test"],
  });
  observer.attach(context);

  const external = fakeResponse({ url: "https://api.example.test/customer" });
  const text = fakeResponse({ contentType: "text/plain" });
  const unknown = fakeResponse({ length: null });
  const oversized = fakeResponse({ length: MAX_RESPONSE_JSON_BYTES + 1 });
  const valid = fakeResponse();
  for (const response of [external, text, unknown, oversized, valid]) {
    context.emit("response", response);
  }
  observer.detach();
  await observer.flush();

  const coverage = observer.snapshot();
  assert.deepEqual(coverage.responses, {
    seen: 5,
    firstParty: 4,
    json: 3,
    parsed: 1,
    withSources: 1,
  });
  assert.equal(coverage.skipped.unknownLength, 1);
  assert.equal(coverage.skipped.oversized, 1);
  assert.equal(coverage.discoveredSources.byCategory["personal.email"], 1);
  assert.equal(external.bodyReads(), 0);
  assert.equal(text.bodyReads(), 0);
  assert.equal(unknown.bodyReads(), 0);
  assert.equal(oversized.bodyReads(), 0);
  assert.equal(valid.bodyReads(), 1);
  assert.equal(registry.snapshot().sources[0]?.kind, "response-json");
  registry.dispose();
});

test("response sources use response-event time instead of asynchronous body completion time", async () => {
  const registry = new SensitiveValueRegistry();
  const context = new FakeContext();
  let timestamp = 10;
  let releaseBody;
  const bodyGate = new Promise((resolve) => {
    releaseBody = resolve;
  });
  const observer = new FirstPartyJsonResponseObserver(
    registry,
    { origins: ["https://app.example.test"] },
    () => timestamp,
  );
  observer.attach(context);
  context.emit(
    "response",
    fakeResponse({
      body: async () => {
        await bodyGate;
        return Buffer.from(JSON.stringify({ email: ["event-time", "example.test"].join("@") }));
      },
    }),
  );
  timestamp = 20;
  releaseBody();
  await observer.flush();

  assert.equal(registry.snapshot().sources[0]?.timestamp, 10);
  registry.dispose();
});

test("response observer clears read buffers and reports body parsing failures", async () => {
  const registry = new SensitiveValueRegistry();
  const context = new FakeContext();
  const observer = new FirstPartyJsonResponseObserver(registry, {
    origins: ["https://app.example.test"],
  });
  observer.attach(context);

  const validBuffer = Buffer.from(JSON.stringify({ email: ["cleared", "example.test"].join("@") }));
  const malformedBuffer = Buffer.from("{");
  const oversizedBuffer = Buffer.alloc(MAX_RESPONSE_JSON_BYTES + 1, 97);
  context.emit("response", fakeResponse({ body: () => validBuffer }));
  context.emit("response", fakeResponse({ payload: "{", body: () => malformedBuffer }));
  context.emit("response", fakeResponse({ length: 1, body: () => oversizedBuffer }));
  context.emit(
    "response",
    fakeResponse({
      body: async () => {
        throw new Error("disposable body read failure");
      },
    }),
  );
  observer.detach();
  await observer.flush();

  const coverage = observer.snapshot();
  assert.equal(coverage.responses.parsed, 1);
  assert.equal(coverage.skipped.invalidJson, 1);
  assert.equal(coverage.skipped.oversized, 1);
  assert.equal(coverage.skipped.bodyReadError, 1);
  assert.equal(
    validBuffer.every((byte) => byte === 0),
    true,
  );
  assert.equal(
    malformedBuffer.every((byte) => byte === 0),
    true,
  );
  assert.equal(
    oversizedBuffer.every((byte) => byte === 0),
    true,
  );
  registry.dispose();
});

test("response observer bounds aggregate material and queued asynchronous work", async () => {
  const registry = new SensitiveValueRegistry();
  const context = new FakeContext();
  const observer = new FirstPartyJsonResponseObserver(registry, {
    origins: ["https://app.example.test"],
  });
  observer.attach(context);

  for (let index = 0; index < 9; index += 1) {
    context.emit(
      "response",
      fakeResponse({
        url: `https://app.example.test/api/aggregate/${index}`,
        length: MAX_RESPONSE_JSON_BYTES,
        payload: JSON.stringify({ marker: index }),
      }),
    );
  }
  await observer.flush();
  assert.equal(observer.snapshot().skipped.aggregateLimit, 1);

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queuedObserver = new FirstPartyJsonResponseObserver(registry, {
    origins: ["https://app.example.test"],
  });
  queuedObserver.attach(context);
  for (
    let index = 0;
    index < MAX_RESPONSE_JSON_CONCURRENCY + MAX_RESPONSE_JSON_QUEUE + 1;
    index += 1
  ) {
    context.emit(
      "response",
      fakeResponse({
        url: `https://app.example.test/api/work/${index}`,
        body: async () => {
          await gate;
          return Buffer.from(JSON.stringify({ marker: index }));
        },
      }),
    );
  }
  assert.equal(queuedObserver.snapshot().skipped.workLimit, 1);
  release();
  queuedObserver.detach();
  await queuedObserver.flush();
  registry.dispose();
});

test("response sources correlate to later events and final storage snapshots", () => {
  const email = ["timed-response", "example.test"].join("@");
  const source = discoverResponseJsonSources(JSON.stringify({ email }), provenance, 20).sources[0];
  assert.ok(source);
  source.requestIdentity = 7;
  const sink = (timestamp) => ({
    kind: "network",
    url: "https://analytics.example.test/event",
    method: "POST",
    resourceType: "fetch",
    headers: { "content-type": "application/json" },
    bodyKind: "json",
    bodySize: 64,
    bodyTruncated: false,
    materials: [{ location: "json.email", value: email }],
    timestamp,
  });
  const result = correlateSensitiveData({
    sources: [source],
    sinks: [
      sink(19),
      sink(20),
      { ...sink(21), requestIdentity: 7 },
      {
        ...sink(22),
        materials: [{ location: "json.later", value: email }],
      },
      {
        kind: "storage",
        storageType: "cookie",
        key: "auth",
        value: email,
        pageUrl: "https://app.example.test/",
        observedBy: "snapshot",
        timestamp: 19,
      },
    ],
    firstParty: { origins: ["https://app.example.test"] },
    test: { file: "response.spec.ts", title: "ordinary journey", project: "chromium" },
  });

  assert.deepEqual(
    result.flows.map((flow) => flow.sinkKind),
    ["cookie", "external-request"],
  );
  assert.equal(result.flows[0].sourceKind, "response-json");
  assert.deepEqual(result.flows[0].sourceProvenance, {
    ...provenance,
    location: "json.email",
  });
  assert.equal(
    result.flows.some((flow) => flow.location === "json.email"),
    false,
  );
  assert.equal(
    result.flows.some((flow) => flow.location === "json.later"),
    true,
  );
  assert.equal(JSON.stringify(result).includes("requestIdentity"), false);
});
