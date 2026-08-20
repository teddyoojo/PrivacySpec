import { expect, test } from "./fixtures";

test("a user can save their profile", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("reader@example.test");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved");
});
