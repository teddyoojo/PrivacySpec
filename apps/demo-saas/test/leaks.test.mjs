import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";

import {
  applyCustomerSaveLeaks,
  applyLoginLeaks,
  applyResponseCustomerLeaks,
  FALSE_LEAKS,
} from "../src/public/leaks.js";

function sensitiveFixtures() {
  return {
    email: ["browser-fixture", "example.test"].join("@"),
    phone: ["+49", "170", "0000000"].join(""),
    password: ["fixture", "credential", "42"].join("-"),
  };
}

function createHarness() {
  const requests = [];
  const storageWrites = [];
  const consoleCalls = [];
  const urlWrites = [];

  return {
    requests,
    storageWrites,
    consoleCalls,
    urlWrites,
    dependencies: {
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true };
      },
      storage: {
        setItem(key, value) {
          storageWrites.push({ key, value });
        },
      },
      logger: {
        log(...arguments_) {
          consoleCalls.push(arguments_);
        },
      },
      history: {
        replaceState(state, title, url) {
          urlWrites.push({ state, title, url });
        },
      },
      crypto: webcrypto,
      TextEncoder,
    },
  };
}

function configFor(toggle) {
  return {
    analyticsOrigin: "http://127.0.0.1:4100",
    insecureOrigin: "http://127.0.0.1:4200",
    leaks: { ...FALSE_LEAKS, [toggle]: true },
  };
}

function parseOnlyRequest(harness, expectedOrigin = "http://127.0.0.1:4100") {
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0];
  assert.equal(request.url, `${expectedOrigin}/event`);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["content-type"], "application/json");
  return JSON.parse(request.options.body);
}

function assertNoOtherCustomerSinks(harness, expected) {
  assert.equal(harness.requests.length, expected === "request" ? 1 : 0);
  assert.equal(harness.storageWrites.length, expected === "storage" ? 1 : 0);
  assert.equal(harness.consoleCalls.length, expected === "console" ? 1 : 0);
  assert.equal(harness.urlWrites.length, expected === "url" ? 1 : 0);
}

test("clean mode performs no intentional customer or login leak", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();
  const config = { leaks: FALSE_LEAKS };

  await applyCustomerSaveLeaks(fixtures, config, harness.dependencies);
  await applyLoginLeaks(fixtures, config, harness.dependencies);
  await applyResponseCustomerLeaks(fixtures, config, harness.dependencies);

  assertNoOtherCustomerSinks(harness, "none");
});

test("emailToAnalytics sends only the saved email to analytics", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("emailToAnalytics"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "request");
  const body = parseOnlyRequest(harness);
  assert.equal(body.event, "customer_saved");
  assert.equal(body.email === fixtures.email, true);
  assert.equal("phone" in body, false);
});

test("phoneToAnalytics sends only the saved phone to analytics", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("phoneToAnalytics"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "request");
  const body = parseOnlyRequest(harness);
  assert.equal(body.event, "customer_saved");
  assert.equal(body.phone === fixtures.phone, true);
  assert.equal("email" in body, false);
});

test("emailInUrl writes only the encoded email to browser history", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("emailInUrl"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "url");
  const url = harness.urlWrites[0].url;
  assert.equal(url.startsWith("/customers?selectedEmail="), true);
  assert.equal(url.endsWith(encodeURIComponent(fixtures.email)), true);
});

test("emailInLocalStorage writes only the saved email", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("emailInLocalStorage"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "storage");
  assert.equal(harness.storageWrites[0].key, "lastCustomerEmail");
  assert.equal(harness.storageWrites[0].value === fixtures.email, true);
});

test("emailInConsole emits only the saved email through the injected logger", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("emailInConsole"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "console");
  assert.equal(harness.consoleCalls[0][0], "saved customer");
  assert.equal(harness.consoleCalls[0][1] === fixtures.email, true);
});

test("hashedEmailToAnalytics sends the SHA-256 of the normalized email", async () => {
  const fixtures = sensitiveFixtures();
  fixtures.email = fixtures.email.toUpperCase();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("hashedEmailToAnalytics"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "request");
  const body = parseOnlyRequest(harness);
  const expectedHash = createHash("sha256").update(fixtures.email.toLowerCase()).digest("hex");
  assert.equal(body.event, "customer_saved");
  assert.equal(body.emailHash === expectedHash, true);
  assert.equal("email" in body, false);
});

test("passwordToAnalytics sends the login password and no customer sink", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyLoginLeaks(fixtures, configFor("passwordToAnalytics"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "request");
  const body = parseOnlyRequest(harness);
  assert.equal(body.event, "user_login");
  assert.equal(body.password === fixtures.password, true);
  assert.equal("email" in body, false);
});

test("httpExternal sends the saved email only to the dedicated insecure origin", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyCustomerSaveLeaks(fixtures, configFor("httpExternal"), harness.dependencies);

  assertNoOtherCustomerSinks(harness, "request");
  const body = parseOnlyRequest(harness, "http://127.0.0.1:4200");
  assert.equal(body.event, "customer_saved");
  assert.equal(body.email === fixtures.email, true);
  assert.equal("phone" in body, false);
});

test("responseEmailToAnalytics sends only the response customer email", async () => {
  const fixtures = sensitiveFixtures();
  const harness = createHarness();

  await applyResponseCustomerLeaks(
    fixtures,
    configFor("responseEmailToAnalytics"),
    harness.dependencies,
  );

  assertNoOtherCustomerSinks(harness, "request");
  const body = parseOnlyRequest(harness);
  assert.equal(body.event, "customer_detail_loaded");
  assert.equal(body.email === fixtures.email, true);
  assert.equal("phone" in body, false);
});
