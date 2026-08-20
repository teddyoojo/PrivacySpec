import type { BrowserContext, ConsoleMessage, JSHandle } from "@playwright/test";
import type { RawConsoleSink, RawSinkMaterial } from "./sink-model.js";
import { MAX_CONSOLE_SINKS_PER_TEST, type SinkRunRegistry } from "./sink-registry.js";

const MAX_CONSOLE_ARGUMENTS = 20;
const MAX_CONSOLE_VALUE_LENGTH = 65_536;
const MAX_CONSOLE_DEPTH = 5;
const MAX_CONSOLE_NODES = 200;
const CONSOLE_ARGUMENT_TIMEOUT_MS = 250;

interface ConsoleSerializationLimits {
  maxDepth: number;
  maxNodes: number;
  maxLength: number;
}

export const serializeConsoleValueInPage = (
  root: unknown,
  limits: ConsoleSerializationLimits,
): string => {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const safeString = (value: unknown): string => {
    try {
      return String(value).slice(0, limits.maxLength);
    } catch {
      return "[unserializable]";
    }
  };
  const boundedClone = (value: unknown, depth = 0): unknown => {
    if (nodes >= limits.maxNodes || depth > limits.maxDepth) return "[truncated]";
    nodes += 1;
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") return value.slice(0, limits.maxLength);
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "object") return safeString(value);
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      const clone: unknown[] = [];
      let length = 0;
      let sourceLength = 0;
      try {
        sourceLength = value.length;
        length = Math.min(sourceLength, limits.maxNodes);
      } catch {
        return "[unserializable]";
      }
      for (let index = 0; index < length && nodes < limits.maxNodes; index += 1) {
        try {
          clone.push(boundedClone(value[index], depth + 1));
        } catch {
          clone.push("[unserializable]");
        }
      }
      if (clone.length < sourceLength) clone.unshift("[truncated]");
      return clone;
    }

    const clone: Record<string, unknown> = {};
    let propertyCount = 0;
    try {
      for (const key in value as Record<string, unknown>) {
        if (nodes >= limits.maxNodes || propertyCount >= limits.maxNodes) break;
        if (!Object.hasOwn(value, key)) continue;
        propertyCount += 1;
        try {
          clone[key.slice(0, 200)] = boundedClone(
            (value as Record<string, unknown>)[key],
            depth + 1,
          );
        } catch {
          clone[key.slice(0, 200)] = "[unserializable]";
        }
      }
    } catch {
      return "[unserializable]";
    }
    return clone;
  };

  if (typeof root === "string") return root.slice(0, limits.maxLength);
  try {
    const serialized = JSON.stringify(boundedClone(root));
    return (serialized ?? safeString(root)).slice(0, limits.maxLength);
  } catch {
    return safeString(root);
  }
};

const readConsoleArgument = (handle: JSHandle): Promise<string> =>
  new Promise((resolve) => {
    let settled = false;
    const fallback = (() => {
      try {
        return handle.toString().slice(0, MAX_CONSOLE_VALUE_LENGTH);
      } catch {
        return "[unserializable]";
      }
    })();
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), CONSOLE_ARGUMENT_TIMEOUT_MS);
    try {
      handle
        .evaluate(serializeConsoleValueInPage, {
          maxDepth: MAX_CONSOLE_DEPTH,
          maxNodes: MAX_CONSOLE_NODES,
          maxLength: MAX_CONSOLE_VALUE_LENGTH,
        })
        .then(
          (value) => finish(value),
          () => finish(fallback),
        );
    } catch {
      finish(fallback);
    }
  });

const captureConsoleMessage = async (message: ConsoleMessage): Promise<RawConsoleSink> => {
  const handles = message.args();
  const materials: RawSinkMaterial[] = await Promise.all(
    handles.slice(0, MAX_CONSOLE_ARGUMENTS).map(async (handle, index) => ({
      location: `console.argument.${index}`,
      value: await readConsoleArgument(handle),
    })),
  );
  const renderedText = message.text().slice(0, MAX_CONSOLE_VALUE_LENGTH);
  if (renderedText.length > 0) {
    materials.push({
      location: "console.text",
      value: renderedText,
    });
  }

  const location = message.location();
  return {
    kind: "console",
    level: message.type(),
    materials,
    argumentCount: handles.length,
    pageUrl: message.page()?.url(),
    sourceUrl: location.url || undefined,
    timestamp: message.timestamp(),
  };
};

export class ConsoleObserver {
  readonly #pending = new Set<Promise<void>>();
  #accepted = 0;
  #context: BrowserContext | undefined;
  readonly #listener: (message: ConsoleMessage) => void;

  constructor(private readonly registry: SinkRunRegistry) {
    this.#listener = (message) => {
      if (this.#accepted >= MAX_CONSOLE_SINKS_PER_TEST) {
        this.registry.markLimitReached("console");
        return;
      }
      this.#accepted += 1;
      let operation: Promise<void>;
      operation = captureConsoleMessage(message)
        .then((sink) => this.registry.addConsole(sink))
        .catch(() => {
          // Handles may be destroyed by navigation before serialization completes.
        })
        .finally(() => this.#pending.delete(operation));
      this.#pending.add(operation);
    };
  }

  attach(context: BrowserContext): void {
    this.#context = context;
    context.on("console", this.#listener);
  }

  async flush(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled(Array.from(this.#pending));
    }
  }

  detach(): void {
    this.#context?.off("console", this.#listener);
    this.#context = undefined;
  }
}
