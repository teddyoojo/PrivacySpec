import assert from "node:assert/strict";
import test from "node:test";

import { RULE_DEFINITIONS } from "../dist/rules/definitions.js";
import { evaluateDataFlows } from "../dist/rules/engine.js";

const TEST_METADATA = {
  file: "tests/customer.spec.ts",
  title: "customer can be edited",
  project: "chromium",
};

const flow = (overrides = {}) => ({
  kind: "data-flow",
  dataCategory: "personal.email",
  sourceKind: "form-input",
  sourceConfidence: "high",
  sinkKind: "request-body",
  recipient: {
    origin: "https://app.example.test",
    host: "app.example.test",
    firstParty: true,
  },
  method: "POST",
  endpoint: "/api/customers",
  location: "json.email",
  transform: "EXACT",
  test: TEST_METADATA,
  ...overrides,
});

const ruleIds = (flows, config) => evaluateDataFlows(flows, config).map(({ ruleId }) => ruleId);

test("the rule registry exposes exactly the six stable technical rule IDs", () => {
  assert.deepEqual(Object.keys(RULE_DEFINITIONS), [
    "PS1001",
    "PS1002",
    "PS1003",
    "PS1004",
    "PS1005",
    "PS1006",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.values(RULE_DEFINITIONS).map((definition) => [
        definition.id,
        [definition.defaultSeverity, definition.defaultClassification],
      ]),
    ),
    {
      PS1001: ["warning", "review_required"],
      PS1002: ["error", "technical_failure"],
      PS1003: ["critical", "technical_failure"],
      PS1004: ["warning", "review_required"],
      PS1005: ["warning", "review_required"],
      PS1006: ["error", "technical_failure"],
    },
  );
});

test("PS1001 distinguishes contextual personal data from secrets in URLs", () => {
  const firstPartyUrl = flow({ sinkKind: "request-url", location: "url.query.email" });
  const phoneUrl = flow({
    dataCategory: "personal.phone",
    sinkKind: "request-url",
    location: "url.query.phone",
  });
  const passwordUrl = flow({
    dataCategory: "secret.password",
    sinkKind: "request-url",
    location: "url.query.password",
  });
  const externalUrl = flow({
    sinkKind: "external-request",
    location: "url.path",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
  });

  for (const personalFlow of [firstPartyUrl, phoneUrl]) {
    const [finding] = evaluateDataFlows([personalFlow]);
    assert.equal(finding?.ruleId, "PS1001");
    assert.equal(finding?.severity, "warning");
    assert.equal(finding?.classification, "review_required");
    assert.match(finding?.limitations[0] ?? "", /not automatically classified as sensitive/u);
  }
  const [passwordFinding] = evaluateDataFlows([passwordUrl]);
  assert.equal(passwordFinding?.ruleId, "PS1001");
  assert.equal(passwordFinding?.severity, "error");
  assert.equal(passwordFinding?.classification, "technical_failure");

  assert.deepEqual(ruleIds([firstPartyUrl]), ["PS1001"]);
  assert.deepEqual(ruleIds([externalUrl]), ["PS1001", "PS1004"]);
  assert.deepEqual(
    ruleIds([
      flow({ sinkKind: "request-url", sourceConfidence: "medium" }),
      flow({ sinkKind: "request-body", location: "json.email" }),
    ]),
    [],
  );
});

test("PS1002 detects request transport over unallowed HTTP with exact-origin exceptions", () => {
  const insecure = flow({
    recipient: {
      origin: "http://app.example.test",
      host: "app.example.test",
      firstParty: true,
    },
  });

  assert.deepEqual(ruleIds([insecure]), ["PS1002"]);
  assert.deepEqual(
    ruleIds([insecure], { allowInsecureOrigins: ["http://app.example.test/some/path"] }),
    [],
  );
  assert.deepEqual(
    ruleIds([insecure], { allowInsecureOrigins: ["http://app.example.test:8080"] }),
    ["PS1002"],
  );
  assert.deepEqual(
    ruleIds([flow(), { ...insecure, method: undefined }, { ...insecure, sourceConfidence: "low" }]),
    [],
    "HTTPS, final page URL samples, and non-high-confidence sources are not transport failures",
  );
});

test("PS1003 is limited to high-confidence secrets crossing the first-party boundary", () => {
  const externalSecret = flow({
    dataCategory: "secret.password",
    sinkKind: "external-request",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
    location: "json.password",
  });
  const [finding] = evaluateDataFlows([externalSecret]);

  assert.equal(finding?.ruleId, "PS1003");
  assert.equal(finding?.severity, "critical");
  assert.equal(finding?.classification, "technical_failure");
  assert.deepEqual(
    ruleIds([
      { ...externalSecret, sourceConfidence: "medium" },
      {
        ...externalSecret,
        sinkKind: "request-body",
        recipient: { ...externalSecret.recipient, firstParty: true },
      },
    ]),
    [],
  );
});

test("PS1004 creates contextual review findings for personal data sent externally", () => {
  const externalPersonal = flow({
    sourceConfidence: "medium",
    sinkKind: "external-request",
    recipient: {
      origin: "https://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
  });
  const [finding] = evaluateDataFlows([externalPersonal]);

  assert.equal(finding?.ruleId, "PS1004");
  assert.equal(finding?.severity, "warning");
  assert.equal(finding?.classification, "review_required");
  assert.match(finding?.limitations[0] ?? "", /cannot determine processor status/u);
  assert.deepEqual(ruleIds([flow(), { ...externalPersonal, dataCategory: "secret.password" }]), []);
});

test("PS1005 distinguishes contextual personal-data storage from secret storage", () => {
  for (const sinkKind of ["local-storage", "session-storage", "cookie"]) {
    const [finding] = evaluateDataFlows([
      flow({ sinkKind, recipient: undefined, method: undefined, location: "profile" }),
    ]);
    assert.equal(finding?.ruleId, "PS1005", sinkKind);
    assert.equal(finding?.severity, "warning", sinkKind);
    assert.equal(finding?.classification, "review_required", sinkKind);
  }

  const [secretFinding] = evaluateDataFlows([
    flow({
      dataCategory: "secret.password",
      sinkKind: "local-storage",
      recipient: undefined,
      method: undefined,
      location: "credential",
    }),
  ]);
  assert.equal(secretFinding?.ruleId, "PS1005");
  assert.equal(secretFinding?.severity, "critical");
  assert.equal(secretFinding?.classification, "technical_failure");
  for (const unsupportedTokenCategory of ["secret.api_token", "secret.session_token"]) {
    assert.deepEqual(
      ruleIds([
        flow({
          dataCategory: unsupportedTokenCategory,
          sinkKind: "local-storage",
          recipient: undefined,
          method: undefined,
          location: "token",
        }),
      ]),
      [],
      unsupportedTokenCategory,
    );
  }
  assert.deepEqual(
    ruleIds([
      flow({ sinkKind: "request-body" }),
      flow({
        dataCategory: "secret.password",
        sourceConfidence: "medium",
        sinkKind: "local-storage",
      }),
    ]),
    [],
  );
});

test("PS1006 treats high-confidence personal and secret console output as failures", () => {
  const [personal, secret] = evaluateDataFlows([
    flow({ sinkKind: "console", recipient: undefined, method: undefined }),
    flow({
      dataCategory: "secret.password",
      sinkKind: "console",
      recipient: undefined,
      method: undefined,
    }),
  ]);

  assert.equal(personal?.ruleId, "PS1006");
  assert.equal(personal?.severity, "error");
  assert.equal(personal?.classification, "technical_failure");
  assert.equal(secret?.ruleId, "PS1006");
  assert.equal(secret?.severity, "critical");
  assert.deepEqual(ruleIds([flow({ sinkKind: "console", sourceConfidence: "low" })]), []);
});

test("a flow can produce all independently applicable rules without duplicate findings", () => {
  const externalInsecureUrl = flow({
    sinkKind: "external-request",
    recipient: {
      origin: "http://analytics.example.test",
      host: "analytics.example.test",
      firstParty: false,
    },
    location: "url.query.email",
  });

  assert.deepEqual(ruleIds([externalInsecureUrl, externalInsecureUrl]), [
    "PS1001",
    "PS1002",
    "PS1004",
  ]);
  const serialized = JSON.stringify(evaluateDataFlows([externalInsecureUrl]));
  assert.doesNotMatch(serialized, /violation|non-compliant|compliant/iu);
});
