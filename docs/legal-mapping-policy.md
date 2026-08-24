# Legal mapping policy

**Status:** Current beta policy
**Mappings last reviewed:** 2026-08-20

PrivacySpec reports browser-side technical observations. Its mapping layer explains why an
observation may matter; it does not decide the legal status of an application or organisation.

## Mapping hierarchy

Mappings keep three layers separate:

```text
Observed browser-side fact
        ↓
Version-pinned technical control
        ↓
Contextual EU regulatory relevance
```

The rule engine remains the source of technical findings. The local registry in
`packages/privacyspec/src/rules/legal-map.ts` is keyed by the existing stable rule ID. Mapping text,
source URLs, and review dates do not enter semantic baseline keys and are not duplicated into the
per-test Playwright attachment. Reporting resolves the same rule ID into aggregate
report metadata.

The registry uses these relationship strengths:

- `direct`: the observed technical fact closely matches a technical control.
- `contextual`: the source is relevant, but facts PrivacySpec cannot observe are needed before the
  source can be applied to the specific processing context.
- `supporting_evidence`: a run artifact may contribute evidence for a testing process; it cannot
  establish that the full process requirement is satisfied.

All GDPR references are contextual. The optional Regulation (EU) 2024/2690 reference is
supporting-evidence metadata at report level only.

## Source policy

Technical-control links are pinned to OWASP ASVS 5.0.0 rather than the changing `master` branch.
The registry uses OWASP's version-qualified requirement IDs, such as `v5.0.0-14.2.1`.

Regulatory references must link to primary EUR-Lex text. Secondary material from the EDPB, EDPS,
ENISA, or an official national authority may explain a mapping later, but it cannot replace the
primary source. Law-firm blogs, vendor summaries, search snippets, and runtime web lookups are not
mapping sources.

Every regulatory entry records:

- instrument and provision;
- relationship strength;
- mapping rationale;
- applicability caveat;
- primary source URL;
- last-reviewed date.

Mappings are static, local, versioned with the package, and make no network request at runtime.

## Current rule mappings

| Rule | Technical control | Strength | EU relevance |
| --- | --- | --- | --- |
| PS1001 — personal data or secret in URL | OWASP ASVS `v5.0.0-14.2.1` | contextual at rule level; direct when the application classifies the value as sensitive | GDPR Articles 5(1)(f), 25(1), 32(1)(b), and 32(2) |
| PS1002 — sensitive data over HTTP | OWASP ASVS `v5.0.0-12.2.1` | direct | GDPR Articles 5(1)(f), 32(1), and 32(2) |
| PS1003 — secret sent externally | OWASP ASVS `v5.0.0-14.2.3` | contextual because external does not automatically mean untrusted | GDPR Articles 5(1)(f), 25(1), 32(1)(b), and 32(2) |
| PS1004 — personal data sent externally | OWASP ASVS `v5.0.0-14.2.3` | contextual | GDPR Articles 5(1)(c), 5(1)(f), and 25(1) |
| PS1005 — sensitive data in browser storage | OWASP ASVS `v5.0.0-14.3.3` | contextual because ASVS relies on application sensitivity classification and explicitly excepts session tokens | GDPR Articles 5(1)(c), 5(1)(f), 25(1)–(2), 32(1)(b), and 32(2) |
| PS1006 — sensitive data in console | OWASP ASVS `v5.0.0-16.2.5` and `v5.0.0-14.2.4` | contextual because console output is not necessarily a retained log | GDPR Articles 5(1)(c), 5(1)(f), 25(1), 32(1)(b), and 32(2) |

Authoritative sources:

- [OWASP ASVS 5.0.0 V12 — Secure Communication](https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x21-V12-Secure-Communication.md)
- [OWASP ASVS 5.0.0 V14 — Data Protection](https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x23-V14-Data-Protection.md)
- [OWASP ASVS 5.0.0 V16 — Security Logging and Error Handling](https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md)
- [GDPR — Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)

Use the CLI to inspect the complete rationale, caveat, review date, and sources for a rule:

```bash
privacyspec explain PS1001
```

## Interpretation boundaries

The technical control is the direct basis where a mapping is marked `direct`. GDPR provisions do
not themselves contain categorical URL, browser-storage, console, or HTTP rules. Their relevance
depends at least on whether the observed value is personal data, whether the GDPR applies, the
processing purpose and necessity, controller/processor roles, recipient authorization, safeguards,
and risk-appropriate measures.

In particular:

- email, telephone, name, postal-address, date-of-birth, explicit account-identifier, payment-card,
  gender-identity, and job-title controls are personal-data categories in PrivacySpec's technical
  taxonomy, but a category alone does not establish that the value identifies a person, that a
  card/account is active, PCI scope, a special-category legal classification, or the application's
  ASVS sensitivity classification;
- a non-first-party origin is not automatically untrusted, unauthorized, or a GDPR third party;
- a browser URL fragment may never be sent to a server;
- browser storage can be necessary, and the ASVS browser-storage control explicitly excepts session
  tokens;
- browser console output is not necessarily retained, exported, or accessible outside the session;
- Article 32 is risk-based and does not itself prescribe HTTP or TLS by name.

Accordingly, PS1001 defaults to `REVIEW_REQUIRED` for ordinary personal data and escalates a
high-confidence secret to an error-level `TECHNICAL_FAILURE`. The static rule-level ASVS mapping is
contextual because PrivacySpec does not currently ingest an application's protection
classification. Projects that want stricter CI behavior for new personal-data URL observations can
enable the existing `failOnNewReviewFindings` reporter option; the finding remains a warning/review
because CI policy does not change the observed fact or mapping strength.

The current secret taxonomy contains only `secret.password`. PrivacySpec has no classifier for
session tokens, JWT or API-token syntax, cookie names, or storage keys; it classifies a value as a
secret only from password-control semantics. PS1005's automatic critical storage branch therefore
applies only to a discovered password. Any future token classifier must positively distinguish
non-session API credentials from the session-token exception before adding them to that branch.

User-facing findings must not be labelled `GDPR violation`, `NIS2 violation`, `compliant`, or
`non-compliant`. Preferred classifications remain `TECHNICAL_FAILURE`, `REVIEW_REQUIRED`, and
`INFORMATIONAL`.

## Optional Regulation (EU) 2024/2690 profile

The reporter can show a separate testing-evidence relevance block only after explicit opt-in:

```ts
reporter: [
  ["@privacyspec/playwright/reporter", {
    profiles: { nis2_2024_2690: true }
  }]
]
```

When linked to a separately documented test methodology, the block maps a documented run to
potential supporting evidence for Commission Implementing Regulation (EU) 2024/2690, Annex points
6.5.2(b)–(c), concerning application of that methodology and test records. It is not attached to
individual PS1001–PS1006 findings.

This implementing regulation applies to specified relevant entities; an ordinary SaaS product is
not automatically within scope. A PrivacySpec run does not establish risk-based scope or frequency,
complete component coverage, mitigating actions, periodic policy review, or satisfaction of Annex
point 6.5 as a whole. Applicability must be confirmed by the organisation before enabling the
profile.

Primary source:

- [Commission Implementing Regulation (EU) 2024/2690](https://eur-lex.europa.eu/eli/reg_impl/2024/2690/oj/eng)

## Review and change process

Before changing a mapping:

1. verify the exact rule behavior against the technical control;
2. use a version-pinned technical source and primary regulatory text;
3. record a rule-specific rationale and applicability caveat;
4. update the last-reviewed date;
5. run the registry, CLI, wording, and full privacy-redaction tests;
6. obtain human review before treating revised legal wording as stable UX.

Mappings should be removed or weakened when a source no longer supports the stated relationship.
Negative review results must not be hidden by broadening the wording.
