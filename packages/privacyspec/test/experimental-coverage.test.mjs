import assert from "node:assert/strict";
import test from "node:test";

import {
  createAPIRequestCoverage,
  createBrowserEngineCoverage,
  normalizePrivacySpecExperimentalOptions,
} from "../dist/playwright/experimental-coverage.js";

test("experimental gates are strict, bounded, and do not accept Chromium promotion", () => {
  const normalized = normalizePrivacySpecExperimentalOptions({
    apiRequestContext: "request-fixture",
    browserEngines: ["firefox", "webkit"],
  });
  assert.equal(normalized.apiRequestContext, true);
  assert.deepEqual(Array.from(normalized.browserEngines), ["firefox", "webkit"]);

  for (const invalid of [
    { apiRequestContext: "all-contexts" },
    { browserEngines: ["chromium"] },
    { browserEngines: ["firefox", "firefox"] },
    { browserEngines: ["gecko"] },
    { browserEngines: "firefox" },
    { callbacks: { browser: () => true } },
  ]) {
    assert.throws(
      () => normalizePrivacySpecExperimentalOptions(invalid),
      /Invalid PrivacySpec experimental configuration/u,
    );
  }
});

test("engine capability tables distinguish supported, gated experimental, and ungated execution", () => {
  const gated = new Set(["firefox", "webkit"]);
  const chromium = createBrowserEngineCoverage("chromium", gated);
  const firefox = createBrowserEngineCoverage("firefox", gated);
  const webkitUngated = createBrowserEngineCoverage("webkit", new Set());

  assert.equal(chromium.support, "supported");
  assert.equal(chromium.experimental, false);
  assert.equal(
    Object.values(chromium.capabilities).every((value) => value === "complete"),
    true,
  );
  assert.equal(firefox.support, "experimental");
  assert.equal(firefox.experimental, true);
  assert.equal(
    Object.values(firefox.capabilities).every((value) => value === "complete"),
    true,
  );
  assert.equal(webkitUngated.support, "unsupported");
  assert.equal(
    Object.values(webkitUngated.capabilities).every((value) => value === "unsupported"),
    true,
  );
});

test("API coverage begins complete but records fixed blind spots for fail-closed aggregation", () => {
  const coverage = createAPIRequestCoverage(true);
  assert.equal(coverage.status, "complete");
  assert.equal(coverage.calls.seen, 0);
  assert.deepEqual(coverage.blindSpots, [
    "implicit-headers-cookies-auth",
    "redirect-chain",
    "page-request",
    "context-request",
    "manual-request-context",
  ]);
});
