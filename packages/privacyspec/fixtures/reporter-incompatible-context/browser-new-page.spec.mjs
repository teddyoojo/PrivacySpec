import { test } from "../../dist/index.js";

test("ordinary journey through an independently created page", async ({ browser }) => {
  const page = await browser.newPage();
  await page.setContent("<main>Ordinary application journey</main>");
  await page.close();
});
