import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { MAX_NETWORK_BODY_BYTES } from "../dist/observe/network.js";
import {
  MAX_NETWORK_RETAINED_BYTES_PER_TEST,
  MAX_NETWORK_SINKS_PER_TEST,
} from "../dist/observe/sink-registry.js";
import {
  APIRequestFixtureObserver,
  createObservedAPIRequestContext,
  MAX_API_CAPTURE_DEPTH,
  MAX_API_CAPTURE_ENTRIES,
} from "../dist/playwright/api-request-observer.js";

const response = (url = "https://app.example.test/final", status = 204) => {
  let bodyReads = 0;
  return {
    value: {
      url: () => url,
      status: () => status,
      headersArray: () => [
        { name: "Content-Security-Policy", value: "default-src 'self'" },
        { name: "Set-Cookie", value: "session_id=not-retained; Secure; HttpOnly; SameSite=Lax" },
      ],
      body: async () => {
        bodyReads += 1;
        throw new Error("response bodies must not be read");
      },
      text: async () => {
        bodyReads += 1;
        throw new Error("response bodies must not be read");
      },
      json: async () => {
        bodyReads += 1;
        throw new Error("response bodies must not be read");
      },
    },
    bodyReads: () => bodyReads,
  };
};

const consumer = () => {
  let sequence = 0;
  const events = [];
  return {
    events,
    reserveAPIRequest() {
      sequence += 1;
      return sequence;
    },
    addAPIRequest(sink, metadata) {
      events.push({ kind: "request", sink, metadata });
    },
    addAPIRequestMetadata(metadata) {
      events.push({ kind: "request-metadata", metadata });
    },
    recordAPIResponse(value) {
      events.push({ kind: "security-response", value });
    },
    recordAPIRequestFailure(metadata) {
      events.push({ kind: "failure", metadata });
    },
    recordAPIHttpResponse(value) {
      events.push({ kind: "http-response", value });
    },
    markLimitReached() {
      events.push({ kind: "limit" });
    },
  };
};

test("request-fixture proxy delegates every network method exactly once and preserves API responses", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(
    true,
    eventConsumer,
    "https://app.example.test/base/",
  );
  const calls = [];
  const returned = response();
  const context = {
    tracing: { id: "same-object" },
    storageState: async function () {
      assert.equal(this, context);
      return { cookies: [], origins: [] };
    },
    dispose: async function () {
      assert.equal(this, context);
    },
  };
  for (const method of ["delete", "fetch", "get", "head", "patch", "post", "put"]) {
    context[method] = async function (...args) {
      assert.equal(this, context);
      calls.push({ method, args });
      return returned.value;
    };
  }
  const wrapped = createObservedAPIRequestContext(context, observer);

  for (const method of ["delete", "fetch", "get", "head", "patch", "post", "put"]) {
    const options = method === "fetch" ? { method: "PATCH" } : undefined;
    assert.equal(await wrapped[method]("relative", options), returned.value);
  }
  assert.equal(calls.length, 7);
  assert.equal(returned.bodyReads(), 0);
  assert.equal(wrapped.tracing, context.tracing);
  assert.deepEqual(await wrapped.storageState(), { cookies: [], origins: [] });
  await wrapped.dispose();
  assert.equal(wrapped.get, wrapped.get);

  const requests = eventConsumer.events.filter((event) => event.kind === "request");
  assert.equal(requests.length, 7);
  assert.equal(
    requests.every((event) => event.sink.requestSurface === "api-request"),
    true,
  );
  assert.equal(
    requests.every((event) => event.sink.url === "https://app.example.test/final"),
    true,
  );
  assert.equal(requests.find((event) => event.metadata.method === "PATCH") !== undefined, true);
  assert.deepEqual(observer.snapshot().calls, {
    seen: 7,
    observed: 7,
    failed: 0,
    serverErrors: 0,
  });
  assert.equal(observer.snapshot().status, "partial");
});

test("enabled observation captures bounded explicit shapes, skips accessors and files, and never reads response bodies", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(true, eventConsumer);
  const returned = response("https://api.example.test/customers?active=true", 503);
  let getterCalls = 0;
  const options = {
    headers: { "X-Explicit": "bounded-header" },
    params: new URLSearchParams({ page: "2" }),
    data: { profile: { contact: "fixture-value" }, enabled: true },
  };
  Object.defineProperty(options, "multipart", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-be-read";
    },
  });
  const context = {
    post: async () => returned.value,
  };
  const wrapped = createObservedAPIRequestContext(context, observer);
  assert.equal(await wrapped.post("https://api.example.test/customers", options), returned.value);

  assert.equal(getterCalls, 0);
  assert.equal(returned.bodyReads(), 0);
  const request = eventConsumer.events.find((event) => event.kind === "request");
  assert.equal(request.sink.bodyKind, "json");
  assert.equal(
    request.sink.materials.some((item) => item.location === "json.profile.contact"),
    true,
  );
  assert.equal(
    request.sink.materials.some((item) => item.location === "url.query.page"),
    true,
  );
  assert.equal(request.sink.headers["x-explicit"], "bounded-header");
  assert.equal(observer.snapshot().skipped.accessors, 1);
  assert.equal(observer.snapshot().calls.serverErrors, 1);
  const security = eventConsumer.events.find((event) => event.kind === "security-response");
  assert.deepEqual(security.value.cookies, [
    { name: "session_id", secure: true, httpOnly: true, sameSite: "lax" },
  ]);
});

test("request argument capture supports buffers, URLSearchParams, and scalar FormData", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(true, eventConsumer);
  const returned = response();
  const context = {
    post: async () => returned.value,
    get: async () => returned.value,
  };
  const wrapped = createObservedAPIRequestContext(context, observer);

  await wrapped.post("https://api.example.test/buffer", {
    data: Buffer.from("bounded-buffer-fixture", "utf8"),
  });
  await wrapped.get("https://api.example.test/params", {
    params: new URLSearchParams({ page: "2" }),
  });
  const form = new FormData();
  form.append("displayName", "Fixture Person");
  await wrapped.post("https://api.example.test/form", { multipart: form });

  const requests = eventConsumer.events.filter((event) => event.kind === "request");
  assert.equal(
    requests.some((event) =>
      event.sink.materials.some(
        (material) =>
          material.location === "body.raw" && material.value === "bounded-buffer-fixture",
      ),
    ),
    true,
  );
  assert.equal(
    requests.some((event) =>
      event.sink.materials.some(
        (material) => material.location === "url.query.page" && material.value === "2",
      ),
    ),
    true,
  );
  assert.equal(
    requests.some((event) =>
      event.sink.materials.some(
        (material) =>
          material.location === "multipart.displayName" && material.value === "Fixture Person",
      ),
    ),
    true,
  );
});

test("disabled detection does not inspect call arguments and enabled failures preserve the original exception", async () => {
  const disabledConsumer = consumer();
  const disabled = new APIRequestFixtureObserver(false, disabledConsumer);
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "data", {
    get() {
      getterCalls += 1;
      throw new Error("must not execute");
    },
  });
  const returned = response();
  const disabledContext = { get: async () => returned.value };
  const disabledWrapped = createObservedAPIRequestContext(disabledContext, disabled);
  assert.equal(await disabledWrapped.get("https://app.example.test", hostile), returned.value);
  assert.equal(getterCalls, 0);
  assert.equal(disabledConsumer.events.length, 0);
  assert.equal(disabled.snapshot().status, "unsupported");

  const enabledConsumer = consumer();
  const enabled = new APIRequestFixtureObserver(true, enabledConsumer);
  const expected = new Error("request failed with sensitive detail");
  const enabledContext = {
    put: async () => {
      throw expected;
    },
  };
  const enabledWrapped = createObservedAPIRequestContext(enabledContext, enabled);
  await assert.rejects(
    enabledWrapped.put("https://api.example.test/failure"),
    (error) => error === expected,
  );
  assert.equal(enabled.snapshot().calls.failed, 1);
  assert.equal(
    enabledConsumer.events.some((event) => event.kind === "failure"),
    true,
  );
  assert.equal(JSON.stringify(enabled.snapshot()).includes(expected.message), false);
});

test("supported option shapes stay bounded and retain only explicit scalar material", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(true, eventConsumer);
  const returned = response();
  const context = {
    post: async () => returned.value,
    get: async () => returned.value,
  };
  const wrapped = createObservedAPIRequestContext(context, observer);

  await wrapped.get("https://api.example.test/query", {
    headers: new Headers({ "X-Fixture": "header-value" }),
    params: "page=3&enabled=true",
  });
  await wrapped.post("https://api.example.test/text", { data: "bounded-text-fixture" });
  await wrapped.post("https://api.example.test/array", { data: ["one", 2, true, null] });
  await wrapped.post("https://api.example.test/form", {
    form: { displayName: "Fixture Person", enabled: true, count: 2 },
  });
  await wrapped.post("https://api.example.test/multipart", {
    multipart: { note: "bounded multipart fixture" },
  });

  const requests = eventConsumer.events.filter((event) => event.kind === "request");
  assert.equal(requests.length, 5);
  assert.equal(requests[0].sink.headers["x-fixture"], "header-value");
  assert.equal(
    requests[0].sink.materials.some(
      (material) => material.location === "url.query.page" && material.value === "3",
    ),
    true,
  );
  assert.equal(requests[1].sink.bodyKind, "text");
  assert.equal(requests[2].sink.bodyKind, "json");
  assert.equal(requests[2].sink.bodyTruncated, false);
  assert.equal(
    requests[3].sink.materials.some(
      (material) => material.location === "form.displayName" && material.value === "Fixture Person",
    ),
    true,
  );
  assert.equal(
    requests[4].sink.materials.some(
      (material) =>
        material.location === "multipart.note" && material.value === "bounded multipart fixture",
    ),
    true,
  );
  assert.equal(returned.bodyReads(), 0);
});

test("deep, sparse, cyclic, accessor, stream, file, and unsupported bodies fail closed", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(true, eventConsumer);
  const returned = response();
  const context = { post: async () => returned.value };
  const wrapped = createObservedAPIRequestContext(context, observer);

  let deep = { leaf: "fixture" };
  for (let depth = 0; depth <= MAX_API_CAPTURE_DEPTH; depth += 1) deep = { child: deep };
  const sparse = [];
  sparse.length = MAX_API_CAPTURE_ENTRIES + 1;
  const cyclic = { value: "fixture" };
  cyclic.self = cyclic;
  let getterCalls = 0;
  const accessorBody = { safe: "fixture" };
  Object.defineProperty(accessorBody, "hidden", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-be-read";
    },
  });
  const fileBody = new FormData();
  fileBody.append("upload", new Blob(["fixture file"]), "fixture.txt");

  for (const data of [deep, sparse, cyclic, accessorBody, Readable.from("fixture"), new Date()]) {
    await wrapped.post("https://api.example.test/body", { data });
  }
  await wrapped.post("https://api.example.test/upload", { multipart: fileBody });

  assert.equal(getterCalls, 0);
  const requests = eventConsumer.events.filter((event) => event.kind === "request");
  assert.equal(requests.length, 7);
  assert.equal(
    requests.every((event) => event.sink.bodyTruncated),
    true,
  );
  assert.equal(
    requests.every((event) => event.sink.materials.length === 0),
    true,
  );
  const coverage = observer.snapshot();
  assert.equal(coverage.skipped.materialLimit >= 2, true);
  assert.equal(coverage.skipped.unsupportedObjects >= 2, true);
  assert.equal(coverage.skipped.accessors, 1);
  assert.equal(coverage.skipped.streams, 1);
  assert.equal(coverage.skipped.files, 1);
  assert.equal(returned.bodyReads(), 0);
});

test("property, material, location, string, buffer, and response-header limits are deterministic", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(true, eventConsumer);
  const excessiveHeaders = Array.from({ length: MAX_API_CAPTURE_ENTRIES + 1 }, (_, index) => ({
    name: `x-fixture-${index}`,
    value: "fixture",
  }));
  const returned = response();
  let responseHeaderCalls = 0;
  const ordinaryHeaders = returned.value.headersArray;
  returned.value.headersArray = () => {
    responseHeaderCalls += 1;
    return responseHeaderCalls === 1 ? excessiveHeaders : ordinaryHeaders();
  };
  const context = { post: async () => returned.value };
  const wrapped = createObservedAPIRequestContext(context, observer);
  const excessiveObject = Object.fromEntries(
    Array.from({ length: MAX_API_CAPTURE_ENTRIES + 1 }, (_, index) => [`field${index}`, "fixture"]),
  );

  await wrapped.post("https://api.example.test/properties", { data: excessiveObject });
  assert.equal(observer.snapshot().skipped.materialLimit, 1);
  const longName = "x".repeat(1_025);
  await wrapped.post("https://api.example.test/location", { data: { [longName]: "fixture" } });
  await wrapped.post("https://api.example.test/string", {
    data: "x".repeat(MAX_NETWORK_BODY_BYTES + 1),
  });
  await wrapped.post("https://api.example.test/buffer", {
    data: Buffer.alloc(MAX_NETWORK_BODY_BYTES + 1),
  });

  const requests = eventConsumer.events.filter((event) => event.kind === "request");
  assert.equal(requests.length, 4);
  assert.equal(
    requests.every((event) => event.sink.bodyTruncated),
    true,
  );
  assert.equal(
    requests.every((event) => event.sink.materials.length === 0),
    true,
  );
  const coverage = observer.snapshot();
  assert.equal(coverage.skipped.materialLimit, 2);
  assert.equal(coverage.skipped.oversized, 2);
  assert.equal(returned.bodyReads(), 0);
});

test("aggregate and sink exhaustion stop later body inspection but preserve response facts", async () => {
  const aggregateConsumer = consumer();
  const aggregateObserver = new APIRequestFixtureObserver(true, aggregateConsumer);
  const returned = response("https://api.example.test/final", 503);
  const aggregateContext = { post: async () => returned.value };
  const aggregateWrapped = createObservedAPIRequestContext(aggregateContext, aggregateObserver);
  const body = "x".repeat(MAX_NETWORK_BODY_BYTES);
  const callsToExhaustAggregate =
    Math.floor(MAX_NETWORK_RETAINED_BYTES_PER_TEST / MAX_NETWORK_BODY_BYTES) + 1;
  for (let index = 0; index < callsToExhaustAggregate; index += 1) {
    await aggregateWrapped.post(`https://api.example.test/aggregate/${index}`, { data: body });
  }
  let aggregateGetterCalls = 0;
  const aggregateOptions = {};
  Object.defineProperty(aggregateOptions, "data", {
    get() {
      aggregateGetterCalls += 1;
      return "must-not-be-read";
    },
  });
  await aggregateWrapped.post("https://api.example.test/after-limit", aggregateOptions);
  assert.equal(aggregateGetterCalls, 0);
  assert.equal(aggregateObserver.snapshot().skipped.aggregateLimit, 1);
  assert.equal(
    aggregateConsumer.events.some(
      (event) => event.kind === "security-response" && event.value.status === 503,
    ),
    true,
  );

  const sinkConsumer = consumer();
  const sinkObserver = new APIRequestFixtureObserver(true, sinkConsumer);
  const sinkContext = { get: async () => returned.value };
  const sinkWrapped = createObservedAPIRequestContext(sinkContext, sinkObserver);
  for (let index = 0; index <= MAX_NETWORK_SINKS_PER_TEST; index += 1) {
    await sinkWrapped.get(`https://api.example.test/sink/${index}`);
  }
  let sinkGetterCalls = 0;
  const sinkOptions = {};
  Object.defineProperty(sinkOptions, "data", {
    get() {
      sinkGetterCalls += 1;
      return "must-not-be-read";
    },
  });
  await sinkWrapped.get("https://api.example.test/after-sink-limit", sinkOptions);
  assert.equal(sinkGetterCalls, 0);
  assert.equal(sinkObserver.snapshot().skipped.sinkLimit, 2);
  assert.equal(sinkObserver.snapshot().calls.observed, MAX_NETWORK_SINKS_PER_TEST + 2);
  assert.equal(returned.bodyReads(), 0);
});

test("hostile option proxies are never traversed and delegation remains exact", async () => {
  const eventConsumer = consumer();
  const observer = new APIRequestFixtureObserver(true, eventConsumer);
  const returned = response();
  let trapCalls = 0;
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("hostile proxy");
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error("must not enumerate");
      },
    },
  );
  const context = {
    post: async (url, options) => {
      assert.equal(url, "https://api.example.test/proxy");
      assert.equal(options, hostile);
      return returned.value;
    },
  };
  const wrapped = createObservedAPIRequestContext(context, observer);
  assert.equal(await wrapped.post("https://api.example.test/proxy", hostile), returned.value);
  assert.equal(trapCalls, 0);
  assert.equal(observer.snapshot().skipped.unsupportedObjects, 1);
  assert.equal(returned.bodyReads(), 0);
});
