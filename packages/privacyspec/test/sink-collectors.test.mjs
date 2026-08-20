import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import { chromium } from "@playwright/test";

import { ConsoleObserver } from "../dist/observe/console.js";
import {
  MAX_NETWORK_BODY_BYTES,
  NetworkObserver,
  parseNetworkBody,
} from "../dist/observe/network.js";
import { sanitizeSinkSnapshot } from "../dist/observe/sanitize-sinks.js";
import {
  MAX_CONSOLE_RETAINED_BYTES_PER_TEST,
  MAX_NETWORK_RETAINED_BYTES_PER_TEST,
  MAX_STORAGE_RETAINED_BYTES_PER_TEST,
  SinkRunRegistry,
} from "../dist/observe/sink-registry.js";
import {
  collectFinalStorage,
  createStorageObserverScript,
  STORAGE_STREAM_BINDING,
} from "../dist/observe/storage.js";

const source = (raw, category, type) => ({
  raw,
  category,
  confidence: "high",
  evidence: [{ kind: "input-type", value: type }],
  control: { elementKind: "input", type },
  pageUrl: "https://app.example.test/form",
  timestamp: Date.now(),
  observedBy: "event",
});

test("network body parsing is structured, defensive, and bounded", () => {
  const email = ["fixture", "example.test"].join("@");
  const phone = ["+49", "170", "0000000"].join("");
  const json = parseNetworkBody(
    Buffer.from(JSON.stringify({ user: { email } })),
    "application/json",
  );
  const form = parseNetworkBody(
    Buffer.from(new URLSearchParams({ email, phone }).toString()),
    "application/x-www-form-urlencoded",
  );
  const text = parseNetworkBody(Buffer.from("plain fixture"), "text/plain");
  const multipart = parseNetworkBody(
    Buffer.from('content-disposition: form-data; name="contact"\r\n\r\nfixture'),
    "multipart/form-data; boundary=fixture",
  );
  const binary = parseNetworkBody(Buffer.from([0, 1, 2, 3]), "application/octet-stream");
  const oversized = parseNetworkBody(Buffer.alloc(MAX_NETWORK_BODY_BYTES + 1), "application/json");

  assert.equal(json.kind, "json");
  assert.equal(json.materials[0]?.location, "json.user.email");
  assert.equal(form.kind, "form");
  assert.deepEqual(
    form.materials.map((material) => material.location),
    ["form.email", "form.phone"],
  );
  assert.equal(text.materials[0]?.location, "body.raw");
  assert.deepEqual(multipart.materials, [{ location: "form.contact", value: "" }]);
  assert.deepEqual(binary.materials, []);
  assert.equal(oversized.truncated, true);
  assert.deepEqual(oversized.materials, []);
});

test("network capture retains event-time attribution across delayed header reads", async () => {
  const context = new EventEmitter();
  const registry = new SinkRunRegistry();
  const observer = new NetworkObserver(registry);
  let currentFrameUrl = "https://app.example.test/start";
  let currentPageUrl = "https://app.example.test/start";
  let resolveHeaders;
  const request = {
    allHeaders: () =>
      new Promise((resolve) => {
        resolveHeaders = resolve;
      }),
    headers: () => ({}),
    frame: () => ({
      url: () => currentFrameUrl,
      page: () => ({ url: () => currentPageUrl }),
    }),
    method: () => "GET",
    postDataBuffer: () => null,
    resourceType: () => "fetch",
    url: () => "https://api.example.test/data",
  };

  try {
    observer.attach(context);
    context.emit("request", request);
    currentFrameUrl = "https://app.example.test/after-navigation";
    currentPageUrl = "https://app.example.test/after-navigation";
    resolveHeaders({});
    await observer.flush();
    const captured = registry.snapshot().network[0];
    assert.equal(captured?.frameUrl, "https://app.example.test/start");
    assert.equal(captured?.pageUrl, "https://app.example.test/start");
  } finally {
    observer.detach();
    registry.dispose();
  }
});

test("network registry enforces an aggregate retained-byte budget", () => {
  const registry = new SinkRunRegistry();
  registry.addNetwork({
    kind: "network",
    url: "https://api.example.test/collect",
    method: "POST",
    resourceType: "fetch",
    headers: {},
    bodyKind: "text",
    bodySize: MAX_NETWORK_RETAINED_BYTES_PER_TEST,
    bodyTruncated: false,
    materials: [
      {
        location: "body.raw",
        value: "x".repeat(MAX_NETWORK_RETAINED_BYTES_PER_TEST),
      },
    ],
    timestamp: Date.now(),
  });

  const snapshot = registry.snapshot();
  assert.equal(snapshot.limitsReached.includes("network"), true);
  assert.deepEqual(snapshot.network[0]?.materials, []);
  assert.equal(snapshot.network[0]?.bodyTruncated, true);
  registry.dispose();
});

test("console and storage registries enforce aggregate retained-byte budgets", () => {
  const registry = new SinkRunRegistry();
  const chunk = "x".repeat(1_048_576);
  for (let index = 0; index < MAX_CONSOLE_RETAINED_BYTES_PER_TEST / chunk.length + 1; index += 1) {
    registry.addConsole({
      kind: "console",
      level: "log",
      materials: [{ location: `console.argument.${index}`, value: chunk }],
      argumentCount: 1,
      timestamp: Date.now(),
    });
  }
  for (let index = 0; index < MAX_STORAGE_RETAINED_BYTES_PER_TEST / chunk.length + 1; index += 1) {
    registry.addStorage({
      kind: "storage",
      storageType: "local-storage",
      key: `large-${index}`,
      value: chunk,
      pageUrl: "https://app.example.test/",
      observedBy: "write",
      timestamp: Date.now(),
    });
  }

  const snapshot = registry.snapshot();
  assert.equal(snapshot.limitsReached.includes("console"), true);
  assert.equal(snapshot.limitsReached.includes("storage"), true);
  assert.equal(snapshot.console.length < 17, true);
  assert.equal(snapshot.storage.length < 17, true);
  registry.dispose();
});

test("console arguments are bounded in the page before transfer to the worker", async () => {
  const context = new EventEmitter();
  const registry = new SinkRunRegistry();
  const observer = new ConsoleObserver(registry);
  const largeValue = Array.from({ length: 1_000 }, (_, index) => ({
    index,
    value: "x".repeat(1_000),
  }));
  largeValue.push(largeValue);
  let evaluateCalls = 0;
  let jsonValueCalls = 0;
  const handle = {
    toString: () => "JSHandle@array",
    evaluate: async (serializer, limits) => {
      evaluateCalls += 1;
      return serializer(largeValue, limits);
    },
    jsonValue: async () => {
      jsonValueCalls += 1;
      return largeValue;
    },
  };
  const message = {
    args: () => [handle],
    text: () => "large console value",
    location: () => ({}),
    page: () => undefined,
    type: () => "log",
    timestamp: () => Date.now(),
  };

  try {
    observer.attach(context);
    context.emit("console", message);
    await observer.flush();
    const captured = registry.snapshot().console[0]?.materials[0]?.value;
    assert.equal(evaluateCalls, 1);
    assert.equal(jsonValueCalls, 0);
    assert.equal(captured?.includes("[truncated]"), true);
    assert.equal((captured?.length ?? Number.POSITIVE_INFINITY) <= 65_536, true);
  } finally {
    observer.detach();
    registry.dispose();
  }
});

test("sink registry rejects cross-test storage events and clears transient values", () => {
  const registryA = new SinkRunRegistry();
  const registryB = new SinkRunRegistry();
  const raw = ["isolated", "example.test"].join("@");
  const sink = {
    kind: "storage",
    storageType: "local-storage",
    key: "contact",
    value: raw,
    pageUrl: "https://app.example.test/",
    observedBy: "write",
    timestamp: Date.now(),
  };

  registryA.recordStorageStreamEvent({
    version: 1,
    token: registryB.streamToken,
    kind: "storage-write",
    sink,
  });
  assert.equal(registryA.snapshot().storage.length, 0);

  registryA.recordStorageStreamEvent({
    version: 1,
    token: registryA.streamToken,
    kind: "storage-write",
    sink,
  });
  assert.equal(registryA.snapshot().storage[0]?.value === raw, true);

  registryA.dispose();
  registryA.addStorage(sink);
  assert.equal(registryA.snapshot().storage.length, 0);
  registryB.dispose();
});

test("sink sanitization removes source values from paths, keys, and structured locations", () => {
  const email = ["metadata", "example.test"].join("@");
  const encoded = encodeURIComponent(email);
  const base64 = Buffer.from(email, "utf8").toString("base64");
  const digest = createHash("sha256").update(email, "utf8").digest("hex");
  const registry = new SinkRunRegistry();
  registry.addNetwork({
    kind: "network",
    url: `https://sink.example.test/customer/${encoded}/${base64}/${digest}`,
    method: "POST",
    resourceType: "fetch",
    headers: { [email]: email },
    bodyKind: "json",
    bodySize: email.length,
    bodyTruncated: false,
    materials: [{ location: `json.${email}.${base64}.${digest}`, value: email }],
    pageUrl: `https://app.example.test/form/${encoded}`,
    timestamp: Date.now(),
  });
  registry.addStorage({
    kind: "storage",
    storageType: "local-storage",
    key: email,
    value: email,
    pageUrl: `https://app.example.test/form/${encoded}`,
    observedBy: "write",
    timestamp: Date.now(),
  });

  const observations = sanitizeSinkSnapshot(registry.snapshot(), [
    source(email, "personal.email", "email"),
  ]);
  const serialized = JSON.stringify(observations);
  assert.equal(serialized.includes(email), false);
  assert.equal(serialized.includes(encoded), false);
  assert.equal(serialized.includes(base64), false);
  assert.equal(serialized.includes(digest), false);
  assert.equal(serialized.includes(":redacted"), true);
  registry.dispose();
});

test("sink sanitization removes source values from recipients and page origins", () => {
  const password = "unique-secret-host-9qz";
  const registry = new SinkRunRegistry();
  registry.addNetwork({
    kind: "network",
    url: `https://${password}.example.test/collect`,
    method: password,
    resourceType: "fetch",
    headers: {},
    bodyKind: "none",
    bodySize: 0,
    bodyTruncated: false,
    materials: [],
    pageUrl: `https://${password}.app.example.test/form`,
    timestamp: Date.now(),
  });
  registry.addStorage({
    kind: "storage",
    storageType: "local-storage",
    key: "session",
    value: password,
    pageUrl: `https://${password}.app.example.test/form`,
    observedBy: "snapshot",
    timestamp: Date.now(),
  });

  const observations = sanitizeSinkSnapshot(registry.snapshot(), [
    source(password, "secret.password", "password"),
  ]);
  const serialized = JSON.stringify(observations);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes(":redacted"), true);
  registry.dispose();
});

test("real Chromium collects structured network, console, storage-write, and final storage sinks", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const registry = new SinkRunRegistry();
  const network = new NetworkObserver(registry);
  const browserConsole = new ConsoleObserver(registry);
  const disposables = [];

  try {
    await context.route("**/*", async (route) => {
      if (route.request().isNavigationRequest()) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>sink fixture</title>",
        });
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    });
    network.attach(context);
    browserConsole.attach(context);
    disposables.push(
      await context.exposeBinding(STORAGE_STREAM_BINDING, (_source, event) => {
        registry.recordStorageStreamEvent(event);
      }),
    );
    disposables.push(
      await context.addInitScript({ content: createStorageObserverScript(registry.streamToken) }),
    );

    const page = await context.newPage();
    await page.goto("https://app.example.test/form");
    const email = ["collector", "example.test"].join("@");
    const phone = ["+49", "172", "2222222"].join("");
    const password = ["sink", "collector", "secret"].join("-");
    const storageSemantics = await page.evaluate(
      async ({ email, phone, password }) => {
        Date.now = () => 1;
        let conversions = 0;
        const dynamicKey = {
          toString() {
            conversions += 1;
            return "ephemeral-contact";
          },
        };
        const returnValue = localStorage.setItem(dynamicKey, email);
        localStorage.removeItem("ephemeral-contact");
        sessionStorage.setItem("support-phone", phone);
        const observerState = globalThis.__privacyspecStorage;
        const observerSnapshot = observerState.snapshot();
        observerSnapshot.writes.length = 0;
        // biome-ignore lint/suspicious/noDocumentCookie: final cookie collection is the behavior under test.
        document.cookie = `session-secret=${encodeURIComponent(password)}; Path=/; SameSite=Lax`;
        console.warn("customer contact", { email });

        await fetch(`/collect?email=${encodeURIComponent(email)}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-demo-secret": password,
          },
          body: JSON.stringify({ profile: { email, phone } }),
        });
        await fetch("/form-collect", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ email, phone }),
        });
        return {
          pageNow: Date.now(),
          conversions,
          returnedUndefined: returnValue === undefined,
          removed: localStorage.getItem("ephemeral-contact") === null,
          functionName: Storage.prototype.setItem.name,
          functionLength: Storage.prototype.setItem.length,
          observerFrozen: Object.isFrozen(observerState),
          observerReplaced: Reflect.set(observerState, "snapshot", () => ({
            writes: [],
            limitReached: false,
          })),
        };
      },
      { email, phone, password },
    );
    assert.deepEqual(storageSemantics, {
      pageNow: 1,
      conversions: 1,
      returnedUndefined: true,
      removed: true,
      functionName: "setItem",
      functionLength: 2,
      observerFrozen: true,
      observerReplaced: false,
    });

    network.detach();
    browserConsole.detach();
    await Promise.all([network.flush(), browserConsole.flush()]);
    const finalStorage = await collectFinalStorage(context);
    for (const sink of finalStorage.sinks) registry.addStorage(sink);
    if (finalStorage.limitReached) registry.markLimitReached("storage");
    const snapshot = registry.snapshot();
    assert.equal(
      snapshot.storage.every((sink) => sink.timestamp > 1),
      true,
    );

    const jsonRequest = snapshot.network.find(
      (sink) => sink.method === "POST" && sink.bodyKind === "json",
    );
    const formRequest = snapshot.network.find(
      (sink) => sink.method === "POST" && sink.bodyKind === "form",
    );
    assert.equal(
      jsonRequest?.materials.some(
        (material) => material.location === "json.profile.email" && material.value === email,
      ),
      true,
    );
    assert.equal(
      jsonRequest?.materials.some(
        (material) => material.location === "header.x-demo-secret" && material.value === password,
      ),
      true,
    );
    assert.equal(
      jsonRequest?.materials.some(
        (material) => material.location === "url.query.email" && material.value === email,
      ),
      true,
    );
    assert.equal(
      formRequest?.materials.some(
        (material) => material.location === "form.phone" && material.value === phone,
      ),
      true,
    );
    assert.equal(
      snapshot.console.some((sink) =>
        sink.materials.some((material) => material.value.includes(email)),
      ),
      true,
    );
    assert.equal(
      snapshot.storage.some(
        (sink) =>
          sink.storageType === "local-storage" &&
          sink.observedBy === "write" &&
          sink.value === email,
      ),
      true,
    );
    assert.equal(
      snapshot.storage.some(
        (sink) => sink.storageType === "session-storage" && sink.value === phone,
      ),
      true,
    );
    assert.equal(
      snapshot.storage.some((sink) => sink.storageType === "cookie" && sink.value === password),
      true,
    );

    const sources = [
      source(email, "personal.email", "email"),
      source(phone, "personal.phone", "tel"),
      source(password, "secret.password", "password"),
    ];
    const observations = sanitizeSinkSnapshot(snapshot, sources);
    const serialized = JSON.stringify(observations);
    for (const raw of [email, phone, password, encodeURIComponent(password)]) {
      assert.equal(serialized.includes(raw), false);
    }
    assert.equal(
      observations.some(
        (observation) =>
          observation.kind === "sink" &&
          observation.sink === "network" &&
          observation.locations.includes("json.profile.email"),
      ),
      true,
    );
    assert.equal(
      observations.some(
        (observation) => observation.kind === "sink" && observation.sink === "console",
      ),
      true,
    );
    assert.equal(
      observations.some(
        (observation) => observation.kind === "sink" && observation.sink === "storage",
      ),
      true,
    );
  } finally {
    network.detach();
    browserConsole.detach();
    registry.dispose();
    await Promise.allSettled(disposables.map((disposable) => disposable.dispose()));
    await context.close();
    await browser.close();
  }
});
