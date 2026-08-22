import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "dependency.spec.mjs",
  workers: 1,
  retries: 0,
  reporter: [
    ["line"],
    [
      fileURLToPath(new URL("../../dist/playwright/reporter.js", import.meta.url)),
      {
        baselinePath: false,
        latestRunPath: false,
        reportPath: false,
        dependencies: {
          baselinePath: process.env.PRIVACYSPEC_DEPENDENCY_BASELINE_PATH || false,
          latestRunPath: process.env.PRIVACYSPEC_DEPENDENCY_LATEST_RUN_PATH || false,
          reportPath: process.env.PRIVACYSPEC_DEPENDENCY_REPORT_PATH || false,
        },
      },
    ],
  ],
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
