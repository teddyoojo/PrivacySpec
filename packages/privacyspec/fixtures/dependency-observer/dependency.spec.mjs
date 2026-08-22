import { expect, test } from "../../dist/index.js";

test("ordinary page can use runtime dependencies", async ({ page }) => {
  if (process.env.PRIVACYSPEC_DEPENDENCY_FIXTURE_MODE !== "external") {
    await page.setContent("<main>Checkout ready</main>");
    await expect(page.getByRole("main")).toHaveText("Checkout ready");
    return;
  }

  await page.route("https://cdn.vendor.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(".js")) {
      await route.fulfill({
        body: "globalThis.runtimeDependencyLoaded = true;",
        contentType: "text/javascript",
      });
      return;
    }
    await route.fulfill({ body: "<main>Embedded checkout help</main>", contentType: "text/html" });
  });
  await page.route("https://api.vendor.test/**", (route) =>
    route.fulfill({
      body: JSON.stringify({ available: true }),
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
    }),
  );

  await page.setContent(`
    <main>Checkout ready</main>
    <script src="https://cdn.vendor.test/runtime.js"></script>
    <iframe title="Checkout help" src="https://cdn.vendor.test/help"></iframe>
  `);
  const available = await page.evaluate(async () => {
    const response = await fetch("https://api.vendor.test/availability", { method: "POST" });
    return (await response.json()).available;
  });

  expect(await page.evaluate(() => globalThis.runtimeDependencyLoaded)).toBe(true);
  await expect(page.getByTitle("Checkout help")).toBeVisible();
  expect(available).toBe(true);
});

test("ordinary local rendering has no external runtime dependency", async ({ page }) => {
  await page.setContent("<main>Account ready</main>");
  await expect(page.getByRole("main")).toHaveText("Account ready");
});
