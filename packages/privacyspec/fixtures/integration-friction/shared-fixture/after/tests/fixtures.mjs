import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "@privacyspec/playwright";

const projectTest = base.extend({
  accountName: async (_fixtures, use) => use("Example account"),
});

export const test = withPrivacySpec(projectTest);
export { expect };
