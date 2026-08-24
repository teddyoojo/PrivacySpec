import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import {
  parseDependencyBaseline,
  parseDependencyLatestRun,
} from "../analyzers/dependency/baseline.js";
import type {
  AcceptedDependencySemantic,
  DependencySemanticCandidate,
} from "../analyzers/dependency/model.js";
import {
  parseRuntimeFailureBaseline,
  parseRuntimeFailureLatestRun,
} from "../analyzers/runtime-failure/artifact.js";
import type { RuntimeFailureBaselineEntry } from "../analyzers/runtime-failure/model.js";
import { parseSecurityBaseline, parseSecurityLatestRun } from "../analyzers/security/baseline.js";
import type { SecurityBaselineEntry } from "../analyzers/security/model.js";
import { compareCanonicalStrings } from "../canonical-order.js";
import { looksSensitive } from "../correlate/redact.js";
import {
  type ClassifierConfiguration,
  classifierConfigurationsEqual,
} from "../discovery/classifier-configuration.js";
import {
  BASELINE_PROPOSAL_SCHEMA_VERSION,
  type BaselineProposal,
  type BaselineProposalAction,
  type BaselineProposalApplication,
  type BaselineProposalCounts,
  type BaselineProposalDigest,
  type BaselineProposalEntry,
  type BaselineProposalId,
  type BaselineProposalModule,
  type BaselineProposalSelectionCounts,
  type BaselineProposalSnapshot,
  MAX_BASELINE_PROPOSAL_BYTES,
  MAX_BASELINE_PROPOSAL_ENTRIES,
  MAX_BASELINE_PROPOSAL_SELECTIONS,
} from "./proposal-model.js";
import type { BaselineFlow, BaselineFlowCandidate } from "./schema.js";
import {
  classifierConfigurationForBaseline,
  classifierConfigurationForLatestRun,
  parseBaselineFile,
  parseLatestRunFile,
} from "./write.js";

const MAX_PROPOSAL_IDENTITY_LENGTH = 16_384;
const MAX_TIMESTAMP_LENGTH = 64;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const actionOrder: Readonly<Record<BaselineProposalAction, number>> = {
  add: 0,
  change: 1,
  remove: 2,
};

export class BaselineProposalFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineProposalFormatError";
  }
}

export class BaselineProposalEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineProposalEligibilityError";
  }
}

export class BaselineProposalStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineProposalStaleError";
  }
}

export class BaselineProposalSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineProposalSelectionError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

const hasUnsafeCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint < 32 ||
      (codePoint >= 127 && codePoint <= 159) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });

const isSafeString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  !hasUnsafeCharacter(value);

const isTimestamp = (value: unknown): value is string => {
  if (!isSafeString(value, MAX_TIMESTAMP_LENGTH)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const decodeSafely = (value: string): string => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
};

const containsProhibitedMaterial = (value: string): boolean => {
  const decoded = decodeSafely(value);
  if (
    value.includes("?") ||
    decoded.includes("?") ||
    looksSensitive(value) ||
    looksSensitive(decoded) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(decoded) ||
    /(?:^|\D)(?:\+?\d[\d\s().-]{5,}\d)(?:\D|$)/u.test(decoded) ||
    /(?:^|[^a-f0-9])[a-f0-9]{64}(?:[^a-f0-9]|$)/iu.test(decoded) ||
    /(?:password|passwd|token|secret|authorization|api[_-]?key)\s*[:=]/iu.test(decoded)
  ) {
    return true;
  }
  for (const match of decoded.matchAll(/[a-z0-9+/]{12,}={0,2}/giu)) {
    const candidate = match[0];
    if (candidate.length % 4 !== 0) continue;
    const decodedCandidate = Buffer.from(candidate, "base64").toString("utf8");
    if (
      looksSensitive(decodedCandidate) ||
      /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(decodedCandidate) ||
      /(?:password|passwd|token|secret|authorization|api[_-]?key)\s*[:=]/iu.test(decodedCandidate)
    ) {
      return true;
    }
  }
  return false;
};

const moduleIdentityPrefixIsValid = (module: BaselineProposalModule, identity: string): boolean => {
  if (module === "privacy") return identity.startsWith("[") && identity.endsWith("]");
  if (module === "dependencies") return identity.startsWith("dependency:");
  if (module === "security") return identity.startsWith("security:");
  return identity.startsWith("runtime-error:");
};

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCanonicalStrings)
      .map((key) => [key, canonicalJsonValue(value[key])]),
  );
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalJsonValue(value));

const digest = (value: unknown): BaselineProposalDigest =>
  `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;

const missingBaselineDigest = digest({ state: "missing" });

const proposalEntryId = (
  module: BaselineProposalModule,
  action: BaselineProposalAction,
  identity: string,
): BaselineProposalId =>
  `${module}:${action}:${digest([BASELINE_PROPOSAL_SCHEMA_VERSION, module, action, identity])}`;

const compareProposalEntries = (
  left: BaselineProposalEntry,
  right: BaselineProposalEntry,
): number =>
  actionOrder[left.action] - actionOrder[right.action] ||
  compareCanonicalStrings(left.identity, right.identity);

const proposalPayload = (proposal: Omit<BaselineProposal, "proposalDigest">): unknown => proposal;

const canonicalPrivacyBaseline = (value: BaselineProposalSnapshot & { module: "privacy" }) => {
  const baselineInput =
    value.baseline === undefined
      ? undefined
      : {
          ...structuredClone(value.baseline),
          flows: value.baseline.flows
            .map((entry) => structuredClone(entry))
            .sort((a, b) => compareCanonicalStrings(a.key, b.key)),
        };
  const latestRunInput = {
    ...structuredClone(value.latestRun),
    flows: value.latestRun.flows
      .map((entry) => structuredClone(entry))
      .sort((a, b) => compareCanonicalStrings(a.key, b.key)),
  };
  const baseline = baselineInput === undefined ? undefined : parseBaselineFile(baselineInput);
  const latestRun = parseLatestRunFile(latestRunInput);
  if (!latestRun.complete) {
    throw new BaselineProposalEligibilityError(
      "The privacy latest-run artifact is incomplete and cannot produce a baseline proposal.",
    );
  }
  const latestClassifierConfiguration = classifierConfigurationForLatestRun(latestRun);
  const baselineClassifierConfiguration =
    baseline === undefined ? undefined : classifierConfigurationForBaseline(baseline);
  if (
    latestClassifierConfiguration.mode === "unavailable" ||
    baselineClassifierConfiguration?.mode === "unavailable" ||
    (baselineClassifierConfiguration !== undefined &&
      !classifierConfigurationsEqual(
        baselineClassifierConfiguration,
        latestClassifierConfiguration,
      ))
  ) {
    throw new BaselineProposalEligibilityError(
      "The privacy classifier configuration is unavailable or incompatible with the accepted baseline.",
    );
  }
  return {
    module: value.module,
    baseline:
      baseline === undefined
        ? undefined
        : {
            ...baseline,
            flows: baseline.flows.slice().sort((a, b) => compareCanonicalStrings(a.key, b.key)),
          },
    latestRun: {
      ...latestRun,
      flows: latestRun.flows.slice().sort((a, b) => compareCanonicalStrings(a.key, b.key)),
    },
    classifierConfiguration: latestClassifierConfiguration as ClassifierConfiguration,
  } as const;
};

const canonicalDependencyBaseline = (
  value: BaselineProposalSnapshot & { module: "dependencies" },
) => {
  const baselineInput =
    value.baseline === undefined
      ? undefined
      : {
          ...structuredClone(value.baseline),
          dependencies: value.baseline.dependencies
            .map((entry) => structuredClone(entry))
            .sort((a, b) => compareCanonicalStrings(a.key, b.key)),
        };
  const latestRunInput = {
    ...structuredClone(value.latestRun),
    dependencies: value.latestRun.dependencies
      .map((entry) => structuredClone(entry))
      .sort((a, b) => compareCanonicalStrings(a.key, b.key)),
  };
  const baseline = baselineInput === undefined ? undefined : parseDependencyBaseline(baselineInput);
  const latestRun = parseDependencyLatestRun(latestRunInput);
  if (!latestRun.complete) {
    throw new BaselineProposalEligibilityError(
      "The dependency latest-run artifact is incomplete and cannot produce a baseline proposal.",
    );
  }
  return { module: value.module, baseline, latestRun } as const;
};

const canonicalSecurityEntries = (
  entries: readonly SecurityBaselineEntry[],
): SecurityBaselineEntry[] =>
  entries
    .map((entry) => ({
      ...structuredClone(entry),
      fingerprints: entry.fingerprints
        .map((fingerprint) => ({
          ...structuredClone(fingerprint),
          cookies: fingerprint.cookies
            .map((cookie) => structuredClone(cookie))
            .sort((a, b) => compareCanonicalStrings(a.name, b.name)),
        }))
        .sort((a, b) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b))),
    }))
    .sort((a, b) => compareCanonicalStrings(a.key, b.key));

const canonicalSecurityBaseline = (value: BaselineProposalSnapshot & { module: "security" }) => {
  const baselineInput =
    value.baseline === undefined
      ? undefined
      : {
          ...structuredClone(value.baseline),
          entries: canonicalSecurityEntries(value.baseline.entries),
        };
  const latestRunInput = {
    ...structuredClone(value.latestRun),
    entries: canonicalSecurityEntries(value.latestRun.entries),
  };
  const baseline = baselineInput === undefined ? undefined : parseSecurityBaseline(baselineInput);
  const latestRun = parseSecurityLatestRun(latestRunInput);
  if (!latestRun.complete) {
    throw new BaselineProposalEligibilityError(
      "The security posture latest-run artifact is incomplete and cannot produce a baseline proposal.",
    );
  }
  return { module: value.module, baseline, latestRun } as const;
};

const canonicalRuntimeBaseline = (value: BaselineProposalSnapshot & { module: "runtime" }) => {
  const baselineInput =
    value.baseline === undefined
      ? undefined
      : {
          ...structuredClone(value.baseline),
          entries: value.baseline.entries
            .map((entry) => structuredClone(entry))
            .sort((a, b) => compareCanonicalStrings(a.key, b.key)),
        };
  const latestRunInput = {
    ...structuredClone(value.latestRun),
    entries: value.latestRun.entries
      .map((entry) => structuredClone(entry))
      .sort((a, b) => compareCanonicalStrings(a.key, b.key)),
  };
  const baseline =
    baselineInput === undefined ? undefined : parseRuntimeFailureBaseline(baselineInput);
  const latestRun = parseRuntimeFailureLatestRun(latestRunInput);
  if (!latestRun.complete) {
    throw new BaselineProposalEligibilityError(
      "The runtime failure latest-run artifact is incomplete and cannot produce a baseline proposal.",
    );
  }
  return { module: value.module, baseline, latestRun } as const;
};

type CanonicalSnapshot =
  | ReturnType<typeof canonicalPrivacyBaseline>
  | ReturnType<typeof canonicalDependencyBaseline>
  | ReturnType<typeof canonicalSecurityBaseline>
  | ReturnType<typeof canonicalRuntimeBaseline>;

const canonicalSnapshot = (snapshot: BaselineProposalSnapshot): CanonicalSnapshot => {
  if (snapshot.module === "privacy") return canonicalPrivacyBaseline(snapshot);
  if (snapshot.module === "dependencies") return canonicalDependencyBaseline(snapshot);
  if (snapshot.module === "security") return canonicalSecurityBaseline(snapshot);
  return canonicalRuntimeBaseline(snapshot);
};

interface SemanticDiff<T> {
  known: number;
  changes: Array<{ action: BaselineProposalAction; identity: string }>;
  baselineByKey: Map<string, T>;
  latestByKey: Map<string, T>;
}

const diffByKey = <T>(
  baselineEntries: readonly T[],
  latestEntries: readonly T[],
  keyOf: (entry: T) => string,
  changed?: ((before: T, after: T) => boolean) | undefined,
): SemanticDiff<T> => {
  const baselineByKey = new Map(baselineEntries.map((entry) => [keyOf(entry), entry]));
  const latestByKey = new Map(latestEntries.map((entry) => [keyOf(entry), entry]));
  const changes: SemanticDiff<T>["changes"] = [];
  let known = 0;
  for (const [identity, current] of latestByKey) {
    const previous = baselineByKey.get(identity);
    if (previous === undefined) {
      changes.push({ action: "add", identity });
    } else if (changed?.(previous, current) === true) {
      changes.push({ action: "change", identity });
    } else {
      known += 1;
    }
  }
  for (const identity of baselineByKey.keys()) {
    if (!latestByKey.has(identity)) changes.push({ action: "remove", identity });
  }
  changes.sort(
    (left, right) =>
      actionOrder[left.action] - actionOrder[right.action] ||
      compareCanonicalStrings(left.identity, right.identity),
  );
  return { known, changes, baselineByKey, latestByKey };
};

const semanticDiff = (snapshot: CanonicalSnapshot): SemanticDiff<unknown> => {
  if (snapshot.module === "privacy") {
    return diffByKey<BaselineFlowCandidate | BaselineFlow>(
      snapshot.baseline?.flows ?? [],
      snapshot.latestRun.flows,
      (entry) => entry.key,
    );
  }
  if (snapshot.module === "dependencies") {
    return diffByKey<DependencySemanticCandidate | AcceptedDependencySemantic>(
      snapshot.baseline?.dependencies ?? [],
      snapshot.latestRun.dependencies,
      (entry) => entry.key,
    );
  }
  if (snapshot.module === "security") {
    return diffByKey<SecurityBaselineEntry>(
      snapshot.baseline?.entries ?? [],
      snapshot.latestRun.entries,
      (entry) => entry.key,
      (before, after) => canonicalJson(before.fingerprints) !== canonicalJson(after.fingerprints),
    );
  }
  return diffByKey<RuntimeFailureBaselineEntry>(
    snapshot.baseline?.entries ?? [],
    snapshot.latestRun.entries,
    (entry) => entry.key,
  );
};

const snapshotArtifacts = (
  snapshot: CanonicalSnapshot,
): { baseline: unknown; latestRun: unknown } => ({
  baseline: snapshot.baseline,
  latestRun: snapshot.latestRun,
});

export const createBaselineProposal = (
  input: BaselineProposalSnapshot,
  options: { createdAt?: string | undefined } = {},
): BaselineProposal => {
  const snapshot = canonicalSnapshot(input);
  const diff = semanticDiff(snapshot);
  if (diff.changes.length > MAX_BASELINE_PROPOSAL_ENTRIES) {
    throw new BaselineProposalEligibilityError(
      "The baseline diff exceeds the bounded proposal entry limit.",
    );
  }
  const entries = diff.changes.map(({ action, identity }) => ({
    id: proposalEntryId(snapshot.module, action, identity),
    module: snapshot.module,
    action,
    identity,
  }));
  const counts: BaselineProposalCounts = {
    known: diff.known,
    add: entries.filter((entry) => entry.action === "add").length,
    change: entries.filter((entry) => entry.action === "change").length,
    remove: entries.filter((entry) => entry.action === "remove").length,
  };
  const artifacts = snapshotArtifacts(snapshot);
  const proposalWithoutDigest: Omit<BaselineProposal, "proposalDigest"> = {
    proposalSchemaVersion: BASELINE_PROPOSAL_SCHEMA_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    module: snapshot.module,
    source: {
      baseline:
        artifacts.baseline === undefined
          ? { state: "missing", digest: missingBaselineDigest }
          : { state: "present", digest: digest(artifacts.baseline) },
      latestRun: { digest: digest(artifacts.latestRun) },
    },
    counts,
    entries,
  };
  return parseBaselineProposal({
    ...proposalWithoutDigest,
    proposalDigest: digest(proposalPayload(proposalWithoutDigest)),
  });
};

const parseDigest = (value: unknown): BaselineProposalDigest | undefined =>
  typeof value === "string" && digestPattern.test(value)
    ? (value as BaselineProposalDigest)
    : undefined;

const parseCounts = (value: unknown): BaselineProposalCounts | undefined => {
  if (!isRecord(value) || !hasExactKeys(value, ["known", "add", "change", "remove"])) {
    return undefined;
  }
  for (const count of Object.values(value)) {
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 100_000) {
      return undefined;
    }
  }
  return value as unknown as BaselineProposalCounts;
};

const parseEntry = (
  value: unknown,
  proposalModule: BaselineProposalModule,
): BaselineProposalEntry | undefined => {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "module", "action", "identity"])) {
    return undefined;
  }
  if (
    value.module !== proposalModule ||
    (value.action !== "add" && value.action !== "change" && value.action !== "remove") ||
    (value.action === "change" && proposalModule !== "security") ||
    !isSafeString(value.identity, MAX_PROPOSAL_IDENTITY_LENGTH) ||
    containsProhibitedMaterial(value.identity) ||
    !moduleIdentityPrefixIsValid(proposalModule, value.identity)
  ) {
    return undefined;
  }
  const expectedId = proposalEntryId(proposalModule, value.action, value.identity);
  if (value.id !== expectedId) return undefined;
  return {
    id: expectedId,
    module: proposalModule,
    action: value.action,
    identity: value.identity,
  };
};

export const parseBaselineProposal = (value: unknown): BaselineProposal => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "proposalSchemaVersion",
      "createdAt",
      "module",
      "source",
      "counts",
      "entries",
      "proposalDigest",
    ]) ||
    value.proposalSchemaVersion !== BASELINE_PROPOSAL_SCHEMA_VERSION ||
    !isTimestamp(value.createdAt) ||
    (value.module !== "privacy" &&
      value.module !== "dependencies" &&
      value.module !== "security" &&
      value.module !== "runtime") ||
    !isRecord(value.source) ||
    !hasExactKeys(value.source, ["baseline", "latestRun"]) ||
    !isRecord(value.source.baseline) ||
    !hasExactKeys(value.source.baseline, ["state", "digest"]) ||
    (value.source.baseline.state !== "missing" && value.source.baseline.state !== "present") ||
    !isRecord(value.source.latestRun) ||
    !hasExactKeys(value.source.latestRun, ["digest"])
  ) {
    throw new BaselineProposalFormatError("Invalid or unsupported baseline proposal schema.");
  }
  const baselineDigest = parseDigest(value.source.baseline.digest);
  const latestRunDigest = parseDigest(value.source.latestRun.digest);
  const proposalDigest = parseDigest(value.proposalDigest);
  const counts = parseCounts(value.counts);
  if (
    baselineDigest === undefined ||
    latestRunDigest === undefined ||
    proposalDigest === undefined ||
    counts === undefined ||
    (value.source.baseline.state === "missing" && baselineDigest !== missingBaselineDigest) ||
    (value.source.baseline.state === "present" && baselineDigest === missingBaselineDigest) ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_BASELINE_PROPOSAL_ENTRIES
  ) {
    throw new BaselineProposalFormatError("Invalid baseline proposal metadata.");
  }
  const module = value.module as BaselineProposalModule;
  const entries = value.entries.map((entry) => parseEntry(entry, module));
  if (entries.some((entry) => entry === undefined)) {
    throw new BaselineProposalFormatError("Invalid baseline proposal entries.");
  }
  const parsedEntries = entries as BaselineProposalEntry[];
  if (
    !parsedEntries.every(
      (entry, index) =>
        index === 0 || compareProposalEntries(parsedEntries[index - 1] ?? entry, entry) < 0,
    ) ||
    new Set(parsedEntries.map((entry) => entry.identity)).size !== parsedEntries.length ||
    counts.add !== parsedEntries.filter((entry) => entry.action === "add").length ||
    counts.change !== parsedEntries.filter((entry) => entry.action === "change").length ||
    counts.remove !== parsedEntries.filter((entry) => entry.action === "remove").length
  ) {
    throw new BaselineProposalFormatError("Invalid or non-canonical baseline proposal entries.");
  }
  const proposalWithoutDigest: Omit<BaselineProposal, "proposalDigest"> = {
    proposalSchemaVersion: BASELINE_PROPOSAL_SCHEMA_VERSION,
    createdAt: value.createdAt,
    module,
    source: {
      baseline: { state: value.source.baseline.state, digest: baselineDigest },
      latestRun: { digest: latestRunDigest },
    },
    counts,
    entries: parsedEntries,
  };
  if (proposalDigest !== digest(proposalPayload(proposalWithoutDigest))) {
    throw new BaselineProposalFormatError("Baseline proposal digest verification failed.");
  }
  return { ...proposalWithoutDigest, proposalDigest };
};

const selectionCounts = (
  entries: readonly BaselineProposalEntry[],
): BaselineProposalSelectionCounts => ({
  add: entries.filter((entry) => entry.action === "add").length,
  change: entries.filter((entry) => entry.action === "change").length,
  remove: entries.filter((entry) => entry.action === "remove").length,
});

const validateSelections = (
  proposal: BaselineProposal,
  selectionIds: readonly string[],
): BaselineProposalEntry[] => {
  if (selectionIds.length > MAX_BASELINE_PROPOSAL_SELECTIONS) {
    throw new BaselineProposalSelectionError(
      "Too many baseline proposal selections were supplied.",
    );
  }
  const seen = new Set<string>();
  const entriesById = new Map(proposal.entries.map((entry) => [entry.id, entry]));
  const selected: BaselineProposalEntry[] = [];
  for (const id of selectionIds) {
    if (
      !isSafeString(id, 128) ||
      !/^(?:privacy|dependencies|security|runtime):(?:add|change|remove):sha256:[0-9a-f]{64}$/u.test(
        id,
      )
    ) {
      throw new BaselineProposalSelectionError(
        "A malformed baseline proposal selection was supplied.",
      );
    }
    if (seen.has(id)) {
      throw new BaselineProposalSelectionError(
        "A duplicate baseline proposal selection was supplied.",
      );
    }
    seen.add(id);
    const entry = entriesById.get(id as BaselineProposalId);
    if (entry === undefined) {
      const selectedModule = id.split(":", 1)[0];
      if (
        selectedModule !== proposal.module &&
        ["privacy", "dependencies", "security", "runtime"].includes(selectedModule ?? "")
      ) {
        throw new BaselineProposalSelectionError(
          "A cross-module baseline proposal selection was supplied.",
        );
      }
      throw new BaselineProposalSelectionError(
        "An unknown or no-longer-applicable baseline proposal selection was supplied.",
      );
    }
    selected.push(entry);
  }
  return selected.sort(compareProposalEntries);
};

const proposalsEqual = (left: BaselineProposal, right: BaselineProposal): boolean =>
  canonicalJson(left) === canonicalJson(right);

export const applyBaselineProposal = (
  proposalValue: BaselineProposal,
  input: BaselineProposalSnapshot,
  selectionIds: readonly string[],
): BaselineProposalApplication => {
  const proposal = parseBaselineProposal(structuredClone(proposalValue));
  if (input.module !== proposal.module) {
    throw new BaselineProposalSelectionError(
      "The baseline proposal and source snapshot modules do not match.",
    );
  }
  const snapshot = canonicalSnapshot(input);
  const expected = createBaselineProposal(snapshot, { createdAt: proposal.createdAt });
  if (
    proposal.source.baseline.digest !== expected.source.baseline.digest ||
    proposal.source.baseline.state !== expected.source.baseline.state ||
    proposal.source.latestRun.digest !== expected.source.latestRun.digest ||
    !proposalsEqual(proposal, expected)
  ) {
    throw new BaselineProposalStaleError(
      "The baseline proposal is stale, tampered, or does not match the current source snapshots.",
    );
  }
  const selected = validateSelections(proposal, selectionIds);
  const selectedIds = selected.map((entry) => entry.id);
  const selectedCounts = selectionCounts(selected);
  const selectedByIdentity = new Map(selected.map((entry) => [entry.identity, entry]));

  if (snapshot.module === "privacy") {
    const entries = new Map<string, BaselineFlowCandidate>(
      (snapshot.baseline?.flows ?? []).map(({ status: _status, ...entry }) => [entry.key, entry]),
    );
    const latest = new Map(snapshot.latestRun.flows.map((entry) => [entry.key, entry]));
    for (const [identity, selection] of selectedByIdentity) {
      if (selection.action === "remove") entries.delete(identity);
      else entries.set(identity, latest.get(identity) as BaselineFlowCandidate);
    }
    return {
      module: snapshot.module,
      selectedIds,
      selectedCounts,
      entries: Array.from(entries.values()).sort((a, b) => compareCanonicalStrings(a.key, b.key)),
      classifierConfiguration: snapshot.classifierConfiguration,
    };
  }
  if (snapshot.module === "dependencies") {
    const entries = new Map<string, DependencySemanticCandidate>(
      (snapshot.baseline?.dependencies ?? []).map(({ status: _status, ...entry }) => [
        entry.key,
        entry,
      ]),
    );
    const latest = new Map(snapshot.latestRun.dependencies.map((entry) => [entry.key, entry]));
    for (const [identity, selection] of selectedByIdentity) {
      if (selection.action === "remove") entries.delete(identity);
      else entries.set(identity, latest.get(identity) as DependencySemanticCandidate);
    }
    return {
      module: snapshot.module,
      selectedIds,
      selectedCounts,
      entries: Array.from(entries.values()).sort((a, b) => compareCanonicalStrings(a.key, b.key)),
    };
  }
  if (snapshot.module === "security") {
    const entries = new Map((snapshot.baseline?.entries ?? []).map((entry) => [entry.key, entry]));
    const latest = new Map(snapshot.latestRun.entries.map((entry) => [entry.key, entry]));
    for (const [identity, selection] of selectedByIdentity) {
      if (selection.action === "remove") entries.delete(identity);
      else entries.set(identity, latest.get(identity) as SecurityBaselineEntry);
    }
    return {
      module: snapshot.module,
      selectedIds,
      selectedCounts,
      entries: Array.from(entries.values()).sort((a, b) => compareCanonicalStrings(a.key, b.key)),
    };
  }
  const entries = new Map((snapshot.baseline?.entries ?? []).map((entry) => [entry.key, entry]));
  const latest = new Map(snapshot.latestRun.entries.map((entry) => [entry.key, entry]));
  for (const [identity, selection] of selectedByIdentity) {
    if (selection.action === "remove") entries.delete(identity);
    else entries.set(identity, latest.get(identity) as RuntimeFailureBaselineEntry);
  }
  return {
    module: snapshot.module,
    selectedIds,
    selectedCounts,
    entries: Array.from(entries.values()).sort((a, b) => compareCanonicalStrings(a.key, b.key)),
  };
};

const isMissing = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT";

const validatePathText = (path: string): string => {
  if (
    path.length === 0 ||
    path.length > 16_384 ||
    path.includes("\0") ||
    hasUnsafeCharacter(path)
  ) {
    throw new BaselineProposalFormatError("Invalid baseline workflow artifact path.");
  }
  return isAbsolute(path) ? path : resolve(path);
};

export const assertBaselineWorkflowArtifactPath = async (
  path: string,
  options: { allowDirectory?: boolean | undefined; allowMissing: boolean },
): Promise<boolean> => {
  const absolute = validatePathText(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index] ?? "");
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (isMissing(error) && options.allowMissing) return false;
      if (isMissing(error)) {
        throw new BaselineProposalFormatError("Required baseline workflow artifact was not found.");
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new BaselineProposalFormatError(
        "Baseline workflow artifact paths must not contain symbolic links.",
      );
    }
    const leaf = index === segments.length - 1;
    if (!leaf && !metadata.isDirectory()) {
      throw new BaselineProposalFormatError(
        "Baseline workflow artifact path has a non-directory parent.",
      );
    }
    if (
      leaf &&
      !metadata.isFile() &&
      !(options.allowDirectory === true && metadata.isDirectory())
    ) {
      throw new BaselineProposalFormatError("Baseline workflow artifact is not a regular file.");
    }
  }
  return true;
};

export const readBaselineProposalFile = async (path: string): Promise<BaselineProposal> => {
  await assertBaselineWorkflowArtifactPath(path, { allowMissing: false });
  const metadata = await lstat(path);
  if (metadata.size > MAX_BASELINE_PROPOSAL_BYTES) {
    throw new BaselineProposalFormatError("Baseline proposal exceeds the size limit.");
  }
  const serialized = await readFile(path, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > MAX_BASELINE_PROPOSAL_BYTES) {
    throw new BaselineProposalFormatError("Baseline proposal exceeds the size limit.");
  }
  try {
    return parseBaselineProposal(JSON.parse(serialized) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new BaselineProposalFormatError("Baseline proposal is not valid JSON.");
    }
    throw error;
  }
};

export const writeBaselineProposalFile = async (
  path: string,
  proposalValue: BaselineProposal,
): Promise<BaselineProposal> => {
  const proposal = parseBaselineProposal(structuredClone(proposalValue));
  const serialized = `${JSON.stringify(proposal, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_BASELINE_PROPOSAL_BYTES) {
    throw new BaselineProposalFormatError("Baseline proposal exceeds the size limit.");
  }
  await assertBaselineWorkflowArtifactPath(path, { allowMissing: true });
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  await assertBaselineWorkflowArtifactPath(directory, {
    allowDirectory: true,
    allowMissing: false,
  });
  await assertBaselineWorkflowArtifactPath(path, { allowMissing: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!isMissing(cleanupError)) throw cleanupError;
    }
    throw error;
  }
  return proposal;
};
