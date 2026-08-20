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
});
