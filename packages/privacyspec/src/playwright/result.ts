import {
  createResponseJsonCoverage,
  type ResponseJsonCoverage,
} from "../discovery/response-json.js";
import type { PrivacySpecObservation } from "../observation-model.js";
import type { NetworkObservationCoverage } from "../observe/network.js";
import { createTestDataAttachment } from "../testdata/create.js";
import type { PrivacySpecTestDataAttachment } from "../testdata/model.js";
import type { PlaywrightObservationCounters } from "./coverage.js";

export const PRIVACYSPEC_ATTACHMENT_NAME = "privacyspec-result";
export const PRIVACYSPEC_ATTACHMENT_CONTENT_TYPE = "application/json";
export const ATTACHMENT_SCHEMA_VERSION_V2 = 2 as const;
export const ATTACHMENT_SCHEMA_VERSION = 3 as const;

export interface PlaywrightInstrumentationCoverage {
  applicationContexts: 0 | 1;
  pages: number;
}

export interface PrivacySpecResultV1 {
  schemaVersion: 1;
  observations: PrivacySpecObservation[];
}

export interface PrivacySpecResultV2 {
  schemaVersion: typeof ATTACHMENT_SCHEMA_VERSION_V2;
  observations: PrivacySpecObservation[];
  coverage: {
    playwright: PlaywrightInstrumentationCoverage;
    network: NetworkObservationCoverage;
    firstPartyJsonResponses: ResponseJsonCoverage;
  };
  testData?: PrivacySpecTestDataAttachment | undefined;
}

export interface PrivacySpecResultV3 {
  schemaVersion: typeof ATTACHMENT_SCHEMA_VERSION;
  observations: PrivacySpecObservation[];
  coverage: PrivacySpecResultV2["coverage"] & {
    observation: PlaywrightObservationCounters;
  };
  testData?: PrivacySpecTestDataAttachment | undefined;
}

export type PrivacySpecResult = PrivacySpecResultV1 | PrivacySpecResultV2 | PrivacySpecResultV3;

export const createPrivacySpecResult = (
  observations: PrivacySpecObservation[] = [],
  responseCoverage: ResponseJsonCoverage = createResponseJsonCoverage(false),
  testData: PrivacySpecTestDataAttachment = createTestDataAttachment([]),
  playwrightCoverage: PlaywrightInstrumentationCoverage = {
    applicationContexts: 1,
    pages: 1,
  },
  networkCoverage: NetworkObservationCoverage = {
    requests: { seen: 0, accepted: 0, filteredLowValueStatic: 0 },
  },
  observationCoverage: PlaywrightObservationCounters = {
    browserObjects: { seen: 1 },
    contexts: { seen: 1, instrumented: 1 },
    pages: { seen: 1, instrumented: 1, storageCapable: 1 },
    events: { navigations: 0, network: 0, console: 0 },
  },
): PrivacySpecResultV3 => ({
  schemaVersion: ATTACHMENT_SCHEMA_VERSION,
  observations,
  coverage: {
    playwright: { ...playwrightCoverage },
    network: { requests: { ...networkCoverage.requests } },
    firstPartyJsonResponses: responseCoverage,
    observation: {
      browserObjects: { ...observationCoverage.browserObjects },
      contexts: { ...observationCoverage.contexts },
      pages: { ...observationCoverage.pages },
      events: { ...observationCoverage.events },
    },
  },
  testData,
});

export const createEmptyPrivacySpecResult = (): PrivacySpecResultV3 => createPrivacySpecResult();

export const isPrivacySpecResult = (value: unknown): value is PrivacySpecResult => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    schemaVersion?: unknown;
    observations?: unknown;
    coverage?: unknown;
  };
  if (!Array.isArray(candidate.observations)) return false;
  if (candidate.schemaVersion === 1) return true;
  return (
    (candidate.schemaVersion === ATTACHMENT_SCHEMA_VERSION_V2 ||
      candidate.schemaVersion === ATTACHMENT_SCHEMA_VERSION) &&
    typeof candidate.coverage === "object" &&
    candidate.coverage !== null
  );
};
