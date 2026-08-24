import { correlateSensitiveData, MAX_PAGE_URLS_PER_TEST } from "../../correlate/match.js";
import type { FirstPartyConfig } from "../../correlate/model.js";
import type { NormalizedCustomDomSourceClassifier } from "../../discovery/custom-classifiers.js";
import { sanitizeSensitiveSources } from "../../discovery/sanitize-sources.js";
import {
  type SensitiveSourceAddResult,
  SensitiveValueRegistry,
} from "../../discovery/sensitive-registry.js";
import type { PrivacySpecObservation } from "../../observation-model.js";
import { sanitizeSinkSnapshot } from "../../observe/sanitize-sinks.js";
import { SinkRunRegistry } from "../../observe/sink-registry.js";
import { evaluateDataFlows } from "../../rules/engine.js";
import type { Analyzer, AnalyzerContext, AnalyzerDiagnostic } from "../../runtime/analyzer.js";
import type { AnalyzerCapabilityCoverage } from "../../runtime/capabilities.js";
import type { RuntimeEvent } from "../../runtime/events.js";
import { PRIVACY_ANALYSIS_MODULE } from "../../runtime/modules.js";
import { browserInputEmailSources, createTestDataObservations } from "../../testdata/classify.js";
import { createTestDataAttachment } from "../../testdata/create.js";
import type { PrivacySpecTestDataAttachment } from "../../testdata/model.js";

export const PRIVACY_ANALYZER_ID = PRIVACY_ANALYSIS_MODULE.id;

export interface PrivacyAnalyzerOptions {
  firstParty: FirstPartyConfig;
  allowInsecureOrigins?: readonly string[] | undefined;
  syntheticEmailDomains: readonly string[];
  customClassifiers?: readonly NormalizedCustomDomSourceClassifier[] | undefined;
}

export interface PrivacyAnalyzerEventResult {
  responseSources?: SensitiveSourceAddResult[] | undefined;
}

export interface PrivacyAnalyzerTestResult {
  analyzerId: typeof PRIVACY_ANALYZER_ID;
  coverage: AnalyzerCapabilityCoverage;
  observations: PrivacySpecObservation[];
  testData: PrivacySpecTestDataAttachment;
}

export interface PrivacyAnalyzerFailureDiagnostic {
  kind: "diagnostic";
  code: "PS_ANALYZER_PRIVACY_FAILED";
  classification: "informational";
  message: string;
}

const withEventSequence = <Value extends { timestamp: number }>(
  value: Value,
  sequence: number,
): Value => ({ ...value, timestamp: sequence });

const partialCoverage = (coverage: AnalyzerCapabilityCoverage): AnalyzerCapabilityCoverage =>
  coverage.status === "complete" ? { ...coverage, status: "partial" } : coverage;

export class PrivacyRuntimeAnalyzer implements Analyzer {
  readonly id = PRIVACY_ANALYZER_ID;
  readonly capabilities = Object.freeze({
    required: [
      "network",
      "console",
      "storage",
      "cookies",
      "custom-contexts",
      "sensitive-sources",
      "browser-engine",
      "api-requests",
    ] as const,
    optional: ["responses", "response-bodies"] as const,
  });
  readonly #sources: SensitiveValueRegistry;
  readonly #sinks = new SinkRunRegistry();
  readonly #pageUrls: string[] = [];

  constructor(private readonly options: PrivacyAnalyzerOptions) {
    this.#sources = new SensitiveValueRegistry(options.customClassifiers);
  }

  hasSensitiveSources(): boolean {
    return this.#sources.hasSources();
  }

  onEvent(event: RuntimeEvent): PrivacyAnalyzerEventResult | undefined {
    switch (event.type) {
      case "sensitive-source":
        if (event.source.kind === "response-json") {
          return {
            responseSources: [
              this.#sources.addResponse(withEventSequence(event.source, event.meta.seq)),
            ],
          };
        }
        this.#sources.add(withEventSequence(event.source, event.meta.seq));
        return undefined;
      case "response":
        return {
          responseSources: event.sources.map((source) =>
            this.#sources.addResponse(withEventSequence(source, event.meta.seq)),
          ),
        };
      case "request":
        if (event.sink !== undefined) {
          this.#sinks.addNetwork(withEventSequence(event.sink, event.meta.seq));
        }
        return undefined;
      case "console":
        this.#sinks.addConsole(withEventSequence(event.sink, event.meta.seq));
        return undefined;
      case "storage":
      case "cookie":
        this.#sinks.addStorage(withEventSequence(event.sink, event.meta.seq));
        return undefined;
      case "page-url-snapshot":
        if (this.#pageUrls.length <= MAX_PAGE_URLS_PER_TEST) this.#pageUrls.push(event.url);
        return undefined;
      case "collector-limit":
        this.#sinks.markLimitReached(event.collector);
        return undefined;
      case "sensitive-source-limit":
        this.#sources.markLimitReached();
        return undefined;
      case "sensitive-source-ambiguous":
        this.#sources.markCustomClassificationAmbiguous();
        return undefined;
      case "context-created":
      case "page-created":
      case "navigation":
      case "page-error":
      case "security-response":
      case "security-cookie":
        return undefined;
    }
  }

  finalizeTest(context: AnalyzerContext): PrivacyAnalyzerTestResult {
    const sourceSnapshot = this.#sources.snapshot();
    const sinkSnapshot = this.#sinks.snapshot();
    const rawSinks = [...sinkSnapshot.network, ...sinkSnapshot.console, ...sinkSnapshot.storage];
    const test = {
      file: context.test.file,
      title: context.test.title,
      project: context.test.projectName,
    };
    const correlation = correlateSensitiveData({
      sources: sourceSnapshot.sources,
      sinks: rawSinks,
      pageUrls: this.#pageUrls,
      firstParty: this.options.firstParty,
      test,
    });
    const testDataObservations = createTestDataObservations(
      browserInputEmailSources(sourceSnapshot.sources),
      this.options.syntheticEmailDomains,
      test,
    );
    const findings = evaluateDataFlows(correlation.flows, {
      allowInsecureOrigins: this.options.allowInsecureOrigins,
    });
    const observations: PrivacySpecObservation[] = [
      ...sanitizeSensitiveSources(
        sourceSnapshot.sources,
        sourceSnapshot.limitReached,
        sourceSnapshot.customClassificationAmbiguous,
      ),
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
    const reachedLimit =
      sourceSnapshot.limitReached ||
      sourceSnapshot.customClassificationAmbiguous ||
      sinkSnapshot.limitsReached.length > 0 ||
      correlation.limitReached;
    const result: PrivacyAnalyzerTestResult = {
      analyzerId: PRIVACY_ANALYZER_ID,
      coverage: reachedLimit
        ? partialCoverage(context.capabilityCoverage)
        : context.capabilityCoverage,
      observations,
      testData: createTestDataAttachment(testDataObservations),
    };
    sourceSnapshot.sources.length = 0;
    sinkSnapshot.network.length = 0;
    sinkSnapshot.console.length = 0;
    sinkSnapshot.storage.length = 0;
    return result;
  }

  dispose(): void {
    this.#sources.dispose();
    this.#sinks.dispose();
    this.#pageUrls.length = 0;
  }
}

export const privacyAnalyzerFailureDiagnostics = (
  diagnostics: readonly AnalyzerDiagnostic[],
): PrivacyAnalyzerFailureDiagnostic[] =>
  diagnostics.some((diagnostic) => diagnostic.analyzerId === PRIVACY_ANALYZER_ID)
    ? [
        {
          kind: "diagnostic",
          code: "PS_ANALYZER_PRIVACY_FAILED",
          classification: "informational",
          message: "The privacy analyzer failed inside the bounded runtime analyzer host.",
        },
      ]
    : [];
