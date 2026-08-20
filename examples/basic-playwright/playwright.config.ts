import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  retries: 0,
  reporter: [
    ["line"],
    [
      "@privacyspec/playwright/reporter",
      {
        baselinePath: false,
        latestRunPath: ".privacyspec/latest-run.json",
        reportPath: "privacyspec-report.json",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
