import { expect, test } from "./fixtures.js";
import { createCustomer, customerData } from "./helpers.js";

test("customer list can be opened", async ({ page }) => {
  await page.goto("/customers");

  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New customer" })).toBeVisible();
});

test("customer can be created", async ({ page }) => {
  const customer = customerData("Create");
  await page.goto("/customers/new");

  await page.getByLabel("Name").fill(customer.name);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Phone").fill(customer.phone);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Customer created.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(customer.name);
});

test("customer detail can be opened from the list", async ({ page }) => {
  const customer = await createCustomer(page, "Detail");

  await page.getByRole("link", { name: "Back to customers" }).click();
  await page.getByRole("link", { name: customer.name }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(customer.name);
  const details = await page.locator(".details dd").allTextContents();
  expect(details.includes(customer.email)).toBe(true);
  expect(details.includes(customer.phone)).toBe(true);
});

test("customer can be edited", async ({ page }) => {
  const original = await createCustomer(page, "Edit");
  const updated = customerData("Updated");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit customer" })).toBeVisible();
  await page.getByLabel("Name").fill(updated.name);
  await page.getByLabel("Email").fill(updated.email);
  await page.getByLabel("Phone").fill(updated.phone);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Customer saved.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(updated.name);
  const details = await page.locator(".details dd").allTextContents();
  expect(details.includes(updated.email)).toBe(true);
  expect(details.includes(updated.phone)).toBe(true);
  expect(details.includes(original.email)).toBe(false);
});

test("customer creation can be cancelled", async ({ page }) => {
  await page.goto("/customers/new");
  await page.getByLabel("Name").fill("Unsaved QA Customer");

  await page.getByRole("link", { name: "Cancel" }).click();

  await expect(page).toHaveURL(/\/customers$/u);
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
});
