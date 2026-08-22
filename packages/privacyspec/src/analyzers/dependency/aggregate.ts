import { compareCanonicalStrings } from "../../canonical-order.js";
import type {
  DependencyCoverageStatus,
  DependencyTestReference,
  RuntimeDependencyInventoryEntry,
} from "./model.js";

export const MAX_DEPENDENCY_TEST_REFERENCES_PER_ORIGIN = 20;
export const MAX_DEPENDENCY_SUITE_ORIGINS = 10_000;

const coverageRank: Readonly<Record<DependencyCoverageStatus, number>> = {
  complete: 0,
  partial: 1,
  incomplete: 2,
  unsupported: 3,
};

export const leastCompleteDependencyCoverage = (
  left: DependencyCoverageStatus,
  right: DependencyCoverageStatus,
): DependencyCoverageStatus => (coverageRank[left] >= coverageRank[right] ? left : right);

const testKey = (test: DependencyTestReference): string =>
  JSON.stringify([test.file, test.project]);

const compareTestReferences = (
  left: DependencyTestReference,
  right: DependencyTestReference,
): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

export const mergeDependencyInventory = (
  target: Map<string, RuntimeDependencyInventoryEntry>,
  incoming: readonly RuntimeDependencyInventoryEntry[],
): boolean => {
  let limitReached = false;
  for (const entry of incoming) {
    const existing = target.get(entry.origin);
    if (existing === undefined) {
      if (target.size >= MAX_DEPENDENCY_SUITE_ORIGINS) {
        limitReached = true;
        continue;
      }
      target.set(entry.origin, {
        ...entry,
        resourceTypes: [...entry.resourceTypes],
        requestMethods: [...entry.requestMethods],
        firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })),
      });
      continue;
    }
    if (existing.host !== entry.host || existing.boundary !== entry.boundary) {
      throw new TypeError("dependency inventory origin metadata changed during aggregation");
    }
    existing.occurrenceCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      existing.occurrenceCount + entry.occurrenceCount,
    );
    existing.resourceTypes = Array.from(
      new Set([...existing.resourceTypes, ...entry.resourceTypes]),
    ).sort(compareCanonicalStrings);
    existing.requestMethods = Array.from(
      new Set([...existing.requestMethods, ...entry.requestMethods]),
    )
      .sort(compareCanonicalStrings)
      .slice(0, 16);
    const tests = new Map(existing.firstSeenTests.map((test) => [testKey(test), test]));
    for (const test of entry.firstSeenTests) tests.set(testKey(test), { ...test });
    existing.firstSeenTests = Array.from(tests.values())
      .sort(compareTestReferences)
      .slice(0, MAX_DEPENDENCY_TEST_REFERENCES_PER_ORIGIN);
  }
  return limitReached;
};

export const sortedDependencyInventory = (
  inventory: ReadonlyMap<string, RuntimeDependencyInventoryEntry>,
): RuntimeDependencyInventoryEntry[] =>
  Array.from(inventory.values())
    .map((entry) => ({
      ...entry,
      resourceTypes: [...entry.resourceTypes].sort(compareCanonicalStrings),
      requestMethods: [...entry.requestMethods].sort(compareCanonicalStrings),
      firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })).sort(compareTestReferences),
    }))
    .sort((left, right) => compareCanonicalStrings(left.origin, right.origin));
