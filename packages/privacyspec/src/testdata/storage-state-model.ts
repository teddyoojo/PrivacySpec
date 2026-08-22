export const STORAGE_STATE_SCAN_SCHEMA_VERSION = 1 as const;

export const PLAYWRIGHT_AUTH_STATE_GUIDANCE_URL = "https://playwright.dev/docs/auth" as const;

export type StorageStateScanFormat = "terminal" | "json" | "markdown";

export type StorageStateRepositoryStatus = "TRACKED" | "IGNORED" | "UNTRACKED" | "GIT_UNAVAILABLE";

export type StorageStateFindingStatus = "REVIEW_REQUIRED" | "INFORMATIONAL";

export interface StorageStateStructure {
  cookieCount: number;
  originCount: number;
  localStorageEntryCount: number;
}

export interface StorageStateCredentialEvidence {
  present: boolean;
  credentialNamedCookieCount: number;
  httpOnlyCookieCount: number;
  credentialNamedLocalStorageEntryCount: number;
}

export interface StorageStatePersonalDataShapes {
  emailValueCount: number;
  phoneValueCount: number;
}

export interface StorageStateFileObservation {
  input: number;
  repositoryStatus: StorageStateRepositoryStatus;
  findingStatus: StorageStateFindingStatus;
  structure: StorageStateStructure;
  credentialEvidence: StorageStateCredentialEvidence;
  personalDataShapes: StorageStatePersonalDataShapes;
}

export interface StorageStateScanSummary {
  files: number;
  reviewRequired: number;
  informational: number;
  credentialBearingFiles: number;
  personalDataShapedFiles: number;
  repositoryStatus: {
    tracked: number;
    ignored: number;
    untracked: number;
    gitUnavailable: number;
  };
}

export interface PrivacySpecStorageStateScan {
  storageStateScanSchemaVersion: typeof STORAGE_STATE_SCAN_SCHEMA_VERSION;
  tool: {
    name: "privacyspec";
    version: string;
  };
  scope: {
    explicitlySuppliedFiles: number;
    scannedFiles: number;
    repositoryCrawl: false;
    symlinksFollowed: false;
  };
  summary: StorageStateScanSummary;
  files: StorageStateFileObservation[];
  technicalBasis: {
    source: typeof PLAYWRIGHT_AUTH_STATE_GUIDANCE_URL;
    statement: string;
  };
  limitations: string[];
}
