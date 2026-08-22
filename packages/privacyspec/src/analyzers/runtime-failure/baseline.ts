import { compareCanonicalStrings } from "../../canonical-order.js";
import { createRuntimeFailureKey } from "./analyzer.js";
import type {
  RuntimeFailureBaselineComparison,
  RuntimeFailureBaselineEntry,
  RuntimeFailureBaselineFile,
  RuntimeFailureFinding,
  RuntimeFailureInventoryEntry,
} from "./model.js";

export const createRuntimeFailureBaselineEntries = (
  inventory: readonly RuntimeFailureInventoryEntry[],
): RuntimeFailureBaselineEntry[] =>
  inventory
    .map(({ firstSeenTests: _tests, occurrenceCount: _count, kind: _kind, ...entry }) => ({
      ...entry,
      status: "accepted" as const,
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));

const ruleFor: Readonly<
  Record<RuntimeFailureInventoryEntry["failureType"], RuntimeFailureFinding["ruleId"]>
> = {
  "page-error": "RUNTIME_PAGE_ERROR",
  "console-error": "RUNTIME_CONSOLE_ERROR",
  "request-failed": "RUNTIME_REQUEST_FAILED",
  "http-5xx": "RUNTIME_HTTP_5XX",
};

export const compareRuntimeFailureBaseline = (
  inventory: readonly RuntimeFailureInventoryEntry[],
  baseline?: RuntimeFailureBaselineFile,
): RuntimeFailureBaselineComparison => {
  const observed = createRuntimeFailureBaselineEntries(inventory);
  const acceptedByKey = new Map((baseline?.entries ?? []).map((entry) => [entry.key, entry]));
  const observedKeys = new Set(observed.map((entry) => entry.key));
  const inventoryByKey = new Map(inventory.map((entry) => [entry.key, entry]));
  const known = observed.filter((entry) => acceptedByKey.has(entry.key));
  const newlyObserved = observed.filter((entry) => !acceptedByKey.has(entry.key));
  const resolved = (baseline?.entries ?? [])
    .filter((entry) => !observedKeys.has(entry.key))
    .slice()
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));
  const findings: RuntimeFailureFinding[] = [];
  for (const entry of newlyObserved) {
    const occurrence = inventoryByKey.get(entry.key);
    const test = occurrence?.firstSeenTests[0];
    if (occurrence === undefined || test === undefined) continue;
    if (createRuntimeFailureKey({ failureType: entry.failureType, details: entry }) !== entry.key) {
      throw new TypeError("runtime failure semantic identity is inconsistent");
    }
    findings.push({
      kind: "runtime-failure-finding",
      ruleId: ruleFor[entry.failureType],
      classification: entry.severity === "ERROR" ? "TECHNICAL_FAILURE" : "REVIEW_REQUIRED",
      identity: entry.key,
      failureType: entry.failureType,
      severity: entry.severity,
      summary: entry.summary,
      boundary: entry.boundary,
      host: entry.host,
      method: entry.method,
      endpoint: entry.endpoint,
      httpStatus: entry.httpStatus,
      errorName: entry.errorName,
      signature: entry.signature,
      failureCode: entry.failureCode,
      firstSeenTest: { ...test },
      occurrenceCount: occurrence.occurrenceCount,
    });
  }
  findings.sort((left, right) => compareCanonicalStrings(left.identity, right.identity));
  return { observed, known, new: newlyObserved, resolved, findings };
};
