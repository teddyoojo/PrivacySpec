import assert from "node:assert/strict";
import test from "node:test";

import { RULE_DEFINITIONS } from "../dist/rules/definitions.js";
import {
  getRuleLegalMapping,
  REPORT_LEVEL_LEGAL_MAPPINGS,
  RULE_LEGAL_MAPPINGS,
} from "../dist/rules/legal-map.js";

const ruleIds = ["PS1001", "PS1002", "PS1003", "PS1004", "PS1005", "PS1006"];
const forbiddenLegalConclusions =
  /\b(?:GDPR|NIS2) violation\b|\bnon[- ]?compliant\b|\bcompliant\b/iu;

const hasUnsafeTerminalCharacter = (value) => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    ) {
      return true;
    }
  }
  return false;
};

const stringsIn = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(stringsIn);
};

test("the Phase 9 registry covers exactly the six stable rules and is immutable", () => {
  assert.deepEqual(Object.keys(RULE_LEGAL_MAPPINGS).sort(), ruleIds);
  assert.deepEqual(Object.keys(RULE_DEFINITIONS).sort(), ruleIds);
  assert.equal(Object.isFrozen(RULE_LEGAL_MAPPINGS), true);

  for (const ruleId of ruleIds) {
    const mapping = RULE_LEGAL_MAPPINGS[ruleId];
    assert.equal(mapping.ruleId, ruleId);
    assert.equal(getRuleLegalMapping(ruleId), mapping);
    assert.equal(Object.isFrozen(mapping), true);
    assert.equal(Object.isFrozen(mapping.technicalControls), true);
    assert.equal(Object.isFrozen(mapping.regulatoryRelevance), true);
    assert.equal(Object.isFrozen(mapping.limitations), true);
    assert.equal(mapping.observationRule.length > 0, true);
    assert.equal(mapping.technicalControls.length > 0, true);
    assert.equal(mapping.regulatoryRelevance.length > 0, true);
    assert.equal(mapping.limitations.length > 0, true);
  }

  assert.equal(getRuleLegalMapping("ps1001"), undefined);
  assert.equal(getRuleLegalMapping("toString"), undefined);
  assert.equal(getRuleLegalMapping("PS9999"), undefined);
});

test("technical controls use version-pinned ASVS sources and explicit relation strength", () => {
  const expectedControls = {
    PS1001: [["v5.0.0-14.2.1", "contextual"]],
    PS1002: [["v5.0.0-12.2.1", "direct"]],
    PS1003: [["v5.0.0-14.2.3", "contextual"]],
    PS1004: [["v5.0.0-14.2.3", "contextual"]],
    PS1005: [["v5.0.0-14.3.3", "contextual"]],
    PS1006: [
      ["v5.0.0-16.2.5", "contextual"],
      ["v5.0.0-14.2.4", "contextual"],
    ],
  };

  for (const ruleId of ruleIds) {
    const controls = RULE_LEGAL_MAPPINGS[ruleId].technicalControls;
    assert.deepEqual(
      controls.map(({ requirementId, relationship }) => [requirementId, relationship]),
      expectedControls[ruleId],
      ruleId,
    );
    assert.equal(
      new Set(controls.map(({ requirementId }) => requirementId)).size,
      controls.length,
      `${ruleId} has duplicate controls`,
    );
    for (const control of controls) {
      assert.equal(Object.isFrozen(control), true);
      assert.equal(control.framework, "OWASP ASVS");
      assert.equal(control.version, "5.0.0");
      assert.match(control.control, /^V\d+\.\d+\.\d+$/u);
      assert.equal(control.requirementId, `v5.0.0-${control.control.slice(1)}`);
      assert.match(
        control.sourceUrl,
        /^https:\/\/github\.com\/OWASP\/ASVS\/blob\/v5\.0\.0_release\//u,
      );
      assert.equal(control.lastReviewed, "2026-08-20");
      assert.equal(control.rationale.length > 0, true);
      assert.equal(control.applicabilityCaveat.length > 0, true);
    }
  }
});

test("every EU regulatory mapping is contextual, source-traceable, and caveated", () => {
  for (const ruleId of ruleIds) {
    const references = RULE_LEGAL_MAPPINGS[ruleId].regulatoryRelevance;
    assert.equal(
      new Set(references.map(({ instrument, provision }) => `${instrument}|${provision}`)).size,
      references.length,
      `${ruleId} has duplicate regulatory references`,
    );
    for (const reference of references) {
      assert.equal(Object.isFrozen(reference), true);
      assert.equal(reference.instrument, "GDPR");
      assert.match(reference.provision, /^Article (?:5|25|32)/u);
      assert.equal(reference.relationship, "contextual");
      assert.equal(reference.sourceType, "primary");
      assert.equal(reference.sourceUrl, "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng");
      assert.equal(reference.lastReviewed, "2026-08-20");
      assert.equal(reference.rationale.length > 0, true);
      assert.equal(reference.applicabilityCaveat.length > 0, true);
    }
  }

  const ps1001 = RULE_LEGAL_MAPPINGS.PS1001;
  assert.deepEqual(
    ps1001.regulatoryRelevance.map(({ provision }) => provision),
    ["Article 5(1)(f)", "Article 25(1)", "Article 32(1)(b) and 32(2)"],
  );
  assert.match(ps1001.technicalControls[0].rationale, /classified as sensitive/u);
  assert.match(ps1001.technicalControls[0].rationale, /ordinary personal data/u);
  assert.match(ps1001.technicalControls[0].rationale, /directly relates/u);
  assert.match(ps1001.technicalControls[0].applicabilityCaveat, /not the application's ASVS/u);

  const ps1005 = RULE_LEGAL_MAPPINGS.PS1005;
  assert.match(ps1005.observationRule, /high-confidence password/u);
  assert.match(
    ps1005.technicalControls[0].applicabilityCaveat,
    /explicitly excepts session tokens/u,
  );
  assert.match(ps1005.technicalControls[0].applicabilityCaveat, /does not infer token purpose/u);
  assert.match(
    ps1005.limitations.join(" "),
    /Future token support must distinguish session tokens/u,
  );
});

test("NIS2 implementing-regulation relevance is separate and report-level only", () => {
  const mapping = REPORT_LEVEL_LEGAL_MAPPINGS.nis2_2024_2690;
  assert.equal(Object.isFrozen(REPORT_LEVEL_LEGAL_MAPPINGS), true);
  assert.equal(Object.isFrozen(mapping), true);
  assert.equal(mapping.profileId, "nis2_2024_2690");
  assert.equal(mapping.regulatoryRelevance.length, 1);
  const [reference] = mapping.regulatoryRelevance;
  assert.equal(reference.relationship, "supporting_evidence");
  assert.equal(reference.sourceType, "primary");
  assert.match(reference.instrument, /2024\/2690/u);
  assert.match(reference.provision, /Annex, points 6\.5\.2\(b\) and 6\.5\.2\(c\)/u);
  assert.equal(reference.sourceUrl, "https://eur-lex.europa.eu/eli/reg_impl/2024/2690/oj/eng");
  assert.equal(reference.lastReviewed, "2026-08-20");
  assert.match(reference.applicabilityCaveat, /explicit|confirmed|applies/iu);
  assert.doesNotMatch(JSON.stringify(RULE_LEGAL_MAPPINGS), /2024\/2690|nis2/iu);
});

test("mapping text stays terminal-safe and makes no prohibited legal conclusion", () => {
  const values = stringsIn({ RULE_LEGAL_MAPPINGS, REPORT_LEVEL_LEGAL_MAPPINGS });
  assert.equal(values.length > 0, true);
  for (const value of values) {
    assert.equal(hasUnsafeTerminalCharacter(value), false);
  }
  const serialized = JSON.stringify({ RULE_LEGAL_MAPPINGS, REPORT_LEVEL_LEGAL_MAPPINGS });
  assert.doesNotMatch(serialized, forbiddenLegalConclusions);
});
