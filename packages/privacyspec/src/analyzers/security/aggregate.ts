import { compareCanonicalStrings } from "../../canonical-order.js";
import type {
  SecurityCoverageStatus,
  SecurityFingerprint,
  SecurityPostureInventoryEntry,
  SecurityTestReference,
} from "./model.js";

export const MAX_SECURITY_SUITE_TARGETS = 10_000;
export const MAX_SECURITY_TEST_REFERENCES = 20;
export const MAX_SECURITY_SUITE_VARIANTS = 8;

const coverageRank: Readonly<Record<SecurityCoverageStatus, number>> = {
  complete: 0,
  partial: 1,
  incomplete: 2,
  unsupported: 3,
};

export const leastCompleteSecurityCoverage = (
  left: SecurityCoverageStatus,
  right: SecurityCoverageStatus,
): SecurityCoverageStatus => (coverageRank[left] >= coverageRank[right] ? left : right);

const testKey = (test: SecurityTestReference): string => JSON.stringify([test.file, test.project]);
const fingerprintKey = (fingerprint: SecurityFingerprint): string => JSON.stringify(fingerprint);

const compareTestReferences = (left: SecurityTestReference, right: SecurityTestReference): number =>
  compareCanonicalStrings(left.file, right.file) ||
  compareCanonicalStrings(left.project, right.project);

const canonicalFingerprint = (fingerprint: SecurityFingerprint): SecurityFingerprint => ({
  ...fingerprint,
  cookies: fingerprint.cookies
    .map((cookie) => ({ ...cookie }))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name)),
});

export const mergeSecurityInventory = (
  target: Map<string, SecurityPostureInventoryEntry>,
  incoming: readonly SecurityPostureInventoryEntry[],
): boolean => {
  let limitReached = false;
  for (const entry of incoming) {
    const existing = target.get(entry.key);
    if (existing === undefined) {
      if (target.size >= MAX_SECURITY_SUITE_TARGETS) {
        limitReached = true;
        continue;
      }
      target.set(entry.key, {
        ...entry,
        fingerprints: entry.fingerprints
          .map(canonicalFingerprint)
          .sort((left, right) =>
            compareCanonicalStrings(fingerprintKey(left), fingerprintKey(right)),
          ),
        firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })),
      });
      continue;
    }
    if (
      existing.host !== entry.host ||
      existing.endpoint !== entry.endpoint ||
      existing.responseKind !== entry.responseKind ||
      existing.method !== entry.method
    ) {
      throw new TypeError("security posture target metadata changed during aggregation");
    }
    existing.occurrenceCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      existing.occurrenceCount + entry.occurrenceCount,
    );
    const fingerprints = new Map(
      existing.fingerprints.map((fingerprint) => [fingerprintKey(fingerprint), fingerprint]),
    );
    for (const fingerprint of entry.fingerprints) {
      const canonical = canonicalFingerprint(fingerprint);
      const key = fingerprintKey(canonical);
      if (fingerprints.size >= MAX_SECURITY_SUITE_VARIANTS && !fingerprints.has(key)) {
        limitReached = true;
        continue;
      }
      fingerprints.set(key, canonical);
    }
    existing.fingerprints = Array.from(fingerprints.entries())
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([, fingerprint]) => fingerprint);
    const tests = new Map(existing.firstSeenTests.map((test) => [testKey(test), test]));
    for (const test of entry.firstSeenTests) tests.set(testKey(test), { ...test });
    existing.firstSeenTests = Array.from(tests.values())
      .sort(compareTestReferences)
      .slice(0, MAX_SECURITY_TEST_REFERENCES);
  }
  return limitReached;
};

export const sortedSecurityInventory = (
  inventory: ReadonlyMap<string, SecurityPostureInventoryEntry>,
): SecurityPostureInventoryEntry[] =>
  Array.from(inventory.values())
    .map((entry) => ({
      ...entry,
      fingerprints: entry.fingerprints
        .map(canonicalFingerprint)
        .sort((left, right) =>
          compareCanonicalStrings(fingerprintKey(left), fingerprintKey(right)),
        ),
      firstSeenTests: entry.firstSeenTests.map((test) => ({ ...test })).sort(compareTestReferences),
    }))
    .sort((left, right) => compareCanonicalStrings(left.key, right.key));
