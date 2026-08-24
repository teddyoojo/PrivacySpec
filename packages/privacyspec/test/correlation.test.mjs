import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { classifyRecipient } from "../dist/correlate/first-party.js";
import { correlateSensitiveData } from "../dist/correlate/match.js";
import { MAX_NORMALIZED_PATH_LENGTH, normalizePath } from "../dist/correlate/redact.js";
import { createRedactionValues } from "../dist/correlate/transforms.js";

const TEST_METADATA = {
  file: "tests/customer.spec.ts",
  title: "customer details can be edited",
  project: "chromium",
};

const source = (raw, category = "personal.email") => ({
  raw,
  category,
  confidence: "high",
  evidence: [
    {
      kind: "input-type",
      value:
        category === "personal.email"
          ? "email"
          : category === "personal.phone"
            ? "tel"
            : "password",
    },
  ],
  control: {
    elementKind: "input",
    type:
      category === "personal.email" ? "email" : category === "personal.phone" ? "tel" : "password",
  },
  pageUrl: "https://app.example.test/form",
  timestamp: 1,
  observedBy: "event",
});

const network = (overrides = {}) => ({
  kind: "network",
  url: "https://app.example.test/collect",
  method: "POST",
  resourceType: "fetch",
  headers: {},
  bodyKind: "json",
  bodySize: 0,
  bodyTruncated: false,
  materials: [],
  pageUrl: "https://app.example.test/form",
  timestamp: 2,
  ...overrides,
});

const correlate = ({ sources, sinks = [], pageUrls, firstParty, metadata } = {}) =>
  correlateSensitiveData({
    sources,
    sinks,
    pageUrls,
    firstParty: firstParty ?? { origins: ["https://app.example.test"] },
    test: metadata ?? TEST_METADATA,
  });

const flowAt = (flows, location) => flows.find((flow) => flow.location === location);

test("exact values correlate to a sanitized first-party request body flow", () => {
  const raw = ["exact.user", "fixture.example"].join("@");
  const result = correlate({
    sources: [source(raw)],
    sinks: [
      network({
        url: "https://app.example.test/customers",
        bodySize: raw.length,
        materials: [{ location: "json.customer.email", value: raw }],
      }),
    ],
  });

  assert.equal(result.limitReached, false);
  assert.deepEqual(result.flows, [
    {
      kind: "data-flow",
      dataCategory: "personal.email",
      sourceKind: "form-input",
      sourceConfidence: "high",
      sinkKind: "request-body",
      requestSurface: "browser",
      recipient: {
        origin: "https://app.example.test",
        host: "app.example.test",
        firstParty: true,
      },
      method: "POST",
      endpoint: "/customers",
      location: "json.customer.email",
      transform: "EXACT",
      test: TEST_METADATA,
    },
  ]);
});

test("percent and form URL encodings correlate without decoding the sink first", () => {
  const raw = ["URL value", "with spaces", "+plus", "unicode-ß"].join("-");
  const percentEncoded = encodeURIComponent(raw);
  const formEncoded = new URLSearchParams([["value", raw]]).toString().slice("value=".length);
  const result = correlate({
    sources: [source(raw, "secret.password")],
    sinks: [
      network({
        url: `https://app.example.test/collect?secret=${percentEncoded}`,
        bodyKind: "none",
      }),
      network({
        url: "https://app.example.test/form-submit",
        bodyKind: "form",
        bodySize: formEncoded.length,
        materials: [{ location: "form.secret", value: formEncoded }],
      }),
    ],
  });

  assert.equal(result.flows.length, 2);
  assert.deepEqual(
    result.flows.map(({ location, sinkKind, transform }) => ({
      location,
      sinkKind,
      transform,
    })),
    [
      {
        location: "form.secret",
        sinkKind: "request-body",
        transform: "URL_ENCODED",
      },
      {
        location: "url.query.secret",
        sinkKind: "request-url",
        transform: "URL_ENCODED",
      },
    ],
  );
});

test("Base64 matching uses the UTF-8 representation for Unicode values", () => {
  const raw = ["pässwort", "漢字", "🔐"].join("-");
  const encoded = Buffer.from(raw, "utf8").toString("base64");
  const result = correlate({
    sources: [source(raw, "secret.password")],
    sinks: [
      {
        kind: "console",
        level: "warn",
        materials: [{ location: "console.argument.0", value: encoded }],
        argumentCount: 1,
        timestamp: 2,
      },
    ],
  });

  assert.equal(result.flows.length, 1);
  assert.equal(result.flows[0]?.sinkKind, "console");
  assert.equal(result.flows[0]?.transform, "BASE64");
});

test("Base64 container matching is stable across encoded JSON byte alignment", () => {
  const raw = ["container.user", "fixture.example"].join("@");
  const results = [0, 1, 2].map((padding) =>
    correlate({
      sources: [source(raw)],
      sinks: [
        {
          kind: "storage",
          storageType: "cookie",
          key: `auth-${padding}`,
          value: Buffer.from(
            JSON.stringify({ padding: "x".repeat(padding), profile: { email: raw } }),
          ).toString("base64"),
          pageUrl: "https://app.example.test/",
          observedBy: "snapshot",
          timestamp: 2,
        },
      ],
    }),
  );

  assert.deepEqual(
    results.map((result) => result.flows.map((flow) => flow.transform)),
    [["BASE64"], ["BASE64"], ["BASE64"]],
  );
});

test("ambient cookie propagation collapses asset fan-out before reporting", () => {
  const raw = ["response.user", "fixture.example"].join("@");
  const encodedProfile = Buffer.from(JSON.stringify({ profile: { email: raw } })).toString(
    "base64",
  );
  const responseSource = {
    kind: "response-json",
    raw,
    category: "personal.email",
    confidence: "high",
    evidence: [{ kind: "json-key", value: "email" }],
    provenance: {
      origin: "https://app.example.test",
      endpoint: "/api/profile",
      location: "json.profile.email",
    },
    timestamp: 1,
    observedBy: "response",
  };
  const asset = (endpoint) =>
    network({
      url: `https://app.example.test${endpoint}`,
      method: "GET",
      resourceType: "script",
      headers: { cookie: `auth_token=${encodedProfile}` },
      materials: [{ location: "header.cookie.auth_token", value: encodedProfile }],
      timestamp: 2,
    });

  const result = correlate({
    sources: [responseSource],
    sinks: [asset("/assets/one.js"), asset("/assets/two.js"), asset("/assets/three.js")],
  });

  assert.equal(result.flows.length, 1);
  assert.deepEqual(result.flows[0], {
    kind: "data-flow",
    dataCategory: "personal.email",
    sourceKind: "response-json",
    sourceConfidence: "high",
    sourceProvenance: responseSource.provenance,
    sinkKind: "request-header",
    requestSurface: "browser",
    recipient: {
      origin: "https://app.example.test",
      host: "app.example.test",
      firstParty: true,
    },
    location: "header.cookie.auth_token",
    transform: "BASE64",
    test: TEST_METADATA,
  });
});

test("mixed-case email values correlate through lowercase and uppercase variants", () => {
  const raw = ["Case.Sensitive", "Example.Test"].join("@");
  const result = correlate({
    sources: [source(raw)],
    sinks: [
      network({
        materials: [
          { location: "json.lower", value: raw.toLowerCase() },
          { location: "json.upper", value: raw.toUpperCase() },
        ],
      }),
    ],
  });

  assert.equal(flowAt(result.flows, "json.lower")?.transform, "LOWERCASE");
  assert.equal(flowAt(result.flows, "json.upper")?.transform, "UPPERCASE");
  assert.equal(result.flows.length, 2);
});

test("SHA-256 matching distinguishes raw values from normalized mixed-case email", () => {
  const secret = ["hash", "fixture", "credential"].join("-");
  const mixedCaseEmail = ["Hash.User", "Example.Test"].join("@");
  const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

  const rawHashResult = correlate({
    sources: [source(secret, "secret.password")],
    sinks: [
      network({
        materials: [{ location: "json.secret_digest", value: sha256(secret) }],
      }),
    ],
  });
  const normalizedHashResult = correlate({
    sources: [source(mixedCaseEmail)],
    sinks: [
      network({
        materials: [
          {
            location: "json.email_digest",
            value: sha256(mixedCaseEmail.toLowerCase()),
          },
        ],
      }),
    ],
  });

  assert.equal(rawHashResult.flows[0]?.transform, "SHA256");
  assert.equal(normalizedHashResult.flows[0]?.transform, "SHA256_NORMALIZED");
});

test("network correlation preserves semantic URL, header, JSON, and form locations", () => {
  const values = {
    path: ["Path", "Sensitive", "901"].join(""),
    query: ["Query", "Sensitive", "902"].join(""),
    header: ["Header", "Sensitive", "903"].join(""),
    json: ["Json", "Sensitive", "904"].join(""),
    form: ["Form", "Sensitive", "905"].join(""),
  };
  const result = correlate({
    sources: Object.values(values).map((value) => source(value, "secret.password")),
    sinks: [
      network({
        url: `https://app.example.test/${values.path}?contact=${values.query}`,
        headers: { "x-contact": values.header },
        materials: [
          { location: "url.path", value: `/${values.path}` },
          { location: "url.query.contact", value: values.query },
          { location: "header.x-contact", value: values.header },
          { location: "json.profile.secret", value: values.json },
          { location: "form.phone", value: values.form },
        ],
      }),
    ],
  });

  assert.equal(result.flows.length, 5);
  assert.deepEqual(Object.fromEntries(result.flows.map((flow) => [flow.location, flow.sinkKind])), {
    "form.phone": "request-body",
    "header.x-contact": "request-header",
    "json.profile.secret": "request-body",
    "url.path": "request-url",
    "url.query.contact": "request-url",
  });
  assert.equal(
    result.flows.every((flow) => flow.transform === "EXACT"),
    true,
  );
});

test("storage snapshots and console fallback text do not duplicate semantic flows", () => {
  const raw = ["dedupe.user", "fixture.example"].join("@");
  const storageSink = {
    kind: "storage",
    storageType: "local-storage",
    key: "profile",
    value: raw,
    pageUrl: "https://app.example.test/account",
    observedBy: "write",
    timestamp: 2,
  };
  const consoleSink = {
    kind: "console",
    level: "log",
    materials: [
      { location: "console.argument.0.email", value: raw },
      { location: "console.text", value: `customer ${raw}` },
    ],
    argumentCount: 1,
    timestamp: 4,
  };
  const result = correlate({
    sources: [source(raw)],
    sinks: [
      storageSink,
      { ...storageSink, observedBy: "snapshot", timestamp: 3 },
      consoleSink,
      { ...consoleSink, timestamp: 5 },
    ],
  });

  assert.deepEqual(
    result.flows.map(({ sinkKind, location }) => ({ sinkKind, location })),
    [
      { sinkKind: "console", location: "console.argument.0.email" },
      { sinkKind: "local-storage", location: "profile" },
    ],
  );
});

test("the current page URL participates in correlation without a network sink", () => {
  const raw = ["page.user", "fixture.example"].join("@");
  const result = correlate({
    sources: [source(raw)],
    pageUrls: [`https://app.example.test/account?email=${encodeURIComponent(raw)}`],
  });

  assert.equal(result.flows.length, 1);
  assert.deepEqual(result.flows[0], {
    kind: "data-flow",
    dataCategory: "personal.email",
    sourceKind: "form-input",
    sourceConfidence: "high",
    sinkKind: "request-url",
    requestSurface: "browser",
    recipient: {
      origin: "https://app.example.test",
      host: "app.example.test",
      firstParty: true,
    },
    endpoint: "/account",
    location: "url.query.email",
    transform: "URL_ENCODED",
    test: TEST_METADATA,
  });
});

test("first-party origins require exact ports unless an explicit host is configured", () => {
  const originConfig = { origins: ["https://app.example.test/some/path"] };

  assert.deepEqual(classifyRecipient("https://app.example.test/api", originConfig), {
    origin: "https://app.example.test",
    host: "app.example.test",
    firstParty: true,
    valid: true,
  });
  assert.equal(
    classifyRecipient("https://app.example.test:8443/api", originConfig).firstParty,
    false,
  );
  assert.equal(classifyRecipient("https://api.example.test/api", originConfig).firstParty, false);
  assert.equal(
    classifyRecipient("https://app.example.test:8443/api", {
      hosts: ["APP.EXAMPLE.TEST."],
    }).firstParty,
    true,
  );
});

test("unrelated and semantically unsupported case variants do not correlate", () => {
  const secret = ["Case", "Sensitive", "Credential", "927"].join("");
  const result = correlate({
    sources: [source(secret, "secret.password")],
    sinks: [
      network({
        materials: [
          { location: "json.unrelated", value: "ordinary fixture value" },
          { location: "json.lower", value: secret.toLowerCase() },
          { location: "json.upper", value: secret.toUpperCase() },
        ],
      }),
      {
        kind: "console",
        level: "log",
        materials: [{ location: "console.text", value: secret.slice(0, -1) }],
        argumentCount: 0,
        timestamp: 3,
      },
    ],
    pageUrls: ["https://app.example.test/account?status=ordinary"],
  });

  assert.deepEqual(result, { flows: [], limitReached: false });
});

test("control sources correlate across the isolated test regardless of delivery order", () => {
  const raw = ["temporal.user", "fixture.example"].join("@");
  const earlierSink = network({
    timestamp: 9,
    materials: [{ location: "json.earlier", value: raw }],
  });
  const laterSink = network({
    timestamp: 11,
    materials: [{ location: "json.later", value: raw }],
  });
  const eventSource = { ...source(raw), timestamp: 10 };

  const eventResult = correlate({
    sources: [eventSource],
    sinks: [earlierSink, laterSink],
  });
  const fallbackResult = correlate({
    sources: [{ ...eventSource, observedBy: "fallback" }],
    sinks: [earlierSink],
  });

  assert.deepEqual(
    eventResult.flows.map((flow) => flow.location),
    ["json.earlier", "json.later"],
  );
  assert.deepEqual(
    fallbackResult.flows.map((flow) => flow.location),
    ["json.earlier"],
  );
});

test("normalized endpoints have a hard total-length bound", () => {
  const oversizedPath = "/x".repeat(1_000_000);
  const normalized = normalizePath(oversizedPath, []);

  assert.equal(normalized.length, MAX_NORMALIZED_PATH_LENGTH);
  assert.equal(normalized.endsWith("/:truncated"), true);
});

test("path normalization emits stable tokens for common dynamic identifiers", () => {
  assert.equal(normalizePath("/api/customer/12345", []), "/api/customer/:number");
  assert.equal(normalizePath("/api/customer/67890", []), "/api/customer/:number");
  assert.equal(
    normalizePath("/api/customer/550e8400-e29b-41d4-a716-446655440000", []),
    "/api/customer/:uuid",
  );
  assert.equal(normalizePath("/api/customer/0123456789abcdef01234567", []), "/api/customer/:id");
  assert.equal(normalizePath("/api/discussions/Td_vr2mldQB0a2vOshEZ3", []), "/api/discussions/:id");
  assert.equal(normalizePath("/api/customer/customer-slug", []), "/api/customer/customer-slug");
});

test("path normalization redacts sensitive values that span path segments", () => {
  const raw = "cross/segment/secret";
  const normalized = normalizePath(`/account/${raw}/details`, [raw]);

  assert.equal(normalized.includes(raw), false);
  assert.equal(normalized.includes(":redacted"), true);
});

test("long external URLs retain recipient semantics for matching request bodies", () => {
  const raw = "long-url-body-secret-927";
  const result = correlate({
    sources: [source(raw, "secret.password")],
    sinks: [
      network({
        url: `https://collector.example.test/${"x".repeat(9_000)}`,
        materials: [{ location: "json.password", value: raw }],
      }),
    ],
  });

  assert.equal(result.limitReached, true);
  assert.equal(result.flows.length, 1);
  assert.equal(result.flows[0]?.sinkKind, "external-request");
  assert.deepEqual(result.flows[0]?.recipient, {
    origin: "https://collector.example.test",
    host: "collector.example.test",
    firstParty: false,
  });
});

test("correlation stops at the per-test data-flow output limit", () => {
  const raw = "bounded-flow-secret-927";
  const result = correlate({
    sources: [source(raw, "secret.password")],
    sinks: [
      network({
        materials: Array.from({ length: 2_001 }, (_, index) => ({
          location: `json.values.${index}`,
          value: raw,
        })),
      }),
    ],
  });

  assert.equal(result.limitReached, true);
  assert.equal(result.flows.length, 2_000);
});

test("serialized flows redact every source representation and sensitive test metadata", () => {
  const raw = ["Private.Person+tag", "Sensitive.Example"].join("@");
  const sensitiveSource = source(raw);
  const representations = createRedactionValues([sensitiveSource]);
  const encoded = encodeURIComponent(raw);
  const base64 = Buffer.from(raw, "utf8").toString("base64");
  const rawHash = createHash("sha256").update(raw, "utf8").digest("hex");
  const normalizedHash = createHash("sha256").update(raw.toLowerCase(), "utf8").digest("hex");
  const result = correlate({
    sources: [sensitiveSource],
    sinks: [
      network({
        url: `https://collector.example.test/leak/${encoded}?digest=${normalizedHash}`,
        materials: [
          { location: `json.${base64}`, value: raw },
          { location: "json.raw_hash", value: rawHash },
        ],
      }),
    ],
    firstParty: { origins: ["https://app.example.test"] },
    metadata: {
      file: `tests/${raw}/${encoded}.spec.ts`,
      title: `submits ${base64} to ${rawHash}`,
      project: `project-${raw.toUpperCase()}-${normalizedHash}`,
    },
  });

  assert.equal(result.flows.length > 0, true);
  assert.equal(
    result.flows.every(
      (flow) =>
        flow.test.file === ":redacted" &&
        flow.test.title === ":redacted" &&
        flow.test.project === ":redacted",
    ),
    true,
  );
  const serialized = JSON.stringify(result.flows);
  for (const representation of representations) {
    assert.equal(
      serialized.includes(representation),
      false,
      `serialized flow retained sensitive representation: ${representation}`,
    );
  }
});
