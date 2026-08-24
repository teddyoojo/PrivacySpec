import assert from "node:assert/strict";
import test from "node:test";

import { classifySensitiveControl } from "../dist/discovery/classify-control.js";

test("classifies strong email semantics with high confidence", () => {
  assert.deepEqual(
    classifySensitiveControl({
      value: ["phase-four", "example.test"].join("@"),
      type: "email",
      autocomplete: "section-account email",
    }),
    {
      category: "personal.email",
      confidence: "high",
      evidence: [
        { kind: "input-type", value: "email" },
        { kind: "autocomplete", value: "email" },
      ],
    },
  );
});

test("classifies telephone autocomplete variants with high confidence", () => {
  assert.deepEqual(
    classifySensitiveControl({ value: "+491700000000", autocomplete: "tel-national" }),
    {
      category: "personal.phone",
      confidence: "high",
      evidence: [{ kind: "autocomplete", value: "tel-national" }],
    },
  );
});

test("password semantics take precedence over other attributes", () => {
  const classification = classifySensitiveControl({
    value: ["phase", "four", "secret"].join("-"),
    type: "password",
    autocomplete: "current-password email",
  });

  assert.equal(classification?.category, "secret.password");
  assert.equal(classification?.confidence, "high");
});

test("classifies the complete high-confidence semantic autocomplete taxonomy", () => {
  const cases = [
    ...[
      "name",
      "honorific-prefix",
      "given-name",
      "additional-name",
      "family-name",
      "honorific-suffix",
      "nickname",
    ].map((autocomplete) => ({
      category: "personal.name",
      autocomplete,
      value: ["Casey", "Example"].join(" "),
    })),
    ...[
      "street-address",
      "address-line1",
      "address-line2",
      "address-line3",
      "address-level1",
      "address-level2",
      "address-level3",
      "address-level4",
      "country",
      "country-name",
      "postal-code",
    ].map((autocomplete) => ({
      category: "personal.postal_address",
      autocomplete,
      value: autocomplete === "country" ? ["Ger", "many"].join("") : ["Fixture", "Place"].join(" "),
    })),
    {
      category: "personal.date_of_birth",
      autocomplete: "bday",
      value: ["1990", "01", "02"].join("-"),
    },
    {
      category: "personal.account_identifier",
      autocomplete: "username",
      value: ["fixture", "account", "42"].join("-"),
    },
    {
      category: "personal.gender_identity",
      autocomplete: "sex",
      value: "Nonbinary",
    },
    {
      category: "personal.job_title",
      autocomplete: "organization-title",
      value: "Software Engineer",
    },
    {
      category: "personal.payment_card",
      autocomplete: "cc-number",
      value: ["4242", "4242", "4242", "4242"].join(" "),
    },
    {
      category: "personal.payment_card",
      autocomplete: "cc-exp",
      value: ["12", "2030"].join("/"),
    },
    { category: "personal.payment_card", autocomplete: "cc-exp", value: ["2030", "12"].join("-") },
    ...["cc-name", "cc-given-name", "cc-additional-name", "cc-family-name"].map((autocomplete) => ({
      category: "personal.payment_card",
      autocomplete,
      value: ["Casey", "Example"].join(" "),
    })),
  ];

  for (const fixture of cases) {
    assert.deepEqual(
      classifySensitiveControl({
        value: fixture.value,
        autocomplete: `section-fixture shipping ${fixture.autocomplete}`,
      }),
      {
        category: fixture.category,
        confidence: "high",
        evidence: [{ kind: "autocomplete", value: fixture.autocomplete }],
      },
      fixture.autocomplete,
    );
  }
});

test("requires corroborated machine and accessible hints without autocomplete", () => {
  const cardNumber = ["4242", "4242", "4242", "4242"].join(" ");
  const cases = [
    {
      category: "personal.name",
      input: {
        value: ["Casey", "Example"].join(" "),
        name: "firstName",
        associatedLabel: "First name",
      },
    },
    {
      category: "personal.postal_address",
      input: {
        value: ["123", "Fixture", "Avenue"].join(" "),
        id: "postalCode",
        ariaLabel: "Postal code",
      },
    },
    {
      category: "personal.date_of_birth",
      input: {
        value: ["1990", "01", "02"].join("-"),
        type: "date",
        associatedLabel: "Date of birth",
      },
    },
    {
      category: "personal.account_identifier",
      input: {
        value: ["customer", "fixture", "42"].join("-"),
        name: "customerId",
        placeholder: "Customer ID",
      },
    },
    {
      category: "personal.payment_card",
      input: { value: cardNumber, id: "ccNumber", associatedLabel: "Card number" },
    },
  ];

  for (const fixture of cases) {
    const classification = classifySensitiveControl(fixture.input);
    assert.equal(classification?.category, fixture.category);
    assert.equal(classification?.confidence, "high");
    assert.equal(classification?.evidence.length, 2);
  }

  assert.equal(
    classifySensitiveControl({ value: ["Casey", "Example"].join(" "), name: "firstName" }),
    undefined,
  );
  assert.equal(
    classifySensitiveControl({
      value: ["Casey", "Example"].join(" "),
      associatedLabel: "First name",
    }),
    undefined,
  );
  for (const input of [
    {
      value: "Nonbinary",
      name: "genderIdentity",
      associatedLabel: "Gender identity",
    },
    {
      value: "Software Engineer",
      id: "jobTitle",
      ariaLabel: "Job title",
    },
  ]) {
    assert.equal(
      classifySensitiveControl(input),
      undefined,
      "gender and job-title classification require exact autocomplete intent",
    );
  }
});

test("rejects invalid bounded card and birth-date shapes", () => {
  for (const input of [
    {
      value: ["4242", "4242", "4242", "4241"].join(" "),
      type: "tel",
      autocomplete: "cc-number",
    },
    { value: "0".repeat(16), autocomplete: "cc-number" },
    { value: "12", autocomplete: "cc-csc" },
    { value: "123", autocomplete: "cc-csc" },
    { value: ["12", "30"].join("/"), autocomplete: "cc-exp" },
    { value: "12", autocomplete: "cc-exp-month" },
    { value: "2030", autocomplete: "cc-exp-year" },
    { value: ["13", "30"].join("/"), autocomplete: "cc-exp" },
    { value: ["12", "0000"].join("/"), autocomplete: "cc-exp" },
    { value: ["0000", "12"].join("-"), autocomplete: "cc-exp" },
    { value: "13", autocomplete: "cc-exp-month" },
    { value: ["1990", "99", "99"].join("-"), autocomplete: "bday" },
    { value: ["2025", "02", "29"].join("-"), autocomplete: "bday" },
    { value: "32", autocomplete: "bday-day" },
    { value: "2", autocomplete: "bday-day" },
    { value: "1", autocomplete: "bday-month" },
    { value: "1990", autocomplete: "bday-year" },
  ]) {
    assert.equal(classifySensitiveControl(input), undefined, JSON.stringify(input));
  }
  assert.equal(
    classifySensitiveControl({
      value: ["4242", "4242", "4242", "4242"].join(" "),
      type: "tel",
      autocomplete: "cc-number",
    })?.category,
    "personal.payment_card",
    "explicit card semantics take precedence over a numeric-keypad telephone type",
  );
});

test("does not classify ambiguous, empty, short, or oversized controls", () => {
  assert.equal(classifySensitiveControl({ value: "Ordinary text", type: "text" }), undefined);
  assert.equal(
    classifySensitiveControl({
      value: ["synthetic-header", "synthetic-payload", "synthetic-signature"].join("."),
      type: "hidden",
      autocomplete: "one-time-code",
    }),
    undefined,
    "token-shaped or session-adjacent controls require an explicit future classifier",
  );
  assert.equal(classifySensitiveControl({ value: "", type: "email" }), undefined);
  assert.equal(classifySensitiveControl({ value: "a@b.c", type: "email" }), undefined);
  assert.equal(classifySensitiveControl({ value: "x".repeat(4_097), type: "password" }), undefined);
  for (const autocomplete of [
    "organization",
    "one-time-code",
    "transaction-amount",
    "transaction-currency",
    "language",
    "url",
    "photo",
    "cc-type",
  ]) {
    assert.equal(
      classifySensitiveControl({ value: "synthetic-looking-value", autocomplete }),
      undefined,
      autocomplete,
    );
  }
  assert.equal(
    classifySensitiveControl({
      value: ["550e8400", "e29b", "41d4", "a716", "446655440000"].join("-"),
      name: "id",
      associatedLabel: "ID",
    }),
    undefined,
    "generic IDs are not automatically classified from their value shape",
  );
  assert.equal(
    classifySensitiveControl({
      value: ["Casey", "Example"].join(" "),
      type: "text",
    }),
    undefined,
    "person-like strings are not recognized without DOM semantics",
  );
});
