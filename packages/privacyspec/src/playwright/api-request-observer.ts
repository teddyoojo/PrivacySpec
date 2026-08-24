import { Readable } from "node:stream";
import { isProxy } from "node:util/types";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { MAX_NETWORK_BODY_BYTES, type NetworkRequestMetadata } from "../observe/network.js";
import type { RuntimeSecurityResponse } from "../observe/response-security.js";
import { parseSecurityCookie } from "../observe/response-security.js";
import type { NetworkBodyKind, RawNetworkSink, RawSinkMaterial } from "../observe/sink-model.js";
import {
  MAX_NETWORK_RETAINED_BYTES_PER_TEST,
  MAX_NETWORK_SINKS_PER_TEST,
} from "../observe/sink-registry.js";
import { type APIRequestCoverage, createAPIRequestCoverage } from "./experimental-coverage.js";

const API_NETWORK_METHODS = ["delete", "fetch", "get", "head", "patch", "post", "put"] as const;
type APIRequestMethodName = (typeof API_NETWORK_METHODS)[number];

const networkMethods = new Set<PropertyKey>(API_NETWORK_METHODS);
const MAX_HEADER_VALUE_LENGTH = 65_536;
export const MAX_API_CAPTURE_DEPTH = 8;
export const MAX_API_CAPTURE_NODES = 4_096;
export const MAX_API_CAPTURE_ENTRIES = 1_000;
const MAX_LOCATION_LENGTH = 1_024;

export interface APIRequestEventConsumer {
  reserveAPIRequest(): number;
  addAPIRequest(sink: RawNetworkSink, metadata: NetworkRequestMetadata): void;
  addAPIRequestMetadata(metadata: NetworkRequestMetadata): void;
  recordAPIResponse(response: RuntimeSecurityResponse): void;
  recordAPIRequestFailure(metadata: NetworkRequestMetadata): void;
  recordAPIHttpResponse(input: { url: string; method: string; status: number }): void;
  markLimitReached(collector: "network"): void;
}

type SkipReason = keyof APIRequestCoverage["skipped"];

interface CapturedRequest {
  inputUrl: string;
  method: string;
  headers: Record<string, string>;
  bodyKind: NetworkBodyKind;
  bodySize: number;
  bodyTruncated: boolean;
  materials: RawSinkMaterial[];
}

interface CaptureBudget {
  depth: number;
  nodes: number;
  entries: number;
  retainedBytes: number;
  exhausted: boolean;
  oversized: boolean;
  incomplete: boolean;
  materialLimitReported: boolean;
  seen: WeakSet<object>;
}

const createCaptureBudget = (): CaptureBudget => ({
  depth: MAX_API_CAPTURE_DEPTH,
  nodes: MAX_API_CAPTURE_NODES,
  entries: MAX_API_CAPTURE_ENTRIES,
  retainedBytes: MAX_NETWORK_BODY_BYTES,
  exhausted: false,
  oversized: false,
  incomplete: false,
  materialLimitReported: false,
  seen: new WeakSet(),
});

const exhaustBudget = (budget: CaptureBudget, skip: (reason: SkipReason) => void): void => {
  budget.exhausted = true;
  if (!budget.materialLimitReported) {
    budget.materialLimitReported = true;
    skip("materialLimit");
  }
};

const consumeNode = (budget: CaptureBudget, skip: (reason: SkipReason) => void): boolean => {
  if (budget.exhausted) return false;
  if (budget.nodes <= 0) {
    exhaustBudget(budget, skip);
    return false;
  }
  budget.nodes -= 1;
  return true;
};

const consumeEntry = (budget: CaptureBudget, skip: (reason: SkipReason) => void): boolean => {
  if (budget.exhausted) return false;
  if (budget.entries <= 0) {
    exhaustBudget(budget, skip);
    return false;
  }
  budget.entries -= 1;
  return true;
};

const consumeBytes = (
  budget: CaptureBudget,
  value: string,
  skip: (reason: SkipReason) => void,
): boolean => {
  if (value.length > MAX_NETWORK_BODY_BYTES) return false;
  const size = byteLength(value);
  if (size > budget.retainedBytes) {
    exhaustBudget(budget, skip);
    return false;
  }
  budget.retainedBytes -= size;
  return true;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

const safeEntries = (
  value: Record<string, unknown>,
  budget: CaptureBudget,
  skip: (reason: SkipReason) => void,
): Array<[string, unknown]> | undefined => {
  try {
    const entries: Array<[string, unknown]> = [];
    for (const key in value) {
      if (!consumeEntry(budget, skip)) return entries;
      if (!Object.hasOwn(value, key)) continue;
      if (key.length > MAX_LOCATION_LENGTH) {
        exhaustBudget(budget, skip);
        return entries;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        skip("accessors");
        continue;
      }
      entries.push([key, descriptor.value]);
    }
    return entries;
  } catch {
    skip("unsupportedObjects");
    return undefined;
  }
};

const looksLikeStream = (value: object): boolean => {
  try {
    const browserReadable = globalThis.ReadableStream;
    return (
      value instanceof Readable ||
      (typeof browserReadable === "function" && value instanceof browserReadable)
    );
  } catch {
    return false;
  }
};

const looksLikeFile = (value: object): boolean => {
  const globalFile = globalThis.File;
  const globalBlob = globalThis.Blob;
  return (
    (typeof globalFile === "function" && value instanceof globalFile) ||
    (typeof globalBlob === "function" && value instanceof globalBlob) ||
    (isPlainObject(value) &&
      Object.hasOwn(value, "name") &&
      Object.hasOwn(value, "mimeType") &&
      Object.hasOwn(value, "buffer"))
  );
};

const pushMaterial = (
  materials: RawSinkMaterial[],
  location: string,
  value: string,
  budget: CaptureBudget,
  skip: (reason: SkipReason) => void,
): void => {
  if (!consumeEntry(budget, skip)) return;
  if (location.length > MAX_LOCATION_LENGTH || value.length > MAX_NETWORK_BODY_BYTES) {
    budget.oversized = true;
    skip("oversized");
    return;
  }
  if (!consumeBytes(budget, value, skip)) return;
  materials.push({ location, value });
};

const flattenPlainValue = (
  value: unknown,
  location: string,
  materials: RawSinkMaterial[],
  budget: CaptureBudget,
  skip: (reason: SkipReason) => void,
  depth = 0,
): unknown => {
  if (!consumeNode(budget, skip)) return undefined;
  if (depth > budget.depth) {
    exhaustBudget(budget, skip);
    return undefined;
  }
  if (isScalar(value)) {
    const rendered = value === null ? "null" : String(value);
    pushMaterial(materials, location, rendered, budget, skip);
    return value;
  }
  if (Array.isArray(value)) {
    if (budget.seen.has(value)) {
      skip("unsupportedObjects");
      return undefined;
    }
    budget.seen.add(value);
    if (value.length > budget.entries) {
      exhaustBudget(budget, skip);
      return undefined;
    }
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!consumeEntry(budget, skip)) return undefined;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      } catch {
        skip("unsupportedObjects");
        return undefined;
      }
      if (descriptor === undefined) {
        clone.push(null);
      } else if (!("value" in descriptor)) {
        skip("accessors");
        clone.push(null);
      } else {
        clone.push(
          flattenPlainValue(
            descriptor.value,
            `${location}[${index}]`,
            materials,
            budget,
            skip,
            depth + 1,
          ),
        );
      }
      if (budget.exhausted || budget.oversized) return undefined;
    }
    return clone;
  }
  if (typeof value === "object" && value !== null) {
    if (looksLikeFile(value)) {
      skip("files");
      return undefined;
    }
    if (looksLikeStream(value)) {
      skip("streams");
      return undefined;
    }
    if (!isPlainObject(value)) {
      skip("unsupportedObjects");
      return undefined;
    }
    if (budget.seen.has(value)) {
      skip("unsupportedObjects");
      return undefined;
    }
    budget.seen.add(value);
    const entries = safeEntries(value, budget, skip);
    if (entries === undefined) return undefined;
    const clone: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      const childLocation = `${location}.${key}`;
      if (childLocation.length > MAX_LOCATION_LENGTH) {
        exhaustBudget(budget, skip);
        return undefined;
      }
      clone[key] = flattenPlainValue(child, childLocation, materials, budget, skip, depth + 1);
      if (budget.exhausted || budget.oversized) return undefined;
    }
    return clone;
  }
  skip("unsupportedObjects");
  return undefined;
};

const formDataEntries = (
  value: FormData,
  location: "form" | "multipart",
  materials: RawSinkMaterial[],
  budget: CaptureBudget,
  skip: (reason: SkipReason) => void,
): URLSearchParams => {
  const params = new URLSearchParams();
  try {
    for (const [name, field] of value.entries()) {
      if (!consumeEntry(budget, skip)) break;
      if (name.length > MAX_LOCATION_LENGTH) {
        exhaustBudget(budget, skip);
        break;
      }
      if (typeof field !== "string") {
        skip("files");
        continue;
      }
      if (field.length > MAX_NETWORK_BODY_BYTES) {
        budget.oversized = true;
        skip("oversized");
        break;
      }
      params.append(name, field);
      pushMaterial(materials, `${location}.${name}`, field, budget, skip);
    }
  } catch {
    skip("unsupportedObjects");
  }
  return params;
};

const scalarParams = (
  value: Record<string, unknown>,
  location: "form" | "multipart" | "url.query",
  materials: RawSinkMaterial[],
  budget: CaptureBudget,
  skip: (reason: SkipReason) => void,
): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [name, field] of safeEntries(value, budget, skip) ?? []) {
    if (!isScalar(field) || field === null) {
      if (typeof field === "object" && field !== null && looksLikeFile(field)) skip("files");
      else if (typeof field === "object" && field !== null && looksLikeStream(field))
        skip("streams");
      else skip("unsupportedObjects");
      continue;
    }
    const rendered = String(field);
    if (rendered.length > MAX_NETWORK_BODY_BYTES) {
      budget.oversized = true;
      skip("oversized");
      break;
    }
    params.append(name, rendered);
    pushMaterial(materials, `${location}.${name}`, rendered, budget, skip);
  }
  return params;
};

const selectedResponseHeaders = (
  response: APIResponse,
  skip: (reason: SkipReason) => void,
): RuntimeSecurityResponse["headers"] & { cookies: RuntimeSecurityResponse["cookies"] } => {
  const selected = new Map<string, string>();
  const cookies: RuntimeSecurityResponse["cookies"] = [];
  const headers = response.headersArray();
  if (headers.length > MAX_API_CAPTURE_ENTRIES) skip("materialLimit");
  for (let index = 0; index < Math.min(headers.length, MAX_API_CAPTURE_ENTRIES); index += 1) {
    const header = headers[index];
    if (header === undefined || header.name.length > MAX_LOCATION_LENGTH) continue;
    const name = header.name.toLowerCase();
    if (name === "set-cookie") {
      const cookie = parseSecurityCookie(header.value);
      if (cookie !== undefined) cookies.push(cookie);
    } else if (
      name === "content-security-policy" ||
      name === "strict-transport-security" ||
      name === "x-content-type-options" ||
      name === "access-control-allow-origin" ||
      name === "access-control-allow-credentials" ||
      name === "access-control-allow-methods"
    ) {
      if (!selected.has(name)) selected.set(name, header.value.slice(0, 8_192));
    }
  }
  return {
    contentSecurityPolicy: selected.get("content-security-policy"),
    strictTransportSecurity: selected.get("strict-transport-security"),
    xContentTypeOptions: selected.get("x-content-type-options"),
    accessControlAllowOrigin: selected.get("access-control-allow-origin"),
    accessControlAllowCredentials: selected.get("access-control-allow-credentials"),
    accessControlAllowMethods: selected.get("access-control-allow-methods"),
    cookies,
  };
};

const resolveRequestUrl = (raw: string, baseURL: string | undefined): string => {
  if (raw.length > 8_192) return raw.slice(0, 8_192);
  try {
    return new URL(raw, baseURL).href;
  } catch {
    return raw;
  }
};

export class APIRequestFixtureObserver {
  readonly #coverage: APIRequestCoverage;
  #retainedBytes = 0;
  #inspectRequestBodies = true;

  constructor(
    readonly enabled: boolean,
    private readonly consumer: APIRequestEventConsumer,
    private readonly baseURL?: string | undefined,
  ) {
    this.#coverage = createAPIRequestCoverage(enabled);
  }

  snapshot(): APIRequestCoverage {
    return structuredClone(this.#coverage);
  }

  async observe(
    methodName: APIRequestMethodName,
    delegate: (...args: unknown[]) => Promise<APIResponse>,
    args: unknown[],
  ): Promise<APIResponse> {
    this.#coverage.calls.seen += 1;
    if (!this.enabled) {
      this.#coverage.status = "unsupported";
      return delegate(...args);
    }
    this.#coverage.status = "partial";
    let materialLimitRecorded = false;
    const skip = (reason: SkipReason): void => {
      if (reason === "materialLimit") {
        if (materialLimitRecorded) return;
        materialLimitRecorded = true;
      }
      this.#coverage.skipped[reason] += 1;
    };
    let reservedSequence = 0;
    try {
      reservedSequence = this.consumer.reserveAPIRequest();
    } catch {
      skip("unsupportedObjects");
    }
    let captured: CapturedRequest;
    try {
      captured = this.#capture(methodName, args, skip);
    } catch {
      skip("unsupportedObjects");
      captured = {
        inputUrl:
          typeof args[0] === "string" ? resolveRequestUrl(args[0], this.baseURL) : "about:blank",
        method: methodName.toUpperCase(),
        headers: {},
        bodyKind: "none",
        bodySize: 0,
        bodyTruncated: true,
        materials: [],
      };
    }
    let response: APIResponse;
    try {
      response = await delegate(...args);
    } catch (error) {
      this.#coverage.calls.failed += 1;
      const metadata: NetworkRequestMetadata = {
        url: captured.inputUrl,
        method: captured.method,
        resourceType: "fetch",
        frameKind: "unknown",
        requestSurface: "api-request",
        timestamp: reservedSequence,
      };
      try {
        this.consumer.addAPIRequestMetadata(metadata);
        this.consumer.recordAPIRequestFailure(metadata);
      } catch {
        skip("unsupportedObjects");
      }
      throw error;
    }
    try {
      const url = resolveRequestUrl(response.url(), this.baseURL);
      const status = response.status();
      const metadata: NetworkRequestMetadata = {
        url,
        method: captured.method,
        resourceType: "fetch",
        frameKind: "unknown",
        requestSurface: "api-request",
        timestamp: reservedSequence,
      };
      this.#coverage.calls.observed += 1;
      if (status >= 500 && status <= 599) this.#coverage.calls.serverErrors += 1;
      if (this.#coverage.calls.observed > MAX_NETWORK_SINKS_PER_TEST) {
        skip("sinkLimit");
        this.#inspectRequestBodies = false;
        this.consumer.markLimitReached("network");
        this.consumer.addAPIRequestMetadata(metadata);
      } else {
        const retainedBytes = this.#retainedSize(captured, url);
        const aggregateLimited =
          this.#retainedBytes + retainedBytes > MAX_NETWORK_RETAINED_BYTES_PER_TEST;
        if (aggregateLimited) {
          skip("aggregateLimit");
          this.#inspectRequestBodies = false;
          this.consumer.markLimitReached("network");
        } else {
          this.#retainedBytes += retainedBytes;
        }
        this.consumer.addAPIRequest(
          {
            kind: "network",
            requestSurface: "api-request",
            url,
            method: captured.method,
            resourceType: "fetch",
            headers: aggregateLimited ? {} : captured.headers,
            bodyKind: captured.bodyKind,
            bodySize: captured.bodySize,
            bodyTruncated: captured.bodyTruncated || aggregateLimited,
            materials: aggregateLimited ? [] : captured.materials,
            timestamp: reservedSequence,
          },
          metadata,
        );
      }
      const selected = selectedResponseHeaders(response, skip);
      this.consumer.recordAPIResponse({
        url,
        method: captured.method,
        resourceType: "fetch",
        frameKind: "unknown",
        status,
        headers: {
          contentSecurityPolicy: selected.contentSecurityPolicy,
          strictTransportSecurity: selected.strictTransportSecurity,
          xContentTypeOptions: selected.xContentTypeOptions,
          accessControlAllowOrigin: selected.accessControlAllowOrigin,
          accessControlAllowCredentials: selected.accessControlAllowCredentials,
          accessControlAllowMethods: selected.accessControlAllowMethods,
        },
        cookies: selected.cookies,
      });
      this.consumer.recordAPIHttpResponse({ url, method: captured.method, status });
    } catch {
      // Observation failures never replace the composed request fixture's return value.
      skip("unsupportedObjects");
    }
    return response;
  }

  #capture(
    methodName: APIRequestMethodName,
    args: unknown[],
    skip: (reason: SkipReason) => void,
  ): CapturedRequest {
    const inputUrl =
      typeof args[0] === "string" ? resolveRequestUrl(args[0], this.baseURL) : "about:blank";
    if (typeof args[0] !== "string") skip("unsupportedObjects");
    const budget = createCaptureBudget();
    const options = isPlainObject(args[1]) ? args[1] : undefined;
    if (args[1] !== undefined && options === undefined) skip("unsupportedObjects");
    const readOption = (name: string): unknown => {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor =
          options === undefined ? undefined : Object.getOwnPropertyDescriptor(options, name);
      } catch {
        skip("unsupportedObjects");
        return undefined;
      }
      if (descriptor === undefined) return undefined;
      if (!("value" in descriptor)) {
        skip("accessors");
        return undefined;
      }
      return descriptor.value;
    };
    const methodOption = readOption("method");
    const method = String(
      methodName === "fetch" && typeof methodOption === "string" ? methodOption : methodName,
    )
      .toUpperCase()
      .slice(0, 32);
    const materials: RawSinkMaterial[] = [];
    const headers: Record<string, string> = {};
    const headerValue = readOption("headers");
    if (isPlainObject(headerValue)) {
      for (const [name, value] of safeEntries(headerValue, budget, skip) ?? []) {
        if (typeof value !== "string") {
          skip("unsupportedObjects");
          continue;
        }
        if (name.length > MAX_LOCATION_LENGTH || value.length > MAX_HEADER_VALUE_LENGTH) {
          skip("oversized");
          continue;
        }
        const normalizedName = name.toLowerCase();
        const boundedValue = value;
        headers[normalizedName] = boundedValue;
        pushMaterial(materials, `header.${normalizedName}`, boundedValue, budget, skip);
      }
    } else if (
      typeof Headers === "function" &&
      typeof headerValue === "object" &&
      headerValue !== null &&
      !isProxy(headerValue) &&
      headerValue instanceof Headers
    ) {
      try {
        for (const [name, value] of headerValue.entries()) {
          if (!consumeEntry(budget, skip)) break;
          if (name.length > MAX_LOCATION_LENGTH || value.length > MAX_HEADER_VALUE_LENGTH) {
            skip("oversized");
            continue;
          }
          const normalizedName = name.toLowerCase();
          headers[normalizedName] = value;
          pushMaterial(materials, `header.${normalizedName}`, value, budget, skip);
        }
      } catch {
        skip("unsupportedObjects");
      }
    } else if (headerValue !== undefined) {
      skip("unsupportedObjects");
    }

    const params = readOption("params");
    if (typeof params === "string") {
      if (params.length > MAX_NETWORK_BODY_BYTES) {
        skip("oversized");
      } else {
        try {
          for (const [name, value] of new URLSearchParams(params)) {
            if (!consumeEntry(budget, skip)) break;
            if (name.length > MAX_LOCATION_LENGTH) {
              exhaustBudget(budget, skip);
              break;
            }
            pushMaterial(materials, `url.query.${name}`, value, budget, skip);
          }
        } catch {
          skip("unsupportedObjects");
        }
      }
    } else if (
      typeof params === "object" &&
      params !== null &&
      !isProxy(params) &&
      params instanceof URLSearchParams
    ) {
      try {
        for (const [name, value] of params) {
          if (!consumeEntry(budget, skip)) break;
          if (name.length > MAX_LOCATION_LENGTH) {
            exhaustBudget(budget, skip);
            break;
          }
          pushMaterial(materials, `url.query.${name}`, value, budget, skip);
        }
      } catch {
        skip("unsupportedObjects");
      }
    } else if (isPlainObject(params)) {
      scalarParams(params, "url.query", materials, budget, skip);
    } else if (params !== undefined) {
      skip("unsupportedObjects");
    }

    let bodyKind: NetworkBodyKind = "none";
    let bodySize = 0;
    const bodyMaterialStart = materials.length;
    const bodySkip = (reason: SkipReason): void => {
      if (
        reason === "accessors" ||
        reason === "streams" ||
        reason === "files" ||
        reason === "unsupportedObjects"
      ) {
        budget.incomplete = true;
      }
      skip(reason);
    };
    const data = this.#inspectRequestBodies ? readOption("data") : undefined;
    const form = this.#inspectRequestBodies ? readOption("form") : undefined;
    const multipart = this.#inspectRequestBodies ? readOption("multipart") : undefined;
    if (data !== undefined) {
      bodyKind = Buffer.isBuffer(data) ? "binary" : typeof data === "string" ? "text" : "json";
      let serialized: string | Buffer | undefined;
      if (Buffer.isBuffer(data)) {
        bodySize = data.byteLength;
        if (data.byteLength > MAX_NETWORK_BODY_BYTES) {
          budget.oversized = true;
          skip("oversized");
        } else {
          serialized = data;
          pushMaterial(materials, "body.raw", data.toString("utf8"), budget, bodySkip);
        }
      } else if (typeof data === "string") {
        bodySize = byteLength(data);
        if (bodySize > MAX_NETWORK_BODY_BYTES) {
          budget.oversized = true;
          skip("oversized");
        } else {
          serialized = data;
          pushMaterial(materials, "body.raw", data, budget, bodySkip);
        }
      } else if (isPlainObject(data) || Array.isArray(data)) {
        const clone = flattenPlainValue(data, "json", materials, budget, bodySkip);
        if (!budget.exhausted && !budget.oversized) {
          try {
            serialized = JSON.stringify(clone);
          } catch {
            bodySkip("unsupportedObjects");
          }
        }
      } else if (typeof data === "object" && data !== null && looksLikeStream(data)) {
        bodySkip("streams");
      } else {
        bodySkip("unsupportedObjects");
      }
      if (bodySize === 0 && serialized !== undefined) bodySize = Buffer.byteLength(serialized);
    } else if (form !== undefined) {
      bodyKind = "form";
      const paramsValue =
        typeof form === "object" && form !== null && !isProxy(form) && form instanceof FormData
          ? formDataEntries(form, "form", materials, budget, bodySkip)
          : isPlainObject(form)
            ? scalarParams(form, "form", materials, budget, bodySkip)
            : undefined;
      if (paramsValue === undefined) bodySkip("unsupportedObjects");
      else bodySize = byteLength(paramsValue.toString());
    } else if (multipart !== undefined) {
      bodyKind = "multipart";
      const paramsValue =
        typeof multipart === "object" &&
        multipart !== null &&
        !isProxy(multipart) &&
        multipart instanceof FormData
          ? formDataEntries(multipart, "multipart", materials, budget, bodySkip)
          : isPlainObject(multipart)
            ? scalarParams(multipart, "multipart", materials, budget, bodySkip)
            : undefined;
      if (paramsValue === undefined) bodySkip("unsupportedObjects");
      else bodySize = byteLength(paramsValue.toString());
    }
    if (bodySize > MAX_NETWORK_BODY_BYTES && !budget.oversized) {
      budget.oversized = true;
      skip("oversized");
    }
    const bodyTruncated =
      !this.#inspectRequestBodies ||
      bodySize > MAX_NETWORK_BODY_BYTES ||
      budget.exhausted ||
      budget.oversized ||
      budget.incomplete;
    if (bodyTruncated) {
      materials.splice(bodyMaterialStart);
    }
    return {
      inputUrl,
      method,
      headers,
      bodyKind,
      bodySize,
      bodyTruncated,
      materials,
    };
  }

  #retainedSize(captured: CapturedRequest, url: string): number {
    let size = byteLength(url) + byteLength(captured.method) + byteLength("fetch");
    for (const [name, value] of Object.entries(captured.headers)) {
      size += byteLength(name) + byteLength(value);
    }
    for (const material of captured.materials) {
      size += byteLength(material.location) + byteLength(material.value);
    }
    return size;
  }
}

export const createObservedAPIRequestContext = (
  context: APIRequestContext,
  observer: APIRequestFixtureObserver,
): APIRequestContext => {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(context, {
    get(target, property) {
      const cached = methods.get(property);
      if (cached !== undefined) return cached;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const bound = value.bind(target) as (...args: unknown[]) => unknown;
      const wrapped = networkMethods.has(property)
        ? (...args: unknown[]) =>
            observer.observe(
              property as APIRequestMethodName,
              (...delegateArgs) => bound(...delegateArgs) as Promise<APIResponse>,
              args,
            )
        : bound;
      methods.set(property, wrapped);
      return wrapped;
    },
  });
};
