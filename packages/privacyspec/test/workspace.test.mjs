import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("the PrivacySpec package is public-release ready", () => {
  assert.equal(manifest.name, "@privacyspec/playwright");
  assert.equal(manifest.version, "0.1.0-beta.1");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.repository.url, "git+https://github.com/teddyoojo/PrivacySpec.git");
  assert.equal(manifest.repository.directory, "packages/privacyspec");
  assert.deepEqual(manifest.publishConfig, { access: "public" });
  assert.equal(manifest.peerDependencies["@playwright/test"], ">=1.58.1 <2");
});

test("the npm package contains only distributable files", async (context) => {
  assert.deepEqual(manifest.files, ["dist", "README.md", "LICENSE"]);
  const cache = await mkdtemp(join(tmpdir(), "privacyspec-npm-cache-"));
  context.after(() => rm(cache, { recursive: true, force: true }));
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts", "--cache", cache],
    { cwd: packageDirectory, maxBuffer: 2 * 1024 * 1024 },
  );
  const [pack] = JSON.parse(stdout);
  const paths = pack.files.map((file) => file.path);
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
  assert.equal(entryPoint.REPORT_SCHEMA_VERSION, 1);
});
