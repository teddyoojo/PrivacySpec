import { expect, test } from "./fixtures.mjs";

test("uses the shared package fixture", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});
