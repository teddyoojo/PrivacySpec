import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Application, type ErrorRequestHandler } from "express";

export interface AnalyticsEventMetadata {
  event: string;
  payloadFieldNames: string[];
  payloadFieldCount: number;
  payloadValueCount: number;
  count: number;
}

const safeEventNames = new Set([
  "auth_login",
  "customer_created",
  "customer_saved",
  "customer_updated",
  "login",
  "settings_saved",
  "settings_updated",
  "support_ticket_submitted",
  "team_invited",
  "user_login",
]);

const safeFieldNames = new Map<string, string>([
  ["contactemail", "contactEmail"],
  ["customeremail", "customerEmail"],
  ["customerid", "customerId"],
  ["customerphone", "customerPhone"],
  ["description", "description"],
  ["displayname", "displayName"],
  ["email", "email"],
  ["emailhash", "emailHash"],
  ["hashedemail", "hashedEmail"],
  ["hash", "hash"],
  ["id", "id"],
  ["name", "name"],
  ["page", "page"],
  ["password", "password"],
  ["phone", "phone"],
  ["profile", "profile"],
  ["source", "source"],
  ["subject", "subject"],
  ["user", "user"],
  ["useremail", "userEmail"],
]);

const normalizeMetadataName = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");

const sanitizeEventName = (value: string): string => {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, "_");
  return safeEventNames.has(normalized) ? normalized : "custom_event";
};

const sanitizeFieldName = (value: string): string =>
  safeFieldNames.get(normalizeMetadataName(value)) ?? "customField";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface FieldCollection {
  names: Set<string>;
  valueCount: number;
}

const collectFields = (value: unknown, path: string, collection: FieldCollection): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFields(item, path, collection);
    }
    return;
  }

  if (isRecord(value)) {
    for (const [rawName, nestedValue] of Object.entries(value)) {
      const fieldName = sanitizeFieldName(rawName);
      const nestedPath = path.length === 0 ? fieldName : `${path}.${fieldName}`;
      collectFields(nestedValue, nestedPath, collection);
    }
    return;
  }

  if (path.length > 0) {
    collection.names.add(path);
    collection.valueCount += 1;
  }
};

const sanitizeEvent = (body: Record<string, unknown>): Omit<AnalyticsEventMetadata, "count"> => {
  const collection: FieldCollection = { names: new Set(), valueCount: 0 };

  for (const [rawName, value] of Object.entries(body)) {
    if (rawName === "event") {
      continue;
    }

    if (rawName === "payload" && isRecord(value)) {
      collectFields(value, "", collection);
      continue;
    }

    collectFields(value, sanitizeFieldName(rawName), collection);
  }

  const payloadFieldNames = Array.from(collection.names).sort();
  return {
    event: sanitizeEventName(String(body.event)),
    payloadFieldNames,
    payloadFieldCount: payloadFieldNames.length,
    payloadValueCount: collection.valueCount,
  };
};

export class AnalyticsEventStore {
  readonly #events = new Map<string, AnalyticsEventMetadata>();

  record(body: Record<string, unknown>): AnalyticsEventMetadata {
    const sanitized = sanitizeEvent(body);
    const key = JSON.stringify([
      sanitized.event,
      sanitized.payloadFieldNames,
      sanitized.payloadValueCount,
    ]);
    const existing = this.#events.get(key);
    const event: AnalyticsEventMetadata = {
      ...sanitized,
      count: (existing?.count ?? 0) + 1,
    };
    this.#events.set(key, event);
    return { ...event, payloadFieldNames: [...event.payloadFieldNames] };
  }

  list(): AnalyticsEventMetadata[] {
    return Array.from(this.#events.values(), (event) => ({
      ...event,
      payloadFieldNames: [...event.payloadFieldNames],
    }));
  }

  clear(): void {
    this.#events.clear();
  }
}

export interface CreateAnalyticsAppOptions {
  store?: AnalyticsEventStore;
}

export const createAnalyticsApp = (options: CreateAnalyticsAppOptions = {}): Application => {
  const app = express();
  const store = options.store ?? new AnalyticsEventStore();

  app.use((_request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    next();
  });
  app.options("/{*path}", (_request, response) => {
    response.sendStatus(204);
  });
  app.use(express.json({ limit: "64kb" }));

  app.post("/event", (request, response) => {
    const body: unknown = request.body;

    if (!isRecord(body) || typeof body.event !== "string" || body.event.trim().length === 0) {
      response.status(400).json({ error: "An event name is required." });
      return;
    }

    response.status(202).json(store.record(body));
  });

  app.get("/events", (_request, response) => {
    const events = store.list();
    response.json({
      events,
      count: events.reduce((total, event) => total + event.count, 0),
    });
  });

  app.delete("/events", (_request, response) => {
    store.clear();
    response.sendStatus(204);
  });

  const handleJsonError: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: "Invalid JSON body." });
      return;
    }
    next(error);
  };
  app.use(handleJsonError);

  return app;
};

export interface RunningHttpServer {
  origin: string;
  server: Server;
  close: () => Promise<void>;
}

export interface StartAnalyticsServerOptions extends CreateAnalyticsAppOptions {
  host?: string;
  port?: number;
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

export const startAnalyticsServer = async (
  options: StartAnalyticsServerOptions = {},
): Promise<RunningHttpServer> => {
  const host = options.host ?? "127.0.0.1";
  const app = createAnalyticsApp(options);
  const server = app.listen(options.port ?? 4100, host);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    origin: `http://${host}:${address.port}`,
    server,
    close: () => closeServer(server),
  };
};
