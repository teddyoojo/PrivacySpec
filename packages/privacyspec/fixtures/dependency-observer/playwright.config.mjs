import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const runScope = process.env.PRIVACYSPEC_RUN_ID
  ? {
      runId: process.env.PRIVACYSPEC_RUN_ID,
      configurationId: process.env.PRIVACYSPEC_CONFIGURATION_ID || "dependency-observer-v1",
      outputDirectory: process.env.PRIVACYSPEC_RUN_PARTS_DIRECTORY,
    }
  : undefined;

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
        ...(runScope === undefined ? {} : { runScope }),
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
