import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

import { createRedactionValues } from "../dist/correlate/transforms.js";
import { sanitizeSensitiveSources } from "../dist/discovery/sanitize-sources.js";
import { SensitiveValueRegistry } from "../dist/discovery/sensitive-registry.js";
import {
  collectSensitiveSources,
  createBrowserObserverScript,
  SOURCE_STREAM_BINDING,
} from "../dist/playwright/browser-observer.js";

const waitForSource = async (registry) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (registry.snapshot().sources.length > 0) return;
    await delay(10);
  }
  assert.fail("The streamed source did not reach its test registry.");
};

test("real Chromium captures event sources and end-of-test fallback without persisting raw values", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const registry = new SensitiveValueRegistry();

  try {
    await context.exposeBinding(SOURCE_STREAM_BINDING, (_source, event) => {
      registry.recordStreamEvent(event);
    });
    await context.addInitScript({ content: createBrowserObserverScript(registry.streamToken) });
    const page = await context.newPage();
    const markup = `
      <script>Date.now = () => 1;</script>
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" autocomplete="email">
      <label for="phone">Phone number</label>
      <input id="phone" name="phone" type="tel" autocomplete="tel">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password">
      <label for="fallback">Recovery email</label>
      <input id="fallback" name="recoveryEmail" type="email" autocomplete="email">
      <label for="ordinary">Search</label>
      <input id="ordinary" name="query" type="text">
    `;
    await page.goto(`data:text/html,${encodeURIComponent(markup)}`);

    const email = ["observer", "example.test"].join("@");
    const phone = ["+49", "170", "0000000"].join("");
    const password = ["phase", "four", "credential"].join("-");
    const fallbackEmail = ["fallback", "example.test"].join("@");
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill(phone);
    await page.locator("#password").fill(password);
    await page.locator("#ordinary").fill("ordinary search text");
    await page.locator("#fallback").evaluate((control, value) => {
      if (control instanceof HTMLInputElement) control.value = String(value);
    }, fallbackEmail);

    assert.equal(
      await page.evaluate(() => Object.keys(globalThis).includes("__privacyspec")),
      false,
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const state = globalThis.__privacyspec;
        const snapshot = state.snapshot();
        snapshot.sources.length = 0;
        return {
          frozen: Object.isFrozen(state),
          replaced: Reflect.set(state, "snapshot", () => ({ sources: [], limitReached: false })),
        };
      }),
      { frozen: true, replaced: false },
    );

    const collected = await collectSensitiveSources(context);
    for (const source of collected.sources) registry.add(source);
    const snapshot = registry.snapshot();
    assert.equal(
      snapshot.sources.every((source) => source.timestamp > 1),
      true,
    );
    const observations = sanitizeSensitiveSources(
      snapshot.sources,
      snapshot.limitReached || collected.limitReached,
    );
    const sources = observations.filter((observation) => observation.kind === "sensitive-source");

    assert.deepEqual(sources.map((source) => source.category).sort(), [
      "personal.email",
      "personal.email",
      "personal.phone",
      "secret.password",
    ]);
    assert.equal(
      sources.some((source) => source.observedBy === "event"),
      true,
    );
    assert.equal(
      sources.some((source) => source.observedBy === "fallback"),
      true,
    );
    assert.equal(
      sources.some((source) => source.control.associatedLabel === "Email address"),
      true,
    );

    const serialized = JSON.stringify(observations);
    for (const raw of [email, phone, password, fallbackEmail]) {
      assert.equal(serialized.includes(raw), false);
    }
  } finally {
    registry.dispose();
    await context.close();
    await browser.close();
  }
});

test("streamed sources survive navigation and popup closure without crossing parallel contexts", async () => {
  const browser = await chromium.launch();
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const registryA = new SensitiveValueRegistry();
  const registryB = new SensitiveValueRegistry();

  const install = async (context, registry) => {
    await context.exposeBinding(SOURCE_STREAM_BINDING, (_source, event) => {
      registry.recordStreamEvent(event);
    });
    await context.addInitScript({ content: createBrowserObserverScript(registry.streamToken) });
  };

  try {
    await Promise.all([install(contextA, registryA), install(contextB, registryB)]);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const navigationMarkup = '<input id="email" type="email" autocomplete="email">';
    const popupMarkup = '<input id="phone" type="tel" autocomplete="tel">';
    await Promise.all([
      pageA.goto(`data:text/html,${encodeURIComponent(navigationMarkup)}`),
      pageB.setContent('<button id="open" onclick="window.open()">Open</button>'),
    ]);

    const popupPromise = pageB.waitForEvent("popup");
    await pageB.locator("#open").click();
    const popup = await popupPromise;
    await popup.goto(`data:text/html,${encodeURIComponent(popupMarkup)}`);

    const email = ["navigation", "example.test"].join("@");
    const phone = ["+49", "171", "1111111"].join("");
    await Promise.all([pageA.locator("#email").fill(email), popup.locator("#phone").fill(phone)]);
    await Promise.all([pageA.goto("data:text/html,navigated"), popup.close()]);
    await Promise.all([waitForSource(registryA), waitForSource(registryB)]);

    const snapshotA = registryA.snapshot();
    const snapshotB = registryB.snapshot();
    assert.equal(snapshotA.sources.length, 1);
    assert.equal(snapshotB.sources.length, 1);
    assert.equal(snapshotA.sources[0]?.category, "personal.email");
    assert.equal(snapshotB.sources[0]?.category, "personal.phone");
    assert.equal(snapshotA.sources[0]?.raw === email, true);
    assert.equal(snapshotB.sources[0]?.raw === phone, true);
    assert.equal(
      snapshotA.sources.some((source) => source.raw === phone),
      false,
    );
    assert.equal(
      snapshotB.sources.some((source) => source.raw === email),
      false,
    );

    const serialized = JSON.stringify([
      ...sanitizeSensitiveSources(snapshotA.sources, snapshotA.limitReached),
      ...sanitizeSensitiveSources(snapshotB.sources, snapshotB.limitReached),
    ]);
    assert.equal(serialized.includes(email), false);
    assert.equal(serialized.includes(phone), false);
  } finally {
    registryA.dispose();
    registryB.dispose();
    await contextA.close();
    await contextB.close();
    await browser.close();
  }
});

test("sanitization redacts raw values from control metadata and URL paths", () => {
  const raw = ["path-value", "example.test"].join("@");
  const observations = sanitizeSensitiveSources(
    [
      {
        raw,
        category: "personal.email",
        confidence: "high",
        evidence: [{ kind: "input-type", value: "email" }],
        control: {
          elementKind: "input",
          type: "email",
          ariaLabel: raw,
        },
        pageUrl: `https://app.example.test/customer/${encodeURIComponent(raw)}?email=${encodeURIComponent(raw)}`,
        timestamp: Date.now(),
        observedBy: "event",
      },
    ],
    false,
  );

  const serialized = JSON.stringify(observations);
  assert.equal(serialized.includes(raw), false);
  assert.equal(serialized.includes(encodeURIComponent(raw)), false);
  assert.equal(observations[0].control.ariaLabel, "[redacted]");
  assert.equal(observations[0].page.path.includes(":redacted"), true);
});

test("sanitization redacts raw values from evidence and URL origins", () => {
  const raw = "unique-secret-host-9qz";
  const observations = sanitizeSensitiveSources(
    [
      {
        raw,
        category: "secret.password",
        confidence: "high",
        evidence: [{ kind: "label", value: raw }],
        control: {
          elementKind: "input",
          type: "password",
          associatedLabel: raw,
        },
        pageUrl: `https://${raw}.example.test/login`,
        timestamp: Date.now(),
        observedBy: "event",
      },
    ],
    false,
  );

  const serialized = JSON.stringify(observations);
  assert.equal(serialized.includes(raw), false);
  assert.equal(observations[0].evidence[0]?.value, "[redacted]");
  assert.equal(observations[0].page.origin.includes(":redacted"), true);
});

test("source sanitization redacts transformed values across source records", () => {
  const email = ["Cross.Source", "example.test"].join("@");
  const password = "cross-source-password";
  const sources = [
    {
      raw: email,
      category: "personal.email",
      confidence: "high",
      evidence: [{ kind: "input-type", value: "email" }],
      control: { elementKind: "input", type: "email" },
      pageUrl: "https://app.example.test/form",
      timestamp: Date.now(),
      observedBy: "event",
    },
    {
      raw: password,
      category: "secret.password",
      confidence: "high",
      evidence: [{ kind: "input-type", value: "password" }],
      control: {
        elementKind: "input",
        type: "password",
        associatedLabel: Buffer.from(email, "utf8").toString("base64"),
      },
      pageUrl: `https://app.example.test/${Buffer.from(email, "utf8").toString("base64")}`,
      timestamp: Date.now(),
      observedBy: "event",
    },
  ];

  const serialized = JSON.stringify(sanitizeSensitiveSources(sources, false));
  for (const representation of createRedactionValues(sources)) {
    assert.equal(serialized.includes(representation), false);
  }
});
