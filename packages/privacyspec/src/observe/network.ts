import type { BrowserContext, Request } from "@playwright/test";
import type { NetworkBodyKind, RawNetworkSink, RawSinkMaterial } from "./sink-model.js";
import {
  MAX_NETWORK_RETAINED_BYTES_PER_TEST,
  MAX_NETWORK_SINKS_PER_TEST,
  type SinkRunRegistry,
} from "./sink-registry.js";

export const MAX_NETWORK_BODY_BYTES = 1_048_576;

const MAX_HEADER_VALUE_LENGTH = 65_536;
const MAX_STRUCTURED_MATERIALS = 1_000;
const MAX_JSON_DEPTH = 8;
const HEADER_LOOKUP_TIMEOUT_MS = 250;

const readHeaders = (request: Request): Promise<Record<string, string>> =>
  new Promise((resolve) => {
    const fallback = request.headers();
    const timer = setTimeout(() => resolve(fallback), HEADER_LOOKUP_TIMEOUT_MS);
    try {
      request.allHeaders().then(
        (headers) => {
          clearTimeout(timer);
          resolve(headers);
        },
        () => {
          clearTimeout(timer);
          resolve(fallback);
        },
      );
    } catch {
      clearTimeout(timer);
      resolve(fallback);
    }
  });

const pushMaterial = (materials: RawSinkMaterial[], location: string, value: string): void => {
  if (materials.length >= MAX_STRUCTURED_MATERIALS) return;
  materials.push({ location: location.slice(0, 1_024), value });
};

const flattenJson = (
  value: unknown,
  location: string,
  materials: RawSinkMaterial[],
  depth = 0,
): void => {
  if (materials.length >= MAX_STRUCTURED_MATERIALS || depth > MAX_JSON_DEPTH) return;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    pushMaterial(materials, location, value === null ? "null" : String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      flattenJson(value[index], `${location}[${index}]`, materials, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenJson(child, `${location}.${key}`, materials, depth + 1);
    }
  }
};

const readFrameUrl = (request: Request): string | undefined => {
  try {
    return request.frame().url();
  } catch {
    return undefined;
  }
};

const readPageUrl = (request: Request): string | undefined => {
  try {
    return request.frame().page().url();
  } catch {
    return undefined;
  }
};

const collectUrlMaterials = (rawUrl: string, materials: RawSinkMaterial[]): void => {
  try {
    const url = new URL(rawUrl);
    pushMaterial(materials, "url.path", url.pathname);
    for (const [name, value] of url.searchParams) {
      pushMaterial(materials, `url.query.${name}`, value);
    }
  } catch {
    pushMaterial(materials, "url.raw", rawUrl);
  }
};

const collectBodyMaterials = (
  body: Buffer | null,
  contentType: string,
  materials: RawSinkMaterial[],
): { kind: NetworkBodyKind; size: number; truncated: boolean } => {
  if (body === null) return { kind: "none", size: 0, truncated: false };
  if (body.byteLength > MAX_NETWORK_BODY_BYTES) {
    return { kind: "binary", size: body.byteLength, truncated: true };
  }

  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes("application/json") || normalizedType.includes("+json")) {
    try {
      flattenJson(JSON.parse(body.toString("utf8")), "json", materials);
      return { kind: "json", size: body.byteLength, truncated: false };
    } catch {
      pushMaterial(materials, "body.raw", body.toString("utf8"));
      return { kind: "text", size: body.byteLength, truncated: false };
    }
  }
  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    for (const [name, value] of new URLSearchParams(body.toString("utf8"))) {
      pushMaterial(materials, `form.${name}`, value);
    }
    return { kind: "form", size: body.byteLength, truncated: false };
  }
  if (normalizedType.includes("multipart/form-data")) {
    const text = body.toString("utf8");
    const fieldPattern = /content-disposition:[^\r\n]*\bname="([^"]{1,200})"/giu;
    for (const match of text.matchAll(fieldPattern)) {
      const name = match[1];
      if (name !== undefined) pushMaterial(materials, `form.${name}`, "");
    }
    return { kind: "multipart", size: body.byteLength, truncated: false };
  }
  if (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("javascript") ||
    normalizedType.includes("xml")
  ) {
    pushMaterial(materials, "body.raw", body.toString("utf8"));
    return { kind: "text", size: body.byteLength, truncated: false };
  }
  return { kind: "binary", size: body.byteLength, truncated: false };
};

export const parseNetworkBody = (
  body: Buffer | null,
  contentType: string,
): {
  kind: NetworkBodyKind;
  size: number;
  truncated: boolean;
  materials: RawSinkMaterial[];
} => {
  const materials: RawSinkMaterial[] = [];
  return { ...collectBodyMaterials(body, contentType, materials), materials };
};

interface RequestEventSnapshot {
  request: Request;
  url: string;
  method: string;
  resourceType: string;
  frameUrl?: string | undefined;
  pageUrl?: string | undefined;
  timestamp: number;
  body: Buffer | null;
  bodySize: number;
  bodyTruncated: boolean;
}

const snapshotRequestEvent = (
  request: Request,
  remainingBodyBytes: number,
): RequestEventSnapshot => {
  let rawBody: Buffer | null = null;
  try {
    rawBody = request.postDataBuffer();
  } catch {
    // Preserve the request metadata even if Playwright can no longer expose its body.
  }
  const bodySize = rawBody?.byteLength ?? 0;
  const bodyTruncated =
    bodySize > MAX_NETWORK_BODY_BYTES || bodySize > Math.max(remainingBodyBytes, 0);
  return {
    request,
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    frameUrl: readFrameUrl(request),
    pageUrl: readPageUrl(request),
    timestamp: Date.now(),
    body: bodyTruncated ? null : rawBody,
    bodySize,
    bodyTruncated,
  };
};

const captureRequest = async (snapshot: RequestEventSnapshot): Promise<RawNetworkSink> => {
  const headers = await readHeaders(snapshot.request);

  const boundedHeaders: Record<string, string> = {};
  const materials: RawSinkMaterial[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase().slice(0, 200);
    const boundedValue = value.slice(0, MAX_HEADER_VALUE_LENGTH);
    boundedHeaders[normalizedName] = boundedValue;
    pushMaterial(materials, `header.${normalizedName}`, boundedValue);
  }

  collectUrlMaterials(snapshot.url, materials);
  const body = snapshot.bodyTruncated
    ? {
        kind: "binary" as const,
        size: snapshot.bodySize,
        truncated: true,
        materials: [],
      }
    : parseNetworkBody(snapshot.body, boundedHeaders["content-type"] ?? "");
  for (const material of body.materials) {
    pushMaterial(materials, material.location, material.value);
  }

  return {
    kind: "network",
    url: snapshot.url,
    method: snapshot.method,
    resourceType: snapshot.resourceType,
    headers: boundedHeaders,
    bodyKind: body.kind,
    bodySize: body.size,
    bodyTruncated: body.truncated,
    materials,
    frameUrl: snapshot.frameUrl,
    pageUrl: snapshot.pageUrl,
    timestamp: snapshot.timestamp,
  };
};

export class NetworkObserver {
  readonly #pending = new Set<Promise<void>>();
  #accepted = 0;
  #acceptedBodyBytes = 0;
  #context: BrowserContext | undefined;
  readonly #listener: (request: Request) => void;

  constructor(private readonly registry: SinkRunRegistry) {
    this.#listener = (request) => {
      if (this.#accepted >= MAX_NETWORK_SINKS_PER_TEST) {
        this.registry.markLimitReached("network");
        return;
      }
      this.#accepted += 1;
      const snapshot = snapshotRequestEvent(
        request,
        MAX_NETWORK_RETAINED_BYTES_PER_TEST - this.#acceptedBodyBytes,
      );
      if (snapshot.bodyTruncated) {
        this.registry.markLimitReached("network");
      } else {
        this.#acceptedBodyBytes += snapshot.bodySize;
      }
      let operation: Promise<void>;
      operation = captureRequest(snapshot)
        .then((sink) => this.registry.addNetwork(sink))
        .catch(() => {
          // Individual requests may disappear during context teardown.
        })
        .finally(() => this.#pending.delete(operation));
      this.#pending.add(operation);
    };
  }

  attach(context: BrowserContext): void {
    this.#context = context;
    context.on("request", this.#listener);
  }

  async flush(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled(Array.from(this.#pending));
    }
  }

  detach(): void {
    this.#context?.off("request", this.#listener);
    this.#context = undefined;
  }
}
