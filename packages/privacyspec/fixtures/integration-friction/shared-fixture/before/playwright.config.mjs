import { defineConfig } from "@playwright/test";

export default defineConfig({ reporter: [["line"]], use: { baseURL: "https://app.example.test" } });
