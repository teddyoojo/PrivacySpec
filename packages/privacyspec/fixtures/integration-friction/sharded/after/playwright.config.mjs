import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["line"],
    [
      "@privacyspec/playwright/reporter",
      { runScope: { runId: process.env.PRIVACYSPEC_RUN_ID, configurationId: "chromium-ci-v1" } },
    ],
  ],
  use: { baseURL: "https://app.example.test" },
});
