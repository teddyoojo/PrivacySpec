export type NetworkBodyKind = "none" | "json" | "form" | "text" | "multipart" | "binary";
export type StorageType = "local-storage" | "session-storage" | "cookie";

export interface RawSinkMaterial {
  location: string;
  value: string;
}

export interface RawNetworkSink {
  kind: "network";
  url: string;
  method: string;
  resourceType: string;
  headers: Record<string, string>;
  bodyKind: NetworkBodyKind;
  bodySize: number;
  bodyTruncated: boolean;
  materials: RawSinkMaterial[];
  frameUrl?: string | undefined;
  pageUrl?: string | undefined;
  timestamp: number;
  requestIdentity?: number | undefined;
}

export interface RawConsoleSink {
  kind: "console";
  level: string;
  materials: RawSinkMaterial[];
  argumentCount: number;
  pageUrl?: string | undefined;
  sourceUrl?: string | undefined;
  timestamp: number;
}

export interface RawStorageSink {
  kind: "storage";
  storageType: StorageType;
  key: string;
  value: string;
  pageUrl: string;
  observedBy: "write" | "snapshot";
  timestamp: number;
}

export type RawSink = RawNetworkSink | RawConsoleSink | RawStorageSink;

export interface SanitizedPageLocation {
  origin: string;
  path: string;
}

export interface NetworkSinkObservation {
  kind: "sink";
  sink: "network";
  method: string;
  resourceType: string;
  recipient: {
    origin: string;
    host: string;
  };
  endpoint: string;
  locations: string[];
  body: {
    kind: NetworkBodyKind;
    size: number;
    truncated: boolean;
  };
  page?: SanitizedPageLocation | undefined;
}

export interface ConsoleSinkObservation {
  kind: "sink";
  sink: "console";
  level: string;
  argumentCount: number;
  locations: string[];
  page?: SanitizedPageLocation | undefined;
}

export interface StorageSinkObservation {
  kind: "sink";
  sink: "storage";
  storageType: StorageType;
  key: string;
  observedBy: "write" | "snapshot";
  page: SanitizedPageLocation;
}

export interface SinkLimitDiagnostic {
  kind: "diagnostic";
  code: "PS_SINK_LIMIT_REACHED";
  classification: "informational";
  collector: "network" | "console" | "storage";
  message: string;
}

export type SinkObservation =
  | NetworkSinkObservation
  | ConsoleSinkObservation
  | StorageSinkObservation
  | SinkLimitDiagnostic;
