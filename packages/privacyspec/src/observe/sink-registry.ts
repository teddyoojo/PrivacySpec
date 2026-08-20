import { randomUUID } from "node:crypto";
import type { RawConsoleSink, RawNetworkSink, RawStorageSink, StorageType } from "./sink-model.js";

export const MAX_NETWORK_SINKS_PER_TEST = 1_000;
export const MAX_NETWORK_RETAINED_BYTES_PER_TEST = 16_777_216;
export const MAX_NETWORK_MATERIALS_PER_TEST = 10_000;
export const MAX_CONSOLE_SINKS_PER_TEST = 500;
export const MAX_CONSOLE_RETAINED_BYTES_PER_TEST = 16_777_216;
export const MAX_STORAGE_SINKS_PER_TEST = 500;
export const MAX_STORAGE_VALUE_LENGTH = 1_048_576;
export const MAX_STORAGE_RETAINED_BYTES_PER_TEST = 16_777_216;

export interface StorageStreamEvent {
  version: 1;
  token: string;
  kind: "storage-write" | "limit-reached";
  sink?: RawStorageSink | undefined;
}

export interface SinkRegistrySnapshot {
  network: RawNetworkSink[];
  console: RawConsoleSink[];
  storage: RawStorageSink[];
  limitsReached: Array<"network" | "console" | "storage">;
}

const storageTypes = new Set<StorageType>(["local-storage", "session-storage", "cookie"]);

const cloneNetwork = (sink: RawNetworkSink): RawNetworkSink => ({
  ...sink,
  headers: { ...sink.headers },
  materials: sink.materials.map((material) => ({ ...material })),
});

const cloneConsole = (sink: RawConsoleSink): RawConsoleSink => ({
  ...sink,
  materials: sink.materials.map((material) => ({ ...material })),
});

const cloneStorage = (sink: RawStorageSink): RawStorageSink => ({ ...sink });

const stringBytes = (value: string): number => Buffer.byteLength(value, "utf8");

const retainedNetworkBytes = (sink: RawNetworkSink): number => {
  let bytes =
    stringBytes(sink.url) +
    stringBytes(sink.method) +
    stringBytes(sink.resourceType) +
    stringBytes(sink.frameUrl ?? "") +
    stringBytes(sink.pageUrl ?? "");
  for (const [name, value] of Object.entries(sink.headers)) {
    bytes += stringBytes(name) + stringBytes(value);
  }
  for (const material of sink.materials) {
    bytes += stringBytes(material.location) + stringBytes(material.value);
  }
  return bytes;
};

const retainedConsoleBytes = (sink: RawConsoleSink): number => {
  let bytes =
    stringBytes(sink.level) + stringBytes(sink.pageUrl ?? "") + stringBytes(sink.sourceUrl ?? "");
  for (const material of sink.materials) {
    bytes += stringBytes(material.location) + stringBytes(material.value);
  }
  return bytes;
};

const retainedStorageBytes = (sink: RawStorageSink): number =>
  stringBytes(sink.storageType) +
  stringBytes(sink.key) +
  stringBytes(sink.value) +
  stringBytes(sink.pageUrl) +
  stringBytes(sink.observedBy);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStorageSink = (value: unknown): RawStorageSink | undefined => {
  if (
    !isRecord(value) ||
    value.kind !== "storage" ||
    !storageTypes.has(value.storageType as StorageType) ||
    typeof value.key !== "string" ||
    value.key.length > 4_096 ||
    typeof value.value !== "string" ||
    value.value.length > MAX_STORAGE_VALUE_LENGTH ||
    typeof value.pageUrl !== "string" ||
    value.pageUrl.length > 8_192 ||
    (value.observedBy !== "write" && value.observedBy !== "snapshot") ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp)
  ) {
    return undefined;
  }

  return {
    kind: "storage",
    storageType: value.storageType as StorageType,
    key: value.key,
    value: value.value,
    pageUrl: value.pageUrl,
    observedBy: value.observedBy,
    timestamp: value.timestamp,
  };
};

export class SinkRunRegistry {
  readonly #network: RawNetworkSink[] = [];
  readonly #console: RawConsoleSink[] = [];
  readonly #storage: RawStorageSink[] = [];
  readonly #storageIdentities = new Set<string>();
  readonly #limitsReached = new Set<"network" | "console" | "storage">();
  #networkRetainedBytes = 0;
  #networkMaterialCount = 0;
  #consoleRetainedBytes = 0;
  #storageRetainedBytes = 0;
  #active = true;
  #streamToken: string = randomUUID();

  get streamToken(): string {
    return this.#streamToken;
  }

  addNetwork(sink: RawNetworkSink): void {
    if (!this.#active) return;
    if (this.#network.length >= MAX_NETWORK_SINKS_PER_TEST) {
      this.#limitsReached.add("network");
      return;
    }
    const clone = cloneNetwork(sink);
    const retainedBytes = retainedNetworkBytes(clone);
    if (
      this.#networkRetainedBytes + retainedBytes > MAX_NETWORK_RETAINED_BYTES_PER_TEST ||
      this.#networkMaterialCount + clone.materials.length > MAX_NETWORK_MATERIALS_PER_TEST
    ) {
      this.#limitsReached.add("network");
      const metadataOnly: RawNetworkSink = {
        ...clone,
        headers: {},
        materials: [],
        bodyTruncated: clone.bodyTruncated || clone.bodySize > 0,
      };
      const metadataBytes = retainedNetworkBytes(metadataOnly);
      if (this.#networkRetainedBytes + metadataBytes <= MAX_NETWORK_RETAINED_BYTES_PER_TEST) {
        this.#network.push(metadataOnly);
        this.#networkRetainedBytes += metadataBytes;
      }
      return;
    }
    this.#network.push(clone);
    this.#networkRetainedBytes += retainedBytes;
    this.#networkMaterialCount += clone.materials.length;
  }

  addConsole(sink: RawConsoleSink): void {
    if (!this.#active) return;
    if (this.#console.length >= MAX_CONSOLE_SINKS_PER_TEST) {
      this.#limitsReached.add("console");
      return;
    }
    const clone = cloneConsole(sink);
    const retainedBytes = retainedConsoleBytes(clone);
    if (this.#consoleRetainedBytes + retainedBytes > MAX_CONSOLE_RETAINED_BYTES_PER_TEST) {
      this.#limitsReached.add("console");
      return;
    }
    this.#console.push(clone);
    this.#consoleRetainedBytes += retainedBytes;
  }

  addStorage(value: unknown): void {
    if (!this.#active) return;
    const sink = parseStorageSink(value);
    if (sink === undefined) return;

    const identity = JSON.stringify([
      sink.storageType,
      sink.key,
      sink.value,
      sink.pageUrl,
      sink.observedBy,
    ]);
    if (this.#storageIdentities.has(identity)) return;
    if (this.#storage.length >= MAX_STORAGE_SINKS_PER_TEST) {
      this.#limitsReached.add("storage");
      return;
    }
    const retainedBytes = retainedStorageBytes(sink);
    if (this.#storageRetainedBytes + retainedBytes > MAX_STORAGE_RETAINED_BYTES_PER_TEST) {
      this.#limitsReached.add("storage");
      return;
    }
    this.#storageIdentities.add(identity);
    this.#storage.push(sink);
    this.#storageRetainedBytes += retainedBytes;
  }

  markLimitReached(collector: "network" | "console" | "storage"): void {
    if (this.#active) this.#limitsReached.add(collector);
  }

  recordStorageStreamEvent(value: unknown): void {
    if (
      !this.#active ||
      !isRecord(value) ||
      value.version !== 1 ||
      value.token !== this.#streamToken
    ) {
      return;
    }
    if (value.kind === "limit-reached") {
      this.#limitsReached.add("storage");
      return;
    }
    if (value.kind === "storage-write") this.addStorage(value.sink);
  }

  snapshot(): SinkRegistrySnapshot {
    return {
      network: this.#network.map(cloneNetwork),
      console: this.#console.map(cloneConsole),
      storage: this.#storage.map(cloneStorage),
      limitsReached: Array.from(this.#limitsReached),
    };
  }

  dispose(): void {
    this.#active = false;
    this.#network.length = 0;
    this.#console.length = 0;
    this.#storage.length = 0;
    this.#storageIdentities.clear();
    this.#limitsReached.clear();
    this.#networkRetainedBytes = 0;
    this.#networkMaterialCount = 0;
    this.#consoleRetainedBytes = 0;
    this.#storageRetainedBytes = 0;
    this.#streamToken = "";
  }
}
