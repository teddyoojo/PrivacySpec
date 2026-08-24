import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "api-request.spec.mjs",
  workers: 1,
  retries: 0,
  reporter: [
    ["line"],
    [
      fileURLToPath(new URL("../../dist/playwright/reporter.js", import.meta.url)),
      {
        baselinePath: false,
        latestRunPath: process.env.PRIVACYSPEC_API_LATEST_RUN_PATH || false,
        reportPath: process.env.PRIVACYSPEC_API_REPORT_PATH || false,
        dependencies: { baselinePath: false, latestRunPath: false, reportPath: false },
        security: { baselinePath: false, latestRunPath: false, reportPath: false },
        runtimeFailures: { baselinePath: false, latestRunPath: false, reportPath: false },
      },
    ],
  ],
  use: { trace: "off", screenshot: "off", video: "off" },
});
