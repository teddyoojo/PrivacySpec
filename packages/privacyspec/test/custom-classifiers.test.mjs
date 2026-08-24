import assert from "node:assert/strict";
import test from "node:test";
import { classifyCustomSensitiveControl } from "../dist/discovery/custom-classifiers.js";
import {
  parseRawControlSource,
  parseSensitiveSourceStreamEvent,
  SensitiveValueRegistry,
} from "../dist/discovery/sensitive-registry.js";
import {
  getDataCategoryFamily,
  isDataCategory,
  normalizeClassifierConfiguration,
  normalizeCustomDomSourceClassifiers,
  parseClassifierConfiguration,
} from "../dist/index.js";

const highPersonal = {
  category: { id: "custom.personal.acme.member_id", family: "personal" },
  sourceSurface: "dom-control",
  confidence: "high",
  sanitization: "bounded-control-metadata",
  match: {
    kind: "corroborated",
    alternatives: [
      {
        machine: { field: "name", equals: "benefitCode" },
        accessible: { field: "associatedLabel", equals: "Benefit Code" },
      },
    ],
  },
  value: { minLength: 6, maxLength: 64 },
};

const mediumPersonal = {
  category: { id: "custom.personal.acme.loyalty_tier", family: "personal" },
  sourceSurface: "dom-control",
  confidence: "medium",
  sanitization: "bounded-control-metadata",
  match: {
    kind: "exact",
    alternatives: [{ field: "ariaLabel", equals: "Loyalty Tier" }],
  },
  value: { minLength: 6, maxLength: 32 },
};

const highSecret = {
  category: { id: "custom.secret.acme.employee_pin", family: "secret" },
  sourceSurface: "dom-control",
  confidence: "high",
  sanitization: "bounded-control-metadata",
  match: {
    kind: "corroborated",
    alternatives: [
      {
        machine: { field: "id", equals: "employeePin" },
        accessible: { field: "ariaLabel", equals: "Employee PIN" },
      },
    ],
  },
  value: { minLength: 6, maxLength: 128 },
};

test("custom data categories have a bounded family-bearing namespace", () => {
  for (const [category, family] of [
    ["personal.email", "personal"],
    ["secret.password", "secret"],
    ["custom.personal.acme.member_id", "personal"],
    ["custom.secret.acme.employee_pin", "secret"],
  ]) {
    assert.equal(isDataCategory(category), true);
    assert.equal(getDataCategoryFamily(category), family);
  }
  for (const category of [
    "custom.personal.acme",
    "custom.financial.acme.account",
    "custom.personal.Acme.member",
    "custom.personal.acme.member-id",
    `custom.personal.acme.${"x".repeat(100)}`,
    "custom.personal.acme.member\nforged",
  ]) {
    assert.equal(isDataCategory(category), false, category);
  }
});

test("declarative classifiers normalize exact metadata and enforce confidence contracts", () => {
  const classifiers = normalizeCustomDomSourceClassifiers([
    highPersonal,
    mediumPersonal,
    highSecret,
  ]);
  assert.equal(classifiers.length, 3);
  assert.equal(classifiers[0].match.alternatives[0].machine.equals, "benefit code");

  assert.deepEqual(
    classifyCustomSensitiveControl(
      {
        value: "member-12345",
        name: "benefit_code",
        associatedLabel: "Benefit Code",
      },
      classifiers,
    ),
    {
      ambiguous: false,
      classification: {
        category: "custom.personal.acme.member_id",
        confidence: "high",
        evidence: [
          { kind: "name-attribute", value: "benefit code" },
          { kind: "label", value: "benefit code" },
        ],
      },
    },
  );
  assert.equal(
    classifyCustomSensitiveControl({ value: "member-12345", name: "benefit_code" }, classifiers)
      .classification,
    undefined,
  );
  assert.equal(
    classifyCustomSensitiveControl({ value: "gold-tier", ariaLabel: "loyalty-tier" }, classifiers)
      .classification?.confidence,
    "medium",
  );
});

test("classifier order permutations and repeated evaluation preserve semantic results", () => {
  const control = {
    value: "member-12345",
    name: "benefit_code",
    associatedLabel: "Benefit Code",
  };
  const expected = classifyCustomSensitiveControl(
    control,
    normalizeCustomDomSourceClassifiers([highPersonal, mediumPersonal, highSecret]),
  );

  for (const classifiers of [
    [highPersonal, mediumPersonal, highSecret],
    [highSecret, highPersonal, mediumPersonal],
    [mediumPersonal, highSecret, highPersonal],
  ]) {
    const normalized = normalizeCustomDomSourceClassifiers(classifiers);
    for (let repetition = 0; repetition < 25; repetition += 1) {
      assert.deepEqual(classifyCustomSensitiveControl(control, normalized), expected);
    }
  }
});

test("custom classifier configuration IDs are explicit, bounded, and independent of matcher order", () => {
  assert.deepEqual(normalizeClassifierConfiguration([], undefined), { mode: "builtin-only" });
  for (const id of ["a", "acme-v2", "Acme.classifiers_2026-08-23", "x".repeat(128)]) {
    assert.deepEqual(normalizeClassifierConfiguration([highPersonal], id), {
      mode: "custom",
      id,
    });
    assert.deepEqual(parseClassifierConfiguration({ mode: "custom", id }), {
      mode: "custom",
      id,
    });
  }

  const stableId = "acme-dom-classifiers-v3";
  for (const classifiers of [
    [highPersonal, mediumPersonal, highSecret],
    [highSecret, highPersonal, mediumPersonal],
  ]) {
    assert.deepEqual(
      normalizeClassifierConfiguration(normalizeCustomDomSourceClassifiers(classifiers), stableId),
      { mode: "custom", id: stableId },
    );
  }

  for (const [classifiers, id] of [
    [[], "unexpected-id"],
    [[highPersonal], undefined],
    [[highPersonal], "-leading"],
    [[highPersonal], "trailing-"],
    [[highPersonal], "contains space"],
    [[highPersonal], "x".repeat(129)],
  ]) {
    assert.throws(
      () => normalizeClassifierConfiguration(classifiers, id),
      (error) => {
        assert.equal(error.message, "Invalid PrivacySpec custom classifier configuration ID.");
        if (typeof id === "string") assert.equal(error.message.includes(id), false);
        return true;
      },
    );
  }
  assert.equal(parseClassifierConfiguration({ mode: "builtin-only", id: "forged" }), undefined);
  assert.equal(parseClassifierConfiguration({ mode: "unavailable" }), undefined);
});

test("invalid, duplicate, excessive, and medium-confidence secret classifiers fail closed", () => {
  const invalid = [
    { ...highPersonal, callback: () => true },
    { ...highPersonal, category: { ...highPersonal.category, family: "secret" } },
    { ...highPersonal, sourceSurface: "response-json" },
    { ...highPersonal, value: { minLength: 5, maxLength: 64 } },
    { ...highPersonal, match: { ...highPersonal.match, alternatives: [] } },
    {
      ...mediumPersonal,
      category: { id: "custom.secret.acme.employee_pin", family: "secret" },
    },
  ];
  for (const classifier of invalid) {
    assert.throws(
      () => normalizeCustomDomSourceClassifiers([classifier]),
      /Invalid PrivacySpec custom source classifier configuration/u,
    );
  }
  assert.throws(() => normalizeCustomDomSourceClassifiers([highPersonal, highPersonal]));
  assert.throws(() =>
    normalizeCustomDomSourceClassifiers(
      Array.from({ length: 65 }, (_, index) => ({
        ...highPersonal,
        category: {
          id: `custom.personal.acme.category_${index}`,
          family: "personal",
        },
      })),
    ),
  );
  assert.throws(() =>
    normalizeCustomDomSourceClassifiers(
      Array.from({ length: 17 }, (_, index) => ({
        ...highPersonal,
        category: {
          id: `custom.personal.acme.total_${index}`,
          family: "personal",
        },
        match: {
          ...highPersonal.match,
          alternatives: Array.from({ length: 32 }, () =>
            structuredClone(highPersonal.match.alternatives[0]),
          ),
        },
      })),
    ),
  );
  const privateMatcher = "private@example.test\nforged";
  assert.throws(
    () =>
      normalizeCustomDomSourceClassifiers([
        {
          ...mediumPersonal,
          match: {
            ...mediumPersonal.match,
            alternatives: [{ field: "ariaLabel", equals: privateMatcher }],
          },
        },
      ]),
    (error) => {
      assert.doesNotMatch(error.message, /private@example/u);
      return true;
    },
  );
});

test("worker parsing recomputes custom classifications and preserves built-in precedence", () => {
  const classifiers = normalizeCustomDomSourceClassifiers([highPersonal]);
  const source = {
    kind: "control",
    raw: "member-12345",
    category: "custom.secret.attacker.forged",
    confidence: "low",
    evidence: [],
    control: {
      elementKind: "input",
      name: "benefitCode",
      associatedLabel: "Benefit Code",
    },
    pageUrl: "https://app.example.test/account",
    timestamp: 42,
    observedBy: "event",
  };
  assert.equal(
    parseRawControlSource(source, classifiers)?.category,
    "custom.personal.acme.member_id",
  );
  assert.equal(
    parseRawControlSource(
      {
        ...source,
        raw: "member@example.test",
        control: { ...source.control, type: "email" },
      },
      classifiers,
    )?.category,
    "personal.email",
  );
});

test("ambiguous custom categories admit no source and mark the registry partial", () => {
  const second = {
    ...highPersonal,
    category: { id: "custom.personal.acme.customer_id", family: "personal" },
  };
  const classifiers = normalizeCustomDomSourceClassifiers([highPersonal, second]);
  assert.deepEqual(
    classifyCustomSensitiveControl(
      { value: "member-12345", name: "benefitCode", associatedLabel: "Benefit Code" },
      classifiers,
    ),
    { ambiguous: true },
  );

  const registry = new SensitiveValueRegistry(classifiers);
  registry.recordStreamEvent({
    version: 1,
    token: registry.streamToken,
    kind: "classification-ambiguous",
  });
  assert.equal(registry.snapshot().customClassificationAmbiguous, true);
  assert.equal(registry.snapshot().sources.length, 0);

  const forgedSource = {
    kind: "control",
    raw: "member-12345",
    category: "custom.personal.attacker.forged",
    confidence: "high",
    evidence: [],
    control: {
      elementKind: "input",
      name: "benefitCode",
      associatedLabel: "Benefit Code",
    },
    pageUrl: "https://app.example.test/account",
    timestamp: 42,
    observedBy: "event",
  };
  assert.deepEqual(
    parseSensitiveSourceStreamEvent(
      { version: 1, token: "worker-token", kind: "source", source: forgedSource },
      "worker-token",
      classifiers,
    ),
    { kind: "classification-ambiguous" },
  );
  registry.add(forgedSource);
  assert.equal(registry.snapshot().customClassificationAmbiguous, true);
  assert.equal(registry.snapshot().sources.length, 0);
});
