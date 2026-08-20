import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(base, {
  dev: {
    allowInsecureOrigins: ["http://127.0.0.1:4173"],
  },
});

export { expect };
