import { expect, test } from "@privacyspec/playwright";

test("loads the account", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});
