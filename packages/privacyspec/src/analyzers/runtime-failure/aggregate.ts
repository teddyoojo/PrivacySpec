import { compareCanonicalStrings } from "../../canonical-order.js";
import type {
  RuntimeFailureCoverageStatus,
  RuntimeFailureInventoryEntry,
  RuntimeFailureTestReference,
} from "./model.js";

export const MAX_RUNTIME_FAILURE_SUITE_IDENTITIES = 10_000;
export const MAX_RUNTIME_FAILURE_TEST_REFERENCES = 20;

const coverageRank: Readonly<Record<RuntimeFailureCoverageStatus, number>> = {
  complete: 0,
  partial: 1,
  incomplete: 2,
  unsupported: 3,
};

export const leastCompleteRuntimeFailureCoverage = (
  left: RuntimeFailureCoverageStatus,
  right: RuntimeFailureCoverageStatus,
): RuntimeFailureCoverageStatus => (coverageRank[left] >= coverageRank[right] ? left : right);

const testKey = (test: RuntimeFailureTestReference): string =>
  JSON.stringify([test.file, test.project]);

const compareTestReferences = (
  left: RuntimeFailureTestReference,
  right: RuntimeFailureTestReference,
): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

export const mergeRuntimeFailureInventory = (
  target: Map<string, RuntimeFailureInventoryEntry>,
  incoming: readonly RuntimeFailureInventoryEntry[],
): boolean => {
  let limitReached = false;
  for (const entry of incoming) {
    const existing = target.get(entry.key);
    if (existing === undefined) {
      if (target.size >= MAX_RUNTIME_FAILURE_SUITE_IDENTITIES) {
        limitReached = true;
        continue;
      }
      target.set(entry.key, {
        ...entry,
        firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })),
      });
      continue;
    }
    const stableExisting = { ...existing, firstSeenTests: [], occurrenceCount: 0 };
    const stableIncoming = { ...entry, firstSeenTests: [], occurrenceCount: 0 };
    if (JSON.stringify(stableExisting) !== JSON.stringify(stableIncoming)) {
      throw new TypeError("runtime failure identity metadata changed during aggregation");
    }
    existing.occurrenceCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      existing.occurrenceCount + entry.occurrenceCount,
    );
    const tests = new Map(existing.firstSeenTests.map((test) => [testKey(test), test]));
    for (const test of entry.firstSeenTests) tests.set(testKey(test), { ...test });
    existing.firstSeenTests = Array.from(tests.values())
      .sort(compareTestReferences)
      .slice(0, MAX_RUNTIME_FAILURE_TEST_REFERENCES);
  }
  return limitReached;
};

export const sortedRuntimeFailureInventory = (
  inventory: ReadonlyMap<string, RuntimeFailureInventoryEntry>,
): RuntimeFailureInventoryEntry[] =>
  Array.from(inventory.values())
    .map((entry) => ({
      ...entry,
      firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })).sort(compareTestReferences),
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));
