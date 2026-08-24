import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "../../dist/index.js";

const gated = process.env.PRIVACYSPEC_ENGINE_GATED !== "false";
const test = withPrivacySpec(base, {
  experimental: gated ? { browserEngines: ["firefox", "webkit"] } : undefined,
  firstParty: { hosts: ["app.fixture.test", "api.fixture.test"] },
});

test("controlled observer pipeline behaves equivalently across browser engines", async ({
  page,
}) => {
  await page.route("https://app.fixture.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/profile") {
      return route.fulfill({
        body: JSON.stringify({ accepted: true }),
        contentType: "application/json",
        headers: { "x-content-type-options": "nosniff" },
      });
    }
    return route.fulfill({
      body: '<label for="email">Email</label><input id="email" type="email"><main>Ready</main>',
      contentType: "text/html",
      headers: {
        "content-security-policy": "default-src 'self'",
        "set-cookie": "session_id=fixture; Secure; HttpOnly; SameSite=Lax; Path=/",
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
      },
    });
  });

  await page.goto("https://app.fixture.test/profile");
  const email = ["cross-engine", "example.test"].join("@");
  await page.locator("#email").evaluate((control, value) => {
    control.value = String(value);
    localStorage.setItem("fixture-state", "ready");
    console.log("cross-engine-observer-ready");
  }, email);
  const accepted = await page.evaluate(async (value) => {
    const response = await fetch("https://app.fixture.test/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value }),
    });
    return (await response.json()).accepted;
  }, email);

  expect(accepted).toBe(true);
  await expect(page.getByRole("main")).toHaveText("Ready");
  expect(await page.evaluate(() => localStorage.getItem("fixture-state"))).toBe("ready");
});
