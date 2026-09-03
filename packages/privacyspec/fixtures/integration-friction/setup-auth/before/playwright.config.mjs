import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [["line"]],
  projects: [
    { name: "setup", testMatch: /auth\.setup\.mjs/u },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { baseURL: "https://app.example.test", storageState: "playwright/.auth/user.json" },
    },
  ],
});
