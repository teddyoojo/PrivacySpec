import { randomUUID } from "node:crypto";
import type { BrowserContext, ConsoleMessage, Page, Request, Response } from "@playwright/test";
import type {
  PrivacyAnalyzerEventResult,
  PrivacyRuntimeAnalyzer,
} from "../analyzers/privacy/analyzer.js";
import { PRIVACY_ANALYZER_ID } from "../analyzers/privacy/analyzer.js";
import type { NormalizedCustomDomSourceClassifier } from "../discovery/custom-classifiers.js";
import {
  parseSensitiveSourceStreamEvent,
  type SensitiveSourceAddResult,
} from "../discovery/sensitive-registry.js";
import type {
  RawControlSensitiveSource,
  RawResponseSensitiveSource,
} from "../discovery/source-model.js";
import type { ConsoleSinkConsumer } from "../observe/console.js";
import type { NetworkRequestMetadata, NetworkSinkConsumer } from "../observe/network.js";
import type {
  RuntimeSecurityResponse,
  SecurityResponseConsumer,
} from "../observe/response-security.js";
import type { RawConsoleSink, RawNetworkSink, RawStorageSink } from "../observe/sink-model.js";
import { parseStorageStreamEvent } from "../observe/sink-registry.js";
import type { AnalyzerHost } from "../runtime/analyzer.js";
import { type RuntimeEventMeta, RuntimeEventMetadataFactory } from "../runtime/events.js";
import type { APIRequestEventConsumer } from "./api-request-observer.js";
import type { ResponseSourceConsumer } from "./response-observer.js";

const requestPage = (request: Request): Page | undefined => {
  try {
    return request.frame().page();
  } catch {
    return undefined;
  }
};

const responsePage = (response: Response): Page | undefined => requestPage(response.request());

const responseStatus = (response: Response): number => {
  try {
    return response.status();
  } catch {
    return 0;
  }
};

const requestFrameKind = (request: Request): "main" | "child" | "unknown" => {
  try {
    return request.frame().parentFrame() === null ? "main" : "child";
  } catch {
    return "unknown";
  }
};

const normalizedRequestFailureCode = (request: Request): string => {
  let text = "";
  try {
    text = request.failure()?.errorText ?? "";
  } catch {
    return "REQUEST_FAILED";
  }
  const match = /\b(?:net::)?(ERR_[A-Z0-9_]{1,64})\b/u.exec(text.toUpperCase());
  return match?.[1] ?? "REQUEST_FAILED";
};

const cloneResponseSource = (source: RawResponseSensitiveSource): RawResponseSensitiveSource => ({
  ...source,
  evidence: source.evidence.map((item) => ({ ...item })),
  provenance: { ...source.provenance },
});

interface RuntimeBindingSource {
  context: BrowserContext;
  page?: Page | undefined;
}

export class PlaywrightRuntimeEventAdapter
  implements
    NetworkSinkConsumer,
    ConsoleSinkConsumer,
    ResponseSourceConsumer,
    SecurityResponseConsumer,
    APIRequestEventConsumer
{
  readonly sourceStreamToken = randomUUID();
  readonly storageStreamToken = randomUUID();
  readonly #metadata: RuntimeEventMetadataFactory;
  readonly #reserved = new Map<number, RuntimeEventMeta>();
  #active = true;

  constructor(
    private readonly host: AnalyzerHost,
    private readonly privacyAnalyzer: PrivacyRuntimeAnalyzer,
    private readonly defaultContext: BrowserContext,
    test: { testId: string; projectName: string },
    private readonly customClassifiers: readonly NormalizedCustomDomSourceClassifier[] = [],
  ) {
    this.#metadata = new RuntimeEventMetadataFactory(test);
  }

  hasSensitiveSources(): boolean {
    return this.privacyAnalyzer.hasSensitiveSources();
  }

  reserveRequest(request?: Request): number {
    return this.#reserve(
      this.defaultContext,
      request === undefined ? undefined : requestPage(request),
    );
  }

  reserveAPIRequest(): number {
    return this.#reserve(this.defaultContext);
  }

  reserveConsole(message?: ConsoleMessage): number {
    return this.#reserve(this.defaultContext, message?.page() ?? undefined);
  }

  reserveResponse(response?: Response): number {
    return this.#reserve(
      this.defaultContext,
      response === undefined ? undefined : responsePage(response),
    );
  }

  reserveSecurityResponse(response: Response): number {
    return this.#reserve(this.defaultContext, responsePage(response));
  }

  addSecurityResponse(
    observation: RuntimeSecurityResponse,
    response: Response,
    reservedSequence: number,
  ): void {
    if (!this.#active) return;
    const meta = this.#take(reservedSequence, this.defaultContext, responsePage(response));
    this.host.emit({ type: "security-response", meta, response: observation });
  }

  recordSecurityCookie(cookie: {
    name: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "strict" | "lax" | "none" | "unspecified";
  }): void {
    if (!this.#active) return;
    this.host.emit({
      type: "security-cookie",
      meta: this.#metadata.create({ context: this.defaultContext }),
      cookie: { ...cookie },
    });
  }

  addNetwork(sink: RawNetworkSink, request?: Request, metadata?: NetworkRequestMetadata): void {
    if (!this.#active) return;
    const page = request === undefined ? undefined : requestPage(request);
    const meta = this.#take(sink.timestamp, this.defaultContext, page);
    this.host.emit({
      type: "request",
      meta,
      request: metadata ?? {
        url: sink.url,
        method: sink.method,
        resourceType: sink.resourceType,
        frameKind: "unknown",
        requestSurface: sink.requestSurface,
        timestamp: sink.timestamp,
      },
      sink,
    });
  }

  addNetworkMetadata(metadata: NetworkRequestMetadata, request?: Request): void {
    if (!this.#active) return;
    const page = request === undefined ? undefined : requestPage(request);
    const meta = this.#take(metadata.timestamp, this.defaultContext, page);
    this.host.emit({ type: "request", meta, request: metadata });
  }

  addAPIRequest(sink: RawNetworkSink, metadata: NetworkRequestMetadata): void {
    if (!this.#active) return;
    const meta = this.#take(sink.timestamp, this.defaultContext);
    this.host.emit({ type: "request", meta, request: metadata, sink });
  }

  addAPIRequestMetadata(metadata: NetworkRequestMetadata): void {
    if (!this.#active) return;
    const meta = this.#take(metadata.timestamp, this.defaultContext);
    this.host.emit({ type: "request", meta, request: metadata });
  }

  recordAPIResponse(response: RuntimeSecurityResponse): void {
    if (!this.#active) return;
    this.host.emit({
      type: "security-response",
      meta: this.#metadata.create({ context: this.defaultContext }),
      response,
    });
  }

  recordAPIRequestFailure(metadata: NetworkRequestMetadata): void {
    if (!this.#active) return;
    this.host.emit({
      type: "request-failed",
      meta: this.#metadata.create({ context: this.defaultContext }),
      request: metadata,
      failureCode: "REQUEST_FAILED",
    });
  }

  recordAPIHttpResponse(input: { url: string; method: string; status: number }): void {
    if (!this.#active) return;
    this.host.emit({
      type: "http-response",
      meta: this.#metadata.create({ context: this.defaultContext }),
      url: input.url,
      method: input.method,
      resourceType: "fetch",
      frameKind: "unknown",
      status: input.status,
    });
  }

  addConsole(sink: RawConsoleSink, message?: ConsoleMessage): void {
    if (!this.#active) return;
    const meta = this.#take(sink.timestamp, this.defaultContext, message?.page() ?? undefined);
    this.host.emit({ type: "console", meta, sink });
  }

  recordPageError(page: Page, error: Error): void {
    if (!this.#active) return;
    this.host.emit({
      type: "page-error",
      meta: this.#metadata.create({ context: page.context(), page }),
      name: error.name,
      message: error.message,
    });
  }

  recordRequestFailed(request: Request): void {
    if (!this.#active) return;
    const timestamp = Date.now();
    this.host.emit({
      type: "request-failed",
      meta: this.#metadata.create({ context: this.defaultContext, page: requestPage(request) }),
      request: {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        frameKind: requestFrameKind(request),
        requestSurface: "browser",
        timestamp,
      },
      failureCode: normalizedRequestFailureCode(request),
    });
  }

  recordHttpResponse(response: Response): void {
    if (!this.#active) return;
    const request = response.request();
    this.host.emit({
      type: "http-response",
      meta: this.#metadata.create({
        context: this.defaultContext,
        page: responsePage(response),
      }),
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      frameKind: requestFrameKind(request),
      status: responseStatus(response),
    });
  }

  markLimitReached(collector: "network" | "console"): void {
    if (!this.#active) return;
    this.host.emit({
      type: "collector-limit",
      meta: this.#metadata.create({ context: this.defaultContext }),
      collector,
    });
  }

  addResponse(_source: RawResponseSensitiveSource): SensitiveSourceAddResult {
    // The response observer uses the batch path so one response keeps one causal sequence.
    return "limit-reached";
  }

  addResponseBatch(
    sources: readonly RawResponseSensitiveSource[],
    response: Response,
    observedAt: number,
  ): readonly SensitiveSourceAddResult[] {
    if (!this.#active) return sources.map(() => "limit-reached");
    const meta = this.#take(observedAt, this.defaultContext, responsePage(response));
    const eventSources = sources.map(cloneResponseSource);
    const dispatch = this.host.emit({
      type: "response",
      meta,
      url: response.url(),
      status: responseStatus(response),
      sources: eventSources,
    });
    const result = dispatch.results.get(PRIVACY_ANALYZER_ID) as
      | PrivacyAnalyzerEventResult
      | undefined;
    return result?.responseSources ?? sources.map(() => "limit-reached");
  }

  recordSensitiveSourceStreamEvent(source: RuntimeBindingSource, value: unknown): void {
    if (!this.#active) return;
    const parsed = parseSensitiveSourceStreamEvent(
      value,
      this.sourceStreamToken,
      this.customClassifiers,
    );
    if (parsed?.kind === "limit-reached") {
      this.host.emit({
        type: "sensitive-source-limit",
        meta: this.#metadata.create({ context: source.context, page: source.page }),
      });
    } else if (parsed?.kind === "classification-ambiguous") {
      this.host.emit({
        type: "sensitive-source-ambiguous",
        meta: this.#metadata.create({ context: source.context, page: source.page }),
      });
    } else if (parsed?.kind === "source") {
      this.recordSensitiveSource(parsed.source, source.context, source.page);
    }
  }

  recordSensitiveSource(
    source: RawControlSensitiveSource,
    context: BrowserContext = this.defaultContext,
    page?: Page,
  ): void {
    if (!this.#active) return;
    this.host.emit({
      type: "sensitive-source",
      meta: this.#metadata.create({ context, page }),
      source,
    });
  }

  markSensitiveSourceLimit(): void {
    if (!this.#active) return;
    this.host.emit({
      type: "sensitive-source-limit",
      meta: this.#metadata.create({ context: this.defaultContext }),
    });
  }

  markCustomSourceClassificationAmbiguous(): void {
    if (!this.#active) return;
    this.host.emit({
      type: "sensitive-source-ambiguous",
      meta: this.#metadata.create({ context: this.defaultContext }),
    });
  }

  recordStorageStreamEvent(source: RuntimeBindingSource, value: unknown): void {
    if (!this.#active) return;
    const meta = this.#metadata.create({ context: source.context, page: source.page });
    const parsed = parseStorageStreamEvent(value, this.storageStreamToken, meta.seq);
    if (parsed?.kind === "limit-reached") {
      this.host.emit({ type: "collector-limit", meta, collector: "storage" });
    } else if (parsed?.kind === "storage-write") {
      this.recordStorage(parsed.sink, source.context, source.page, meta);
    }
  }

  recordStorage(
    sink: RawStorageSink,
    context: BrowserContext = this.defaultContext,
    page?: Page,
    reservedMeta?: RuntimeEventMeta,
  ): void {
    if (!this.#active) return;
    const meta = reservedMeta ?? this.#metadata.create({ context, page });
    if (sink.storageType === "cookie") {
      this.host.emit({
        type: "cookie",
        meta,
        sink: { ...sink, storageType: "cookie" },
      });
    } else {
      this.host.emit({
        type: "storage",
        meta,
        sink: { ...sink, storageType: sink.storageType },
      });
    }
  }

  markStorageLimit(): void {
    if (!this.#active) return;
    this.host.emit({
      type: "collector-limit",
      meta: this.#metadata.create({ context: this.defaultContext }),
      collector: "storage",
    });
  }

  recordPageUrl(page: Page): void {
    if (!this.#active) return;
    this.host.emit({
      type: "page-url-snapshot",
      meta: this.#metadata.create({ context: page.context(), page }),
      url: page.url(),
    });
  }

  recordContext(context: BrowserContext, instrumented: boolean): void {
    if (!this.#active) return;
    this.host.emit({
      type: "context-created",
      meta: this.#metadata.create({ context }),
      instrumented,
    });
  }

  recordPage(page: Page, instrumented: boolean): void {
    if (!this.#active) return;
    this.host.emit({
      type: "page-created",
      meta: this.#metadata.create({ context: page.context(), page }),
      instrumented,
    });
  }

  recordNavigation(page: Page): void {
    if (!this.#active) return;
    this.host.emit({
      type: "navigation",
      meta: this.#metadata.create({ context: page.context(), page }),
      url: page.url(),
    });
  }

  dispose(): void {
    this.#active = false;
    this.#reserved.clear();
  }

  #reserve(context: BrowserContext, page?: Page): number {
    if (!this.#active) return 0;
    const meta = this.#metadata.create({ context, page });
    this.#reserved.set(meta.seq, meta);
    return meta.seq;
  }

  #take(sequence: number, context: BrowserContext, page?: Page): RuntimeEventMeta {
    const reserved = this.#reserved.get(sequence);
    if (reserved !== undefined) {
      this.#reserved.delete(sequence);
      return reserved;
    }
    return this.#metadata.create({ context, page });
  }
}
