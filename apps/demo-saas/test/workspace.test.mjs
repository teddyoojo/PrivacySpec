import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("the demo SaaS workspace is private", () => {
  assert.equal(manifest.name, "@privacyspec/demo-saas");
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, "Apache-2.0");
});

test("the built application entry point exposes testable server factories", async () => {
  const entryPoint = await import("../dist/index.js");
  assert.equal(typeof entryPoint.createDemoApp, "function");
  assert.equal(typeof entryPoint.createAnalyticsApp, "function");
  assert.equal(typeof entryPoint.startDemoEnvironment, "function");
});
