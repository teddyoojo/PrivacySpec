import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createTestDataObservations,
  normalizeSyntheticEmailDomains,
} from "../dist/testdata/classify.js";
import { createTestDataSection } from "../dist/testdata/create.js";
import { TEST_DATA_SCHEMA_VERSION } from "../dist/testdata/model.js";
import {
  renderPrivacySpecTestData,
  renderTestDataMarkdown,
  renderTestDataTerminal,
} from "../dist/testdata/render.js";
import { parseTestDataSection } from "../dist/testdata/validate.js";
import { writeTestDataOutput } from "../dist/testdata/write.js";

const testAttribution = {
  file: "tests/customer.spec.ts",
  title: "customer can be created",
  project: "chromium",
};

const controlSource = (raw, overrides = {}) => ({
  kind: "control",
  raw,
  category: "personal.email",
  confidence: "high",
  evidence: [{ kind: "input-type", value: "email" }],
  control: { elementKind: "input", type: "email" },
  pageUrl: "https://app.example.test/customers/new",
  timestamp: 1,
  observedBy: "event",
  ...overrides,
});

test("IANA-reserved example and special-use email domains are synthetic", () => {
  const domains = [
    "example",
    "example.com",
    "sub.example.net",
    "example.org",
    "invalid",
    "sub.invalid",
    "localhost",
    "test",
    "deep.example.test",
  ];
  const observations = createTestDataObservations(
    domains.map((domain, index) => controlSource(`reserved-${index}@${domain}`)),
    [],
    testAttribution,
  );
  assert.equal(observations.length, 1);
  assert.equal(
    observations.every((item) => item.verdict === "SYNTHETIC"),
    true,
  );
  assert.equal(
    observations.every((item) => item.signal === "IANA_RESERVED_EMAIL_DOMAIN"),
    true,
  );
});

test("configured synthetic domains match themselves and subdomains after IDNA normalization", () => {
  const configured = normalizeSyntheticEmailDomains([
    "QA.Example.Internal.",
    "b\u00fccher.qa",
    "qa.example.internal",
  ]);
  assert.deepEqual(configured, ["qa.example.internal", "xn--bcher-kva.qa"]);

  const observations = createTestDataObservations(
    [
      controlSource("configured@qa.example.internal"),
      controlSource("subdomain@team.qa.example.internal"),
      controlSource("unicode@shop.b\u00fccher.qa"),
      controlSource("punycode@xn--bcher-kva.qa"),
    ],
    configured,
    testAttribution,
  );
  assert.equal(observations.length, 1);
  assert.equal(
    observations.every((item) => item.verdict === "SYNTHETIC"),
    true,
  );
  assert.equal(
    observations.every((item) => item.signal === "CONFIGURED_SYNTHETIC_EMAIL_DOMAIN"),
    true,
  );
});

test("valid non-reserved domains require review without routability or person claims", () => {
  const [observation] = createTestDataObservations(
    [controlSource("review@phase16-corporate.dev")],
    [],
    testAttribution,
  );
  assert.equal(observation?.verdict, "REVIEW_REQUIRED");
  assert.equal(observation?.signal, "EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC");
  const section = createTestDataSection(observation === undefined ? [] : [observation]);
  const serialized = JSON.stringify(section);
  assert.doesNotMatch(serialized, /phase16-corporate|review@/u);
  assert.match(serialized, /does not establish that the value belongs to a real person/u);
  assert.match(serialized, /or that the domain is externally routable/u);
});

test("malformed email values and unsupported sources/categories remain unassessed", () => {
  const expandedCategories = [
    "personal.name",
    "personal.postal_address",
    "personal.date_of_birth",
    "personal.account_identifier",
    "personal.payment_card",
    "personal.gender_identity",
    "personal.job_title",
    "custom.personal.acme.benefit_code",
    "custom.secret.acme.employee_pin",
  ];
  const responseSource = {
    kind: "response-json",
    raw: "response@example.test",
    category: "personal.email",
    confidence: "high",
    evidence: [{ kind: "json-key", value: "email" }],
    provenance: {
      origin: "https://app.example.test",
      endpoint: "/api/profile",
      location: "json.email",
    },
    timestamp: 1,
    observedBy: "response",
  };
  const observations = createTestDataObservations(
    [
      controlSource("not-an-email"),
      controlSource("double@@example.test"),
      controlSource("unicode-local-\u00e4@example.test"),
      controlSource("phone-value", {
        category: "personal.phone",
        control: { elementKind: "input", type: "tel" },
      }),
      ...expandedCategories.map((category, index) =>
        controlSource(`synthetic-${category.replaceAll(".", "-")}`, {
          category,
          control: {
            elementKind: index === 5 ? "select" : "input",
            autocomplete: "semantic-fixture",
          },
        }),
      ),
      responseSource,
    ],
    [],
    testAttribution,
  );
  assert.equal(observations.length, 12);
  assert.equal(
    observations.every((item) => item.verdict === "UNASSESSED"),
    true,
  );
  assert.equal(observations.filter((item) => item.signal === "EMAIL_SHAPE_UNSUPPORTED").length, 1);
  assert.equal(observations.filter((item) => item.signal === "UNSUPPORTED_CATEGORY").length, 10);
  assert.equal(
    observations.some((item) => item.signal === "UNSUPPORTED_SOURCE_KIND"),
    true,
  );
  const parsed = parseTestDataSection(createTestDataSection(observations));
  assert.deepEqual(
    parsed?.observations
      .filter((item) => expandedCategories.includes(item.category))
      .map((item) => item.category)
      .toSorted(),
    expandedCategories.toSorted(),
  );
});

test("hygiene observations deduplicate deterministically and redact values and domains", () => {
  const raw = "private-fixture@phase16-private.dev";
  const source = controlSource(raw);
  const observations = createTestDataObservations([source, structuredClone(source)], [], {
    file: "tests/customer.spec.ts",
    title: `customer ${raw} phase16-private.dev`,
    project: "chromium",
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.attribution.test.title, ":redacted");
  const serialized = JSON.stringify(observations);
  for (const forbidden of [
    raw,
    raw.toLowerCase(),
    raw.toUpperCase(),
    encodeURIComponent(raw),
    "phase16-private.dev",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("test-data sections validate strict fields, counts, paths, and controls", () => {
  const observations = createTestDataObservations(
    [controlSource("valid@example.test")],
    [],
    testAttribution,
  );
  const section = createTestDataSection(observations);
  assert.equal(section.testDataSchemaVersion, TEST_DATA_SCHEMA_VERSION);
  assert.deepEqual(parseTestDataSection(structuredClone(section)), section);

  for (const malformed of [
    { ...structuredClone(section), testDataSchemaVersion: 2 },
    { ...structuredClone(section), summary: { ...section.summary, total: 99 } },
    { ...structuredClone(section), extra: true },
    {
      ...structuredClone(section),
      observations: section.observations.map((item) => ({
        ...item,
        attribution: { ...item.attribution, test: { ...item.attribution.test, file: "/tmp/x" } },
      })),
    },
    {
      ...structuredClone(section),
      observations: section.observations.map((item) => ({ ...item, signal: "RAW_VALUE" })),
    },
  ]) {
    assert.equal(parseTestDataSection(malformed), undefined);
  }
});

test("terminal, JSON, and Markdown output are deterministic and private", async (context) => {
  const section = createTestDataSection(
    createTestDataObservations(
      [controlSource("synthetic@example.test"), controlSource("review@phase16-review.dev")],
      [],
      testAttribution,
    ),
  );
  const report = {
    ...section,
    tool: { name: "privacyspec", version: "0.1.0-beta.4" },
    sourceReport: {
      schemaVersion: 2,
      generatedAt: "2026-08-20T12:00:00.000Z",
      complete: false,
      status: "incomplete",
      testDataAvailable: true,
      projects: ["chromium"],
      tests: {
        total: 2,
        observed: 1,
        passed: 1,
        failed: 1,
        timedOut: 0,
        skipped: 0,
        interrupted: 0,
      },
    },
  };
  const terminal = renderTestDataTerminal(report);
  const markdown = renderTestDataMarkdown(report);
  const json = renderPrivacySpecTestData(report, "json");
  assert.match(terminal, /Source run: INCOMPLETE/u);
  assert.match(terminal, /REVIEW_REQUIRED EMAIL_DOMAIN_NOT_RECOGNIZED_AS_SYNTHETIC/u);
  assert.match(markdown, /# PrivacySpec Test-Data Hygiene/u);
  assert.match(json, /"testDataSchemaVersion": 1/u);
  assert.equal(renderPrivacySpecTestData(report, "terminal"), terminal);
  assert.equal(renderPrivacySpecTestData(report, "markdown"), markdown);
  for (const output of [terminal, markdown, json]) {
    assert.doesNotMatch(output, /synthetic@example|review@|phase16-review\.dev/u);
  }

  const directory = await mkdtemp(join(tmpdir(), "privacyspec-testdata-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "testdata.json");
  await writeTestDataOutput(path, json);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await readFile(path, "utf8"), json);
});

test("configured domain validation is bounded and never echoes rejected domains", () => {
  assert.throws(
    () => normalizeSyntheticEmailDomains(["https://unsafe.example"]),
    (error) => error instanceof TypeError && !error.message.includes("unsafe.example"),
  );
  assert.throws(
    () =>
      normalizeSyntheticEmailDomains(Array.from({ length: 101 }, (_, index) => `qa${index}.test`)),
    /at most 100/u,
  );
});
