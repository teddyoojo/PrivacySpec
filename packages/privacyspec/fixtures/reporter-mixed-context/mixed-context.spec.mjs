import { test } from "../../dist/index.js";

test("ordinary journey mixes the fixture page with an independent page", async ({
  browser,
  page,
}) => {
  await page.setContent("<main>Instrumented application journey</main>");
  const independentPage = await browser.newPage();
  await independentPage.setContent("<main>Independent application journey</main>");
  await independentPage.close();
  const independentContext = await browser.newContext();
  const contextPage = await independentContext.newPage();
  await contextPage.setContent("<main>Independent context journey</main>");
  await independentContext.close();
});
