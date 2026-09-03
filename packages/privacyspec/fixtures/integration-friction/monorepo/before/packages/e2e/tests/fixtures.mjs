import { installAccountFixtures } from "@example/test-support";
import { test as base, expect } from "@playwright/test";

export const test = installAccountFixtures(base);
export { expect };
