import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [["line"], ["@privacyspec/playwright/reporter"]],
  projects: [
    { name: "chromium", use: { browserName: "chromium", baseURL: "https://app.example.test" } },
    { name: "firefox", use: { browserName: "firefox", baseURL: "https://app.example.test" } },
    { name: "webkit", use: { browserName: "webkit", baseURL: "https://app.example.test" } },
  ],
});
