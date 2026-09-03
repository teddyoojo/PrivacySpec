import { expect, test } from "./fixtures.js";
import { createCustomer } from "./helpers.js";

test("customer appears in search results", async ({ page }) => {
  const customer = await createCustomer(page, "Search");
  await page.goto("/search");

  await page.getByLabel("Name or email").fill(customer.name);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByRole("link", { name: customer.name })).toBeVisible();
});

test("search explains when there are no matches", async ({ page }) => {
  await page.goto("/search");

  await page.getByLabel("Name or email").fill(`No match ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("No matching customers.");
});
