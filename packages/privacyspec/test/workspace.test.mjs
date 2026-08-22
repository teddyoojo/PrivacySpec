import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("the PrivacySpec package identifies the public beta", () => {
  assert.equal(manifest.name, "@privacyspec/playwright");
  assert.equal(manifest.version, "0.1.0-beta.2");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.repository.url, "git+https://github.com/teddyoojo/PrivacySpec.git");
  assert.equal(manifest.repository.directory, "packages/privacyspec");
  assert.equal(manifest.homepage, "https://github.com/teddyoojo/PrivacySpec#readme");
  assert.equal(manifest.bugs.url, "https://github.com/teddyoojo/PrivacySpec/issues");
  assert.equal(manifest.peerDependencies["@playwright/test"], ">=1.58.1 <2");
});

test("the npm package contains only distributable files", async (context) => {
  assert.deepEqual(manifest.files, ["dist", "README.md", "LICENSE"]);
  const packDirectory = await mkdtemp(join(tmpdir(), "privacyspec-npm-pack-"));
  context.after(() => rm(packDirectory, { recursive: true, force: true }));
  await execFileAsync(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDirectory,
      "--cache",
      join(packDirectory, "npm-cache"),
    ],
    { cwd: packageDirectory, maxBuffer: 2 * 1024 * 1024 },
  );
  const archive = (await readdir(packDirectory)).find((path) => path.endsWith(".tgz"));
  assert.ok(archive);
  const { stdout } = await execFileAsync("tar", ["-tzf", join(packDirectory, archive)]);
  const paths = stdout
    .trim()
    .split("\n")
    .map((path) => path.replace(/^package\//u, ""));
  const allowedRootFiles = new Set([
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "README.md",
    "package.json",
  ]);

  assert.ok(paths.includes("dist/index.js"));
  assert.ok(paths.includes("dist/index.d.ts"));
  assert.ok(paths.includes("dist/playwright/reporter.js"));
  assert.ok(paths.includes("dist/cli/index.js"));
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("LICENSE"));
  assert.ok(
    paths.every((path) => path.startsWith("dist/") || allowedRootFiles.has(path)),
    paths.filter((path) => !path.startsWith("dist/") && !allowedRootFiles.has(path)),
  );
  assert.equal(
    paths.some((path) => /^(?:src|test|fixtures|\.privacyspec)\//u.test(path)),
    false,
  );
  assert.equal(paths.includes("privacyspec-report.json"), false);
});

test("the TypeScript entry point is loadable", async () => {
  const entryPoint = await import("../dist/index.js");
  assert.equal(typeof entryPoint.withPrivacySpec, "function");
  assert.equal(typeof entryPoint.test, "function");
  assert.equal(typeof entryPoint.expect, "function");
  assert.equal(entryPoint.RULE_LEGAL_MAPPINGS.PS1001.ruleId, "PS1001");
  assert.equal(typeof entryPoint.getRuleLegalMapping, "function");
  assert.equal(entryPoint.PRIVACYSPEC_TOOL_VERSION, manifest.version);
  assert.equal(entryPoint.REPORT_SCHEMA_VERSION_V1, 1);
  assert.equal(entryPoint.REPORT_SCHEMA_VERSION_V2, 2);
  assert.equal(entryPoint.REPORT_SCHEMA_VERSION_V3, 3);
  assert.equal(entryPoint.REPORT_SCHEMA_VERSION, 4);
  assert.equal(entryPoint.ATTACHMENT_SCHEMA_VERSION_V2, 2);
  assert.equal(entryPoint.ATTACHMENT_SCHEMA_VERSION, 3);
  assert.equal(entryPoint.EVIDENCE_SCHEMA_VERSION, 1);
  assert.equal(entryPoint.INVENTORY_SCHEMA_VERSION, 1);
  assert.equal(entryPoint.TEST_DATA_SCHEMA_VERSION, 1);
  assert.equal(typeof entryPoint.createPrivacyInventory, "function");
  assert.equal(typeof entryPoint.createPrivacySpecEvidence, "function");
  assert.equal(typeof entryPoint.renderPrivacySpecEvidence, "function");
  assert.equal(typeof entryPoint.createTestDataReport, "function");
  assert.equal(typeof entryPoint.renderPrivacySpecTestData, "function");
  assert.equal(typeof entryPoint.parsePrivacySpecReportV1, "function");
  assert.equal(typeof entryPoint.parsePrivacySpecReportV2, "function");
  assert.equal(typeof entryPoint.parsePrivacySpecReportV3, "function");
  assert.equal(typeof entryPoint.parsePrivacySpecReportV4, "function");
  assert.equal(typeof entryPoint.parsePrivacySpecReport, "function");
  assert.equal(typeof entryPoint.renderSecondaryCoverageSummary, "function");
});
