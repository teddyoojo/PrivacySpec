import {
  type AnalyzerCapabilityCoverage,
  type AnalyzerCapabilityRequirements,
  type RuntimeCapabilityModel,
  resolveAnalyzerCapabilityCoverage,
} from "./capabilities.js";
import type { RuntimeEvent } from "./events.js";

export const MAX_RUNTIME_ANALYZERS = 8;
export const MAX_PENDING_ANALYZER_EVENTS = 1_024;

export interface RuntimeTestMetadata {
  testId: string;
  file: string;
  title: string;
  projectName: string;
}

export interface AnalyzerContext {
  test: RuntimeTestMetadata;
  capabilities: RuntimeCapabilityModel;
  capabilityCoverage: AnalyzerCapabilityCoverage;
}

export interface AnalyzerRunContext {
  capabilities: RuntimeCapabilityModel;
}

export interface Analyzer {
  id: string;
  capabilities: AnalyzerCapabilityRequirements;
  onEvent?(event: RuntimeEvent): unknown | Promise<unknown>;
  finalizeTest?(context: AnalyzerContext): unknown | Promise<unknown>;
  finalizeRun?(context: AnalyzerRunContext): unknown | Promise<unknown>;
  dispose?(): void;
}

export type AnalyzerFailurePhase = "event" | "event-capacity" | "finalize-test" | "finalize-run";

export interface AnalyzerDiagnostic {
  analyzerId: string;
  code: `analyzer.${string}.${AnalyzerFailurePhase}`;
  phase: AnalyzerFailurePhase;
}

export interface AnalyzerDispatchResult {
  readonly results: ReadonlyMap<string, unknown>;
}

export interface AnalyzerHostResult {
  readonly results: ReadonlyMap<string, unknown>;
  readonly diagnostics: readonly AnalyzerDiagnostic[];
}

interface AnalyzerState {
  analyzer: Analyzer;
  failed: boolean;
}

const analyzerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

export class AnalyzerHost {
  readonly #states = new Map<string, AnalyzerState>();
  readonly #pending = new Set<Promise<void>>();
  readonly #diagnostics = new Map<string, AnalyzerDiagnostic>();
  #acceptingEvents = true;
  #disposed = false;

  constructor(analyzers: readonly Analyzer[]) {
    if (analyzers.length > MAX_RUNTIME_ANALYZERS) {
      throw new RangeError(`runtime analyzer count exceeds ${MAX_RUNTIME_ANALYZERS}`);
    }
    for (const analyzer of analyzers) {
      if (!analyzerIdPattern.test(analyzer.id)) {
        throw new TypeError("runtime analyzer ID must use bounded lowercase kebab-case");
      }
      if (this.#states.has(analyzer.id)) {
        throw new TypeError(`duplicate runtime analyzer ID: ${analyzer.id}`);
      }
      this.#states.set(analyzer.id, { analyzer, failed: false });
    }
  }

  emit(event: RuntimeEvent): AnalyzerDispatchResult {
    if (!this.#acceptingEvents || this.#disposed) return { results: new Map() };
    const results = new Map<string, unknown>();
    for (const [analyzerId, state] of this.#states) {
      if (state.failed || state.analyzer.onEvent === undefined) continue;
      try {
        const result = state.analyzer.onEvent(event);
        if (!isPromiseLike(result)) {
          if (result !== undefined) results.set(analyzerId, result);
          continue;
        }
        if (this.#pending.size >= MAX_PENDING_ANALYZER_EVENTS) {
          this.#fail(state, "event-capacity");
          void Promise.resolve(result).catch(() => undefined);
          continue;
        }
        let tracked: Promise<void>;
        tracked = Promise.resolve(result).then(
          () => {
            this.#pending.delete(tracked);
          },
          () => {
            this.#pending.delete(tracked);
            this.#fail(state, "event");
          },
        );
        this.#pending.add(tracked);
      } catch {
        this.#fail(state, "event");
      }
    }
    return { results };
  }

  closeEvents(): void {
    this.#acceptingEvents = false;
  }

  async flushEvents(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled(Array.from(this.#pending));
    }
  }

  async finalizeTest(input: {
    test: RuntimeTestMetadata;
    capabilities: RuntimeCapabilityModel;
  }): Promise<AnalyzerHostResult> {
    this.closeEvents();
    await this.flushEvents();
    const results = new Map<string, unknown>();
    await Promise.all(
      Array.from(this.#states.entries()).map(async ([analyzerId, state]) => {
        if (state.failed || state.analyzer.finalizeTest === undefined) return;
        const capabilityCoverage = resolveAnalyzerCapabilityCoverage(
          input.capabilities,
          state.analyzer.capabilities,
        );
        try {
          const result = await state.analyzer.finalizeTest({
            test: input.test,
            capabilities: input.capabilities,
            capabilityCoverage,
          });
          if (!state.failed && result !== undefined) results.set(analyzerId, result);
        } catch {
          this.#fail(state, "finalize-test");
        }
      }),
    );
    return { results, diagnostics: this.diagnostics() };
  }

  async finalizeRun(context: AnalyzerRunContext): Promise<AnalyzerHostResult> {
    const results = new Map<string, unknown>();
    await Promise.all(
      Array.from(this.#states.entries()).map(async ([analyzerId, state]) => {
        if (state.failed || state.analyzer.finalizeRun === undefined) return;
        try {
          const result = await state.analyzer.finalizeRun(context);
          if (!state.failed && result !== undefined) results.set(analyzerId, result);
        } catch {
          this.#fail(state, "finalize-run");
        }
      }),
    );
    return { results, diagnostics: this.diagnostics() };
  }

  diagnostics(): AnalyzerDiagnostic[] {
    return Array.from(this.#diagnostics.values()).sort((left, right) =>
      left.code.localeCompare(right.code),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#acceptingEvents = false;
    for (const state of this.#states.values()) {
      try {
        state.analyzer.dispose?.();
      } catch {
        // Disposal is best-effort after bounded analysis has already stopped.
      }
    }
    this.#pending.clear();
    this.#states.clear();
  }

  #fail(state: AnalyzerState, phase: AnalyzerFailurePhase): void {
    state.failed = true;
    const analyzerId = state.analyzer.id;
    const diagnostic: AnalyzerDiagnostic = {
      analyzerId,
      code: `analyzer.${analyzerId}.${phase}`,
      phase,
    };
    this.#diagnostics.set(diagnostic.code, diagnostic);
  }
}
