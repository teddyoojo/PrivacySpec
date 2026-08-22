import type { BrowserContext, Request, Response } from "@playwright/test";
import { classifyRecipient } from "../correlate/first-party.js";
import type { FirstPartyConfig } from "../correlate/model.js";
import { canonicalizeEndpointPath } from "../correlate/redact.js";
import {
  createResponseJsonCoverage,
  discoverResponseJsonSources,
  isJsonMediaType,
  MAX_RESPONSE_JSON_BYTES,
  MAX_RESPONSE_JSON_CONCURRENCY,
  MAX_RESPONSE_JSON_QUEUE,
  MAX_RESPONSE_JSON_RESPONSES_PER_TEST,
  MAX_RESPONSE_JSON_RETAINED_BYTES_PER_TEST,
  type ResponseJsonCoverage,
} from "../discovery/response-json.js";
import type {
  SensitiveSourceAddResult,
  SensitiveValueRegistry,
} from "../discovery/sensitive-registry.js";
import type { RawResponseSensitiveSource } from "../discovery/source-model.js";

interface QueuedResponse {
  response: Response;
  declaredBytes: number;
  observedAt: number;
  requestIdentity?: number | undefined;
}

export interface ResponseSourceConsumer {
  addResponse(source: RawResponseSensitiveSource): SensitiveSourceAddResult;
  addResponseBatch?(
    sources: readonly RawResponseSensitiveSource[],
    response: Response,
    observedAt: number,
  ): readonly SensitiveSourceAddResult[];
}

const contentLength = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
};

const cloneCoverage = (coverage: ResponseJsonCoverage): ResponseJsonCoverage => ({
  enabled: coverage.enabled,
  responses: { ...coverage.responses },
  retainedBytes: coverage.retainedBytes,
  discoveredSources: {
    total: coverage.discoveredSources.total,
    byCategory: { ...coverage.discoveredSources.byCategory },
  },
  skipped: { ...coverage.skipped },
});

export class FirstPartyJsonResponseObserver {
  readonly #coverage = createResponseJsonCoverage(true);
  readonly #queue: QueuedResponse[] = [];
  readonly #flushWaiters = new Set<() => void>();
  #context: BrowserContext | undefined;
  #activeWork = 0;
  #scheduled = 0;
  #reservedBytes = 0;
  #retainedBytes = 0;
  readonly #listener: (response: Response) => void;

  constructor(
    private readonly registry: SensitiveValueRegistry | ResponseSourceConsumer,
    private readonly firstParty: FirstPartyConfig,
    private readonly now: (response?: Response) => number = Date.now,
    private readonly identifyRequest: (request: Request) => number | undefined = () => undefined,
  ) {
    this.#listener = (response) => this.#accept(response);
  }

  attach(context: BrowserContext): void {
    if (this.#context !== undefined) return;
    this.#context = context;
    context.on("response", this.#listener);
  }

  detach(): void {
    this.#context?.off("response", this.#listener);
    this.#context = undefined;
  }

  snapshot(): ResponseJsonCoverage {
    return cloneCoverage(this.#coverage);
  }

  async flush(): Promise<void> {
    if (this.#queue.length === 0 && this.#activeWork === 0) return;
    await new Promise<void>((resolve) => this.#flushWaiters.add(resolve));
  }

  #accept(response: Response): void {
    this.#coverage.responses.seen += 1;
    const recipient = classifyRecipient(response.url(), this.firstParty);
    if (!recipient.valid || !recipient.firstParty) return;
    this.#coverage.responses.firstParty += 1;

    const headers = response.headers();
    if (!isJsonMediaType(headers["content-type"] ?? "")) return;
    this.#coverage.responses.json += 1;

    const declaredBytes = contentLength(headers["content-length"]);
    if (declaredBytes === undefined) {
      this.#coverage.skipped.unknownLength += 1;
      return;
    }
    if (declaredBytes > MAX_RESPONSE_JSON_BYTES) {
      this.#coverage.skipped.oversized += 1;
      return;
    }
    if (this.#reservedBytes + declaredBytes > MAX_RESPONSE_JSON_RETAINED_BYTES_PER_TEST) {
      this.#coverage.skipped.aggregateLimit += 1;
      return;
    }
    if (
      this.#scheduled >= MAX_RESPONSE_JSON_RESPONSES_PER_TEST ||
      this.#queue.length >= MAX_RESPONSE_JSON_QUEUE
    ) {
      this.#coverage.skipped.workLimit += 1;
      return;
    }

    this.#scheduled += 1;
    this.#reservedBytes += declaredBytes;
    this.#queue.push({
      response,
      declaredBytes,
      observedAt: this.now(response),
      requestIdentity: this.identifyRequest(response.request()),
    });
    this.#drain();
  }

  #drain(): void {
    while (this.#activeWork < MAX_RESPONSE_JSON_CONCURRENCY) {
      const queued = this.#queue.shift();
      if (queued === undefined) break;
      this.#activeWork += 1;
      void this.#process(queued).finally(() => {
        this.#activeWork -= 1;
        this.#drain();
        if (this.#queue.length === 0 && this.#activeWork === 0) {
          for (const resolve of this.#flushWaiters) resolve();
          this.#flushWaiters.clear();
        }
      });
    }
  }

  async #process(queued: QueuedResponse): Promise<void> {
    let body: Buffer | undefined;
    let serialized = "";
    try {
      body = await queued.response.body();
      if (body.byteLength > MAX_RESPONSE_JSON_BYTES) {
        this.#coverage.skipped.oversized += 1;
        return;
      }
      if (this.#retainedBytes + body.byteLength > MAX_RESPONSE_JSON_RETAINED_BYTES_PER_TEST) {
        this.#coverage.skipped.aggregateLimit += 1;
        return;
      }
      this.#retainedBytes += body.byteLength;
      this.#coverage.retainedBytes += body.byteLength;
      serialized = body.toString("utf8");

      let url: URL;
      try {
        url = new URL(queued.response.url());
      } catch {
        this.#coverage.skipped.bodyReadError += 1;
        return;
      }
      const discovered = discoverResponseJsonSources(
        serialized,
        { origin: url.origin, endpoint: canonicalizeEndpointPath(url.pathname, []) },
        queued.observedAt,
      );
      for (const source of discovered.sources) {
        source.requestIdentity = queued.requestIdentity;
      }
      if (discovered.invalidJson) {
        this.#coverage.skipped.invalidJson += 1;
        return;
      }
      this.#coverage.responses.parsed += 1;
      if (discovered.traversalLimitReached) {
        this.#coverage.skipped.traversalLimit += 1;
        return;
      }

      let added = 0;
      const results =
        "addResponseBatch" in this.registry && typeof this.registry.addResponseBatch === "function"
          ? this.registry.addResponseBatch(discovered.sources, queued.response, queued.observedAt)
          : discovered.sources.map((source) => this.registry.addResponse(source));
      for (const [index, source] of discovered.sources.entries()) {
        const result = results[index] ?? "limit-reached";
        if (result === "added") {
          added += 1;
          this.#coverage.discoveredSources.total += 1;
          this.#coverage.discoveredSources.byCategory[source.category] += 1;
        } else if (result === "limit-reached") {
          this.#coverage.skipped.sourceLimit += 1;
        }
      }
      if (added > 0) this.#coverage.responses.withSources += 1;
      discovered.sources.length = 0;
    } catch {
      this.#coverage.skipped.bodyReadError += 1;
    } finally {
      serialized = "";
      body?.fill(0);
      // Keep cumulative reservation in place: it is the bounded per-test material budget.
      void queued.declaredBytes;
    }
  }
}
