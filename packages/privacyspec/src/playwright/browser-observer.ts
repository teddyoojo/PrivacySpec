import type { BrowserContext } from "@playwright/test";
import { classifySensitiveControl } from "../discovery/classify-control.js";
import {
  MAX_SENSITIVE_SOURCES_PER_TEST,
  type SensitiveSourceStreamEvent,
} from "../discovery/sensitive-registry.js";
import type {
  ControlClassification,
  ControlClassificationInput,
  RawControlSensitiveSource,
  SourceControlMetadata,
} from "../discovery/source-model.js";

const OBSERVER_GLOBAL = "__privacyspec";
export const SOURCE_STREAM_BINDING = "__privacyspec_record_source_v1";

interface BrowserObserverState {
  version: 1;
  sampleCurrentControls: () => void;
  flushPending: () => Promise<void>;
  snapshot: () => { sources: RawControlSensitiveSource[]; limitReached: boolean };
}

type BrowserGlobal = typeof globalThis & {
  __privacyspec?: BrowserObserverState;
};

type BrowserClassifier = (control: ControlClassificationInput) => ControlClassification | undefined;

const installBrowserObserver = (
  classify: BrowserClassifier,
  observerGlobal: string,
  streamBinding: string,
  streamToken: string,
  maxSources: number,
): void => {
  const browserGlobal = globalThis as BrowserGlobal;
  if (browserGlobal.__privacyspec?.version === 1) {
    return;
  }

  // Capture the native clock before application code can replace Date.now().
  // Correlation compares these timestamps with worker-side sink timestamps.
  const now = Date.now.bind(Date);
  const sources: RawControlSensitiveSource[] = [];
  const identities = new Set<string>();
  const pending = new Set<Promise<void>>();
  let limitReached = false;
  let limitEventSent = false;

  const streamEvent = (
    event: SensitiveSourceStreamEvent,
    bufferedSource?: RawControlSensitiveSource,
  ): void => {
    const binding = (browserGlobal as unknown as Record<string, unknown>)[streamBinding];
    if (typeof binding !== "function") return;
    let operation: Promise<void>;
    operation = Promise.resolve(binding(event))
      .then(() => {
        if (bufferedSource === undefined) return;
        const index = sources.indexOf(bufferedSource);
        if (index >= 0) sources.splice(index, 1);
      })
      .catch(() => {
        // Keep the source in the bounded browser buffer for end-of-test fallback collection.
      })
      .finally(() => pending.delete(operation));
    pending.add(operation);
  };
  const cleanMetadata = (value: string | null | undefined): string | undefined => {
    const normalized = value?.trim().replace(/\s+/gu, " ");
    return normalized ? normalized.slice(0, 200) : undefined;
  };
  const readControl = (
    target: EventTarget | Element,
  ): { raw: string; control: SourceControlMetadata } | undefined => {
    if (target instanceof HTMLInputElement) {
      const associatedLabel = Array.from(target.labels ?? [], (label) => label.textContent ?? "")
        .join(" ")
        .trim();
      return {
        raw: target.value,
        control: {
          elementKind: "input",
          type: cleanMetadata(target.type),
          name: cleanMetadata(target.name),
          id: cleanMetadata(target.id),
          autocomplete: cleanMetadata(target.autocomplete),
          ariaLabel: cleanMetadata(target.getAttribute("aria-label")),
          associatedLabel: cleanMetadata(associatedLabel),
          placeholder: cleanMetadata(target.placeholder),
        },
      };
    }

    if (target instanceof HTMLTextAreaElement) {
      const associatedLabel = Array.from(target.labels ?? [], (label) => label.textContent ?? "")
        .join(" ")
        .trim();
      return {
        raw: target.value,
        control: {
          elementKind: "textarea",
          name: cleanMetadata(target.name),
          id: cleanMetadata(target.id),
          autocomplete: cleanMetadata(target.autocomplete),
          ariaLabel: cleanMetadata(target.getAttribute("aria-label")),
          associatedLabel: cleanMetadata(associatedLabel),
          placeholder: cleanMetadata(target.placeholder),
        },
      };
    }

    if (target instanceof HTMLElement && target.isContentEditable) {
      return {
        raw: target.textContent ?? "",
        control: {
          elementKind: "contenteditable",
          id: cleanMetadata(target.id),
          autocomplete: cleanMetadata(target.getAttribute("autocomplete")),
          ariaLabel: cleanMetadata(target.getAttribute("aria-label")),
        },
      };
    }

    return undefined;
  };

  const state: BrowserObserverState = {
    version: 1,
    sampleCurrentControls: () => {
      for (const control of document.querySelectorAll(
        'input, textarea, [contenteditable="true"], [contenteditable=""]',
      )) {
        capture(control, "fallback");
      }
    },
    flushPending: async () => {
      await Promise.allSettled(Array.from(pending));
    },
    snapshot: () => ({
      sources: sources.map((source) => ({
        ...source,
        evidence: source.evidence.map((item) => ({ ...item })),
        control: { ...source.control },
      })),
      limitReached,
    }),
  };

  const capture = (target: EventTarget | Element, observedBy: "event" | "fallback"): void => {
    const observed = readControl(target);
    if (observed === undefined) {
      return;
    }

    const classification = classify({
      value: observed.raw,
      type: observed.control.type,
      autocomplete: observed.control.autocomplete,
    });
    if (classification === undefined) {
      return;
    }

    const identity = JSON.stringify([
      classification.category,
      observed.raw,
      location.href,
      observed.control.elementKind,
      observed.control.id,
      observed.control.name,
    ]);
    if (identities.has(identity)) {
      return;
    }
    if (identities.size >= maxSources) {
      limitReached = true;
      if (!limitEventSent) {
        limitEventSent = true;
        streamEvent({ version: 1, token: streamToken, kind: "limit-reached" });
      }
      return;
    }

    identities.add(identity);
    const source: RawControlSensitiveSource = {
      kind: "control",
      ...classification,
      raw: observed.raw,
      control: observed.control,
      pageUrl: location.href,
      timestamp: now(),
      observedBy,
    };
    sources.push(source);
    streamEvent({ version: 1, token: streamToken, kind: "source", source }, source);
  };

  document.addEventListener(
    "input",
    (event) => {
      if (event.target !== null) capture(event.target, "event");
    },
    true,
  );
  document.addEventListener(
    "change",
    (event) => {
      if (event.target !== null) capture(event.target, "event");
    },
    true,
  );

  Object.defineProperty(browserGlobal, observerGlobal, {
    value: Object.freeze(state),
    configurable: false,
    enumerable: false,
    writable: false,
  });
};

export const createBrowserObserverScript = (streamToken: string): string =>
  `(() => { const classify = ${classifySensitiveControl.toString()}; const install = ${installBrowserObserver.toString()}; install(classify, ${JSON.stringify(OBSERVER_GLOBAL)}, ${JSON.stringify(SOURCE_STREAM_BINDING)}, ${JSON.stringify(streamToken)}, ${MAX_SENSITIVE_SOURCES_PER_TEST}); })();`;

export interface CollectedSensitiveSources {
  sources: RawControlSensitiveSource[];
  limitReached: boolean;
}

export const collectSensitiveSources = async (
  context: BrowserContext,
): Promise<CollectedSensitiveSources> => {
  const collected: RawControlSensitiveSource[] = [];
  let limitReached = false;

  for (const page of context.pages()) {
    try {
      const pageResult = await page.evaluate(async () => {
        const state = (globalThis as BrowserGlobal).__privacyspec;
        if (state === undefined) {
          return { sources: [], limitReached: false };
        }
        state.sampleCurrentControls();
        await state.flushPending();
        return state.snapshot();
      });
      limitReached ||= pageResult.limitReached;
      for (const source of pageResult.sources) {
        if (collected.length >= MAX_SENSITIVE_SOURCES_PER_TEST) {
          limitReached = true;
          break;
        }
        collected.push(source);
      }
    } catch {
      // Already-streamed sources survive page closure; only current-control fallback sampling is unavailable.
    }
  }

  return { sources: collected, limitReached };
};
