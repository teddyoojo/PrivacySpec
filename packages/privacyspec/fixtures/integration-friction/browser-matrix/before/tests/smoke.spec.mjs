import { expect, test } from "./fixtures.mjs";

test("loads the application", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
});
