import { expect, test } from "./fixtures.js";
import { accountData } from "./helpers.js";

test("team member can be invited", async ({ page }) => {
  const teammate = accountData("Invite");
  await page.goto("/team");

  await page.getByLabel("Email").fill(teammate.email);
  await page.getByLabel("Role").selectOption("member");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByRole("status")).toHaveText("Invitation sent.");
  await expect(page.getByLabel("Email")).toHaveValue("");
});

test("administrator role can be selected for an invitation", async ({ page }) => {
  const teammate = accountData("Admin invite");
  await page.goto("/team");

  await page.getByLabel("Email").fill(teammate.email);
  await page.getByLabel("Role").selectOption("admin");
  await expect(page.getByLabel("Role")).toHaveValue("admin");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByRole("status")).toHaveText("Invitation sent.");
});
