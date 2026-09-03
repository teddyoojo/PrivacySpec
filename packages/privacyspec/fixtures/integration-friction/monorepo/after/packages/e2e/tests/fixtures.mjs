import { installAccountFixtures } from "@example/test-support";
import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "@privacyspec/playwright";

const projectTest = installAccountFixtures(base);
export const test = withPrivacySpec(projectTest);
export { expect };
