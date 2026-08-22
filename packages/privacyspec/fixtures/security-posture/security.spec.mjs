import { expect, test } from "../../dist/index.js";

test("dashboard keeps working across security posture changes", async ({ page }) => {
  const mode = process.env.PRIVACYSPEC_SECURITY_FIXTURE_MODE ?? "strong";
  if (mode === "absent") {
    await page.setContent("<main>Dashboard ready</main>");
    await expect(page.getByRole("main")).toHaveText("Dashboard ready");
    return;
  }

  await page.route("https://app.security.test/dashboard", (route) => {
    const strong = mode === "strong";
    return route.fulfill({
      body: "<main>Dashboard ready</main>",
      contentType: "text/html",
      headers: strong
        ? {
            "access-control-allow-origin": "https://app.security.test",
            "content-security-policy":
              "default-src 'self'; script-src 'self' 'nonce-changing-value'",
            "strict-transport-security": "max-age=31536000; includeSubDomains",
            "x-content-type-options": "nosniff",
            "set-cookie":
              "session_id=never-persist-this-value; Path=/; Secure; HttpOnly; SameSite=Lax",
          }
        : {
            "access-control-allow-origin": "*",
            "access-control-allow-credentials": "true",
            "set-cookie": "session_id=another-private-value; Path=/",
          },
    });
  });

  await page.goto("/dashboard");
  await expect(page.getByRole("main")).toHaveText("Dashboard ready");
});

test("client-only rendering has no response posture target", async ({ page }) => {
  await page.setContent("<main>Client rendering ready</main>");
  await expect(page.getByRole("main")).toHaveText("Client rendering ready");
});
