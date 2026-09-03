import { expect, test } from "./fixtures.mjs";

test("uses authenticated state", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});
