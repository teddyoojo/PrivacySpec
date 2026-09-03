import {
  applyCustomerSaveLeaks,
  applyLoginLeaks,
  applyResponseCustomerLeaks,
  FALSE_LEAKS,
} from "./leaks.js";

const app = document.querySelector("#app");
const loginLink = document.querySelector("[data-login-link]");
const logoutButton = document.querySelector('[data-action="logout"]');

const state = {
  config: { analyticsOrigin: "", insecureOrigin: "", leaks: { ...FALSE_LEAKS } },
  authenticated: false,
  currentCustomer: null,
  editingCustomer: false,
  searchResults: null,
  flash: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asCustomer(payload) {
  return payload?.customer ?? payload;
}

function asCustomers(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload?.customers) ? payload.customers : [];
}

function asSettings(payload) {
  return payload?.settings ?? payload ?? {};
}

function valueFrom(formData, name, trim = true) {
  const value = formData.get(name);
  if (typeof value !== "string") {
    return "";
  }
  return trim ? value.trim() : value;
}

async function apiRequest(path, options = {}) {
  const request = { ...options, headers: { ...(options.headers ?? {}) } };

  if (request.body && typeof request.body !== "string") {
    request.headers["content-type"] = "application/json";
    request.body = JSON.stringify(request.body);
  }

  const response = await fetch(path, request);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "The request failed.";
    throw new Error(message);
  }

  return payload;
}

function noticeMarkup() {
  if (!state.flash) {
    return "";
  }

  const flash = state.flash;
  state.flash = null;
  const errorClass = flash.type === "error" ? " error" : "";
  const role = flash.type === "error" ? "alert" : "status";
  return `<div class="notice${errorClass}" role="${role}">${escapeHtml(flash.message)}</div>`;
}

function updateNavigation() {
  const path = window.location.pathname;
  for (const link of document.querySelectorAll("nav a[data-link]")) {
    const href = link.getAttribute("href");
    const active = href === "/customers" ? path.startsWith("/customers") : path === href;
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  loginLink.hidden = state.authenticated;
  logoutButton.hidden = !state.authenticated;
}

function renderPage(title, content) {
  document.title = `${title} — PrivacySpec Demo SaaS`;
  app.innerHTML = `${noticeMarkup()}${content}`;
  updateNavigation();
  app.focus({ preventScroll: true });
}

function renderFailure(title, message = "This page could not be loaded.") {
  renderPage(
    title,
    `<h1>${escapeHtml(title)}</h1>
     <div class="notice error" role="alert">${escapeHtml(message)}</div>
     <p><a href="${escapeHtml(window.location.pathname)}" data-link>Try again</a></p>`,
  );
}

function customerForm(customer = null) {
  const editing = Boolean(customer);
  const formId = editing ? "edit-customer-form" : "create-customer-form";
  const heading = editing ? "Edit customer" : "New customer";
  const submitLabel = editing ? "Save" : "Create";
  const cancel = editing
    ? '<button type="button" class="secondary" data-action="cancel-customer-edit">Cancel</button>'
    : '<a class="button-link secondary" href="/customers" data-link>Cancel</a>';

  return `
    <h1>${heading}</h1>
    <form id="${formId}" class="form-card" ${editing ? `data-customer-id="${escapeHtml(customer.id)}"` : ""}>
      <div class="field">
        <label for="customer-name">Name</label>
        <input id="customer-name" name="name" autocomplete="name" required value="${escapeHtml(customer?.name)}" />
      </div>
      <div class="field">
        <label for="customer-email">Email</label>
        <input id="customer-email" name="email" type="email" autocomplete="email" required value="${escapeHtml(customer?.email)}" />
      </div>
      <div class="field">
        <label for="customer-phone">Phone</label>
        <input id="customer-phone" name="phone" type="tel" autocomplete="tel" required value="${escapeHtml(customer?.phone)}" />
      </div>
      <p id="form-message" class="form-message" role="alert"></p>
      <div class="form-actions">
        <button type="submit">${submitLabel}</button>
        ${cancel}
      </div>
    </form>`;
}

function renderCustomers(customers) {
  const list = customers.length
    ? `<ul class="card-list">${customers
        .map(
          (customer) => `
          <li class="card">
            <h2><a href="/customers/${encodeURIComponent(customer.id)}" data-link>${escapeHtml(customer.name)}</a></h2>
            <p class="muted">${escapeHtml(customer.email)}</p>
          </li>`,
        )
        .join("")}</ul>`
    : '<div class="empty-state"><p>No customers yet.</p></div>';

  renderPage(
    "Customers",
    `<div class="split-heading">
       <h1>Customers</h1>
       <a class="button-link" href="/customers/new" data-link>New customer</a>
     </div>
     ${list}`,
  );
}

function renderCustomerDetail(customer) {
  state.currentCustomer = customer;

  if (state.editingCustomer) {
    renderPage("Edit customer", customerForm(customer));
    return;
  }

  renderPage(
    customer.name || "Customer",
    `<div class="split-heading">
       <h1>${escapeHtml(customer.name)}</h1>
       <button type="button" class="secondary" data-action="edit-customer">Edit</button>
     </div>
     <dl class="details card">
       <dt>Email</dt><dd>${escapeHtml(customer.email)}</dd>
       <dt>Phone</dt><dd>${escapeHtml(customer.phone)}</dd>
     </dl>
     <p><a href="/customers" data-link>Back to customers</a></p>`,
  );
}

function searchResultsMarkup(results) {
  if (results === null) {
    return "";
  }
  if (results.length === 0) {
    return '<div class="empty-state" role="status"><p>No matching customers.</p></div>';
  }

  return `<section aria-labelledby="search-results-heading">
    <h2 id="search-results-heading">Results</h2>
    <ul class="search-results">${results
      .map(
        (customer) => `
        <li class="card">
          <a href="/customers/${encodeURIComponent(customer.id)}" data-link>${escapeHtml(customer.name)}</a>
          <p class="muted">${escapeHtml(customer.email)}</p>
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

function renderSearch() {
  renderPage(
    "Search customers",
    `<h1>Search customers</h1>
     <form id="search-form" class="form-card" role="search">
       <div class="field">
         <label for="customer-query">Name or email</label>
         <input id="customer-query" name="query" type="search" required />
       </div>
       <p id="form-message" class="form-message" role="alert"></p>
       <button type="submit">Search</button>
     </form>
     ${searchResultsMarkup(state.searchResults)}`,
  );
}

function renderTeam() {
  renderPage(
    "Team",
    `<h1>Team</h1>
     <p>Invite a teammate to the demo workspace.</p>
     <form id="invitation-form" class="form-card">
       <div class="field">
         <label for="invitation-email">Email</label>
         <input id="invitation-email" name="email" type="email" autocomplete="email" required />
       </div>
       <div class="field">
         <label for="invitation-role">Role</label>
         <select id="invitation-role" name="role">
           <option value="member">Member</option>
           <option value="admin">Administrator</option>
         </select>
       </div>
       <p id="form-message" class="form-message" role="alert"></p>
       <button type="submit">Send invitation</button>
     </form>`,
  );
}

function renderSupport() {
  renderPage(
    "Support",
    `<h1>Support</h1>
     <form id="support-form" class="form-card">
       <div class="field">
         <label for="support-subject">Subject</label>
         <input id="support-subject" name="subject" required />
       </div>
       <div class="field">
         <label for="support-description">Description</label>
         <textarea id="support-description" name="description" required></textarea>
       </div>
       <div class="field">
         <label for="support-email">Contact email</label>
         <input id="support-email" name="contactEmail" type="email" autocomplete="email" required />
       </div>
       <p id="form-message" class="form-message" role="alert"></p>
       <button type="submit">Submit ticket</button>
     </form>`,
  );
}

function renderSettings(settings) {
  const preferences = settings.preferences ?? {};
  renderPage(
    "Settings",
    `<h1>Settings</h1>
     <form id="settings-form" class="form-card">
       <div class="field">
         <label for="settings-name">Display name</label>
         <input id="settings-name" name="displayName" autocomplete="name" required value="${escapeHtml(settings.displayName)}" />
       </div>
       <div class="field">
         <label for="settings-email">Email</label>
         <input id="settings-email" name="email" type="email" autocomplete="email" required value="${escapeHtml(settings.email)}" />
       </div>
       <div class="field">
         <label for="settings-phone">Phone</label>
         <input id="settings-phone" name="phone" type="tel" autocomplete="tel" required value="${escapeHtml(settings.phone)}" />
       </div>
       <fieldset>
         <legend>Preferences</legend>
         <label class="checkbox-field">
           <input name="emailNotifications" type="checkbox" ${preferences.emailNotifications ? "checked" : ""} />
           Email notifications
         </label>
         <label class="checkbox-field">
           <input name="productUpdates" type="checkbox" ${preferences.productUpdates ? "checked" : ""} />
           Product updates
         </label>
       </fieldset>
       <p id="form-message" class="form-message" role="alert"></p>
       <button type="submit">Save settings</button>
     </form>`,
  );
}

function renderLogin() {
  renderPage(
    "Log in",
    `<h1>Log in</h1>
     <form id="login-form" class="form-card">
       <div class="field">
         <label for="login-email">Email</label>
         <input id="login-email" name="email" type="email" autocomplete="email" required />
       </div>
       <div class="field">
         <label for="login-password">Password</label>
         <input id="login-password" name="password" type="password" autocomplete="current-password" required />
       </div>
       <p id="form-message" class="form-message" role="alert"></p>
       <button type="submit">Log in</button>
     </form>`,
  );
}

async function renderRoute() {
  const path = window.location.pathname;
  state.editingCustomer = false;

  try {
    if (path === "/" || path === "") {
      history.replaceState({}, "", "/customers");
      await renderRoute();
      return;
    }

    if (path === "/customers") {
      renderCustomers(asCustomers(await apiRequest("/api/customers")));
      return;
    }

    if (path === "/customers/new") {
      renderPage("New customer", customerForm());
      return;
    }

    const customerMatch = path.match(/^\/customers\/([^/]+)$/);
    if (customerMatch) {
      const customerId = decodeURIComponent(customerMatch[1]);
      const customer = asCustomer(
        await apiRequest(`/api/customers/${encodeURIComponent(customerId)}`),
      );
      await safelyApplyResponseLeaks(customer);
      renderCustomerDetail(customer);
      return;
    }

    if (path === "/search") {
      state.searchResults = null;
      renderSearch();
      return;
    }

    if (path === "/team") {
      renderTeam();
      return;
    }

    if (path === "/support") {
      renderSupport();
      return;
    }

    if (path === "/settings") {
      renderSettings(asSettings(await apiRequest("/api/settings")));
      return;
    }

    if (path === "/login") {
      renderLogin();
      return;
    }

    renderFailure("Page not found", "The requested demo page does not exist.");
  } catch {
    renderFailure("Unable to load page");
  }
}

async function navigate(path, replace = false) {
  if (replace) {
    history.replaceState({}, "", path);
  } else {
    history.pushState({}, "", path);
  }
  await renderRoute();
}

function setFormBusy(form, busy) {
  const submit = form.querySelector('button[type="submit"]');
  if (submit) {
    submit.disabled = busy;
    submit.setAttribute("aria-busy", String(busy));
  }
}

function setFormMessage(form, message, isError = false) {
  const output = form.querySelector("#form-message");
  if (!output) {
    return;
  }
  output.textContent = message;
  output.classList.toggle("error", isError);
  output.setAttribute("role", isError ? "alert" : "status");
}

async function safelyApplyCustomerLeaks(customer) {
  try {
    await applyCustomerSaveLeaks(customer, state.config);
  } catch {
    state.leakRuntimeUnavailable = true;
  }
}

async function safelyApplyLoginLeaks(credentials) {
  try {
    await applyLoginLeaks(credentials, state.config);
  } catch {
    state.leakRuntimeUnavailable = true;
  }
}

async function safelyApplyResponseLeaks(customer) {
  try {
    await applyResponseCustomerLeaks(customer, state.config);
  } catch {
    state.leakRuntimeUnavailable = true;
  }
}

async function submitCustomer(form, editing) {
  const formData = new FormData(form);
  const customer = {
    name: valueFrom(formData, "name"),
    email: valueFrom(formData, "email"),
    phone: valueFrom(formData, "phone"),
  };
  const customerId = form.dataset.customerId;
  const path = editing ? `/api/customers/${encodeURIComponent(customerId)}` : "/api/customers";

  setFormBusy(form, true);
  setFormMessage(form, "");
  try {
    const saved = asCustomer(
      await apiRequest(path, { method: editing ? "PUT" : "POST", body: customer }),
    );
    const completeCustomer = { ...customer, ...saved };
    state.currentCustomer = completeCustomer;
    state.editingCustomer = false;
    state.flash = { type: "success", message: editing ? "Customer saved." : "Customer created." };

    if (completeCustomer.id) {
      await navigate(`/customers/${encodeURIComponent(completeCustomer.id)}`, editing);
    } else {
      await navigate("/customers");
    }
    await safelyApplyCustomerLeaks(completeCustomer);
  } catch (error) {
    setFormMessage(form, error.message, true);
    setFormBusy(form, false);
  }
}

async function submitSearch(form) {
  const query = valueFrom(new FormData(form), "query");
  setFormBusy(form, true);
  setFormMessage(form, "");
  try {
    const payload = await apiRequest("/api/customers/search", {
      method: "POST",
      body: { query },
    });
    state.searchResults = asCustomers(payload);
    renderSearch();
  } catch (error) {
    setFormMessage(form, error.message, true);
    setFormBusy(form, false);
  }
}

async function submitInvitation(form) {
  const formData = new FormData(form);
  setFormBusy(form, true);
  setFormMessage(form, "");
  try {
    await apiRequest("/api/invitations", {
      method: "POST",
      body: { email: valueFrom(formData, "email"), role: valueFrom(formData, "role") },
    });
    form.reset();
    setFormMessage(form, "Invitation sent.");
  } catch (error) {
    setFormMessage(form, error.message, true);
  } finally {
    setFormBusy(form, false);
  }
}

async function submitSupport(form) {
  const formData = new FormData(form);
  setFormBusy(form, true);
  setFormMessage(form, "");
  try {
    await apiRequest("/api/support-tickets", {
      method: "POST",
      body: {
        subject: valueFrom(formData, "subject"),
        description: valueFrom(formData, "description"),
        contactEmail: valueFrom(formData, "contactEmail"),
      },
    });
    form.reset();
    setFormMessage(form, "Support ticket submitted.");
  } catch (error) {
    setFormMessage(form, error.message, true);
  } finally {
    setFormBusy(form, false);
  }
}

async function submitSettings(form) {
  const formData = new FormData(form);
  const settings = {
    displayName: valueFrom(formData, "displayName"),
    email: valueFrom(formData, "email"),
    phone: valueFrom(formData, "phone"),
    preferences: {
      emailNotifications: formData.has("emailNotifications"),
      productUpdates: formData.has("productUpdates"),
    },
  };
  setFormBusy(form, true);
  setFormMessage(form, "");
  try {
    const saved = asSettings(await apiRequest("/api/settings", { method: "PUT", body: settings }));
    renderSettings({ ...settings, ...saved });
    const renderedForm = document.querySelector("#settings-form");
    setFormMessage(renderedForm, "Settings saved.");
  } catch (error) {
    setFormMessage(form, error.message, true);
    setFormBusy(form, false);
  }
}

async function submitLogin(form) {
  const formData = new FormData(form);
  const credentials = {
    email: valueFrom(formData, "email"),
    password: valueFrom(formData, "password", false),
  };
  setFormBusy(form, true);
  setFormMessage(form, "");
  try {
    await apiRequest("/api/auth/login", { method: "POST", body: credentials });
    state.authenticated = true;
    state.flash = { type: "success", message: "Signed in." };
    await navigate("/customers");
    await safelyApplyLoginLeaks(credentials);
  } catch (error) {
    setFormMessage(form, error.message, true);
    setFormBusy(form, false);
  }
}

async function logOut(button) {
  button.disabled = true;
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
    state.authenticated = false;
    state.flash = { type: "success", message: "Signed out." };
    await navigate("/login");
  } catch {
    state.flash = { type: "error", message: "Sign out failed." };
    await renderRoute();
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[data-link]");
  if (link && link.origin === window.location.origin) {
    event.preventDefault();
    await navigate(`${link.pathname}${link.search}${link.hash}`);
    return;
  }

  const button = target?.closest("button[data-action]");
  if (!button) {
    return;
  }

  if (button.dataset.action === "edit-customer" && state.currentCustomer) {
    state.editingCustomer = true;
    renderCustomerDetail(state.currentCustomer);
  } else if (button.dataset.action === "cancel-customer-edit" && state.currentCustomer) {
    state.editingCustomer = false;
    renderCustomerDetail(state.currentCustomer);
  } else if (button.dataset.action === "logout") {
    await logOut(button);
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  if (form.id === "create-customer-form") {
    await submitCustomer(form, false);
  } else if (form.id === "edit-customer-form") {
    await submitCustomer(form, true);
  } else if (form.id === "search-form") {
    await submitSearch(form);
  } else if (form.id === "invitation-form") {
    await submitInvitation(form);
  } else if (form.id === "support-form") {
    await submitSupport(form);
  } else if (form.id === "settings-form") {
    await submitSettings(form);
  } else if (form.id === "login-form") {
    await submitLogin(form);
  }
});

window.addEventListener("popstate", () => {
  void renderRoute();
});

async function bootstrap() {
  try {
    const config = await apiRequest("/api/demo-config");
    state.config = {
      analyticsOrigin: config?.analyticsOrigin ?? "",
      insecureOrigin: config?.insecureOrigin ?? "",
      leaks: { ...FALSE_LEAKS, ...(config?.leaks ?? {}) },
    };
    await renderRoute();
  } catch {
    renderFailure("Unable to start demo", "The demo configuration could not be loaded.");
  }
}

void bootstrap();
