import { test } from "./fixtures.mjs";

test("uses an independent context", async ({ browser }) => {
  const independent = await browser.newContext();
  await independent.newPage();
  await independent.close();
});
