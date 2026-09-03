import { test } from "./fixtures.mjs";

test("authenticate", async ({ page }) => {
  await page.goto("/login");
});
