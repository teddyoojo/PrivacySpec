import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { measureIntegrationFriction } from "../scripts/integration-friction-benchmark.mjs";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the integration-friction benchmark covers every required repository archetype", async () => {
  const first = await measureIntegrationFriction();
  const second = await measureIntegrationFriction();
  assert.deepEqual(first, second);
  assert.equal(first.benchmarkSchemaVersion, 1);
  assert.deepEqual(
    first.archetypes.map(({ id }) => id),
    [
      "minimal",
      "shared-fixture",
      "setup-auth",
      "browser-matrix",
      "sharded",
      "custom-context",
      "monorepo",
    ],
  );

  for (const archetype of first.archetypes) {
    assert.equal(archetype.metrics.filesAdded, 0, archetype.id);
    assert.equal(archetype.metrics.filesRemoved, 0, archetype.id);
    assert.equal(archetype.metrics.testBodiesChanged, 0, archetype.id);
    assert.equal(archetype.metrics.privacySpecAssertions, 0, archetype.id);
    assert.equal(archetype.metrics.proxyOrCertificateSettings, 0, archetype.id);
    assert.equal(archetype.metrics.timeToFirstReportMilliseconds, null, archetype.id);
    assert.ok(archetype.behaviorEvidence.length > 0, archetype.id);
    for (const evidencePath of archetype.behaviorEvidence) {
      await access(resolve(packageDirectory, evidencePath));
    }
  }
});

test("ordinary supported fixtures meet the zero-friction release gate", async () => {
  const benchmark = await measureIntegrationFriction();
  const supported = benchmark.archetypes.filter(({ supportedHappyPath }) => supportedHappyPath);
  assert.deepEqual(
    supported.map(({ id }) => id),
    ["minimal", "shared-fixture", "setup-auth"],
  );

  for (const archetype of supported) {
    assert.ok(archetype.metrics.existingFilesTouched <= 2, archetype.id);
    assert.ok(archetype.metrics.nonBlankIntegrationLines <= 10, archetype.id);
    assert.equal(archetype.metrics.commandsAdded, 0, archetype.id);
    assert.equal(archetype.metrics.newProcesses, 0, archetype.id);
    assert.equal(archetype.metrics.environmentVariablesAdded, 0, archetype.id);
    assert.equal(archetype.expectedCoverage, "complete", archetype.id);
    assert.equal(archetype.expectedReasonCode, null, archetype.id);
  }

  const minimal = supported.find(({ id }) => id === "minimal");
  assert.equal(minimal.metrics.testFilesImportRouteChanged, 1);
  for (const archetype of supported.filter(({ id }) => id !== "minimal")) {
    assert.equal(archetype.metrics.testFilesImportRouteChanged, 0, archetype.id);
  }
});

test("advanced archetypes expose their explicit portability and coverage contract", async () => {
  const benchmark = await measureIntegrationFriction();
  const byId = new Map(benchmark.archetypes.map((archetype) => [archetype.id, archetype]));

  assert.deepEqual(
    {
      coverage: byId.get("browser-matrix").expectedCoverage,
      reason: byId.get("browser-matrix").expectedReasonCode,
    },
    { coverage: "unsupported", reason: "COVERAGE_UNSUPPORTED_BROWSER_ENGINE" },
  );
  assert.deepEqual(
    {
      coverage: byId.get("custom-context").expectedCoverage,
      reason: byId.get("custom-context").expectedReasonCode,
    },
    { coverage: "unsupported", reason: "COVERAGE_INCOMPATIBLE" },
  );
  assert.equal(byId.get("sharded").expectedCoverage, "complete-after-aggregate");
  assert.equal(byId.get("sharded").metrics.commandsAdded, 1);
  assert.equal(byId.get("sharded").metrics.environmentVariablesAdded, 1);
  assert.equal(byId.get("monorepo").expectedCoverage, "complete");
});
