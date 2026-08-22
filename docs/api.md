# Public API

The public package surface consists of the root `@privacyspec/playwright` export, the
`@privacyspec/playwright/reporter` reporter export, and the `privacyspec` CLI. The current public
channel is installed with `npm i -D @privacyspec/playwright@beta`.

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
  sources: {
    firstPartyJsonResponses: true,
  },
  testData: {
    syntheticEmailDomains: ["test-data.my-company.internal"],
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
- `sources.firstPartyJsonResponses` is experimental and defaults to `false`. When enabled it reads
  only bounded, known-length JSON responses classified by the same exact first-party rules. It
  recognizes `personal.email` and `personal.phone` only when JSON-key semantics and value shape
  both agree.
- `testData.syntheticEmailDomains` accepts at most 100 valid domain strings. Domains are
  Unicode/IDNA-normalized, deduplicated, and matched exactly or by subdomain. Invalid configuration
  fails before collection without echoing the configured value. The normalized configuration is
  never persisted.

### `test` and `expect`

The root export provides `test = withPrivacySpec(@playwright/test.test)` and re-exports Playwright's
`expect` for suites without an existing custom fixture. Composable mode is preferred for mature
repositories.

The returned test also composes a worker-scoped `browser` proxy. Calls through that fixture retain
their Playwright return values and method behavior while `newContext()` and `newPage()` register
coverage. Those independent contexts are detected, not instrumented, so their use makes secondary
analysis `UNSUPPORTED`. Browser objects obtained outside the composed fixture are not covered by
this guarantee.

## Reporter

Configure the default export from `@privacyspec/playwright/reporter` in Playwright's reporter array.
It accepts:

| Option | Type/default | Behavior |
| --- | --- | --- |
| `baselinePath` | `string \| false`; `privacyspec-baseline.json` | Reads an accepted semantic baseline; `false` disables it. |
| `latestRunPath` | `string \| false`; `.privacyspec/latest-run.json` | Writes the baseline-update handoff; `false` disables it. |
| `reportPath` | `string \| false`; `privacyspec-report.json` | Writes unified schema-v4 JSON; `false` disables it. |
| `dependencies` | module path options | Configures the independent dependency baseline, latest-run, and schema-v1 report paths. |
| `security` | module path options | Configures the independent security baseline, latest-run, and schema-v1 report paths. |
| `runtimeFailures` | module path options | Configures the independent runtime-failure baseline, latest-run, and schema-v1 report paths. |
| `failOnNewReviewFindings` | `boolean`; `false` | Makes new semantic `REVIEW_REQUIRED` findings fail the reporter. |
| `profiles.nis2_2024_2690` | `boolean`; `false` | Opts into report-level testing-evidence relevance with explicit applicability caveats. |

Technical failures and reporter/integration failures always fail PrivacySpec. A failed, skipped,
interrupted, coverage-limited, or zero-execution run is not eligible to replace the baseline.
The terminal prints one hierarchy with the functional result, observation coverage, overall
secondary-coverage result, privacy/dependency/security/runtime module results, and bounded change
counts. `PARTIAL`, `INCOMPLETE`, and `UNSUPPORTED` observation coverage makes privacy analysis
inconclusive; incomplete coverage in any module prevents an overall clean result. Detected
custom-context coverage also fails the reporter.

The terminal aggregates actionable occurrences by semantic identity. The JSON report retains every
sanitized occurrence with test attribution and exposes `REPORT_SCHEMA_VERSION` for consumers.

## CLI

```text
privacyspec explain <PS1001..PS1006>
privacyspec baseline show [--module privacy|dependencies|security|runtime] [--baseline <path>]
privacyspec baseline update [--module privacy|dependencies|security|runtime] [--baseline <path>] [--report <path>] [--yes]
privacyspec inventory [--report <path>] [--format terminal|json|csv|markdown] [--output <path>]
privacyspec testdata [--report <path>] [--format terminal|json|markdown] [--output <path>]
privacyspec evidence [--report <path>] [--format json|markdown] [--output <path>] [--commit <id>] [--build-id <id>]
```

`baseline update` is interactive unless `--yes` is supplied and refuses to run when `CI` is set.
It replaces the accepted review identities with those from the latest complete handoff, so callers
must run the intended complete Playwright scope first.

`inventory` reads schema-v1 through schema-v4 `privacyspec-report.json` by default. It rejects
malformed or unsupported reports, aggregates duplicate occurrences, and emits an independent
`inventorySchemaVersion: 1` model. JSON and CSV are intended for local tooling; terminal and
Markdown are intended for human review. `--output` uses an atomic mode-`0600` write. An incomplete
report is exportable, marked `INCOMPLETE`, and does not present resolved baseline candidates as
verified absence.

`testdata` reads schema-v2/v3/v4 test-data observations and emits independent
`testDataSchemaVersion: 1` output. Schema-v1 and earlier schema-v2 reports remain readable but are
marked as having unavailable hygiene data; incomplete source runs also retain an explicit
limitation. The command accepts terminal, JSON, or Markdown, deliberately not CSV, and uses the
same atomic mode-`0600` file-output contract. It prints only verdict, signal, category, source kind,
and sanitized test/control attribution—never an observed email value or its domain.

`evidence` reads schema-v1 through schema-v4 reports and emits an independent
`evidenceSchemaVersion: 1` bundle. JSON is intended for local tooling and Markdown for human
review. Build identifiers appear only when explicitly supplied; the command does not inspect Git
or environment variables. `--output` is atomic and mode `0600`. Incomplete reports remain
exportable with a prominent marker, `resolved: null`, and an `INCONCLUSIVE` resolved status. The
model keeps observations, technical-control relationships, and contextual/supporting regulatory
relevance separate, retains mapping caveats and primary sources, and states coverage/legal
limitations. It is labelled audit-supporting technical evidence, never an audit or legal outcome.

New review findings include one deterministic semantic comparison reason:
`NEW_RECIPIENT`, `NEW_CATEGORY`, `NEW_ENDPOINT`, `NEW_LOCATION`, `NEW_TRANSFORM`, or the fallback
`NEW_FLOW`. These labels add explanation without changing baseline schema v1 or its semantic keys.

## Exported models and metadata

The root export includes types for data flows, observations, findings, configuration, JSON reports,
and legal mappings. It also exports `evaluateDataFlows`, `RULE_DEFINITIONS`,
`RULE_LEGAL_MAPPINGS`, `REPORT_LEVEL_LEGAL_MAPPINGS`, schema/tool version constants, and attachment
metadata constants. Phase 14 additionally exports `PrivacyInventory` and its related entry, state,
format, and `BaselineChangeReason` types; `INVENTORY_SCHEMA_VERSION`; `createPrivacyInventory`;
`renderPrivacyInventory`; `parsePrivacySpecReportV1`; `readPrivacySpecReport`; and
`ReportFormatError`.

Phase 15 exports explicit `PrivacySpecJsonReportV1` and `PrivacySpecJsonReportV2` types,
`REPORT_SCHEMA_VERSION_V1`, and strict `parsePrivacySpecReportV1`, `parsePrivacySpecReportV2`, and
union `parsePrivacySpecReport` readers.
Schema v2 adds bounded experimental response-source coverage and optional response provenance on
flows. Earlier schema-v1 reports remain readable. Baseline schema v1, semantic keys, rule IDs, and
reporter/fixture composition remain compatible.

Phase 19 adds `PrivacySpecJsonReportV3`, `PrivacySpecResultV3`, `ObservationCoverageReport`,
`ObservationCoverageStatus`, diagnostics/counter types, the explicit v2 schema constants, and
`parsePrivacySpecReportV3`. `REPORT_SCHEMA_VERSION` and `ATTACHMENT_SCHEMA_VERSION` are now `3`;
their `_V2` constants remain available. Schema v3 adds `coverage.observation`. The union reader and
CLI commands continue to accept report schemas v1, v2, and v3, while the reporter accepts attachment
schemas v1, v2, and v3. Baseline schema v1 and rule IDs are unchanged.

Phase 26 adds `PrivacySpecJsonReportV4`, `REPORT_SCHEMA_VERSION_V3`,
`parsePrivacySpecReportV4`, `SecondaryAnalysisReport`, its four namespaced module-section types,
and `renderSecondaryCoverageSummary`. `REPORT_SCHEMA_VERSION` is now `4`; attachment schema v3 and
independent analyzer artifact/baseline schema v1 remain unchanged. Schema v4 adds the strict
`analysis.privacy`, `analysis.dependencies`, `analysis.security`, and `analysis.runtimeErrors`
envelope. Union readers and existing CLI commands accept schemas v1–v4.

Phase 16 exports `PrivacySpecTestDataReport`, `PrivacySpecTestDataSection`, observation, verdict,
signal, attribution, summary, and format types; `TEST_DATA_SCHEMA_VERSION`;
`createTestDataReport`; and `renderPrivacySpecTestData`. The test-data model is versioned
independently of report schema v2 and inventory schema v1.

Phase 17 exports `PrivacySpecEvidence`, its build, observation, technical-relevance,
regulatory-relevance, source-run-state, and format types; `EVIDENCE_SCHEMA_VERSION`;
`createPrivacySpecEvidence`; and `renderPrivacySpecEvidence`. Evidence schema v1 is independently
versioned from reports, inventory, test-data output, and baseline artifacts.

Phase 18 exports `PrivacySpecStorageStateScan`, its file observation, structural evidence,
credential evidence, personal-data shapes, repository/finding status, summary, and format types;
`STORAGE_STATE_SCAN_SCHEMA_VERSION`; `PLAYWRIGHT_AUTH_STATE_GUIDANCE_URL`;
`scanStorageStateFiles`; and `renderStorageStateScan`. Storage-state scan schema v1 is independent
of runtime test-data schema v1. The API accepts explicit paths only, rejects symlinks, applies file
size and JSON depth/node bounds, and returns input indexes instead of source paths.

Only paths declared in the package `exports` field are public. Files under `dist/` are
implementation details unless re-exported from the root entry point.
