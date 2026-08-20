import type { BrowserContext } from "@playwright/test";
import type { RawStorageSink, StorageType } from "./sink-model.js";
import {
  MAX_STORAGE_SINKS_PER_TEST,
  MAX_STORAGE_VALUE_LENGTH,
  type StorageStreamEvent,
} from "./sink-registry.js";

export const STORAGE_STREAM_BINDING = "__privacyspec_record_storage_v1";
const STORAGE_OBSERVER_GLOBAL = "__privacyspecStorage";

interface StorageObserverState {
  version: 1;
  flushPending: () => Promise<void>;
  snapshot: () => { writes: RawStorageSink[]; limitReached: boolean };
}

type StorageBrowserGlobal = typeof globalThis & {
  __privacyspecStorage?: StorageObserverState;
};

const installStorageObserver = (
  observerGlobal: string,
  streamBinding: string,
  streamToken: string,
  maxWrites: number,
  maxValueLength: number,
): void => {
  const browserGlobal = globalThis as StorageBrowserGlobal;
  if (browserGlobal.__privacyspecStorage?.version === 1) return;

  // Bind before application code can mock Date.now(); source/sink ordering is
  // evaluated against worker-side timestamps during correlation.
  const now = Date.now.bind(Date);
  const writes: RawStorageSink[] = [];
  const pending = new Set<Promise<void>>();
  let observedWrites = 0;
  let limitReached = false;
  let limitEventSent = false;

  const streamEvent = (event: StorageStreamEvent, bufferedSink?: RawStorageSink): void => {
    const binding = (browserGlobal as unknown as Record<string, unknown>)[streamBinding];
    if (typeof binding !== "function") return;
    let operation: Promise<void>;
    operation = Promise.resolve(binding(event))
      .then(() => {
        if (bufferedSink === undefined) return;
        const index = writes.indexOf(bufferedSink);
        if (index >= 0) writes.splice(index, 1);
      })
      .catch(() => {
        // Keep the write in the bounded browser buffer for teardown fallback.
      })
      .finally(() => pending.delete(operation));
    pending.add(operation);
  };

  const reportLimit = (): void => {
    if (limitEventSent) return;
    limitEventSent = true;
    limitReached = true;
    streamEvent({ version: 1, token: streamToken, kind: "limit-reached" });
  };

  const storageTypeOf = (storage: Storage): StorageType | undefined => {
    try {
      if (storage === globalThis.localStorage) return "local-storage";
      if (storage === globalThis.sessionStorage) return "session-storage";
    } catch {
      // Storage can be inaccessible for opaque or restricted origins.
    }
    return undefined;
  };

  const originalKey = Storage.prototype.key;
  const originalGetItem = Storage.prototype.getItem;
  const lengthGetter = Object.getOwnPropertyDescriptor(Storage.prototype, "length")?.get;
  const snapshotStorage = (storage: Storage): Map<string, string> | undefined => {
    try {
      const snapshot = new Map<string, string>();
      const length =
        lengthGetter === undefined ? storage.length : Reflect.apply(lengthGetter, storage, []);
      for (let index = 0; index < length; index += 1) {
        const key = Reflect.apply(originalKey, storage, [index]);
        if (key === null) continue;
        const value = Reflect.apply(originalGetItem, storage, [key]);
        if (value !== null) snapshot.set(key, value);
      }
      return snapshot;
    } catch {
      return undefined;
    }
  };

  const state: StorageObserverState = {
    version: 1,
    flushPending: async () => {
      await Promise.allSettled(Array.from(pending));
    },
    snapshot: () => ({
      writes: writes.map((sink) => ({ ...sink })),
      limitReached,
    }),
  };

  const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
  const originalSetItem = Storage.prototype.setItem;
  const wrappedSetItem = function (this: Storage, ...args: unknown[]): void {
    const before = snapshotStorage(this);
    Reflect.apply(originalSetItem, this, args);

    try {
      const storageType = storageTypeOf(this);
      const after = snapshotStorage(this);
      if (storageType === undefined || after === undefined) return;
      for (const [key, value] of after) {
        if (before?.get(key) === value) continue;
        if (observedWrites >= maxWrites || value.length > maxValueLength) {
          reportLimit();
          continue;
        }
        observedWrites += 1;
        const sink: RawStorageSink = {
          kind: "storage",
          storageType,
          key,
          value,
          pageUrl: location.href,
          observedBy: "write",
          timestamp: now(),
        };
        writes.push(sink);
        streamEvent({ version: 1, token: streamToken, kind: "storage-write", sink }, sink);
      }
    } catch {
      // Observation must never change Storage.setItem behavior.
    }
  };
  Object.defineProperty(wrappedSetItem, "name", { value: "setItem" });
  Object.defineProperty(wrappedSetItem, "length", { value: 2 });

  Object.defineProperty(Storage.prototype, "setItem", {
    ...descriptor,
    value: wrappedSetItem,
  });
  Object.defineProperty(browserGlobal, observerGlobal, {
    value: Object.freeze(state),
    configurable: false,
    enumerable: false,
    writable: false,
  });
};

export const createStorageObserverScript = (streamToken: string): string =>
  `(() => { const install = ${installStorageObserver.toString()}; install(${JSON.stringify(STORAGE_OBSERVER_GLOBAL)}, ${JSON.stringify(STORAGE_STREAM_BINDING)}, ${JSON.stringify(streamToken)}, ${MAX_STORAGE_SINKS_PER_TEST}, ${MAX_STORAGE_VALUE_LENGTH}); })();`;

interface FrameStorageSnapshot {
  writes: RawStorageSink[];
  limitReached: boolean;
  localStorage: Array<{ key: string; value: string }>;
  sessionStorage: Array<{ key: string; value: string }>;
  pageUrl: string;
}

const collectFrameStorage = async (
  context: BrowserContext,
): Promise<{ sinks: RawStorageSink[]; limitReached: boolean }> => {
  const sinks: RawStorageSink[] = [];
  let limitReached = false;
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      try {
        const snapshot = await frame.evaluate(
          async ({ maxEntries, maxValueLength }): Promise<FrameStorageSnapshot> => {
            const state = (globalThis as StorageBrowserGlobal).__privacyspecStorage;
            await state?.flushPending();
            const observerSnapshot = state?.snapshot();
            let sampleLimitReached = false;
            let sampledEntries = 0;
            const read = (storage: Storage): Array<{ key: string; value: string }> => {
              const entries: Array<{ key: string; value: string }> = [];
              try {
                for (let index = 0; index < storage.length; index += 1) {
                  if (sampledEntries >= maxEntries) {
                    sampleLimitReached = true;
                    break;
                  }
                  const key = storage.key(index);
                  if (key === null) continue;
                  const value = storage.getItem(key);
                  if (value !== null) {
                    sampledEntries += 1;
                    if (value.length > maxValueLength) {
                      sampleLimitReached = true;
                      continue;
                    }
                    entries.push({ key, value });
                  }
                }
              } catch {
                // Storage is unavailable for some origins.
              }
              return entries;
            };
            const readGlobalStorage = (
              key: "localStorage" | "sessionStorage",
            ): Array<{ key: string; value: string }> => {
              try {
                return read(globalThis[key]);
              } catch {
                return [];
              }
            };
            const localStorage = readGlobalStorage("localStorage");
            const sessionStorage = readGlobalStorage("sessionStorage");
            return {
              writes: observerSnapshot?.writes ?? [],
              limitReached: (observerSnapshot?.limitReached ?? false) || sampleLimitReached,
              localStorage,
              sessionStorage,
              pageUrl: location.href,
            };
          },
          {
            maxEntries: MAX_STORAGE_SINKS_PER_TEST,
            maxValueLength: MAX_STORAGE_VALUE_LENGTH,
          },
        );
        const snapshotTimestamp = Date.now();
        const append = (sink: RawStorageSink): void => {
          if (sinks.length >= MAX_STORAGE_SINKS_PER_TEST) {
            limitReached = true;
            return;
          }
          sinks.push(sink);
        };
        for (const sink of snapshot.writes) append(sink);
        limitReached ||= snapshot.limitReached;
        for (const entry of snapshot.localStorage) {
          append({
            kind: "storage",
            storageType: "local-storage",
            key: entry.key,
            value: entry.value,
            pageUrl: snapshot.pageUrl,
            observedBy: "snapshot",
            timestamp: snapshotTimestamp,
          });
        }
        for (const entry of snapshot.sessionStorage) {
          append({
            kind: "storage",
            storageType: "session-storage",
            key: entry.key,
            value: entry.value,
            pageUrl: snapshot.pageUrl,
            observedBy: "snapshot",
            timestamp: snapshotTimestamp,
          });
        }
      } catch {
        // Writes already streamed from a closed frame remain in the Node registry.
      }
    }
  }
  return { sinks, limitReached };
};

export const collectFinalStorage = async (
  context: BrowserContext,
): Promise<{ sinks: RawStorageSink[]; limitReached: boolean }> => {
  const frameStorage = await collectFrameStorage(context);
  const sinks = [...frameStorage.sinks];
  let limitReached = frameStorage.limitReached;

  try {
    const storageState = await context.storageState();
    for (const cookie of storageState.cookies) {
      if (
        sinks.length >= MAX_STORAGE_SINKS_PER_TEST ||
        cookie.value.length > MAX_STORAGE_VALUE_LENGTH
      ) {
        limitReached = true;
        if (sinks.length >= MAX_STORAGE_SINKS_PER_TEST) break;
        continue;
      }
      const host = cookie.domain.replace(/^\./u, "");
      sinks.push({
        kind: "storage",
        storageType: "cookie",
        key: cookie.name,
        value: cookie.value,
        pageUrl: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`,
        observedBy: "snapshot",
        timestamp: Date.now(),
      });
    }
    for (const origin of storageState.origins) {
      for (const entry of origin.localStorage) {
        if (
          sinks.length >= MAX_STORAGE_SINKS_PER_TEST ||
          entry.value.length > MAX_STORAGE_VALUE_LENGTH
        ) {
          limitReached = true;
          if (sinks.length >= MAX_STORAGE_SINKS_PER_TEST) break;
          continue;
        }
        sinks.push({
          kind: "storage",
          storageType: "local-storage",
          key: entry.name,
          value: entry.value,
          pageUrl: origin.origin,
          observedBy: "snapshot",
          timestamp: Date.now(),
        });
      }
    }
  } catch {
    // A user test may explicitly close its context before teardown.
  }

  return { sinks, limitReached };
};
