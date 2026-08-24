import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDependencySemanticKey } from "../dist/analyzers/dependency/baseline.js";
import { createRuntimeFailureKey } from "../dist/analyzers/runtime-failure/analyzer.js";
import { createSecurityTargetKey } from "../dist/analyzers/security/analyzer.js";
import { createBaselineFlowCandidate, createBaselineKey } from "../dist/baseline/compare.js";
import {
  applyBaselineProposal,
  BaselineProposalEligibilityError,
  BaselineProposalFormatError,
  BaselineProposalSelectionError,
  BaselineProposalStaleError,
  createBaselineProposal,
  parseBaselineProposal,
  readBaselineProposalFile,
  writeBaselineProposalFile,
} from "../dist/baseline/proposal.js";
import {
  BASELINE_PROPOSAL_SCHEMA_VERSION,
  DEFAULT_BASELINE_PROPOSAL_PATH,
  MAX_BASELINE_PROPOSAL_BYTES,
} from "../dist/baseline/proposal-model.js";
import { createBaselineFile, createLatestRunFile } from "../dist/baseline/write.js";
import * as publicApi from "../dist/index.js";

const CREATED_AT = "2026-08-23T10:00:00.000Z";
const PROPOSED_AT = "2026-08-23T11:00:00.000Z";

const privacyCandidate = (location) => {
  const identity = {
    ruleId: "PS1004",
    dataCategory: "personal.email",
    sinkKind: "external-request",
    recipient: "https://analytics.example.test",
    endpoint: "/events",
    location,
    transform: "EXACT",
  };
  return { key: createBaselineKey(identity), ...identity };
};

const dependencyCandidate = (category, host) => ({
  key: createDependencySemanticKey(category, host),
  boundary: "external",
  category,
  host,
});

const securityEntry = (endpoint, csp) => ({
  key: createSecurityTargetKey({
    host: "app.example.test",
    endpoint,
    responseKind: "document",
    method: "GET",
  }),
  host: "app.example.test",
  endpoint,
  responseKind: "document",
  method: "GET",
  fingerprints: [
    {
      transport: "secure",
      csp,
      hsts: "max-age=31536000;includeSubDomains=true;preload=false",
      xContentTypeOptions: "nosniff",
      cors: "origin=none;credentials=none;methods=none",
      cookies: [],
    },
  ],
  status: "accepted",
});

const runtimeEntry = (endpoint, httpStatus = 503) => {
  const details = {
    boundary: "first-party",
    host: "app.example.test",
    method: "GET",
    endpoint,
    httpStatus,
    errorName: null,
    signature: null,
    failureCode: null,
  };
  return {
    key: createRuntimeFailureKey({ failureType: "http-5xx", details }),
    failureType: "http-5xx",
    severity: "ERROR",
    summary: `First-party HTTP ${httpStatus}`,
    ...details,
    status: "accepted",
  };
};

const sorted = (entries) => entries.toSorted((left, right) => left.key.localeCompare(right.key));

const canonicalJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, canonicalJsonValue(value[key])]),
  );
};

const sha256Digest = (value) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest("hex")}`;

const moduleSnapshots = () => {
  const privacyKnown = privacyCandidate("json.known");
  const privacyAdded = privacyCandidate("json.added");
  const privacyRemoved = privacyCandidate("json.removed");
  const privacy = {
    module: "privacy",
    baseline: createBaselineFile([privacyRemoved, privacyKnown], { createdAt: CREATED_AT }),
    latestRun: createLatestRunFile([privacyAdded, privacyKnown], {
      complete: true,
      createdAt: CREATED_AT,
    }),
  };

  const dependencyKnown = dependencyCandidate("origin", "known.vendor.test");
  const dependencyAdded = dependencyCandidate("script", "added.vendor.test");
  const dependencyRemoved = dependencyCandidate("iframe", "removed.vendor.test");
  const dependencies = {
    module: "dependencies",
    baseline: {
      schemaVersion: 1,
      createdAt: CREATED_AT,
      dependencies: sorted([dependencyKnown, dependencyRemoved]).map((entry) => ({
        ...entry,
        status: "accepted",
      })),
    },
    latestRun: {
      schemaVersion: 1,
      createdAt: CREATED_AT,
      complete: true,
      dependencies: sorted([dependencyKnown, dependencyAdded]),
    },
  };

  const securityKnown = securityEntry("/known", "present:sha256:1111111111111111");
  const securityPrevious = securityEntry("/changed", "present:sha256:2222222222222222");
  const securityChanged = securityEntry("/changed", "present:sha256:3333333333333333");
  const securityAdded = securityEntry("/added", "present:sha256:4444444444444444");
  const securityRemoved = securityEntry("/removed", "present:sha256:5555555555555555");
  const security = {
    module: "security",
    baseline: {
      schemaVersion: 1,
      createdAt: CREATED_AT,
      entries: sorted([securityKnown, securityPrevious, securityRemoved]),
    },
    latestRun: {
      schemaVersion: 1,
      createdAt: CREATED_AT,
      complete: true,
      entries: sorted([securityKnown, securityChanged, securityAdded]),
    },
  };

  const runtimeKnown = runtimeEntry("/known", 501);
  const runtimeAdded = runtimeEntry("/added", 502);
  const runtimeRemoved = runtimeEntry("/removed", 503);
  const runtime = {
    module: "runtime",
    baseline: {
      schemaVersion: 1,
      createdAt: CREATED_AT,
      entries: sorted([runtimeKnown, runtimeRemoved]),
    },
    latestRun: {
      schemaVersion: 1,
      createdAt: CREATED_AT,
      complete: true,
      entries: sorted([runtimeKnown, runtimeAdded]),
    },
  };

  return { privacy, dependencies, security, runtime };
};

test("public package root exports the Step 4 proposal contract", () => {
  assert.equal(publicApi.BASELINE_PROPOSAL_SCHEMA_VERSION, 1);
  assert.equal(publicApi.DEFAULT_BASELINE_PROPOSAL_PATH, DEFAULT_BASELINE_PROPOSAL_PATH);
  assert.equal(typeof publicApi.createBaselineProposal, "function");
  assert.equal(typeof publicApi.parseBaselineProposal, "function");
  assert.equal(typeof publicApi.readBaselineProposalFile, "function");
  assert.equal(typeof publicApi.writeBaselineProposalFile, "function");
  assert.equal(typeof publicApi.applyBaselineProposal, "function");
});

test("all modules produce canonical known/add/change/remove proposals", () => {
  const snapshots = moduleSnapshots();
  for (const [module, snapshot] of Object.entries(snapshots)) {
    const proposal = createBaselineProposal(snapshot, { createdAt: PROPOSED_AT });
    assert.equal(proposal.module, module);
    assert.equal(proposal.proposalSchemaVersion, BASELINE_PROPOSAL_SCHEMA_VERSION);
    assert.equal(proposal.counts.known, 1);
    assert.equal(proposal.counts.add, 1);
    assert.equal(proposal.counts.change, module === "security" ? 1 : 0);
    assert.equal(proposal.counts.remove, 1);
    assert.deepEqual(parseBaselineProposal(structuredClone(proposal)), proposal);
    assert.deepEqual(
      proposal.entries.map((entry) => entry.action),
      module === "security" ? ["add", "change", "remove"] : ["add", "remove"],
    );
    for (const entry of proposal.entries) {
      assert.match(entry.id, new RegExp(`^${module}:${entry.action}:sha256:[0-9a-f]{64}$`, "u"));
      assert.equal(entry.module, module);
    }
  }
});

test("missing baselines propose additions and incomplete handoffs remain ineligible", () => {
  const snapshots = moduleSnapshots();
  for (const snapshot of Object.values(snapshots)) {
    const missing = { ...snapshot, baseline: undefined };
    const proposal = createBaselineProposal(missing, { createdAt: PROPOSED_AT });
    assert.equal(proposal.source.baseline.state, "missing");
    assert.equal(
      proposal.counts.add,
      snapshot.latestRun[
        snapshot.module === "dependencies"
          ? "dependencies"
          : snapshot.module === "privacy"
            ? "flows"
            : "entries"
      ].length,
    );
    assert.equal(proposal.counts.remove, 0);

    const incomplete = {
      ...snapshot,
      latestRun: { ...snapshot.latestRun, complete: false },
    };
    assert.throws(
      () => createBaselineProposal(incomplete, { createdAt: PROPOSED_AT }),
      BaselineProposalEligibilityError,
    );
  }
});

test("privacy proposals require available matching classifier configurations", () => {
  const candidate = privacyCandidate("json.email");
  const baseline = createBaselineFile([candidate], {
    createdAt: CREATED_AT,
    classifierConfiguration: { mode: "custom", id: "acme-classifiers-v1" },
  });
  const matchingLatest = createLatestRunFile([candidate], {
    complete: true,
    createdAt: CREATED_AT,
    classifierConfiguration: { mode: "custom", id: "acme-classifiers-v1" },
  });
  assert.equal(
    createBaselineProposal(
      { module: "privacy", baseline, latestRun: matchingLatest },
      { createdAt: PROPOSED_AT },
    ).module,
    "privacy",
  );

  const mismatchedLatest = {
    ...matchingLatest,
    classifierConfiguration: { mode: "custom", id: "acme-classifiers-v2" },
  };
  assert.throws(
    () =>
      createBaselineProposal(
        { module: "privacy", baseline, latestRun: mismatchedLatest },
        { createdAt: PROPOSED_AT },
      ),
    BaselineProposalEligibilityError,
  );

  const customCandidate = {
    ...candidate,
    dataCategory: "custom.personal.acme.member_id",
  };
  customCandidate.key = createBaselineKey(customCandidate);
  const legacyCustomBaseline = {
    schemaVersion: 1,
    createdAt: CREATED_AT,
    flows: [{ ...customCandidate, status: "accepted" }],
  };
  const legacyCustomLatest = {
    schemaVersion: 1,
    createdAt: CREATED_AT,
    complete: true,
    flows: [customCandidate],
  };
  assert.throws(
    () =>
      createBaselineProposal(
        {
          module: "privacy",
          baseline: legacyCustomBaseline,
          latestRun: legacyCustomLatest,
        },
        { createdAt: PROPOSED_AT },
      ),
    BaselineProposalEligibilityError,
  );
});

test("objective privacy technical failures cannot enter proposal-eligible handoffs", () => {
  const technicalIdentity = {
    ruleId: "PS1006",
    dataCategory: "personal.email",
    sinkKind: "console",
    transform: "EXACT",
  };
  const forged = { key: createBaselineKey(technicalIdentity), ...technicalIdentity };
  assert.throws(
    () => createLatestRunFile([forged], { complete: true, createdAt: CREATED_AT }),
    /flow entries/u,
  );
});

test("selective application preserves unselected entries and makes removal explicit", () => {
  for (const snapshot of Object.values(moduleSnapshots())) {
    const proposal = createBaselineProposal(snapshot, { createdAt: PROPOSED_AT });
    const add = proposal.entries.find((entry) => entry.action === "add");
    const remove = proposal.entries.find((entry) => entry.action === "remove");
    assert.ok(add);
    assert.ok(remove);

    const unchanged = applyBaselineProposal(proposal, snapshot, []);
    assert.equal(unchanged.selectedIds.length, 0);
    assert.equal(
      unchanged.entries.length,
      snapshot.baseline[
        snapshot.module === "dependencies"
          ? "dependencies"
          : snapshot.module === "privacy"
            ? "flows"
            : "entries"
      ].length,
    );

    const added = applyBaselineProposal(proposal, snapshot, [add.id]);
    assert.equal(
      added.entries.some((entry) => entry.key === add.identity),
      true,
    );
    assert.equal(
      added.entries.some((entry) => entry.key === remove.identity),
      true,
    );

    const removed = applyBaselineProposal(proposal, snapshot, [remove.id]);
    assert.equal(
      removed.entries.some((entry) => entry.key === remove.identity),
      false,
    );
    assert.equal(
      removed.entries.some((entry) => entry.key === add.identity),
      false,
    );
  }
});

test("security changes replace only selected fingerprints", () => {
  const snapshot = moduleSnapshots().security;
  const proposal = createBaselineProposal(snapshot, { createdAt: PROPOSED_AT });
  const change = proposal.entries.find((entry) => entry.action === "change");
  const remove = proposal.entries.find((entry) => entry.action === "remove");
  assert.ok(change);
  assert.ok(remove);

  const unchanged = applyBaselineProposal(proposal, snapshot, []);
  const oldChanged = unchanged.entries.find((entry) => entry.key === change.identity);
  assert.equal(oldChanged?.fingerprints[0]?.csp, "present:sha256:2222222222222222");

  const applied = applyBaselineProposal(proposal, snapshot, [change.id]);
  const newChanged = applied.entries.find((entry) => entry.key === change.identity);
  assert.equal(newChanged?.fingerprints[0]?.csp, "present:sha256:3333333333333333");
  assert.equal(
    applied.entries.some((entry) => entry.key === remove.identity),
    true,
  );
});

test("selection validation rejects duplicate, unknown, malformed, and cross-module IDs", () => {
  const snapshot = moduleSnapshots().privacy;
  const proposal = createBaselineProposal(snapshot, { createdAt: PROPOSED_AT });
  const selected = proposal.entries[0]?.id;
  assert.ok(selected);
  const digest = "0".repeat(64);
  for (const selections of [
    [selected, selected],
    [`privacy:add:sha256:${digest}`],
    ["display-index-1"],
    [`security:add:sha256:${digest}`],
  ]) {
    assert.throws(
      () => applyBaselineProposal(proposal, snapshot, selections),
      BaselineProposalSelectionError,
    );
  }
});

test("stale and tampered proposals cannot be applied", () => {
  const snapshot = moduleSnapshots().privacy;
  const proposal = createBaselineProposal(snapshot, { createdAt: PROPOSED_AT });
  const tampered = structuredClone(proposal);
  tampered.counts.known += 1;
  assert.throws(() => parseBaselineProposal(tampered), BaselineProposalFormatError);

  const forged = structuredClone(proposal);
  const forgedIdentity = privacyCandidate("json.forged").key;
  forged.entries[0].identity = forgedIdentity;
  forged.entries[0].id = `privacy:add:${sha256Digest([1, "privacy", "add", forgedIdentity])}`;
  const { proposalDigest: _oldDigest, ...forgedPayload } = forged;
  forged.proposalDigest = sha256Digest(forgedPayload);
  assert.deepEqual(parseBaselineProposal(forged), forged);
  assert.throws(
    () => applyBaselineProposal(forged, snapshot, [forged.entries[0].id]),
    BaselineProposalStaleError,
  );

  const staleSnapshot = {
    ...snapshot,
    latestRun: { ...snapshot.latestRun, createdAt: "2026-08-23T12:00:00.000Z" },
  };
  assert.throws(
    () => applyBaselineProposal(proposal, staleSnapshot, []),
    BaselineProposalStaleError,
  );
});

test("proposal output is deterministic across module source permutations", () => {
  for (const snapshot of Object.values(moduleSnapshots())) {
    const baselineKey =
      snapshot.module === "privacy"
        ? "flows"
        : snapshot.module === "dependencies"
          ? "dependencies"
          : "entries";
    const latestKey = baselineKey;
    const permuted = {
      ...snapshot,
      baseline: {
        ...snapshot.baseline,
        [baselineKey]: snapshot.baseline[baselineKey].toReversed(),
      },
      latestRun: {
        ...snapshot.latestRun,
        [latestKey]: snapshot.latestRun[latestKey].toReversed(),
      },
    };
    assert.deepEqual(
      createBaselineProposal(permuted, { createdAt: PROPOSED_AT }),
      createBaselineProposal(snapshot, { createdAt: PROPOSED_AT }),
      snapshot.module,
    );
  }
});

test("proposal parser rejects unknown fields, versions, order, counts, and hostile identities", () => {
  const proposal = createBaselineProposal(moduleSnapshots().privacy, { createdAt: PROPOSED_AT });
  const cases = [
    { ...proposal, proposalSchemaVersion: 2 },
    { ...proposal, unknown: true },
    { ...proposal, entries: proposal.entries.toReversed() },
    { ...proposal, counts: { ...proposal.counts, add: 99 } },
    {
      ...proposal,
      entries: proposal.entries.map((entry, index) =>
        index === 0 ? { ...entry, identity: "[person@example.test\n]" } : entry,
      ),
    },
  ];
  for (const value of cases) {
    assert.throws(() => parseBaselineProposal(value), BaselineProposalFormatError);
  }
});

test("proposal persistence and terminal-shaped output exclude hostile raw source material", () => {
  const raw = "Private.Person+proposal@Sensitive.Example";
  const encoded = encodeURIComponent(raw);
  const base64 = Buffer.from(raw, "utf8").toString("base64");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  const flow = {
    kind: "data-flow",
    dataCategory: "personal.email",
    sourceKind: "form-input",
    sourceConfidence: "high",
    sinkKind: "external-request",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
    method: raw,
    endpoint: "/events",
    location: "json.email",
    transform: "EXACT",
    test: {
      file: `tests/${encoded}.spec.ts`,
      title: `submits ${base64}\n<script>`,
      project: hash,
    },
  };
  const proposalCandidate = createBaselineFlowCandidate({
    kind: "finding",
    ruleId: "PS1004",
    severity: "warning",
    classification: "review_required",
    title: `Observed ${raw}`,
    observation: `Observed ${encoded}`,
    flow,
    limitations: [`Source ${base64}`],
  });
  assert.ok(proposalCandidate);
  const proposal = createBaselineProposal(
    {
      module: "privacy",
      latestRun: createLatestRunFile([proposalCandidate], {
        complete: true,
        createdAt: CREATED_AT,
      }),
    },
    { createdAt: PROPOSED_AT },
  );
  const rendered = `${JSON.stringify(proposal)}\n${proposal.entries
    .map((entry) => `${entry.id} :: ${entry.action.toUpperCase()} :: ${entry.identity}`)
    .join("\n")}`;
  for (const prohibited of [raw, encoded, base64, hash, "<script>"]) {
    assert.equal(rendered.includes(prohibited), false, prohibited);
  }
});

test("proposal IO is strict, bounded, atomic, private, and rejects symlinks", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-proposal-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const proposal = createBaselineProposal(moduleSnapshots().privacy, { createdAt: PROPOSED_AT });
  const proposalPath = join(directory, "nested", "proposal.json");
  await writeBaselineProposalFile(proposalPath, proposal);
  assert.deepEqual(await readBaselineProposalFile(proposalPath), proposal);
  assert.equal((await stat(proposalPath)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await readdir(join(directory, "nested"))).filter((name) => name.endsWith(".tmp")),
    [],
  );

  const original = await readFile(proposalPath, "utf8");
  const malformed = { ...proposal, counts: { ...proposal.counts, add: 99 } };
  await assert.rejects(
    writeBaselineProposalFile(proposalPath, malformed),
    BaselineProposalFormatError,
  );
  assert.equal(await readFile(proposalPath, "utf8"), original);

  const linkPath = join(directory, "proposal-link.json");
  await symlink(proposalPath, linkPath);
  await assert.rejects(readBaselineProposalFile(linkPath), /symbolic links/u);
  await assert.rejects(writeBaselineProposalFile(linkPath, proposal), /symbolic links/u);

  const oversizedPath = join(directory, "oversized.json");
  await writeFile(oversizedPath, Buffer.alloc(MAX_BASELINE_PROPOSAL_BYTES + 1, 0x20));
  await assert.rejects(readBaselineProposalFile(oversizedPath), /size limit/u);
});
