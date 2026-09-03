import { expect, test } from "./fixtures.mjs";

test("shows the account", async ({ page, accountName }) => {
  await page.goto("/account");
  await expect(page.getByText(accountName)).toBeVisible();
});
