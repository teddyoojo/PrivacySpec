import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "runtime-failure.spec.mjs",
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
        dependencies: { baselinePath: false, latestRunPath: false, reportPath: false },
        security: { baselinePath: false, latestRunPath: false, reportPath: false },
        runtimeFailures: {
          baselinePath: process.env.PRIVACYSPEC_RUNTIME_FAILURE_BASELINE_PATH || false,
          latestRunPath: process.env.PRIVACYSPEC_RUNTIME_FAILURE_LATEST_RUN_PATH || false,
          reportPath: process.env.PRIVACYSPEC_RUNTIME_FAILURE_REPORT_PATH || false,
        },
      },
    ],
  ],
  use: {
    baseURL: "https://app.runtime.test",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
