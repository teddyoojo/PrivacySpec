export const OBSERVER_FINALIZATION_TIMEOUT_MS = 5_000;

export type ObserverFinalizationWork =
  | "analyzers"
  | "console"
  | "network"
  | "responses"
  | "security-responses"
  | "source-fallback"
  | "storage-snapshot";

export interface ObserverFinalizationResult {
  complete: boolean;
  failed: ObserverFinalizationWork[];
  pending: ObserverFinalizationWork[];
  timedOut: boolean;
}

export interface ObserverFinalizationDiagnostic {
  kind: "diagnostic";
  code: "PS_OBSERVER_FINALIZATION_FAILED" | "PS_OBSERVER_FINALIZATION_TIMEOUT";
  classification: "informational";
  message: string;
}

const sortedWork = (work: Iterable<ObserverFinalizationWork>): ObserverFinalizationWork[] =>
  Array.from(new Set(work)).sort();

export class PendingWorkRegistry {
  readonly #failed = new Set<ObserverFinalizationWork>();
  readonly #pending = new Map<Promise<void>, ObserverFinalizationWork>();
  #draining = false;

  constructor(private readonly timeoutMilliseconds = OBSERVER_FINALIZATION_TIMEOUT_MS) {
    if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
      throw new TypeError("observer finalization timeout must be a positive finite number");
    }
  }

  track(work: ObserverFinalizationWork, operation: Promise<unknown>): void {
    if (this.#draining) {
      throw new Error("observer work cannot be registered after finalization starts");
    }
    let tracked: Promise<void>;
    tracked = Promise.resolve(operation).then(
      () => {
        this.#pending.delete(tracked);
      },
      () => {
        this.#failed.add(work);
        this.#pending.delete(tracked);
      },
    );
    this.#pending.set(tracked, work);
  }

  async drain(): Promise<ObserverFinalizationResult> {
    this.#draining = true;
    if (this.#pending.size === 0) return this.#result(false);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("observer-finalization-timeout");
    const timeout = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), this.timeoutMilliseconds);
    });
    const settled = Promise.allSettled(Array.from(this.#pending.keys()));
    const outcome = await Promise.race([settled, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return this.#result(outcome === timedOut);
  }

  #result(timedOut: boolean): ObserverFinalizationResult {
    const failed = sortedWork(this.#failed);
    const pending = sortedWork(this.#pending.values());
    return {
      complete: !timedOut && failed.length === 0 && pending.length === 0,
      failed,
      pending,
      timedOut,
    };
  }
}

export const finalizationDiagnostics = (
  result: ObserverFinalizationResult,
): ObserverFinalizationDiagnostic[] => {
  const diagnostics: ObserverFinalizationDiagnostic[] = [];
  if (result.failed.length > 0) {
    diagnostics.push({
      kind: "diagnostic",
      code: "PS_OBSERVER_FINALIZATION_FAILED",
      classification: "informational",
      message: "Observer finalization failed before the event set could be completed.",
    });
  }
  if (result.timedOut) {
    diagnostics.push({
      kind: "diagnostic",
      code: "PS_OBSERVER_FINALIZATION_TIMEOUT",
      classification: "informational",
      message: "Observer finalization exceeded its bounded wait before the event set was complete.",
    });
  }
  return diagnostics;
};
