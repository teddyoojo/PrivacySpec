import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  leastCompleteSecurityCoverage,
  mergeSecurityInventory,
  sortedSecurityInventory,
} from "../dist/analyzers/security/aggregate.js";
import {
  createSecurityFingerprint,
  createSecurityTargetKey,
  SecurityPostureAnalyzer,
} from "../dist/analyzers/security/analyzer.js";
import {
  createSecurityAttachment,
  MAX_SECURITY_ARTIFACT_BYTES,
  parseSecurityAttachment,
  parseSecurityReport,
  readCompleteSecurityLatestRunFile,
  readSecurityBaselineFile,
  readSecurityReport,
  writeSecurityBaselineFile,
  writeSecurityLatestRunFile,
  writeSecurityReport,
} from "../dist/analyzers/security/artifact.js";
import {
  compareSecurityBaseline,
  createSecurityBaselineEntries,
  parseSecurityBaseline,
  parseSecurityLatestRun,
} from "../dist/analyzers/security/baseline.js";
import { SECURITY_TECHNICAL_CONTROLS } from "../dist/analyzers/security/mappings.js";
import { createResponseJsonCoverage } from "../dist/discovery/response-json.js";
import { parseSecurityCookie } from "../dist/observe/response-security.js";
import { AnalyzerHost } from "../dist/runtime/analyzer.js";
import { createRuntimeCapabilityModel } from "../dist/runtime/capabilities.js";
import { RuntimeEventMetadataFactory } from "../dist/runtime/events.js";

const observationCoverage = {
  browserObjects: { seen: 1 },
  contexts: { seen: 1, instrumented: 1 },
  pages: { seen: 1, instrumented: 1, storageCapable: 1 },
  events: { navigations: 1, network: 1, console: 0 },
};
const capabilities = createRuntimeCapabilityModel({
  observation: observationCoverage,
  responseJson: createResponseJsonCoverage(false),
  observerWorkFailed: false,
  responseHeaders: { enabled: true, limitReached: false, workFailed: false },
});
const testMetadata = {
  testId: "security-test",
  file: "tests/dashboard.spec.ts",
  title: "dashboard works",
  projectName: "chromium",
};

const response = (overrides = {}) => ({
  url: "https://app.example.test/dashboard?private=person@example.test",
  method: "GET",
  resourceType: "document",
  frameKind: "main",
  status: 200,
  headers: {
    contentSecurityPolicy: "default-src 'self'; script-src 'self' 'nonce-private-value'",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    accessControlAllowOrigin: "https://app.example.test",
  },
  cookies: [{ name: "session_id", secure: true, httpOnly: true, sameSite: "lax" }],
  ...overrides,
});

const inventoryEntry = (fingerprint, overrides = {}) => ({
  kind: "security-posture",
  key: createSecurityTargetKey({
    host: "app.example.test",
    endpoint: "/dashboard",
    responseKind: "authentication",
    method: "GET",
  }),
  host: "app.example.test",
  endpoint: "/dashboard",
  responseKind: "authentication",
  method: "GET",
  fingerprints: [fingerprint],
  firstSeenTests: [{ file: "tests/dashboard.spec.ts", project: "chromium" }],
  occurrenceCount: 1,
  ...overrides,
});

const adversarialTestReferences = [
  { file: "tests/routes/Überblick.spec.ts", project: "chromium" },
  { file: "tests/routes/.account.spec.ts", project: "chromium" },
  { file: "tests/routes/%24user.spec.ts", project: ".project" },
  { file: "tests/routes/%24user.spec.ts", project: "%project" },
];

const canonicalAdversarialTestReferences = [
  { file: "tests/routes/%24user.spec.ts", project: "%project" },
  { file: "tests/routes/%24user.spec.ts", project: ".project" },
  { file: "tests/routes/.account.spec.ts", project: "chromium" },
  { file: "tests/routes/Überblick.spec.ts", project: "chromium" },
];

const adversarialSecurityInventory = () => {
  const base = createSecurityFingerprint(response());
  const upperFingerprint = {
    ...base,
    csp: "present:sha256:Ab3F09",
    cookies: [
      { name: ".session", secure: true, httpOnly: true, sameSite: "lax" },
      { name: "%session", secure: true, httpOnly: true, sameSite: "lax" },
    ],
  };
  const lowerFingerprint = {
    ...base,
    csp: "present:sha256:aB3f09",
    cookies: [
      { name: ".session", secure: false, httpOnly: true, sameSite: "strict" },
      { name: "%session", secure: false, httpOnly: true, sameSite: "strict" },
    ],
  };
  const entry = (endpoint, fingerprints) =>
    inventoryEntry(fingerprints[0], {
      key: createSecurityTargetKey({
        host: "app.example.test",
        endpoint,
        responseKind: "api",
        method: "GET",
      }),
      endpoint,
      responseKind: "api",
      fingerprints,
      firstSeenTests: adversarialTestReferences,
    });
  return [
    entry("/assets/app-aB3f09.js", [lowerFingerprint, upperFingerprint]),
    entry("/assets/app-Ab3F09.js", [lowerFingerprint, upperFingerprint]),
  ];
};

test("security normalization reduces headers and cookies without retaining raw values", () => {
  assert.deepEqual(parseSecurityCookie("session_id=private; Secure; HttpOnly; SameSite=Lax"), {
    name: "session_id",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
  });
  assert.equal(parseSecurityCookie("preference=private; Secure"), undefined);
  const first = createSecurityFingerprint(response());
  const second = createSecurityFingerprint(
    response({
      headers: {
        ...response().headers,
        contentSecurityPolicy:
          "default-src 'self'; script-src 'self' 'nonce-a-different-private-value'",
      },
    }),
  );
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("private-value"), false);
});

test("security analyzer inventories first-party document posture and strips paths and values", async () => {
  const analyzer = new SecurityPostureAnalyzer({ origins: ["https://app.example.test"] });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
  });
  host.emit({ type: "security-response", meta: metadata.create(), response: response() });
  host.emit({
    type: "security-response",
    meta: metadata.create(),
    response: response({ url: "https://external.example.test/private" }),
  });
  const result = await host.finalizeTest({ test: testMetadata, capabilities });
  const security = result.results.get("security");
  assert.equal(security.coverage, "complete");
  assert.equal(security.inventory.length, 1);
  assert.equal(security.inventory[0].endpoint, "/dashboard");
  const serialized = JSON.stringify(security);
  assert.equal(serialized.includes("person@example.test"), false);
  assert.equal(serialized.includes("private-value"), false);
  host.dispose();
});

test("security target identities share endpoint canonicalization across dynamic instances", async () => {
  const analyzer = new SecurityPostureAnalyzer({ origins: ["https://app.example.test"] });
  const host = new AnalyzerHost([analyzer]);
  const metadata = new RuntimeEventMetadataFactory({
    testId: testMetadata.testId,
    projectName: testMetadata.projectName,
  });
  for (const url of [
    "https://app.example.test/members/q7_amber_forest_/notes/cmt3ab4cd5ef6gh7ij8kl9mn0.data",
    "https://app.example.test/members/m2_silver_harbor_/notes/cmx9zy8wv7ut6sr5qp4on3ml2.data",
  ]) {
    host.emit({
      type: "security-response",
      meta: metadata.create(),
      response: response({ url, resourceType: "fetch", cookies: [] }),
    });
  }

  const result = await host.finalizeTest({ test: testMetadata, capabilities });
  const security = result.results.get("security");
  assert.equal(security.inventory.length, 1);
  assert.equal(security.inventory[0].endpoint, "/members/:id/notes/:id.data");
  assert.equal(security.inventory[0].occurrenceCount, 2);
  host.dispose();
});

test("security baseline comparison reports only changes to known targets", () => {
  const strong = createSecurityFingerprint(response());
  const initialInventory = [inventoryEntry(strong)];
  const initial = compareSecurityBaseline(initialInventory);
  assert.equal(initial.newTargets.length, 1);
  assert.equal(initial.findings.length, 0);
  const baseline = {
    schemaVersion: 1,
    createdAt: "2026-08-21T12:00:00.000Z",
    entries: createSecurityBaselineEntries(initialInventory),
  };
  const known = compareSecurityBaseline(initialInventory, baseline);
  assert.equal(known.known.length, 1);
  assert.equal(known.findings.length, 0);

  const weak = createSecurityFingerprint(
    response({
      headers: { accessControlAllowOrigin: "*", accessControlAllowCredentials: "true" },
      cookies: [{ name: "session_id", secure: false, httpOnly: false, sameSite: "unspecified" }],
    }),
  );
  const changed = compareSecurityBaseline([inventoryEntry(weak)], baseline);
  assert.equal(changed.changed.length, 1);
  assert.deepEqual(changed.findings.map((finding) => finding.ruleId).sort(), [
    "SECURITY_COOKIE_CHANGED",
    "SECURITY_CORS_CHANGED",
    "SECURITY_CSP_CHANGED",
    "SECURITY_HSTS_CHANGED",
    "SECURITY_XCTO_CHANGED",
  ]);
  assert.equal(compareSecurityBaseline([], baseline).resolved.length, 1);
});

test("security aggregation is bounded, deterministic, and retains least-complete coverage", () => {
  const fingerprint = createSecurityFingerprint(response());
  const target = new Map();
  mergeSecurityInventory(target, [inventoryEntry(fingerprint)]);
  mergeSecurityInventory(target, [
    inventoryEntry(fingerprint, {
      firstSeenTests: [{ file: "tests/account.spec.ts", project: "chromium" }],
      occurrenceCount: 2,
    }),
  ]);
  const merged = sortedSecurityInventory(target)[0];
  assert.equal(merged.occurrenceCount, 3);
  assert.deepEqual(
    merged.firstSeenTests.map((reference) => reference.file),
    ["tests/account.spec.ts", "tests/dashboard.spec.ts"],
  );
  assert.equal(leastCompleteSecurityCoverage("complete", "partial"), "partial");
});

test("security attachments canonically order mixed-case fingerprints, cookies, and paths", () => {
  const attachment = createSecurityAttachment(
    {
      analyzerId: "security",
      coverage: "complete",
      inventory: adversarialSecurityInventory(),
      diagnostics: [],
    },
    { failed: false },
  );

  assert.deepEqual(
    attachment.inventory.map((entry) => entry.endpoint),
    ["/assets/app-Ab3F09.js", "/assets/app-aB3f09.js"],
  );
  for (const entry of attachment.inventory) {
    assert.deepEqual(entry.firstSeenTests, canonicalAdversarialTestReferences);
    assert.deepEqual(
      entry.fingerprints.map((fingerprint) => fingerprint.csp),
      ["present:sha256:Ab3F09", "present:sha256:aB3f09"],
    );
    for (const fingerprint of entry.fingerprints) {
      assert.deepEqual(
        fingerprint.cookies.map((cookie) => cookie.name),
        ["%session", ".session"],
      );
    }
  }
  assert.deepEqual(parseSecurityAttachment(structuredClone(attachment)), attachment);

  const nonCanonical = structuredClone(attachment);
  nonCanonical.inventory[0].fingerprints.reverse();
  assert.equal(parseSecurityAttachment(nonCanonical), undefined);

  const duplicate = structuredClone(attachment);
  duplicate.inventory[0].fingerprints.push(structuredClone(duplicate.inventory[0].fingerprints[0]));
  assert.equal(parseSecurityAttachment(duplicate), undefined);
});

test("security artifacts are strict, private, and reject raw fields", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-security-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const latestPath = join(directory, "latest.json");
  const baselinePath = join(directory, "baseline.json");
  const reportPath = join(directory, "report.json");
  const oversizedPath = join(directory, "oversized.json");
  const inventory = adversarialSecurityInventory();
  const entries = createSecurityBaselineEntries(inventory);
  const attachment = createSecurityAttachment(
    {
      analyzerId: "security",
      coverage: "complete",
      inventory: inventory.slice().reverse(),
      diagnostics: [],
    },
    { failed: false },
  );
  assert.deepEqual(parseSecurityAttachment(JSON.parse(JSON.stringify(attachment))), attachment);
  assert.equal(
    parseSecurityAttachment({ ...attachment, rawHeaders: { authorization: "private" } }),
    undefined,
  );
  await writeSecurityLatestRunFile(latestPath, entries.toReversed(), {
    complete: true,
    createdAt: "2026-08-21T12:00:00.000Z",
  });
  const latest = await readCompleteSecurityLatestRunFile(latestPath);
  assert.deepEqual(parseSecurityLatestRun(structuredClone(latest)), latest);
  const baseline = await writeSecurityBaselineFile(baselinePath, latest.entries.toReversed(), {
    createdAt: "2026-08-21T12:00:00.000Z",
  });
  assert.deepEqual(await readSecurityBaselineFile(baselinePath), baseline);
  assert.deepEqual(parseSecurityBaseline(structuredClone(baseline)), baseline);
  assert.throws(
    () => parseSecurityBaseline({ ...baseline, entries: baseline.entries.toReversed() }),
    /entries/u,
  );
  const strong = createSecurityFingerprint(response());
  const weak = createSecurityFingerprint(
    response({
      headers: { accessControlAllowOrigin: "*", accessControlAllowCredentials: "true" },
      cookies: [{ name: "session_id", secure: false, httpOnly: false, sameSite: "unspecified" }],
    }),
  );
  const findings = compareSecurityBaseline([inventoryEntry(weak)], {
    schemaVersion: 1,
    createdAt: "2026-08-21T12:00:00.000Z",
    entries: createSecurityBaselineEntries([inventoryEntry(strong)]),
  }).findings;
  const report = {
    schemaVersion: 1,
    generatedAt: "2026-08-21T12:00:00.000Z",
    complete: true,
    coverage: "complete",
    inventory: inventory.slice().reverse(),
    findings: findings.toReversed(),
    baseline: { exists: true, known: 0, changed: 1, newTargets: 0, resolved: 0 },
    diagnostics: [],
  };
  await writeSecurityReport(reportPath, report);
  const writtenReport = await readSecurityReport(reportPath);
  assert.deepEqual(
    parseSecurityReport(JSON.parse(await readFile(reportPath, "utf8"))),
    writtenReport,
  );
  assert.deepEqual(
    writtenReport.inventory.map((entry) => entry.endpoint),
    ["/assets/app-Ab3F09.js", "/assets/app-aB3f09.js"],
  );
  assert.throws(
    () => parseSecurityReport({ ...writtenReport, findings: writtenReport.findings.toReversed() }),
    /content/u,
  );
  assert.throws(() => parseSecurityReport({ ...writtenReport, schemaVersion: 2 }), /schema/u);
  await writeFile(oversizedPath, Buffer.alloc(MAX_SECURITY_ARTIFACT_BYTES + 1));
  await assert.rejects(readSecurityReport(oversizedPath), /bounded regular file/u);
  for (const path of [latestPath, baselinePath, reportPath]) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const serialized = await readFile(path, "utf8");
    assert.equal(serialized.includes("person@example.test"), false);
    assert.equal(serialized.includes("never-persist"), false);
    assert.equal(serialized.includes("rawHeaders"), false);
  }
});

test("security findings map only to pinned authoritative ASVS controls", () => {
  assert.deepEqual(Object.keys(SECURITY_TECHNICAL_CONTROLS).sort(), [
    "SECURITY_COOKIE_CHANGED",
    "SECURITY_CORS_CHANGED",
    "SECURITY_CSP_CHANGED",
    "SECURITY_HSTS_CHANGED",
    "SECURITY_TRANSPORT_CHANGED",
    "SECURITY_XCTO_CHANGED",
  ]);
  for (const controls of Object.values(SECURITY_TECHNICAL_CONTROLS)) {
    for (const control of controls) {
      assert.equal(control.version, "5.0.0");
      assert.match(control.control, /^v5\.0\.0-3\.[34]\./u);
      assert.match(control.sourceUrl, /v5\.0\.0_release/u);
    }
  }
});
