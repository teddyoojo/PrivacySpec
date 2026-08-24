import { createServer } from "node:http";
import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "../../dist/index.js";

const enabled = process.env.PRIVACYSPEC_API_FIXTURE_MODE === "enabled";
const server = createServer((_request, response) => {
  response.writeHead(204, {
    "access-control-allow-origin": "https://app.example.test",
    "x-content-type-options": "nosniff",
  });
  response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (typeof address !== "object" || address === null) throw new Error("fixture server unavailable");
const fixtureOrigin = `http://127.0.0.1:${address.port}`;
const test = withPrivacySpec(base, {
  experimental: enabled ? { apiRequestContext: "request-fixture" } : undefined,
  firstParty: { hosts: ["app.example.test"] },
  dev: { allowInsecureOrigins: [fixtureOrigin] },
});

test.afterAll(
  () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    ),
);

test("composed request fixture remains functional and carries existing DOM sources", async ({
  page,
  request,
}) => {
  await page.goto(
    `data:text/html,${encodeURIComponent('<label for="email">Email</label><input id="email" type="email">')}`,
  );
  const email = ["api", "fixture.example"].join("@");
  await page.locator("#email").fill(email);
  const response = await request.post(`${fixtureOrigin}/customers/42`, {
    data: { email },
    headers: { "x-fixture": "explicit" },
  });
  expect(response.status()).toBe(204);
});
