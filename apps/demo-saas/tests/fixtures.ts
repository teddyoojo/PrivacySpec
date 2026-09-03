import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(base, {
  sources: {
    firstPartyJsonResponses: process.env.PRIVACYSPEC_FIRST_PARTY_JSON_RESPONSES === "1",
  },
  dev: {
    allowInsecureOrigins: ["http://localhost:3100", "http://127.0.0.1:4100"],
  },
});
export { expect };
