import { expect, test } from "./fixtures.js";
import { accountData } from "./helpers.js";

test("account contact settings can be updated", async ({ page }) => {
  const account = accountData("Settings");
  await page.goto("/settings");

  await page.getByLabel("Display name").fill(account.displayName);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Phone").fill(account.phone);
  await page.getByRole("button", { name: "Save settings" }).click();

  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  expect((await page.getByLabel("Email", { exact: true }).inputValue()) === account.email).toBe(
    true,
  );
  expect((await page.getByLabel("Phone").inputValue()) === account.phone).toBe(true);
});

test("account preferences remain selected after revisiting settings", async ({ page }) => {
  const account = accountData("Preferences");
  await page.goto("/settings");

  await page.getByLabel("Display name").fill(account.displayName);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Phone").fill(account.phone);
  await page.getByLabel("Email notifications").uncheck();
  await page.getByLabel("Product updates").check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");

  await page.goto("/customers");
  await page.goto("/settings");
  await expect(page.getByLabel("Email notifications")).not.toBeChecked();
  await expect(page.getByLabel("Product updates")).toBeChecked();
});
