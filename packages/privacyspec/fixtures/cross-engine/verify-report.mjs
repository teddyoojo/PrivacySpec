import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readPrivacySpecReport } from "../../dist/report/read.js";

const reportPath = process.argv[2];
assert.ok(reportPath, "Expected the cross-engine report path.");

const serialized = await readFile(reportPath, "utf8");
const report = await readPrivacySpecReport(reportPath);

assert.equal(report.schemaVersion, 5);
assert.equal(report.run.complete, true);
assert.deepEqual(report.coverage.browserEngines.tests, {
  supported: 1,
  experimental: 2,
  unsupported: 0,
  unavailable: 0,
});
for (const [engine, support] of [
  ["chromium", "supported"],
  ["firefox", "experimental"],
  ["webkit", "experimental"],
]) {
  const coverage = report.coverage.browserEngines.engines[engine];
  assert.equal(coverage.tests, 1, engine);
  assert.equal(coverage.support, support, engine);
  assert.equal(
    Object.values(coverage.capabilities).every((state) => state === "complete"),
    true,
    engine,
  );
}
assert.deepEqual(report.coverage.apiRequests.tests, {
  enabled: 0,
  disabled: 3,
  unavailable: 0,
  complete: 3,
  partial: 0,
  unsupported: 0,
});
assert.equal(serialized.includes("cross-engine@example.test"), false);
