import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readLeakConfig, startDemoEnvironment } from "../dist/index.js";

const syntheticEmail = (label) => `${label}-${randomUUID()}@example.test`;
const syntheticPhone = () => ["+49", "170", String(Date.now()).slice(-7)].join("");

const jsonRequest = async (origin, path, options = {}) => {
  const request = { ...options, headers: { ...(options.headers ?? {}) } };
  if (request.body !== undefined && typeof request.body !== "string") {
    request.headers["content-type"] = "application/json";
    request.body = JSON.stringify(request.body);
  }
  const response = await fetch(`${origin}${path}`, request);
  const body = response.status === 204 ? undefined : await response.json();
  return { response, body };
};

const withEnvironment = async (callback, options = {}) => {
  const environment = await startDemoEnvironment({
    analytics: { host: "127.0.0.1", port: 0 },
    insecureSink: { host: "127.0.0.1", port: 0 },
    app: { host: "127.0.0.1", port: 0, ...options },
  });

  try {
    await callback(environment);
  } finally {
    await environment.close();
  }
};

test("leak configuration maps the nine documented environment flags", () => {
  assert.deepEqual(
    readLeakConfig({
      DEMO_LEAK_EMAIL_TO_ANALYTICS: "1",
      DEMO_LEAK_PHONE_TO_ANALYTICS: "true",
      DEMO_LEAK_EMAIL_IN_URL: "yes",
      DEMO_LEAK_EMAIL_LOCALSTORAGE: "0",
      DEMO_LEAK_EMAIL_CONSOLE: "false",
      DEMO_LEAK_PASSWORD_EXTERNAL: "1",
      DEMO_LEAK_HASHED_EMAIL_EXTERNAL: "1",
      DEMO_LEAK_HTTP_EXTERNAL: "true",
      DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL: "true",
    }),
    {
      emailToAnalytics: true,
      phoneToAnalytics: true,
      emailInUrl: true,
      emailInLocalStorage: false,
      emailInConsole: false,
      passwordToAnalytics: true,
      hashedEmailToAnalytics: true,
      httpExternal: true,
      responseEmailToAnalytics: true,
    },
  );
  assert.deepEqual(readLeakConfig({}), {
    emailToAnalytics: false,
    phoneToAnalytics: false,
    emailInUrl: false,
    emailInLocalStorage: false,
    emailInConsole: false,
    passwordToAnalytics: false,
    hashedEmailToAnalytics: false,
    httpExternal: false,
    responseEmailToAnalytics: false,
  });
});

test("demo config exposes the analytics origin and a leak snapshot", async () => {
  const leaks = {
    emailToAnalytics: true,
    phoneToAnalytics: false,
    emailInUrl: false,
    emailInLocalStorage: true,
    emailInConsole: false,
    passwordToAnalytics: false,
    hashedEmailToAnalytics: true,
    httpExternal: false,
    responseEmailToAnalytics: false,
  };

  await withEnvironment(
    async ({ app, analytics, insecureSink }) => {
      const { response, body } = await jsonRequest(app.origin, "/api/demo-config");
      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        analyticsOrigin: analytics.origin,
        insecureOrigin: insecureSink.origin,
        leaks,
      });
    },
    { leaks },
  );
});

test("customer list, create, detail, edit, and search flows use the in-memory store", async () => {
  await withEnvironment(async ({ app }) => {
    const email = syntheticEmail("customer");
    const phone = syntheticPhone();
    const createdResult = await jsonRequest(app.origin, "/api/customers", {
      method: "POST",
      body: { name: "Customer Alpha", email, phone },
    });
    assert.equal(createdResult.response.status, 201);
    assert.equal(createdResult.body.name, "Customer Alpha");
    assert.equal(createdResult.body.email, email);
    assert.ok(createdResult.body.id);

    const listResult = await jsonRequest(app.origin, "/api/customers");
    assert.equal(listResult.response.status, 200);
    assert.deepEqual(listResult.body, [createdResult.body]);

    const detailResult = await jsonRequest(
      app.origin,
      `/api/customers/${encodeURIComponent(createdResult.body.id)}`,
    );
    assert.deepEqual(detailResult.body, createdResult.body);

    const updatedEmail = syntheticEmail("updated");
    const updateResult = await jsonRequest(
      app.origin,
      `/api/customers/${encodeURIComponent(createdResult.body.id)}`,
      { method: "PUT", body: { name: "Customer Beta", email: updatedEmail } },
    );
    assert.equal(updateResult.response.status, 200);
    assert.equal(updateResult.body.name, "Customer Beta");
    assert.equal(updateResult.body.email, updatedEmail);
    assert.equal(updateResult.body.phone, phone);

    const searchResult = await jsonRequest(app.origin, "/api/customers/search", {
      method: "POST",
      body: { query: "Beta" },
    });
    assert.deepEqual(searchResult.body, [updateResult.body]);

    const emailSearchResult = await jsonRequest(app.origin, "/api/customers/search", {
      method: "POST",
      body: { query: updatedEmail },
    });
    assert.deepEqual(emailSearchResult.body, [updateResult.body]);
  });
});

test("invitation, support, and settings flows retain only in-memory application state", async () => {
  await withEnvironment(async ({ app }) => {
    const inviteEmail = syntheticEmail("invite");
    const invitation = await jsonRequest(app.origin, "/api/invitations", {
      method: "POST",
      body: { email: inviteEmail, role: "member" },
    });
    assert.equal(invitation.response.status, 201);
    assert.deepEqual(
      await jsonRequest(app.origin, "/api/invitations").then((result) => result.body),
      [invitation.body],
    );

    const contactEmail = syntheticEmail("support");
    const ticket = await jsonRequest(app.origin, "/api/support-tickets", {
      method: "POST",
      body: {
        subject: "Export question",
        description: "The sample export needs clarification.",
        contactEmail,
      },
    });
    assert.equal(ticket.response.status, 201);
    assert.equal(ticket.body.status, "submitted");
    assert.deepEqual(
      await jsonRequest(app.origin, "/api/support-tickets").then((result) => result.body),
      [ticket.body],
    );

    const settingsEmail = syntheticEmail("settings");
    const settings = await jsonRequest(app.origin, "/api/settings", {
      method: "PUT",
      body: {
        displayName: "Demo Operator",
        email: settingsEmail,
        phone: syntheticPhone(),
        preferences: { emailNotifications: false, productUpdates: true },
      },
    });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.body.email, settingsEmail);
    assert.deepEqual(settings.body.preferences, {
      emailNotifications: false,
      productUpdates: true,
    });
    assert.deepEqual(
      await jsonRequest(app.origin, "/api/settings").then((result) => result.body),
      settings.body,
    );
  });
});

test("login and logout expose only simple demo session state and never return the password", async () => {
  await withEnvironment(async ({ app }) => {
    const email = syntheticEmail("login");
    const password = randomUUID();
    const login = await jsonRequest(app.origin, "/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.authenticated, true);
    assert.equal(login.body.user.email, email);
    assert.equal(JSON.stringify(login.body).includes(password), false);

    const authenticatedSession = await jsonRequest(app.origin, "/api/auth/session");
    assert.equal(authenticatedSession.body.authenticated, true);
    assert.equal(authenticatedSession.body.user.email, email);

    const logout = await jsonRequest(app.origin, "/api/auth/logout", { method: "POST" });
    assert.deepEqual(logout.body, { authenticated: false });
    assert.deepEqual(
      await jsonRequest(app.origin, "/api/auth/session").then((result) => result.body),
      { authenticated: false },
    );
  });
});

test("invalid application input and missing resources receive basic 400/404 responses", async () => {
  await withEnvironment(async ({ app }) => {
    assert.equal(
      (await jsonRequest(app.origin, "/api/customers", { method: "POST", body: {} })).response
        .status,
      400,
    );
    assert.equal((await jsonRequest(app.origin, "/api/customers/missing")).response.status, 404);
    assert.equal(
      (
        await jsonRequest(app.origin, "/api/customers/missing", {
          method: "PUT",
          body: { name: "Still missing" },
        })
      ).response.status,
      404,
    );
    assert.equal(
      (await jsonRequest(app.origin, "/api/invitations", { method: "POST", body: {} })).response
        .status,
      400,
    );
    assert.equal((await jsonRequest(app.origin, "/api/not-a-route")).response.status, 404);
  });
});

test("fake analytics allows CORS while retaining only sanitized metadata", async () => {
  await withEnvironment(async ({ analytics }) => {
    const preflight = await fetch(`${analytics.origin}/event`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

    const email = syntheticEmail("analytics");
    const phone = syntheticPhone();
    const password = randomUUID();
    const first = await jsonRequest(analytics.origin, "/event", {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
      body: { event: "customer_saved", email, phone },
    });
    assert.equal(first.response.status, 202);
    assert.deepEqual(first.body, {
      event: "customer_saved",
      payloadFieldNames: ["email", "phone"],
      payloadFieldCount: 2,
      payloadValueCount: 2,
      count: 1,
    });
    assert.equal(first.response.headers.get("access-control-allow-origin"), "*");

    await jsonRequest(analytics.origin, "/event", {
      method: "POST",
      body: { event: "customer_saved", email, phone },
    });
    await jsonRequest(analytics.origin, "/event", {
      method: "POST",
      body: { event: "user_login", password },
    });

    const events = await jsonRequest(analytics.origin, "/events");
    assert.equal(events.body.count, 3);
    assert.equal(events.body.events[0].count, 2);
    assert.deepEqual(events.body.events[1].payloadFieldNames, ["password"]);

    const serializedMetadata = JSON.stringify(events.body);
    assert.equal(serializedMetadata.includes(email), false);
    assert.equal(serializedMetadata.includes(phone), false);
    assert.equal(serializedMetadata.includes(password), false);

    const invalid = await jsonRequest(analytics.origin, "/event", {
      method: "POST",
      body: { email },
    });
    assert.equal(invalid.response.status, 400);
  });
});

test("the app serves the static Phase 1 browser client and supports direct route navigation", async () => {
  await withEnvironment(async ({ app }) => {
    for (const path of ["/", "/customers/new", "/settings", "/app.js", "/leaks.js"]) {
      const response = await fetch(`${app.origin}${path}`, {
        headers: { accept: path.endsWith(".js") ? "text/javascript" : "text/html" },
      });
      assert.equal(response.status, 200, path);
    }
  });
});
