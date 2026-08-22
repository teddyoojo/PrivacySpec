import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "browser-new-page.spec.mjs",
  workers: 1,
  retries: 0,
  reporter: [
    ["line"],
    [
      fileURLToPath(new URL("../../dist/playwright/reporter.js", import.meta.url)),
      { baselinePath: false, latestRunPath: false, reportPath: false },
    ],
  ],
});
