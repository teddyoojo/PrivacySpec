import { expect, type Page } from "@playwright/test";

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${sequence.toString(36)}`;
}

function syntheticEmail(prefix: string, suffix: string): string {
  return [`${prefix}-${suffix}`, "example.test"].join("@");
}

function syntheticPhone(): string {
  const digits = `${Date.now()}${sequence}`.slice(-9);
  return `+49170${digits}`;
}

export interface CustomerData {
  name: string;
  email: string;
  phone: string;
}

export function customerData(prefix: string): CustomerData {
  const suffix = uniqueSuffix();
  return {
    name: `${prefix} QA Customer ${suffix}`,
    email: syntheticEmail(prefix.replaceAll(" ", "-"), suffix),
    phone: syntheticPhone(),
  };
}

export function accountData(prefix: string) {
  const suffix = uniqueSuffix();
  return {
    displayName: `${prefix} QA User ${suffix}`,
    email: syntheticEmail(prefix.replaceAll(" ", "-"), suffix),
    phone: syntheticPhone(),
    password: ["temporary", suffix, "credential"].join("-"),
  };
}

export async function createCustomer(page: Page, prefix: string): Promise<CustomerData> {
  const customer = customerData(prefix);
  await page.goto("/customers/new");
  await page.getByLabel("Name").fill(customer.name);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Phone").fill(customer.phone);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Customer created.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(customer.name);
  return customer;
}

export async function logIn(page: Page, prefix: string) {
  const account = accountData(prefix);
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Signed in.");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  return account;
}
