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
    customClassifierConfigurationId: "acme-dom-classifiers-v1",
    customClassifiers: [
      {
        category: { id: "custom.personal.acme.member_id", family: "personal" },
        sourceSurface: "dom-control",
        confidence: "high",
        sanitization: "bounded-control-metadata",
        match: {
          kind: "corroborated",
          alternatives: [{
            machine: { field: "name", equals: "memberId" },
            accessible: { field: "associatedLabel", equals: "Member ID" },
          }],
        },
        value: { minLength: 6, maxLength: 128 },
      },
    ],
  },
  testData: {
    syntheticEmailDomains: ["test-data.my-company.internal"],
  },
  dev: {
    allowInsecureOrigins: ["http://localhost:3000"],
  },
  experimental: {
    browserEngines: ["firefox", "webkit"],
    apiRequestContext: "request-fixture",
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

### DOM source classification

Automatic DOM discovery emits high-confidence `DataCategory` values for `personal.email`,
`personal.phone`, `personal.name`, `personal.postal_address`, `personal.date_of_birth`,
`personal.account_identifier`, `personal.payment_card`, `personal.gender_identity`,
`personal.job_title`, and `secret.password`.

Email, telephone, and password retain their input-type/autocomplete behavior. The expanded
personal categories prefer exact HTML `autocomplete` intent. Without it, a classifier requires a
normalized exact `name` or `id` hint corroborated by an associated label, ARIA label, or
placeholder; full DOB fields may use `type="date"` plus an exact accessible DOB label. Payment-card
numbers use a bounded 12–19 digit Luhn check, while full expiry and DOB values use bounded valid
date shapes. Every admitted raw value remains 6–4,096 characters so exact substring correlation
does not operate on ambiguous short components. Gender identity and job title require exact
`autocomplete="sex"` and `autocomplete="organization-title"` intent respectively; they have no
metadata fallback. Input, textarea, select, and contenteditable controls share the bounded
event/fallback collection path. Token meanings follow the
[HTML autofill-field vocabulary](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill-field).

The public `ControlClassificationInput` includes `value`, `type`, `autocomplete`, `name`, `id`,
`ariaLabel`, `associatedLabel`, and `placeholder`. Classification evidence can identify input type,
autocomplete, name/id attributes, associated/ARIA labels, and placeholders. These fields describe
semantic DOM evidence; they do not enable arbitrary value regexes.

`bday` is supported as a full date. Standalone day/month/year components, short card security or
expiry components, generic ID/UUID/number shapes, person-name recognition in ordinary text,
organization, language, profile URL/photo and transaction fields, one-time codes,
session/JWT/API tokens, and arbitrary strings are not classified. Response-source discovery
remains independently limited to email and phone JSON-key/value pairs.

`sources.customClassifiers` accepts at most 64 bounded declarative DOM classifiers, 32 alternatives
per classifier, and 512 alternatives total. Category IDs use
`custom.<personal|secret>.<namespace>.<name>` with lowercase safe ASCII segments and a 128-character
total limit. Machine signals are normalized exact `name`/`id` matches; accessible signals are
normalized exact associated-label, ARIA-label, or placeholder matches. High confidence requires a
machine/accessibility pair. Medium confidence accepts one exact signal and is personal-only;
custom secrets require high confidence. Matcher literals are capped at 200 characters and admitted
values remain within configured 6–4,096-character bounds.

Configuration is normalized once and rejects unknown fields, malformed/duplicate categories,
family/ID disagreement, invalid bounds, and excess limits without echoing matcher literals. The
worker recomputes classification from the normalized table and bounded metadata instead of
trusting a browser-supplied category or confidence. Built-ins always take precedence. An ambiguous
custom match admits no category, emits a sanitized fixed diagnostic, makes source coverage partial,
and prevents baseline eligibility.

`sources.customClassifierConfigurationId` is required if and only if the normalized custom table
is non-empty. It accepts 1–128 characters matching
`[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?`. Keep the same ID for reorder-only changes and rotate
it for every semantic category, matcher, confidence, or value-bound change. PrivacySpec persists
only `{ mode: "builtin-only" }` or `{ mode: "custom", id }`; classifier tables, matcher literals,
automatic matcher digests, and raw values are never persisted. Compatibility provenance remains
outside per-flow semantic identity. Missing/mismatched state makes privacy comparison inconclusive
and rejects proposal/selective acceptance, while a current complete latest run can still support
the explicitly confirmed whole-baseline update. Legacy v1 artifacts containing custom categories
require a fresh run and whole-baseline reacceptance.

This ID is not `runScope.configurationId`: the former versions classifier semantics; the latter
coordinates one sharded/process execution envelope. The root exports built-in/custom category and
classifier/configuration types, `isDataCategory()`, `getDataCategoryFamily()`, and the normalization
limits/helpers.

### `test` and `expect`

The root export provides `test = withPrivacySpec(@playwright/test.test)` and re-exports Playwright's
`expect` for suites without an existing custom fixture. Composable mode is preferred for mature
repositories.

The returned test also composes a worker-scoped `browser` proxy. Calls through that fixture retain
their Playwright return values and method behavior while `newContext()` and `newPage()` register
coverage. Those independent contexts are detected, not instrumented, so their use makes secondary
analysis `UNSUPPORTED`. Browser objects obtained outside the composed fixture are not covered by
this guarantee.

`experimental.browserEngines` accepts only `firefox` and/or `webkit`. Chromium remains the
supported default. Ungated Firefox/WebKit tests run functionally without observers, emit
`UNSUPPORTED` secondary coverage, cannot create a complete latest-run handoff, and fail the
reporter. Gated engines reuse the observer pipeline and are explicitly labelled experimental in
attachments, report v5, summaries, inventory, and evidence.

`experimental.apiRequestContext: "request-fixture"` enables observation of the composed test
`request` fixture. Its `delete`, `fetch`, `get`, `head`, `patch`, `post`, and `put` methods delegate
exactly once and preserve response, exception, storage-state, disposal, and bound-method behavior.
Observation is limited to bounded explicit arguments and final response URL/status/selected
headers; response bodies are never read. API arguments/responses do not become sensitive sources.
Every detected call makes API coverage `PARTIAL`, secondary analysis inconclusive, and the run
baseline-ineligible because final wire headers, implicit cookies/authentication, and redirect hops
are unavailable. With the gate disabled, calls pass through without argument inspection but emit
unsupported coverage. `page.request`, `context.request`, and manually created request contexts are
explicitly undetectable blind spots.

## Reporter

Configure the default export from `@privacyspec/playwright/reporter` in Playwright's reporter array.
It accepts:

| Option | Type/default | Behavior |
| --- | --- | --- |
| `baselinePath` | `string \| false`; `privacyspec-baseline.json` | Reads an accepted semantic baseline; `false` disables it. |
| `latestRunPath` | `string \| false`; `.privacyspec/latest-run.json` | Writes the baseline-update handoff; `false` disables it. |
| `reportPath` | `string \| false`; `privacyspec-report.json` | Writes unified schema-v5 JSON; `false` disables it. |
| `dependencies` | module path options | Configures the independent dependency baseline, latest-run, and schema-v1 report paths. |
| `security` | module path options | Configures the independent security baseline, latest-run, and schema-v1 report paths. |
| `runtimeFailures` | module path options | Configures the independent runtime-failure baseline, latest-run, and schema-v1 report paths. |
| `runScope` | `PrivacySpecRunScopeOptions`; unset | Emits one baseline-ineligible schema-v3 run part instead of final/latest/module reports. Requires `runId` and `configurationId`; optional paired `part`/`total` overrides must match Playwright shard metadata. |
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

`runScope.runId` and `runScope.configurationId` accept 1–128 ASCII letters, digits, dots,
underscores, or hyphens. Coordinates are one-based with a maximum total of 128. Without explicit
coordinates the reporter uses `FullConfig.shard`, then falls back to `1/1`. The default output is
`.privacyspec-parts/<runId>/part-<part>-of-<total>.json`; `outputDirectory` may override its parent.
Each coordinate is create-only and mode `0600`. A zero-test shard still emits a completed part with
the built-in-only default configuration state; current v3 parts with different classifier state
always reject during aggregation.
Detected Playwright sharding without `runScope` fails and disables all colliding final/latest
outputs.

## CLI

```text
privacyspec explain <PS1001..PS1006>
privacyspec baseline show [--module privacy|dependencies|security|runtime] [--baseline <path>]
privacyspec baseline update [--module privacy|dependencies|security|runtime] [--baseline <path>] [--report <path>] [--yes]
privacyspec baseline propose [--module privacy|dependencies|security|runtime] [--baseline <path>] [--report <path>] [--proposal <path>]
privacyspec baseline accept [--proposal <path>] [--baseline <path>] [--report <path>] [--select <proposal-id> ...] [--yes]
privacyspec aggregate --part <path> [--part <path> ...] [--report <path>]
privacyspec summary [--report <path>] [--format terminal|markdown] [--output <path>]
privacyspec inventory [--report <path>] [--format terminal|json|csv|markdown] [--output <path>]
privacyspec testdata [--report <path>] [--format terminal|json|markdown] [--output <path>]
privacyspec evidence [--report <path>] [--format json|markdown] [--output <path>] [--commit <id>] [--build-id <id>]
```

`baseline update` is interactive unless `--yes` is supplied and refuses to run when `CI` is set.
It replaces the accepted review identities with those from the latest complete handoff, so callers
must run the intended complete Playwright scope first. This whole-snapshot path is also the explicit
migration path after an intentional custom-classifier ID change.

`baseline propose` is the selective workflow's read-only comparison step. It defaults to privacy,
the selected module's existing baseline/latest-run paths, and
`.privacyspec/baseline-proposal.json`. A missing baseline is allowed; the latest-run handoff must
exist and be complete. The command writes an independent strict `proposalSchemaVersion: 1`
artifact with canonical known/add/change/remove counts and deterministic IDs. It does not modify
the accepted baseline and may run in CI. Privacy, dependency, and runtime identities use
add/remove actions; security target fingerprints also support change.

`baseline accept` rereads the proposal and its current baseline/latest-run snapshots, verifies
their full SHA-256 digests, re-derives the complete proposal, and applies only repeated exact
`--select` IDs. Unknown, duplicate, malformed, cross-module, stale, tampered, or no-longer-
applicable selections reject the whole operation. Selected add/change/remove actions are explicit;
unselected accepted entries and old values remain unchanged. No selection validates the proposal
but performs no write. A non-empty selection is interactive unless `--yes` is supplied, and the
command refuses to run whenever `CI` is set. Proposal and selectively written baseline files are
atomic mode-`0600` artifacts; workflow paths reject collisions, non-regular files, and symbolic-
link components. `baseline update` remains the compatible whole-snapshot replacement path.
For privacy, proposal creation and application additionally require available identical classifier
state in the accepted baseline and latest run. A mismatch never silently re-labels known/new/resolved
flows.

`aggregate` accepts 1–128 repeated explicit part paths; it never expands globs or crawls a
directory. Parts must have the same bounded run/configuration IDs, expected total, policy, tool
contract, and canonical project set, with no duplicate coordinate. Missing coordinates create a
valid `INCONCLUSIVE` schema-v5 report with fixed scope diagnostics and exit `0`. Malformed,
unsupported, duplicate, mismatched, symlinked, or unwritable inputs return `1`. Aggregate output
defaults to `privacyspec-report.json`, is validated before an atomic mode-`0600` write, and cannot
overwrite a source part, baseline, or latest-run path.

The command reads the four existing baseline defaults, compares them only after the relevant
complete run scope is established, and never mutates them. It invalidates stale final/latest-run
artifacts before reading inputs; complete eligible modules receive new latest-run handoffs while
partial modules receive incomplete handoffs. Input order does not affect the semantic result.

`summary` reads `privacyspec-report.json` by default and requires a strict current schema-v5
unified report because earlier versions do not contain all four analysis modules. Terminal is the
default; Markdown is deterministic, limited to five actionable items per module and five coverage
or integration diagnostics, and capped at 64 KiB. It excludes known accepted findings, test
titles/files, expanded legal mappings, raw values, query strings, request bodies, console
arguments, and storage values. `--output` cannot overwrite the input and writes atomically with
mode `0600`. Every valid semantic status returns `0`; only input, rendering, or output errors
return `1`, independently of reporter failure policy.

`inventory` reads schema-v1 through schema-v5 `privacyspec-report.json` by default. It rejects
malformed or unsupported reports, aggregates duplicate occurrences, and emits an independent
`inventorySchemaVersion: 2` model with request-surface and experimental-coverage facts. JSON and
CSV are intended for local tooling; terminal and
Markdown are intended for human review. `--output` uses an atomic mode-`0600` write. An incomplete
report is exportable, marked `INCOMPLETE`, and does not present resolved baseline candidates as
verified absence.

`testdata` reads schema-v2/v3/v4/v5 test-data observations and emits independent
`testDataSchemaVersion: 1` output. Schema-v1 and earlier schema-v2 reports remain readable but are
marked as having unavailable hygiene data; incomplete source runs also retain an explicit
limitation. The command accepts terminal, JSON, or Markdown, deliberately not CSV, and uses the
same atomic mode-`0600` file-output contract. It prints only verdict, signal, category, source kind,
and sanitized test/control attribution—never an observed email value or its domain.

`evidence` reads schema-v1 through schema-v5 reports and emits an independent
`evidenceSchemaVersion: 2` bundle with request-surface and experimental-coverage facts. JSON is
intended for local tooling and Markdown for human
review. Build identifiers appear only when explicitly supplied; the command does not inspect Git
or environment variables. `--output` is atomic and mode `0600`. Incomplete reports remain
exportable with a prominent marker, `resolved: null`, and an `INCONCLUSIVE` resolved status. The
model keeps observations, technical-control relationships, and contextual/supporting regulatory
relevance separate, retains mapping caveats and primary sources, and states coverage/legal
limitations. It is labelled audit-supporting technical evidence, never an audit or legal outcome.

New review findings include one deterministic semantic comparison reason:
`NEW_RECIPIENT`, `NEW_CATEGORY`, `NEW_ENDPOINT`, `NEW_LOCATION`, `NEW_TRANSFORM`, or the fallback
`NEW_FLOW`. These labels add explanation without changing the stable semantic keys; privacy
baseline v2 adds only classifier compatibility provenance.

## GitHub Action

The root composite Action post-processes a report after the caller's normal Playwright command.
Use `if: always()` and install `@privacyspec/playwright` in the working directory before invoking
it. Its inputs are `working-directory` (default `.`), `report-path`
(`privacyspec-report.json`), `artifact-name` (`privacyspec-report`), `upload-artifact` (`true`),
and `retention-days` (`7`).

The Action confines a relative regular-file report path to `GITHUB_WORKSPACE`, calls the local CLI
with `npx --no-install`, appends sanitized Markdown to the GitHub Step Summary, and optionally
uploads an exact mode-`0600` staging copy using `actions/upload-artifact@v4`. Invalid input,
rendering, or upload fails the Action; a valid report's semantic status does not independently do
so. It installs no packages or browsers, requests no pull-request write permission, and mutates no
baseline. Use `teddyoojo/PrivacySpec@<approved-release-ref>` only after a release containing the
Action has been separately authorized; repository CI uses `uses: ./` until then.

## Exported models and metadata

The root package groups its public surface into:

- fixture integration: `withPrivacySpec`, precomposed `test`/`expect`, and `PrivacySpecOptions`;
- privacy semantics: data-flow, source/sink, observation, finding, rule, mapping, and configuration
  types plus `evaluateDataFlows`, `RULE_DEFINITIONS`, `RULE_LEGAL_MAPPINGS`, and
  `REPORT_LEVEL_LEGAL_MAPPINGS`;
- report contracts: `PrivacySpecJsonReportV1` through `PrivacySpecJsonReportV5`, strict
  version-specific parsers, the union parser/reader, coverage and secondary-analysis models,
  `renderSecondaryCoverageSummary`, `renderSecondaryCoverageMarkdown`,
  `SecondaryCoverageSummaryFormat`, and current/historical schema constants;
- run-scope contracts: `PrivacySpecRunPart`, `PrivacySpecRunScopeOptions`,
  `RUN_PART_SCHEMA_VERSION`, strict part parser/reader, `aggregatePrivacySpecRunParts`, aggregate
  result/baseline types, and fixed errors/limits;
- baseline-proposal contracts: `BaselineProposal`, discriminated snapshot/application types,
  `BASELINE_PROPOSAL_SCHEMA_VERSION`, fixed paths/limits/errors, strict parser/reader/private writer,
  pure proposal creation, and pure selective application;
- attachment contracts: result v1 through v5, bounded exact union parser, attachment name/content
  type, and current/historical schema constants;
- derived exports: inventory/evidence current writer models, separate v1/v2 readable unions, strict
  object/file readers, test-data hygiene, storage-state scan, schema constants,
  constructors/scanner, and renderers.

The current version map is: unified report v5; attachment v5; run part v3; privacy baseline/latest
run v2; inventory/evidence v2; and proposal, test-data, storage-state, dependency/security/runtime
baseline/latest/report, and analyzer attachments v1. Strict readers support report v1–v5,
attachment v1–v5, run part v1–v3, privacy baseline/latest v1–v2, and inventory/evidence v1–v2.
Legacy attachment v1–v4 and run-part v1/v2 classifier state is unavailable rather than inferred;
mixed run-part versions reject.

The storage-state API accepts explicit paths only, rejects symlinks, applies file-size and JSON
depth/node bounds, and returns input indexes instead of source paths.

Only paths declared in the package `exports` field are public. Files under `dist/` are
implementation details unless re-exported from the root entry point.
