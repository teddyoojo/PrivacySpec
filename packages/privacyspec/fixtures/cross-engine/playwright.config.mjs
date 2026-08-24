import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "cross-engine.spec.mjs",
  workers: 1,
  retries: 0,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  reporter: [
    ["line"],
    [
      fileURLToPath(new URL("../../dist/playwright/reporter.js", import.meta.url)),
      {
        baselinePath: false,
        latestRunPath: false,
        reportPath: process.env.PRIVACYSPEC_CROSS_ENGINE_REPORT_PATH || false,
        dependencies: { baselinePath: false, latestRunPath: false, reportPath: false },
        security: { baselinePath: false, latestRunPath: false, reportPath: false },
        runtimeFailures: { baselinePath: false, latestRunPath: false, reportPath: false },
      },
    ],
  ],
  use: { trace: "off", screenshot: "off", video: "off" },
});
