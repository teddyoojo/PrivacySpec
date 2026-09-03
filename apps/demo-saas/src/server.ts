import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type Application, type ErrorRequestHandler, type RequestHandler } from "express";
import {
  type RunningHttpServer,
  type StartAnalyticsServerOptions,
  startAnalyticsServer,
} from "./analytics-server.js";
import { type LeakConfig, readLeakConfig } from "./config.js";
import {
  createDemoStore,
  type DemoStore,
  type UpdateCustomerInput,
  type UpdateSettingsInput,
} from "./store.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPublicDirectory = resolve(
  moduleDirectory,
  basename(moduleDirectory) === "dist" ? "../src/public" : "public",
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBody = (body: unknown): Record<string, unknown> | undefined =>
  isRecord(body) ? body : undefined;

const readRequiredString = (body: Record<string, unknown>, field: string): string | undefined => {
  const value = body[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);

const readRouteParameter = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const validationError = (response: express.Response, message: string): void => {
  response.status(400).json({ error: message });
};

const customerUpdateFrom = (body: Record<string, unknown>): UpdateCustomerInput | undefined => {
  const update: UpdateCustomerInput = {};

  if (body.name !== undefined) {
    const name = readRequiredString(body, "name");
    if (name === undefined) return undefined;
    update.name = name;
  }
  if (body.email !== undefined) {
    const email = readRequiredString(body, "email");
    if (email === undefined || !isEmail(email)) return undefined;
    update.email = email;
  }
  if (body.phone !== undefined) {
    const phone = readRequiredString(body, "phone");
    if (phone === undefined) return undefined;
    update.phone = phone;
  }

  return Object.keys(update).length > 0 ? update : undefined;
};

const settingsUpdateFrom = (body: Record<string, unknown>): UpdateSettingsInput | undefined => {
  const update: UpdateSettingsInput = {};

  if (body.displayName !== undefined) {
    const displayName = readRequiredString(body, "displayName");
    if (displayName === undefined) return undefined;
    update.displayName = displayName;
  }
  if (body.email !== undefined) {
    const email = readRequiredString(body, "email");
    if (email === undefined || !isEmail(email)) return undefined;
    update.email = email;
  }
  if (body.phone !== undefined) {
    const phone = readRequiredString(body, "phone");
    if (phone === undefined) return undefined;
    update.phone = phone;
  }
  if (body.preferences !== undefined) {
    if (!isRecord(body.preferences)) return undefined;
    const preferences: NonNullable<UpdateSettingsInput["preferences"]> = {};

    if (body.preferences.emailNotifications !== undefined) {
      if (typeof body.preferences.emailNotifications !== "boolean") return undefined;
      preferences.emailNotifications = body.preferences.emailNotifications;
    }
    if (body.preferences.productUpdates !== undefined) {
      if (typeof body.preferences.productUpdates !== "boolean") return undefined;
      preferences.productUpdates = body.preferences.productUpdates;
    }
    update.preferences = preferences;
  }

  return Object.keys(update).length > 0 ? update : undefined;
};

export interface CreateDemoAppOptions {
  analyticsOrigin?: string;
  insecureOrigin?: string;
  leaks?: LeakConfig;
  leakConfig?: LeakConfig;
  publicDirectory?: string;
  store?: DemoStore;
}

export const createDemoApp = (options: CreateDemoAppOptions = {}): Application => {
  const app = express();
  const store = options.store ?? createDemoStore();
  const analyticsOrigin = options.analyticsOrigin ?? "http://127.0.0.1:4100";
  const insecureOrigin = options.insecureOrigin ?? "http://127.0.0.1:4200";
  const leaks = options.leaks ?? options.leakConfig ?? readLeakConfig();
  const publicDirectory = options.publicDirectory ?? defaultPublicDirectory;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/demo-config", (_request, response) => {
    response.json({ analyticsOrigin, insecureOrigin, leaks });
  });

  app.post("/api/customers/search", (request, response) => {
    const body = readBody(request.body);
    const query = body === undefined ? undefined : readRequiredString(body, "query");
    if (query === undefined) {
      validationError(response, "A search query is required.");
      return;
    }
    response.json(store.searchCustomers(query));
  });

  app.get("/api/customers", (_request, response) => {
    response.json(store.listCustomers());
  });

  app.post("/api/customers", (request, response) => {
    const body = readBody(request.body);
    if (body === undefined) {
      validationError(response, "A JSON object is required.");
      return;
    }

    const name = readRequiredString(body, "name");
    const email = readRequiredString(body, "email");
    const phone = readRequiredString(body, "phone");
    if (name === undefined || email === undefined || phone === undefined || !isEmail(email)) {
      validationError(response, "Valid name, email, and phone values are required.");
      return;
    }

    response.status(201).json(store.createCustomer({ name, email, phone }));
  });

  app.get("/api/customers/:id", (request, response) => {
    const customer = store.getCustomer(readRouteParameter(request.params.id));
    if (customer === undefined) {
      response.status(404).json({ error: "Customer not found." });
      return;
    }
    response.json(customer);
  });

  const updateCustomer: RequestHandler = (request, response) => {
    const body = readBody(request.body);
    const update = body === undefined ? undefined : customerUpdateFrom(body);
    if (update === undefined) {
      validationError(response, "At least one valid customer field is required.");
      return;
    }

    const customer = store.updateCustomer(readRouteParameter(request.params.id), update);
    if (customer === undefined) {
      response.status(404).json({ error: "Customer not found." });
      return;
    }
    response.json(customer);
  };
  app.put("/api/customers/:id", updateCustomer);
  app.patch("/api/customers/:id", updateCustomer);

  app.get("/api/invitations", (_request, response) => {
    response.json(store.listInvitations());
  });

  app.post("/api/invitations", (request, response) => {
    const body = readBody(request.body);
    const email = body === undefined ? undefined : readRequiredString(body, "email");
    if (email === undefined || !isEmail(email)) {
      validationError(response, "A valid email is required.");
      return;
    }
    response.status(201).json(store.createInvitation(email));
  });

  app.get("/api/support-tickets", (_request, response) => {
    response.json(store.listSupportTickets());
  });

  app.post("/api/support-tickets", (request, response) => {
    const body = readBody(request.body);
    if (body === undefined) {
      validationError(response, "A JSON object is required.");
      return;
    }

    const subject = readRequiredString(body, "subject");
    const description = readRequiredString(body, "description");
    const contactEmail = readRequiredString(body, "contactEmail");
    if (
      subject === undefined ||
      description === undefined ||
      contactEmail === undefined ||
      !isEmail(contactEmail)
    ) {
      validationError(
        response,
        "Valid subject, description, and contactEmail values are required.",
      );
      return;
    }

    response.status(201).json(
      store.createSupportTicket({
        subject,
        description,
        contactEmail,
      }),
    );
  });

  app.get("/api/settings", (_request, response) => {
    response.json(store.getSettings());
  });

  const updateSettings: RequestHandler = (request, response) => {
    const body = readBody(request.body);
    const update = body === undefined ? undefined : settingsUpdateFrom(body);
    if (update === undefined) {
      validationError(response, "At least one valid settings field is required.");
      return;
    }
    response.json(store.updateSettings(update));
  };
  app.put("/api/settings", updateSettings);
  app.patch("/api/settings", updateSettings);

  const login: RequestHandler = (request, response) => {
    const body = readBody(request.body);
    if (body === undefined) {
      validationError(response, "A JSON object is required.");
      return;
    }

    const email = readRequiredString(body, "email");
    const password = readRequiredString(body, "password");
    if (email === undefined || password === undefined || !isEmail(email)) {
      validationError(response, "A valid email and password are required.");
      return;
    }

    response.json({ authenticated: true, user: store.login(email) });
  };
  app.post("/api/auth/login", login);
  app.post("/api/login", login);

  const logout: RequestHandler = (_request, response) => {
    store.logout();
    response.json({ authenticated: false });
  };
  app.post("/api/auth/logout", logout);
  app.post("/api/logout", logout);

  app.get("/api/auth/session", (_request, response) => {
    const user = store.getAuthenticatedUser();
    response.json(user === undefined ? { authenticated: false } : { authenticated: true, user });
  });
  app.get("/api/session", (_request, response) => {
    const user = store.getAuthenticatedUser();
    response.json(user === undefined ? { authenticated: false } : { authenticated: true, user });
  });

  app.use(express.static(publicDirectory));
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });
  app.use((request, response, next) => {
    if (request.method !== "GET" || !request.accepts("html")) {
      next();
      return;
    }
    response.sendFile("index.html", { root: publicDirectory }, (error) => {
      if (error !== undefined) next();
    });
  });
  app.use((_request, response) => {
    response.status(404).json({ error: "Not found." });
  });

  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: "Invalid JSON body." });
      return;
    }
    response.status(500).json({ error: "Internal server error." });
  };
  app.use(handleError);

  return app;
};

export interface StartDemoServerOptions extends CreateDemoAppOptions {
  host?: string;
  port?: number;
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
      } else {
        reject(error);
      }
    });
  });

export const startDemoServer = async (
  options: StartDemoServerOptions = {},
): Promise<RunningHttpServer> => {
  const host = options.host ?? "localhost";
  const server = createDemoApp(options).listen(options.port ?? 3100, host);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    origin: `http://${host}:${address.port}`,
    server,
    close: () => closeServer(server),
  };
};

export interface StartDemoEnvironmentOptions {
  analytics?: StartAnalyticsServerOptions;
  insecureSink?: StartAnalyticsServerOptions;
  app?: Omit<StartDemoServerOptions, "analyticsOrigin" | "insecureOrigin">;
}

export interface RunningDemoEnvironment {
  analytics: RunningHttpServer;
  insecureSink: RunningHttpServer;
  app: RunningHttpServer;
  close: () => Promise<void>;
}

export const startDemoEnvironment = async (
  options: StartDemoEnvironmentOptions = {},
): Promise<RunningDemoEnvironment> => {
  const analytics = await startAnalyticsServer(options.analytics);

  try {
    const insecureSink = await startAnalyticsServer({ port: 4200, ...options.insecureSink });

    try {
      const app = await startDemoServer({
        ...options.app,
        analyticsOrigin: analytics.origin,
        insecureOrigin: insecureSink.origin,
      });
      return {
        analytics,
        insecureSink,
        app,
        close: async () => {
          await app.close();
          await Promise.all([analytics.close(), insecureSink.close()]);
        },
      };
    } catch (error) {
      await insecureSink.close();
      throw error;
    }
  } catch (error) {
    await analytics.close();
    throw error;
  }
};

const mainModulePath = process.argv[1];
const isMainModule =
  mainModulePath !== undefined && pathToFileURL(resolve(mainModulePath)).href === import.meta.url;

if (isMainModule) {
  startDemoEnvironment()
    .then((environment) => {
      process.stdout.write(
        `Demo SaaS: ${environment.app.origin}\n` +
          `Fake analytics: ${environment.analytics.origin}\n` +
          `Insecure external receiver: ${environment.insecureSink.origin}\n`,
      );
      let closing = false;
      const closeGracefully = async (): Promise<void> => {
        if (closing) return;
        closing = true;
        await environment.close();
      };

      process.once("SIGINT", () => {
        void closeGracefully().then(() => process.exit(0));
      });
      process.once("SIGTERM", () => {
        void closeGracefully().then(() => process.exit(0));
      });
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
