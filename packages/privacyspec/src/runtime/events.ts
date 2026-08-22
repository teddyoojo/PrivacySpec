import type { RawResponseSensitiveSource, RawSensitiveSource } from "../discovery/source-model.js";
import type { NetworkRequestMetadata } from "../observe/network.js";
import type { RuntimeSecurityResponse } from "../observe/response-security.js";
import type { RawConsoleSink, RawNetworkSink, RawStorageSink } from "../observe/sink-model.js";

export interface RuntimeEventMeta {
  testId: string;
  projectName: string;
  contextId?: string | undefined;
  pageId?: string | undefined;
  seq: number;
  timestamp: number;
}

export interface ContextCreatedEvent {
  type: "context-created";
  meta: RuntimeEventMeta;
  instrumented: boolean;
}

export interface PageCreatedEvent {
  type: "page-created";
  meta: RuntimeEventMeta;
  instrumented: boolean;
}

export interface NavigationEvent {
  type: "navigation";
  meta: RuntimeEventMeta;
  url: string;
}

export interface RequestEvent {
  type: "request";
  meta: RuntimeEventMeta;
  request: NetworkRequestMetadata;
  sink?: RawNetworkSink | undefined;
}

export interface ResponseEvent {
  type: "response";
  meta: RuntimeEventMeta;
  url: string;
  status: number;
  sources: readonly RawResponseSensitiveSource[];
}

export interface HttpResponseEvent {
  type: "http-response";
  meta: RuntimeEventMeta;
  url: string;
  method: string;
  resourceType: string;
  frameKind: "main" | "child" | "unknown";
  status: number;
}

export interface RequestFailedEvent {
  type: "request-failed";
  meta: RuntimeEventMeta;
  request: NetworkRequestMetadata;
  failureCode: string;
}

export interface SecurityResponseEvent {
  type: "security-response";
  meta: RuntimeEventMeta;
  response: RuntimeSecurityResponse;
}

export interface SecurityCookieEvent {
  type: "security-cookie";
  meta: RuntimeEventMeta;
  cookie: {
    name: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "strict" | "lax" | "none" | "unspecified";
  };
}

export interface CookieEvent {
  type: "cookie";
  meta: RuntimeEventMeta;
  sink: RawStorageSink & { storageType: "cookie" };
}

export interface StorageEvent {
  type: "storage";
  meta: RuntimeEventMeta;
  sink: RawStorageSink & { storageType: "local-storage" | "session-storage" };
}

export interface ConsoleEvent {
  type: "console";
  meta: RuntimeEventMeta;
  sink: RawConsoleSink;
}

export interface PageErrorEvent {
  type: "page-error";
  meta: RuntimeEventMeta;
  name: string;
  message: string;
}

export interface SensitiveSourceEvent {
  type: "sensitive-source";
  meta: RuntimeEventMeta;
  source: RawSensitiveSource;
}

export interface PageUrlSnapshotEvent {
  type: "page-url-snapshot";
  meta: RuntimeEventMeta;
  url: string;
}

export interface CollectorLimitEvent {
  type: "collector-limit";
  meta: RuntimeEventMeta;
  collector: "network" | "console" | "storage";
}

export interface SensitiveSourceLimitEvent {
  type: "sensitive-source-limit";
  meta: RuntimeEventMeta;
}

export type RuntimeEvent =
  | ContextCreatedEvent
  | PageCreatedEvent
  | NavigationEvent
  | RequestEvent
  | ResponseEvent
  | HttpResponseEvent
  | RequestFailedEvent
  | SecurityResponseEvent
  | SecurityCookieEvent
  | CookieEvent
  | StorageEvent
  | ConsoleEvent
  | PageErrorEvent
  | SensitiveSourceEvent
  | PageUrlSnapshotEvent
  | CollectorLimitEvent
  | SensitiveSourceLimitEvent;

export interface RuntimeEventMetaInput {
  context?: object | undefined;
  page?: object | undefined;
  timestamp?: number | undefined;
}

export class RuntimeEventMetadataFactory {
  readonly #contextIds = new WeakMap<object, string>();
  readonly #pageIds = new WeakMap<object, string>();
  #nextContextId = 0;
  #nextPageId = 0;
  #sequence = 0;

  constructor(
    private readonly test: { testId: string; projectName: string },
    private readonly clock: () => number = Date.now,
  ) {
    if (test.testId.length === 0) throw new TypeError("runtime test ID must not be empty");
  }

  create(input: RuntimeEventMetaInput = {}): RuntimeEventMeta {
    this.#sequence += 1;
    const meta: RuntimeEventMeta = {
      testId: this.test.testId,
      projectName: this.test.projectName,
      seq: this.#sequence,
      timestamp: input.timestamp ?? this.clock(),
    };
    if (input.context !== undefined) meta.contextId = this.#idForContext(input.context);
    if (input.page !== undefined) meta.pageId = this.#idForPage(input.page);
    return Object.freeze(meta);
  }

  #idForContext(context: object): string {
    const existing = this.#contextIds.get(context);
    if (existing !== undefined) return existing;
    this.#nextContextId += 1;
    const id = `context-${this.#nextContextId}`;
    this.#contextIds.set(context, id);
    return id;
  }

  #idForPage(page: object): string {
    const existing = this.#pageIds.get(page);
    if (existing !== undefined) return existing;
    this.#nextPageId += 1;
    const id = `page-${this.#nextPageId}`;
    this.#pageIds.set(page, id);
    return id;
  }
}
