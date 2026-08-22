import { expect, test } from "../../dist/index.js";

test("dashboard remains usable when background work fails", async ({ page }) => {
  const mode = process.env.PRIVACYSPEC_RUNTIME_FAILURE_FIXTURE_MODE ?? "none";
  await page.route("https://app.runtime.test/dashboard", (route) =>
    route.fulfill({
      body:
        mode === "failures"
          ? `
              <main>Dashboard ready</main>
              <script>
                Promise.allSettled([
                  fetch('/api/recommendations/99123'),
                  fetch('/api/optional/404'),
                  fetch('https://telemetry.runtime.test/collect/55123').catch(() => undefined),
                ]).then(() => setTimeout(() => {
                  console.error('Background widget 99123 rejected person@example.test');
                  globalThis.hiddenBackgroundWorkFinished = true;
                  throw new TypeError('Recommendation widget 99123 failed for person@example.test');
                }, 0));
              </script>
            `
          : "<main>Dashboard ready</main><script>globalThis.hiddenBackgroundWorkFinished = true;</script>",
      contentType: "text/html",
    }),
  );
  await page.route("https://app.runtime.test/api/recommendations/**", (route) =>
    route.fulfill({ status: 503, body: "temporarily unavailable", contentType: "text/plain" }),
  );
  await page.route("https://app.runtime.test/api/optional/**", (route) =>
    route.fulfill({ status: 404, body: "not found", contentType: "text/plain" }),
  );
  await page.route("https://telemetry.runtime.test/**", (route) => route.abort("connectionreset"));

  await page.goto("/dashboard");
  await expect(page.getByRole("main")).toHaveText("Dashboard ready");
  await page.waitForFunction(() => globalThis.hiddenBackgroundWorkFinished === true);
});
