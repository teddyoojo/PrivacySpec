import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyPrivacySpecResult,
  MAX_ATTACHMENT_OBSERVATIONS,
  parsePrivacySpecResult,
} from "../dist/playwright/result.js";

const flow = () => ({
  kind: "data-flow",
  requestSurface: "browser",
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
  test: {
    file: "tests/customer.spec.ts",
    title: "customer can be created",
    project: "chromium",
  },
});

const attachmentVersion = (version) => {
  if (version === 1) {
    const legacyFlow = flow();
    delete legacyFlow.requestSurface;
    return { schemaVersion: 1, observations: [legacyFlow] };
  }
  const value = createEmptyPrivacySpecResult();
  value.schemaVersion = version;
  value.observations = [flow()];
  if (version < 5) delete value.classifierConfiguration;
  if (version < 4) {
    delete value.coverage.browserEngine;
    delete value.coverage.apiRequests;
    delete value.observations[0].requestSurface;
  }
  if (version < 3) delete value.coverage.observation;
  return value;
};

test("attachment compatibility matrix accepts exact v1-v5 shapes", () => {
  for (const version of [1, 2, 3, 4, 5]) {
    const value = attachmentVersion(version);
    const parsed = parsePrivacySpecResult(structuredClone(value));
    assert.equal(parsed?.schemaVersion, version);
    assert.equal(parsed?.observations[0]?.requestSurface, "browser");
    if (version === 5) {
      assert.deepEqual(parsed.classifierConfiguration, { mode: "builtin-only" });
    } else {
      assert.equal("classifierConfiguration" in parsed, false);
    }
  }

  const custom = attachmentVersion(5);
  custom.classifierConfiguration = { mode: "custom", id: "acme-classifiers-v2" };
  assert.deepEqual(parsePrivacySpecResult(custom)?.classifierConfiguration, {
    mode: "custom",
    id: "acme-classifiers-v2",
  });
});

test("attachment parser rejects future, unknown, malformed, hostile, and excessive values", () => {
  const current = attachmentVersion(5);
  const accessor = structuredClone(current);
  let getterCalls = 0;
  Object.defineProperty(accessor, "observations", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });
  const cyclic = structuredClone(current);
  cyclic.self = cyclic;
  const excessive = structuredClone(current);
  excessive.observations = [];
  excessive.observations.length = MAX_ATTACHMENT_OBSERVATIONS + 1;

  for (const value of [
    { ...structuredClone(current), schemaVersion: 6 },
    { ...structuredClone(current), unknown: true },
    {
      ...structuredClone(current),
      classifierConfiguration: { mode: "builtin-only", id: "forged" },
    },
    {
      ...structuredClone(current),
      coverage: {
        ...structuredClone(current.coverage),
        playwright: { ...current.coverage.playwright, unknown: true },
      },
    },
    { ...structuredClone(current), observations: [{ kind: "unknown" }] },
    {
      ...structuredClone(current),
      observations: [{ ...flow(), sinkKind: "database" }],
    },
    {
      ...structuredClone(current),
      observations: [
        {
          kind: "diagnostic",
          code: "PS_SOURCE_LIMIT_REACHED",
          classification: "informational",
          message: "unsafe\nterminal text",
        },
      ],
    },
    accessor,
    cyclic,
    excessive,
  ]) {
    assert.equal(parsePrivacySpecResult(value), undefined);
  }
  assert.equal(getterCalls, 0);
});
