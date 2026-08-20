import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareBaseline,
  createBaselineFlowCandidate,
  createBaselineKey,
  normalizeBaselineEndpoint,
} from "../dist/baseline/compare.js";
import {
  createBaselineFile,
  createLatestRunFile,
  LatestRunIncompleteError,
  parseBaselineFile,
  parseLatestRunFile,
  readBaselineFile,
  readCompleteLatestRunFile,
  readLatestRunFile,
  writeBaselineFile,
  writeLatestRunFile,
} from "../dist/baseline/write.js";

const CREATED_AT = "2026-08-20T00:00:00.000Z";
const TEST_METADATA = {
  file: "tests/customer.spec.ts",
  title: "customer can be edited",
  project: "chromium",
};

const externalFlow = (overrides = {}) => ({
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
  method: "POST",
  endpoint: "/api/customer/12345",
  location: "json.email",
  transform: "EXACT",
  test: TEST_METADATA,
  ...overrides,
});

const reviewFinding = (flowOverrides = {}, findingOverrides = {}) => ({
  kind: "finding",
  ruleId: "PS1004",
  severity: "warning",
  classification: "review_required",
  title: "Personal data sent to external recipient",
  observation: "personal.email left the configured first-party boundary.",
  flow: externalFlow(flowOverrides),
  limitations: ["The processing context requires review."],
  ...findingOverrides,
});

const candidate = (finding = reviewFinding()) => {
  const result = createBaselineFlowCandidate(finding);
  assert.ok(result);
  return result;
};

test("semantic keys normalize dynamic paths and exclude test, method, and source metadata", () => {
  const first = candidate();
  const second = candidate(
    reviewFinding({
      sourceKind: "dom-control",
      sourceConfidence: "medium",
      method: "PATCH",
      endpoint: "/api/customer/67890",
      test: {
        file: "tests/renamed.spec.ts",
        title: "renamed test",
        project: "another-project",
      },
    }),
  );

  assert.equal(first.endpoint, "/api/customer/:number");
  assert.equal(first.key, second.key);
  assert.equal(first.key.includes("customer can be edited"), false);
  assert.equal(
    normalizeBaselineEndpoint("/objects/550e8400-e29b-41d4-a716-446655440000"),
    "/objects/:uuid",
  );
  assert.equal(normalizeBaselineEndpoint("/objects/0123456789abcdef01234567"), "/objects/:id");

  const identity = {
    ruleId: first.ruleId,
    dataCategory: first.dataCategory,
    sinkKind: first.sinkKind,
    recipient: first.recipient,
    endpoint: first.endpoint,
    location: first.location,
    transform: first.transform,
  };
  const key = createBaselineKey(identity);
  for (const changed of [
    { ...identity, ruleId: "PS1005" },
    { ...identity, dataCategory: "personal.phone" },
    { ...identity, sinkKind: "local-storage" },
    { ...identity, recipient: "https://another.example.test" },
    { ...identity, endpoint: "/another" },
    { ...identity, location: "json.contact" },
    { ...identity, transform: "SHA256_NORMALIZED" },
  ]) {
    assert.notEqual(createBaselineKey(changed), key);
  }
});

test("comparison groups review findings by semantic key and classifies known, new, and resolved", () => {
  const known = reviewFinding();
  const knownFromAnotherTest = reviewFinding({
    endpoint: "/api/customer/99999",
    test: { ...TEST_METADATA, title: "customer appears in search results" },
  });
  const newlyObserved = reviewFinding(
    {
      sinkKind: "local-storage",
      recipient: undefined,
      method: undefined,
      endpoint: undefined,
      location: "lastCustomerEmail",
    },
    {
      ruleId: "PS1005",
      title: "Sensitive data in browser storage",
      observation: "personal.email was observed in browser storage.",
    },
  );
  const resolved = candidate(
    reviewFinding({
      dataCategory: "personal.phone",
      location: "json.phone",
      endpoint: "/event",
    }),
  );
  const baseline = createBaselineFile([candidate(known), resolved], { createdAt: CREATED_AT });
  const technical = reviewFinding(
    { sinkKind: "console", recipient: undefined, method: undefined, endpoint: undefined },
    {
      ruleId: "PS1006",
      classification: "technical_failure",
      severity: "error",
      title: "Sensitive data emitted to browser console",
    },
  );

  const comparison = compareBaseline(
    [newlyObserved, knownFromAnotherTest, technical, known, known],
    baseline,
  );

  assert.equal(comparison.known.length, 1);
  assert.equal(comparison.known[0]?.findings.length, 2);
  assert.equal(comparison.new.length, 1);
  assert.equal(comparison.new[0]?.flow.ruleId, "PS1005");
  assert.equal(comparison.resolved.length, 1);
  assert.equal(comparison.resolved[0]?.dataCategory, "personal.phone");
  assert.deepEqual(
    comparison.observed.map(({ key }) => key),
    comparison.observed.map(({ key }) => key).toSorted(),
  );
});

test("only contextual personal-data review semantics can become baseline candidates", () => {
  const personalUrl = reviewFinding(
    {
      sinkKind: "request-url",
      recipient: undefined,
      method: undefined,
      endpoint: "/customers",
      location: "url.query.email",
    },
    {
      ruleId: "PS1001",
      title: "Personal data or secret in URL",
      observation: "High-confidence personal.email was observed in a URL.",
    },
  );
  assert.equal(createBaselineFlowCandidate(personalUrl)?.ruleId, "PS1001");
  assert.equal(
    createBaselineFlowCandidate(
      reviewFinding(
        { location: "url.path" },
        {
          ruleId: "PS1001",
          title: "Personal data or secret in URL",
          observation: "High-confidence personal.email was observed in a URL.",
        },
      ),
    )?.ruleId,
    "PS1001",
  );
  assert.equal(
    createBaselineFlowCandidate(
      reviewFinding({}, { classification: "technical_failure", ruleId: "PS1004" }),
    ),
    undefined,
  );
  assert.equal(
    createBaselineFlowCandidate(
      reviewFinding({}, { ruleId: "PS1003", classification: "review_required" }),
    ),
    undefined,
  );
  assert.equal(
    createBaselineFlowCandidate(
      reviewFinding({ sinkKind: "request-body", location: "json.email" }, { ruleId: "PS1001" }),
    ),
    undefined,
  );
  assert.equal(
    createBaselineFlowCandidate(
      reviewFinding(
        {
          dataCategory: "secret.password",
          sinkKind: "request-url",
          recipient: undefined,
          location: "url.query.password",
        },
        { ruleId: "PS1001" },
      ),
    ),
    undefined,
  );
  assert.equal(
    createBaselineFlowCandidate(
      reviewFinding(
        {
          dataCategory: "secret.password",
          sinkKind: "local-storage",
          recipient: undefined,
          endpoint: undefined,
        },
        { ruleId: "PS1005" },
      ),
    ),
    undefined,
  );
  assert.equal(createBaselineFlowCandidate(reviewFinding({ sinkKind: "request-body" })), undefined);

  const valid = candidate();
  const forgedCandidates = [
    { ...valid, ruleId: "PS1003" },
    { ...valid, dataCategory: "secret.api_token" },
    {
      ...valid,
      ruleId: "PS1005",
      dataCategory: "secret.password",
      sinkKind: "local-storage",
      recipient: undefined,
      endpoint: undefined,
    },
    { ...valid, recipient: undefined },
  ];
  for (const forged of forgedCandidates) {
    forged.key = createBaselineKey(forged);
    assert.throws(
      () =>
        parseLatestRunFile({
          schemaVersion: 1,
          createdAt: CREATED_AT,
          complete: true,
          flows: [forged],
        }),
      /flow entries/u,
    );
  }
});

test("baseline schemas reject unknown fields, non-canonical keys, duplicates, and bad versions", () => {
  const flow = candidate();
  const baseline = createBaselineFile([flow], { createdAt: CREATED_AT });
  const latestRun = createLatestRunFile([flow], { complete: true, createdAt: CREATED_AT });

  assert.throws(() => parseBaselineFile({ ...baseline, schemaVersion: 2 }), /schema/u);
  assert.throws(() => parseBaselineFile({ ...baseline, unexpected: true }), /schema/u);
  assert.throws(
    () =>
      parseBaselineFile({
        ...baseline,
        flows: [{ ...baseline.flows[0], key: "forged" }],
      }),
    /flow entries/u,
  );
  assert.throws(
    () => parseBaselineFile({ ...baseline, flows: [baseline.flows[0], baseline.flows[0]] }),
    /flow entries/u,
  );
  assert.throws(
    () =>
      parseLatestRunFile({ ...latestRun, flows: [{ ...latestRun.flows[0], status: "accepted" }] }),
    /flow entries/u,
  );
});

test("baseline and latest-run IO is atomic, bounded, private, and protects incomplete runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-baseline-"));
  const baselinePath = join(directory, "privacyspec-baseline.json");
  const latestRunPath = join(directory, ".privacyspec", "latest-run.json");
  const flow = candidate();

  try {
    assert.equal(await readBaselineFile(baselinePath), undefined);
    assert.equal(await readLatestRunFile(latestRunPath), undefined);
    await assert.rejects(readCompleteLatestRunFile(latestRunPath), LatestRunIncompleteError);

    const written = await writeBaselineFile(baselinePath, [flow, flow], {
      createdAt: CREATED_AT,
    });
    assert.equal(written.flows.length, 1);
    assert.deepEqual(await readBaselineFile(baselinePath), written);
    assert.equal((await stat(baselinePath)).mode & 0o777, 0o600);
    assert.equal((await readFile(baselinePath, "utf8")).endsWith("\n"), true);
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
      [],
    );

    await writeLatestRunFile(latestRunPath, [flow], {
      complete: false,
      createdAt: CREATED_AT,
    });
    assert.equal((await readLatestRunFile(latestRunPath))?.complete, false);
    await assert.rejects(readCompleteLatestRunFile(latestRunPath), LatestRunIncompleteError);

    const complete = await writeLatestRunFile(latestRunPath, [flow], {
      complete: true,
      createdAt: CREATED_AT,
    });
    assert.deepEqual(await readCompleteLatestRunFile(latestRunPath), complete);
    assert.equal((await stat(latestRunPath)).mode & 0o777, 0o600);

    await writeFile(baselinePath, "not json", "utf8");
    await assert.rejects(readBaselineFile(baselinePath), /valid JSON/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persisted baseline artifacts whitelist semantics and reject transformed sensitive locations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-baseline-redaction-"));
  const baselinePath = join(directory, "baseline.json");
  const latestRunPath = join(directory, "latest.json");
  const raw = ["Private.Person+tag", "Sensitive.Example"].join("@");
  const encoded = encodeURIComponent(raw);
  const base64 = Buffer.from(raw, "utf8").toString("base64");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  const finding = reviewFinding(
    {
      method: raw,
      test: {
        file: `tests/${encoded}.spec.ts`,
        title: `submits ${base64}`,
        project: hash,
      },
    },
    {
      observation: `Observed ${raw}`,
      limitations: [`Encoded fixture: ${encoded}`],
    },
  );
  const flow = candidate(finding);

  try {
    await writeBaselineFile(baselinePath, [flow], { createdAt: CREATED_AT });
    await writeLatestRunFile(latestRunPath, [flow], {
      complete: true,
      createdAt: CREATED_AT,
    });
    const serialized = `${await readFile(baselinePath, "utf8")}\n${await readFile(
      latestRunPath,
      "utf8",
    )}`;
    for (const representation of [raw, encoded, base64, hash]) {
      assert.equal(serialized.includes(representation), false, representation);
    }

    for (const sensitiveLocation of [raw, encoded, base64, hash]) {
      const forged = { ...flow, location: sensitiveLocation };
      forged.key = createBaselineKey(forged);
      assert.throws(
        () => createLatestRunFile([forged], { complete: true, createdAt: CREATED_AT }),
        /flow entries/u,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
