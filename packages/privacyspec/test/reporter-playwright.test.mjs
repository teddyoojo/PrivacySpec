import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const configPath = fileURLToPath(
  new URL("../fixtures/reporter-skip/playwright.config.mjs", import.meta.url),
);

test("a static Playwright skip does not become a PrivacySpec failure", async () => {
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [playwrightCli, "test", `--config=${configPath}`],
    {
      cwd: packageDirectory,
      env: environment,
    },
  );
  const output = `${stdout}\n${stderr}`;
  assert.match(output, /1 skipped/u);
  assert.match(output, /PrivacySpec observed 0 tests/u);
  assert.doesNotMatch(output, /PrivacySpec integration error/u);
});
