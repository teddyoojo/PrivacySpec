import { defineConfig, devices } from "@playwright/test";

const reporterOptions = {
  ...(process.env.PRIVACYSPEC_BASELINE_PATH
    ? { baselinePath: process.env.PRIVACYSPEC_BASELINE_PATH }
    : {}),
  ...(process.env.PRIVACYSPEC_LATEST_RUN_PATH
    ? { latestRunPath: process.env.PRIVACYSPEC_LATEST_RUN_PATH }
    : {}),
  ...(process.env.PRIVACYSPEC_REPORT_PATH
    ? { reportPath: process.env.PRIVACYSPEC_REPORT_PATH }
    : {}),
};

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  forbidOnly: true,
  preserveOutput: "never",
  reporter: [["list"], ["@privacyspec/playwright/reporter", reporterOptions]],
  use: {
    baseURL: "http://localhost:3100",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
      },
    },
  ],
  webServer: {
    command: "pnpm run start",
    url: "http://localhost:3100/api/demo-config",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
