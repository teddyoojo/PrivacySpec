import { expect, test } from "./fixtures.mjs";

test("loads one shard journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
});
