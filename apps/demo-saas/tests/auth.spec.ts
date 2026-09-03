import { expect, test } from "./fixtures.js";
import { accountData, logIn } from "./helpers.js";

test("user can log in", async ({ page }) => {
  const account = accountData("Login");
  await page.goto("/login");

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Signed in.");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("user can log out", async ({ page }) => {
  await logIn(page, "Logout");

  await page.getByRole("button", { name: "Log out" }).click();

  await expect(page.getByRole("status")).toHaveText("Signed out.");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
