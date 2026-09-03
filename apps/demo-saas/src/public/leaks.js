const FALSE_LEAKS = Object.freeze({
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

function runtimeDependencies(overrides = {}) {
  return {
    fetch: overrides.fetch ?? globalThis.fetch?.bind(globalThis),
    history: overrides.history ?? globalThis.history,
    storage: overrides.storage ?? globalThis.localStorage,
    logger: overrides.logger ?? globalThis.console,
    crypto: overrides.crypto ?? globalThis.crypto,
    TextEncoder: overrides.TextEncoder ?? globalThis.TextEncoder,
  };
}

function configuredLeaks(config) {
  return { ...FALSE_LEAKS, ...(config?.leaks ?? {}) };
}

function eventEndpoint(origin, description) {
  if (!origin) {
    throw new Error(`The ${description} origin is required for an enabled demo leak.`);
  }

  return new URL("/event", origin).toString();
}

async function postEvent(origin, description, body, dependencies) {
  if (typeof dependencies.fetch !== "function") {
    throw new Error("Fetch is unavailable for an enabled demo leak.");
  }

  await dependencies.fetch(eventEndpoint(origin, description), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sha256Lowercase(value, dependencies) {
  if (!dependencies.crypto?.subtle || typeof dependencies.TextEncoder !== "function") {
    throw new Error("Web Crypto is unavailable for the enabled hash demo leak.");
  }

  const bytes = new dependencies.TextEncoder().encode(value.toLowerCase());
  const digest = await dependencies.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Applies deliberately unsafe, environment-controlled behavior after a customer save.
 * Values are used only for the selected runtime operation and are never retained here.
 */
export async function applyCustomerSaveLeaks(customer, config, overrides = {}) {
  const leaks = configuredLeaks(config);
  const dependencies = runtimeDependencies(overrides);
  const email = typeof customer?.email === "string" ? customer.email : "";
  const phone = typeof customer?.phone === "string" ? customer.phone : "";

  if (leaks.emailToAnalytics && email) {
    await postEvent(
      config.analyticsOrigin,
      "analytics",
      { event: "customer_saved", email },
      dependencies,
    );
  }

  if (leaks.phoneToAnalytics && phone) {
    await postEvent(
      config.analyticsOrigin,
      "analytics",
      { event: "customer_saved", phone },
      dependencies,
    );
  }

  if (leaks.emailInLocalStorage && email) {
    dependencies.storage?.setItem("lastCustomerEmail", email);
  }

  if (leaks.emailInConsole && email) {
    dependencies.logger?.log("saved customer", email);
  }

  if (leaks.hashedEmailToAnalytics && email) {
    const emailHash = await sha256Lowercase(email, dependencies);
    await postEvent(
      config.analyticsOrigin,
      "analytics",
      { event: "customer_saved", emailHash },
      dependencies,
    );
  }

  if (leaks.httpExternal && email) {
    await postEvent(
      config.insecureOrigin,
      "insecure external",
      { event: "customer_saved", email },
      dependencies,
    );
  }

  if (leaks.emailInUrl && email) {
    dependencies.history?.replaceState(
      {},
      "",
      `/customers?selectedEmail=${encodeURIComponent(email)}`,
    );
  }
}

/** Applies a delayed leak to a value read from the completed customer-detail response. */
export async function applyResponseCustomerLeaks(customer, config, overrides = {}) {
  const leaks = configuredLeaks(config);
  const dependencies = runtimeDependencies(overrides);
  const email = typeof customer?.email === "string" ? customer.email : "";
  if (!leaks.responseEmailToAnalytics || !email) return;

  await new Promise((resolve) => setTimeout(resolve, 25));
  await postEvent(
    config.analyticsOrigin,
    "analytics",
    { event: "customer_detail_loaded", email },
    dependencies,
  );
}

/** Applies the deliberately unsafe external-password variant after a successful login. */
export async function applyLoginLeaks(credentials, config, overrides = {}) {
  const leaks = configuredLeaks(config);
  const dependencies = runtimeDependencies(overrides);
  const password = typeof credentials?.password === "string" ? credentials.password : "";

  if (leaks.passwordToAnalytics && password) {
    await postEvent(
      config.analyticsOrigin,
      "analytics",
      { event: "user_login", password },
      dependencies,
    );
  }
}

export { FALSE_LEAKS };
