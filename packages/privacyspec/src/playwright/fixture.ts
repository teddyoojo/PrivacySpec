import { relative } from "node:path";
import type { BrowserContext, TestType } from "@playwright/test";
import { correlateSensitiveData, MAX_PAGE_URLS_PER_TEST } from "../correlate/match.js";
import type { FirstPartyConfig } from "../correlate/model.js";
import { sanitizeSensitiveSources } from "../discovery/sanitize-sources.js";
import { SensitiveValueRegistry } from "../discovery/sensitive-registry.js";
import type { PrivacySpecObservation } from "../observation-model.js";
import { ConsoleObserver } from "../observe/console.js";
import { NetworkObserver } from "../observe/network.js";
import { sanitizeSinkSnapshot } from "../observe/sanitize-sinks.js";
import { SinkRunRegistry } from "../observe/sink-registry.js";
import {
  collectFinalStorage,
  createStorageObserverScript,
  STORAGE_STREAM_BINDING,
} from "../observe/storage.js";
import { evaluateDataFlows } from "../rules/engine.js";
import {
  collectSensitiveSources,
  createBrowserObserverScript,
  SOURCE_STREAM_BINDING,
} from "./browser-observer.js";
import {
  createPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "./result.js";

interface AutomaticPrivacySpecFixture {
  __conformTestAutomatic: undefined;
}

interface BrowserContextFixture {
  context: BrowserContext;
}

interface DisposableLike {
  dispose(): Promise<void>;
}

const isDisposableLike = (resource: unknown): resource is DisposableLike =>
  typeof resource === "object" &&
  resource !== null &&
  "dispose" in resource &&
  typeof resource.dispose === "function";

export const disposePlaywrightResources = async (resources: readonly unknown[]): Promise<void> => {
  const availableResources = resources.filter(isDisposableLike);
  await Promise.allSettled(availableResources.map((resource) => resource.dispose()));
};

export interface PrivacySpecOptions {
  firstParty?: FirstPartyConfig | undefined;
  dev?:
    | {
        allowInsecureOrigins?: readonly string[] | undefined;
      }
    | undefined;
}

export const withPrivacySpec = <TestArgs extends {}, WorkerArgs extends {}>(
  baseTest: TestType<TestArgs, WorkerArgs>,
  options: PrivacySpecOptions = {},
): TestType<TestArgs, WorkerArgs> => {
  const extensibleTest = baseTest as unknown as TestType<
    BrowserContextFixture,
    Record<never, never>
  >;
  const extendedTest = extensibleTest.extend<AutomaticPrivacySpecFixture>({
    __conformTestAutomatic: [
      async ({ context }, use, testInfo) => {
        const registry = new SensitiveValueRegistry();
        const sinkRegistry = new SinkRunRegistry();
        const networkObserver = new NetworkObserver(sinkRegistry);
        const consoleObserver = new ConsoleObserver(sinkRegistry);
        const disposables: unknown[] = [];
        try {
          networkObserver.attach(context);
          consoleObserver.attach(context);
          disposables.push(
            await context.exposeBinding(SOURCE_STREAM_BINDING, (_source, event) => {
              registry.recordStreamEvent(event);
            }),
          );
          disposables.push(
            await context.exposeBinding(STORAGE_STREAM_BINDING, (_source, event) => {
              sinkRegistry.recordStorageStreamEvent(event);
            }),
          );
          disposables.push(
            await context.addInitScript({
              content: createBrowserObserverScript(registry.streamToken),
            }),
          );
          disposables.push(
            await context.addInitScript({
              content: createStorageObserverScript(sinkRegistry.streamToken),
            }),
          );
          await use(undefined);
        } finally {
          networkObserver.detach();
          consoleObserver.detach();
          try {
            const fallback = await collectSensitiveSources(context);
            for (const source of fallback.sources) registry.add(source);
            if (fallback.limitReached) {
              registry.recordStreamEvent({
                version: 1,
                token: registry.streamToken,
                kind: "limit-reached",
              });
            }
            await Promise.all([networkObserver.flush(), consoleObserver.flush()]);
            const finalStorage = await collectFinalStorage(context);
            for (const sink of finalStorage.sinks) sinkRegistry.addStorage(sink);
            if (finalStorage.limitReached) sinkRegistry.markLimitReached("storage");

            const sourceSnapshot = registry.snapshot();
            const sinkSnapshot = sinkRegistry.snapshot();
            const rawSinks = [
              ...sinkSnapshot.network,
              ...sinkSnapshot.console,
              ...sinkSnapshot.storage,
            ];
            const pages = context.pages();
            const pageUrls = pages.slice(0, MAX_PAGE_URLS_PER_TEST + 1).map((page) => page.url());
            const configuredBaseUrl = testInfo.project.use.baseURL;
            const firstParty: FirstPartyConfig = {
              origins: [
                ...(options.firstParty?.origins ?? []),
                ...(typeof configuredBaseUrl === "string" ? [configuredBaseUrl] : []),
              ],
              hosts: options.firstParty?.hosts ?? [],
            };
            const correlation = correlateSensitiveData({
              sources: sourceSnapshot.sources,
              sinks: rawSinks,
              pageUrls,
              firstParty,
              test: {
                file: relative(testInfo.config.rootDir, testInfo.file),
                title: testInfo.titlePath.slice(1).join(" › ") || testInfo.title,
                project: testInfo.project.name,
              },
            });
            const findings = evaluateDataFlows(correlation.flows, {
              allowInsecureOrigins: options.dev?.allowInsecureOrigins,
            });
            const observations: PrivacySpecObservation[] = [
              ...sanitizeSensitiveSources(sourceSnapshot.sources, sourceSnapshot.limitReached),
              ...sanitizeSinkSnapshot(sinkSnapshot, sourceSnapshot.sources),
              ...correlation.flows,
              ...findings,
            ];
            if (correlation.limitReached) {
              observations.push({
                kind: "diagnostic",
                code: "PS_CORRELATION_LIMIT_REACHED",
                classification: "informational",
                message: "Sensitive data correlation reached its per-test safety limit.",
              });
            }
            sourceSnapshot.sources.length = 0;
            sinkSnapshot.network.length = 0;
            sinkSnapshot.console.length = 0;
            sinkSnapshot.storage.length = 0;
            const result = createPrivacySpecResult(observations);
            await testInfo.attach(PRIVACYSPEC_ATTACHMENT_NAME, {
              body: JSON.stringify(result),
              contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
            });
          } finally {
            registry.dispose();
            sinkRegistry.dispose();
            await disposePlaywrightResources(disposables);
          }
        }
      },
      { auto: true },
    ],
  });

  return extendedTest as unknown as TestType<TestArgs, WorkerArgs>;
};
