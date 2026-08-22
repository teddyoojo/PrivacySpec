import { relative } from "node:path";
import type { Browser, BrowserContext, Page, Request, Response, TestType } from "@playwright/test";
import {
  DependencyRuntimeAnalyzer,
  dependencyAnalyzerFailed,
} from "../analyzers/dependency/analyzer.js";
import {
  createDependencyAttachment,
  DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
  DEPENDENCY_ATTACHMENT_NAME,
} from "../analyzers/dependency/artifact.js";
import {
  DEPENDENCY_ANALYZER_ID,
  type DependencyAnalyzerTestResult,
} from "../analyzers/dependency/model.js";
import {
  PRIVACY_ANALYZER_ID,
  type PrivacyAnalyzerTestResult,
  PrivacyRuntimeAnalyzer,
  privacyAnalyzerFailureDiagnostics,
} from "../analyzers/privacy/analyzer.js";
import {
  RuntimeFailureAnalyzer,
  runtimeFailureAnalyzerFailed,
} from "../analyzers/runtime-failure/analyzer.js";
import {
  createRuntimeFailureAttachment,
  RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
  RUNTIME_FAILURE_ATTACHMENT_NAME,
} from "../analyzers/runtime-failure/artifact.js";
import {
  RUNTIME_FAILURE_ANALYZER_ID,
  type RuntimeFailureAnalyzerTestResult,
} from "../analyzers/runtime-failure/model.js";
import { SecurityPostureAnalyzer, securityAnalyzerFailed } from "../analyzers/security/analyzer.js";
import {
  createSecurityAttachment,
  SECURITY_ATTACHMENT_CONTENT_TYPE,
  SECURITY_ATTACHMENT_NAME,
} from "../analyzers/security/artifact.js";
import {
  SECURITY_ANALYZER_ID,
  type SecurityAnalyzerTestResult,
} from "../analyzers/security/model.js";
import { MAX_PAGE_URLS_PER_TEST } from "../correlate/match.js";
import type { FirstPartyConfig } from "../correlate/model.js";
import { createResponseJsonCoverage } from "../discovery/response-json.js";
import type { PrivacySpecObservation } from "../observation-model.js";
import { ConsoleObserver } from "../observe/console.js";
import { NetworkObserver } from "../observe/network.js";
import { SecurityResponseObserver } from "../observe/response-security.js";
import {
  collectFinalStorage,
  createStorageObserverScript,
  STORAGE_STREAM_BINDING,
} from "../observe/storage.js";
import { AnalyzerHost, type AnalyzerHostResult } from "../runtime/analyzer.js";
import { createRuntimeCapabilityModel } from "../runtime/capabilities.js";
import { normalizeSyntheticEmailDomains } from "../testdata/classify.js";
import { createTestDataAttachment } from "../testdata/create.js";
import {
  collectSensitiveSources,
  createBrowserObserverScript,
  SOURCE_STREAM_BINDING,
} from "./browser-observer.js";
import { activatePlaywrightCoverage, createCoverageAwareBrowser } from "./coverage.js";
import { finalizationDiagnostics, PendingWorkRegistry } from "./finalization.js";
import { FirstPartyJsonResponseObserver } from "./response-observer.js";
import {
  createPrivacySpecResult,
  PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
  PRIVACYSPEC_ATTACHMENT_NAME,
} from "./result.js";
import { PlaywrightRuntimeEventAdapter } from "./runtime-events.js";

interface AutomaticPrivacySpecFixture {
  __conformTestAutomatic: undefined;
}

interface BrowserContextFixture {
  context: BrowserContext;
}

interface BrowserWorkerFixture {
  browser: Browser;
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
  sources?:
    | {
        firstPartyJsonResponses?: boolean | undefined;
      }
    | undefined;
  testData?:
    | {
        syntheticEmailDomains?: readonly string[] | undefined;
      }
    | undefined;
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
  const syntheticEmailDomains = normalizeSyntheticEmailDomains(
    options.testData?.syntheticEmailDomains,
  );
  const extensibleTest = baseTest as unknown as TestType<
    BrowserContextFixture,
    BrowserWorkerFixture
  >;
  const extendedTest = extensibleTest.extend<AutomaticPrivacySpecFixture>({
    browser: [
      async ({ browser }, use) => {
        await use(createCoverageAwareBrowser(browser));
      },
      { scope: "worker" },
    ],
    __conformTestAutomatic: [
      async ({ browser, context }, use, testInfo) => {
        const testMetadata = {
          testId:
            testInfo.testId ||
            JSON.stringify([testInfo.project.name, testInfo.file, testInfo.titlePath]),
          file: relative(testInfo.config.rootDir, testInfo.file),
          title: testInfo.titlePath.slice(1).join(" › ") || testInfo.title,
          projectName: testInfo.project.name,
        };
        const configuredBaseUrl = testInfo.project.use.baseURL;
        const firstParty: FirstPartyConfig = {
          origins: [
            ...(options.firstParty?.origins ?? []),
            ...(typeof configuredBaseUrl === "string" ? [configuredBaseUrl] : []),
          ],
          hosts: options.firstParty?.hosts ?? [],
        };
        const privacyAnalyzer = new PrivacyRuntimeAnalyzer({
          firstParty,
          allowInsecureOrigins: options.dev?.allowInsecureOrigins,
          syntheticEmailDomains,
        });
        const dependencyAnalyzer = new DependencyRuntimeAnalyzer(firstParty);
        const securityAnalyzer = new SecurityPostureAnalyzer(firstParty);
        const runtimeFailureAnalyzer = new RuntimeFailureAnalyzer(firstParty);
        const analyzerHost = new AnalyzerHost([
          privacyAnalyzer,
          dependencyAnalyzer,
          securityAnalyzer,
          runtimeFailureAnalyzer,
        ]);
        const runtimeEvents = new PlaywrightRuntimeEventAdapter(
          analyzerHost,
          privacyAnalyzer,
          context,
          testMetadata,
        );
        const pendingWork = new PendingWorkRegistry();
        let nextRequestIdentity = 0;
        const requestIdentities = new WeakMap<Request, number>();
        const identifyRequest = (request: Request): number => {
          const existing = requestIdentities.get(request);
          if (existing !== undefined) return existing;
          nextRequestIdentity += 1;
          requestIdentities.set(request, nextRequestIdentity);
          return nextRequestIdentity;
        };
        const networkObserver = new NetworkObserver(
          runtimeEvents,
          () => runtimeEvents.hasSensitiveSources(),
          (request) => runtimeEvents.reserveRequest(request),
          identifyRequest,
        );
        const consoleObserver = new ConsoleObserver(runtimeEvents, (message) =>
          runtimeEvents.reserveConsole(message),
        );
        const securityResponseObserver = new SecurityResponseObserver(runtimeEvents);
        const responseObserver =
          options.sources?.firstPartyJsonResponses === true
            ? new FirstPartyJsonResponseObserver(
                runtimeEvents,
                firstParty,
                (response) => runtimeEvents.reserveResponse(response),
                identifyRequest,
              )
            : undefined;
        const disposables: unknown[] = [];
        const playwrightCoverage = activatePlaywrightCoverage(browser, context, {
          context: (observedContext, instrumented) =>
            runtimeEvents.recordContext(observedContext, instrumented),
          page: (page, instrumented) => runtimeEvents.recordPage(page, instrumented),
          navigation: (page) => runtimeEvents.recordNavigation(page),
        });
        const instrumentedPages = new Set<Page>(context.pages());
        const pageErrorListeners = new Map<Page, (error: Error) => void>();
        const attachPageErrorListener = (page: Page): void => {
          if (pageErrorListeners.has(page)) return;
          const listener = (error: Error): void => runtimeEvents.recordPageError(page, error);
          pageErrorListeners.set(page, listener);
          page.on("pageerror", listener);
        };
        for (const page of instrumentedPages) attachPageErrorListener(page);
        const pageListener = (page: Page): void => {
          instrumentedPages.add(page);
          attachPageErrorListener(page);
        };
        const requestFailedListener = (request: Request): void =>
          runtimeEvents.recordRequestFailed(request);
        const responseListener = (response: Response): void =>
          runtimeEvents.recordHttpResponse(response);
        try {
          context.on("page", pageListener);
          context.on("requestfailed", requestFailedListener);
          context.on("response", responseListener);
          networkObserver.attach(context);
          consoleObserver.attach(context);
          securityResponseObserver.attach(context);
          responseObserver?.attach(context);
          disposables.push(
            await context.exposeBinding(SOURCE_STREAM_BINDING, (source, event) => {
              runtimeEvents.recordSensitiveSourceStreamEvent(source, event);
            }),
          );
          disposables.push(
            await context.exposeBinding(STORAGE_STREAM_BINDING, (source, event) => {
              runtimeEvents.recordStorageStreamEvent(source, event);
            }),
          );
          disposables.push(
            await context.addInitScript({
              content: createBrowserObserverScript(runtimeEvents.sourceStreamToken),
            }),
          );
          disposables.push(
            await context.addInitScript({
              content: createStorageObserverScript(runtimeEvents.storageStreamToken),
            }),
          );
          await use(undefined);
        } finally {
          networkObserver.detach();
          consoleObserver.detach();
          securityResponseObserver.detach();
          responseObserver?.detach();
          context.off("page", pageListener);
          context.off("requestfailed", requestFailedListener);
          context.off("response", responseListener);
          for (const [page, listener] of pageErrorListeners) page.off("pageerror", listener);
          pageErrorListeners.clear();
          playwrightCoverage.dispose();
          try {
            let acceptFinalizationResults = true;
            let observerWorkFailed = false;
            let analysisResult: AnalyzerHostResult | undefined;
            const observerOperations: Promise<void>[] = [];
            const trackObserverWork = (
              name:
                | "network"
                | "console"
                | "responses"
                | "security-responses"
                | "source-fallback"
                | "storage-snapshot",
              operation: Promise<unknown>,
            ): void => {
              const tracked = operation.then(
                () => undefined,
                (error) => {
                  observerWorkFailed = true;
                  throw error;
                },
              );
              observerOperations.push(tracked);
              pendingWork.track(name, tracked);
            };
            trackObserverWork("network", networkObserver.flush());
            trackObserverWork("console", consoleObserver.flush());
            trackObserverWork("security-responses", securityResponseObserver.flush());
            if (responseObserver !== undefined) {
              trackObserverWork("responses", responseObserver.flush());
            }
            trackObserverWork(
              "source-fallback",
              collectSensitiveSources(context).then((result) => {
                if (acceptFinalizationResults) {
                  for (const source of result.sources) {
                    runtimeEvents.recordSensitiveSource(source, context);
                  }
                  if (result.limitReached) runtimeEvents.markSensitiveSourceLimit();
                }
                result.sources.length = 0;
              }),
            );
            trackObserverWork(
              "storage-snapshot",
              collectFinalStorage(context).then((result) => {
                if (acceptFinalizationResults) {
                  for (const sink of result.sinks) runtimeEvents.recordStorage(sink, context);
                  for (const cookie of result.securityCookies) {
                    runtimeEvents.recordSecurityCookie(cookie);
                  }
                  if (result.limitReached) runtimeEvents.markStorageLimit();
                }
                result.sinks.length = 0;
                result.securityCookies.length = 0;
              }),
            );
            const analysisOperation = Promise.allSettled(observerOperations).then(async () => {
              if (!acceptFinalizationResults) return;
              for (const page of context.pages().slice(0, MAX_PAGE_URLS_PER_TEST + 1)) {
                runtimeEvents.recordPageUrl(page);
              }
              analyzerHost.closeEvents();
              await analyzerHost.flushEvents();
              if (!acceptFinalizationResults) return;
              const responseCoverage =
                responseObserver?.snapshot() ?? createResponseJsonCoverage(false);
              const observationCoverage = playwrightCoverage.tracker.snapshot();
              const completed = await analyzerHost.finalizeTest({
                test: testMetadata,
                capabilities: createRuntimeCapabilityModel({
                  observation: observationCoverage,
                  responseJson: responseCoverage,
                  observerWorkFailed,
                  responseHeaders: securityResponseObserver.snapshot(),
                }),
              });
              if (acceptFinalizationResults) analysisResult = completed;
            });
            pendingWork.track("analyzers", analysisOperation);
            const finalization = await pendingWork.drain();
            acceptFinalizationResults = false;
            runtimeEvents.dispose();
            analyzerHost.closeEvents();
            const privacyResult = analysisResult?.results.get(PRIVACY_ANALYZER_ID) as
              | PrivacyAnalyzerTestResult
              | undefined;
            const dependencyResult = analysisResult?.results.get(DEPENDENCY_ANALYZER_ID) as
              | DependencyAnalyzerTestResult
              | undefined;
            const securityResult = analysisResult?.results.get(SECURITY_ANALYZER_ID) as
              | SecurityAnalyzerTestResult
              | undefined;
            const runtimeFailureResult = analysisResult?.results.get(RUNTIME_FAILURE_ANALYZER_ID) as
              | RuntimeFailureAnalyzerTestResult
              | undefined;
            const analyzerDiagnostics = analysisResult?.diagnostics ?? analyzerHost.diagnostics();
            const observations: PrivacySpecObservation[] = [
              ...(privacyResult?.observations ?? []),
              ...finalizationDiagnostics(finalization),
              ...privacyAnalyzerFailureDiagnostics(analyzerDiagnostics),
            ];
            const responseCoverage =
              responseObserver?.snapshot() ?? createResponseJsonCoverage(false);
            const observationCoverage = playwrightCoverage.tracker.snapshot();
            const result = createPrivacySpecResult(
              observations,
              responseCoverage,
              privacyResult?.testData ?? createTestDataAttachment([]),
              {
                applicationContexts: instrumentedPages.size > 0 ? 1 : 0,
                pages: instrumentedPages.size,
              },
              networkObserver.snapshotCoverage(),
              observationCoverage,
            );
            await testInfo.attach(PRIVACYSPEC_ATTACHMENT_NAME, {
              body: JSON.stringify(result),
              contentType: PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE,
            });
            await testInfo.attach(DEPENDENCY_ATTACHMENT_NAME, {
              body: JSON.stringify(
                createDependencyAttachment(dependencyResult, {
                  failed: dependencyAnalyzerFailed(analyzerDiagnostics),
                }),
              ),
              contentType: DEPENDENCY_ATTACHMENT_CONTENT_TYPE,
            });
            await testInfo.attach(SECURITY_ATTACHMENT_NAME, {
              body: JSON.stringify(
                createSecurityAttachment(securityResult, {
                  failed: securityAnalyzerFailed(analyzerDiagnostics),
                }),
              ),
              contentType: SECURITY_ATTACHMENT_CONTENT_TYPE,
            });
            await testInfo.attach(RUNTIME_FAILURE_ATTACHMENT_NAME, {
              body: JSON.stringify(
                createRuntimeFailureAttachment(runtimeFailureResult, {
                  failed: runtimeFailureAnalyzerFailed(analyzerDiagnostics),
                }),
              ),
              contentType: RUNTIME_FAILURE_ATTACHMENT_CONTENT_TYPE,
            });
          } finally {
            playwrightCoverage.dispose();
            runtimeEvents.dispose();
            analyzerHost.dispose();
            await disposePlaywrightResources(disposables);
          }
        }
      },
      { auto: true },
    ],
  });

  return extendedTest as unknown as TestType<TestArgs, WorkerArgs>;
};
