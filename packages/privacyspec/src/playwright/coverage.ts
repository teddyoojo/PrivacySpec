import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Frame,
  Page,
  Request,
} from "@playwright/test";

export interface PlaywrightObservationCounters {
  browserObjects: {
    seen: number;
  };
  contexts: {
    seen: number;
    instrumented: number;
  };
  pages: {
    seen: number;
    instrumented: number;
    storageCapable: number;
  };
  events: {
    navigations: number;
    network: number;
    console: number;
  };
}

interface ContextListeners {
  page: (page: Page) => void;
  request: (request: Request) => void;
  console: (message: ConsoleMessage) => void;
}

export interface PlaywrightCoverageEventObserver {
  context(context: BrowserContext, instrumented: boolean): void;
  page(page: Page, instrumented: boolean): void;
  navigation(page: Page): void;
}

const isStorageCapableUrl = (rawUrl: string): boolean => {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export class PlaywrightCoverageTracker {
  readonly #browsers = new Set<Browser>();
  readonly #contexts = new Set<BrowserContext>();
  readonly #instrumentedContexts = new Set<BrowserContext>();
  readonly #pages = new Set<Page>();
  readonly #instrumentedPages = new Set<Page>();
  readonly #storageCapablePages = new Set<Page>();
  readonly #contextListeners = new Map<BrowserContext, ContextListeners>();
  readonly #navigationListeners = new Map<Page, (frame: Frame) => void>();
  #navigations = 0;
  #networkEvents = 0;
  #consoleEvents = 0;

  constructor(private readonly eventObserver?: PlaywrightCoverageEventObserver) {}

  observeBrowser(browser: Browser): void {
    this.#browsers.add(browser);
  }

  observeContext(context: BrowserContext, instrumented: boolean): void {
    if (instrumented) this.#instrumentedContexts.add(context);

    if (!this.#contexts.has(context)) {
      this.#contexts.add(context);
      this.eventObserver?.context(context, instrumented);
      const listeners: ContextListeners = {
        page: (page) => {
          this.observePage(page, this.#instrumentedContexts.has(context));
        },
        request: () => {
          this.#networkEvents += 1;
        },
        console: () => {
          this.#consoleEvents += 1;
        },
      };
      context.on("page", listeners.page);
      context.on("request", listeners.request);
      context.on("console", listeners.console);
      this.#contextListeners.set(context, listeners);
    }

    for (const page of context.pages()) this.observePage(page, instrumented);
  }

  observePage(page: Page, instrumented: boolean): void {
    if (instrumented) this.#instrumentedPages.add(page);
    if (isStorageCapableUrl(page.url())) this.#storageCapablePages.add(page);
    if (this.#pages.has(page)) return;

    this.#pages.add(page);
    this.eventObserver?.page(page, instrumented);
    const listener = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      this.#navigations += 1;
      if (isStorageCapableUrl(frame.url())) this.#storageCapablePages.add(page);
      this.eventObserver?.navigation(page);
    };
    page.on("framenavigated", listener);
    this.#navigationListeners.set(page, listener);
  }

  snapshot(): PlaywrightObservationCounters {
    return {
      browserObjects: { seen: this.#browsers.size },
      contexts: {
        seen: this.#contexts.size,
        instrumented: this.#instrumentedContexts.size,
      },
      pages: {
        seen: this.#pages.size,
        instrumented: this.#instrumentedPages.size,
        storageCapable: this.#storageCapablePages.size,
      },
      events: {
        navigations: this.#navigations,
        network: this.#networkEvents,
        console: this.#consoleEvents,
      },
    };
  }

  dispose(): void {
    for (const [context, listeners] of this.#contextListeners) {
      context.off("page", listeners.page);
      context.off("request", listeners.request);
      context.off("console", listeners.console);
    }
    for (const [page, listener] of this.#navigationListeners) {
      page.off("framenavigated", listener);
    }
    this.#contextListeners.clear();
    this.#navigationListeners.clear();
  }
}

class BrowserCoverageController {
  #activeTracker: PlaywrightCoverageTracker | undefined;

  activate(tracker: PlaywrightCoverageTracker): void {
    if (this.#activeTracker !== undefined) {
      throw new Error("PrivacySpec browser coverage tracker is already active");
    }
    this.#activeTracker = tracker;
  }

  deactivate(tracker: PlaywrightCoverageTracker): void {
    if (this.#activeTracker === tracker) this.#activeTracker = undefined;
  }

  observeContext(context: BrowserContext): void {
    this.#activeTracker?.observeContext(context, false);
  }

  observePage(page: Page): void {
    this.#activeTracker?.observeContext(page.context(), false);
    this.#activeTracker?.observePage(page, false);
  }
}

const controllers = new WeakMap<Browser, BrowserCoverageController>();

export const createCoverageAwareBrowser = (browser: Browser): Browser => {
  const controller = new BrowserCoverageController();
  const boundMethods = new Map<PropertyKey, unknown>();
  const newContext: Browser["newContext"] = async (...args) => {
    const context = await browser.newContext(...args);
    controller.observeContext(context);
    return context;
  };
  const newPage: Browser["newPage"] = async (...args) => {
    const page = await browser.newPage(...args);
    controller.observePage(page);
    return page;
  };

  const proxy = new Proxy(browser, {
    get(target, property) {
      if (property === "newContext") return newContext;
      if (property === "newPage") return newPage;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const cached = boundMethods.get(property);
      if (cached !== undefined) return cached;
      const bound = value.bind(target);
      boundMethods.set(property, bound);
      return bound;
    },
  });
  controllers.set(proxy, controller);
  return proxy;
};

export const activatePlaywrightCoverage = (
  browser: Browser,
  instrumentedContext: BrowserContext,
  eventObserver?: PlaywrightCoverageEventObserver,
): { tracker: PlaywrightCoverageTracker; dispose: () => void } => {
  const tracker = new PlaywrightCoverageTracker(eventObserver);
  tracker.observeBrowser(browser);
  const controller = controllers.get(browser);
  controller?.activate(tracker);

  for (const context of browser.contexts()) {
    tracker.observeContext(context, context === instrumentedContext);
  }
  tracker.observeContext(instrumentedContext, true);

  return {
    tracker,
    dispose: () => {
      controller?.deactivate(tracker);
      tracker.dispose();
    },
  };
};
