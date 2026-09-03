import { expect, test } from "./fixtures.js";
import { accountData } from "./helpers.js";

test("support ticket can be submitted", async ({ page }) => {
  const contact = accountData("Support");
  await page.goto("/support");

  await page.getByLabel("Subject").fill("Unable to export a report");
  await page
    .getByLabel("Description")
    .fill("The export action finishes, but the expected download does not start.");
  await page.getByLabel("Contact email").fill(contact.email);
  await page.getByRole("button", { name: "Submit ticket" }).click();

  await expect(page.getByRole("status")).toHaveText("Support ticket submitted.");
  await expect(page.getByLabel("Subject")).toHaveValue("");
});

test("support form rejects an invalid contact email", async ({ page }) => {
  await page.goto("/support");

  await page.getByLabel("Subject").fill("Billing question");
  await page.getByLabel("Description").fill("Please clarify the latest invoice.");
  await page.getByLabel("Contact email").fill("invalid-address");
  await page.getByRole("button", { name: "Submit ticket" }).click();

  const valid = await page
    .getByLabel("Contact email")
    .evaluate((input) => (input instanceof HTMLInputElement ? input.validity.valid : false));
  expect(valid).toBe(false);
  await expect(page.getByText("Support ticket submitted.")).toHaveCount(0);
});
