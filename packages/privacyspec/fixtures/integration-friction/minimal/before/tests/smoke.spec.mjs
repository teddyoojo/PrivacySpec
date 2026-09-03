import { expect, test } from "@playwright/test";

test("loads the account", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});
