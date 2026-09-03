import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [["line"], ["@privacyspec/playwright/reporter"]],
  use: { baseURL: "https://app.example.test" },
});
