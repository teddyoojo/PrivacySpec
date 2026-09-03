import { test as base, expect } from "@playwright/test";

const projectTest = base.extend({
  accountName: async (_fixtures, use) => use("Example account"),
});

export const test = projectTest;
export { expect };
