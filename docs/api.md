# Public API

The public package surface consists of the root `@privacyspec/playwright` export, the
`@privacyspec/playwright/reporter` reporter export, and the `privacyspec` CLI.

## Fixture integration

### `withPrivacySpec(baseTest, options?)`

Composes an automatic test-scoped observer with an existing Playwright `TestType` and returns the
extended test object. Test bodies do not request a PrivacySpec fixture.

```ts
const test = withPrivacySpec(projectTest, {
  firstParty: {
    origins: ["https://app.example.test"],
    hosts: ["api.example.test"],
  },
  dev: {
    allowInsecureOrigins: ["http://localhost:3000"],
  },
});
```

- `firstParty.origins` uses exact origins, including the port.
- `firstParty.hosts` trusts exact configured hosts; subdomains are not inferred.
- `dev.allowInsecureOrigins` suppresses PS1002 only for exact explicitly allowed development
  origins. It does not classify an origin as first party.
- The Playwright `baseURL` origin is inferred as first party when present.

### `test` and `expect`

The root export provides `test = withPrivacySpec(@playwright/test.test)` and re-exports Playwright's
`expect` for suites without an existing custom fixture. Composable mode is preferred for mature
repositories.

## Reporter

Configure the default export from `@privacyspec/playwright/reporter` in Playwright's reporter array.
It accepts:

| Option | Type/default | Behavior |
| --- | --- | --- |
| `baselinePath` | `string \| false`; `privacyspec-baseline.json` | Reads an accepted semantic baseline; `false` disables it. |
| `latestRunPath` | `string \| false`; `.privacyspec/latest-run.json` | Writes the baseline-update handoff; `false` disables it. |
| `reportPath` | `string \| false`; `privacyspec-report.json` | Writes schema-v1 JSON; `false` disables it. |
| `failOnNewReviewFindings` | `boolean`; `false` | Makes new semantic `REVIEW_REQUIRED` findings fail the reporter. |
| `profiles.nis2_2024_2690` | `boolean`; `false` | Opts into report-level testing-evidence relevance with explicit applicability caveats. |

Technical failures and reporter/integration failures always fail PrivacySpec. A failed, skipped,
interrupted, coverage-limited, or zero-execution run is not eligible to replace the baseline.

The terminal aggregates actionable occurrences by semantic identity. The JSON report retains every
sanitized occurrence with test attribution and exposes `REPORT_SCHEMA_VERSION` for consumers.

## CLI

```text
privacyspec explain <PS1001..PS1006>
privacyspec baseline show [--baseline-path <path>]
privacyspec baseline update [--baseline-path <path>] [--report-path <path>] [--yes]
```

`baseline update` is interactive unless `--yes` is supplied and refuses to run when `CI` is set.
It replaces the accepted review identities with those from the latest complete handoff, so callers
must run the intended complete Playwright scope first.

## Exported models and metadata

The root export includes types for data flows, observations, findings, configuration, JSON reports,
and legal mappings. It also exports `evaluateDataFlows`, `RULE_DEFINITIONS`,
`RULE_LEGAL_MAPPINGS`, `REPORT_LEVEL_LEGAL_MAPPINGS`, schema/tool version constants, and attachment
metadata constants.

Only paths declared in the package `exports` field are public. Files under `dist/` are
implementation details unless re-exported from the root entry point.
