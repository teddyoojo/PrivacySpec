# PrivacySpec — Continuous privacy QA for Playwright

PrivacySpec is a local, passive secondary-coverage layer for ordinary Playwright tests. It observes
high-confidence browser inputs and runtime sinks, dependency origins, selected browser security
posture, and hidden runtime failures; emits sanitized semantic findings; and compares supported
changes with explicitly accepted module baselines.

The package provides three related outputs: current-run secondary observations (**OBSERVE**),
semantic baseline changes (**REGRESS**), and sanitized technical review material (**EVIDENCE**).
It is licensed under Apache-2.0 and developed at
[`teddyoojo/PrivacySpec`](https://github.com/teddyoojo/PrivacySpec).

Install the public beta explicitly:

```bash
npm i -D @privacyspec/playwright@beta
```

## Integration

Compose PrivacySpec with an existing shared fixture:

```ts
import { test as projectTest } from "./existing-fixtures";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(projectTest, {
  firstParty: { origins: ["https://app.example.test"] },
  sources: {
    firstPartyJsonResponses: true,
    customClassifierConfigurationId: "acme-dom-classifiers-v1",
    customClassifiers: [
      {
        category: { id: "custom.personal.acme.member_id", family: "personal" },
        sourceSurface: "dom-control",
        confidence: "medium",
        sanitization: "bounded-control-metadata",
        match: { kind: "exact", alternatives: [{ field: "name", equals: "memberId" }] },
        value: { minLength: 6, maxLength: 128 },
      },
    ],
  },
  experimental: {
    browserEngines: ["firefox", "webkit"],
    apiRequestContext: "request-fixture",
  },
  testData: { syntheticEmailDomains: ["test-data.my-company.internal"] },
});
```

Keep existing test bodies unchanged. Add the reporter beside the repository's normal reporter:

```ts
export default defineConfig({
  reporter: [
    ["line"],
    [
      "@privacyspec/playwright/reporter",
      {
        baselinePath: "privacyspec-baseline.json",
        latestRunPath: ".privacyspec/latest-run.json",
        reportPath: "privacyspec-report.json",
        failOnNewReviewFindings: false,
      },
    ],
  ],
});
```

The package also exports a precomposed `test` and Playwright `expect` for simple repositories.
Non-empty custom classifier tables require a bounded `customClassifierConfigurationId`. Reuse it
only for reorder-equivalent tables and rotate it for semantic changes. Only the ID is persisted;
matcher literals/tables and automatic matcher digests are not. It is distinct from
`runScope.configurationId`, which coordinates one sharded/process execution.

For shards or coordinated processes, configure `runScope` with a shared bounded `runId` and
`configurationId`. Playwright shard metadata supplies the coordinate, or a caller may provide a
paired one-based `part`/`total` (maximum 128). Each invocation writes only a private,
baseline-ineligible `.privacyspec-parts/<runId>/part-<part>-of-<total>.json`. Run
`privacyspec aggregate` with every explicit part path before publishing or updating a baseline.
Missing parts are `INCONCLUSIVE`; invalid, duplicate, and mismatched parts are integration errors.

PrivacySpec instruments Playwright's test-scoped `context` and wraps the composed worker-scoped
`browser` fixture. Report schema v5 retains schema-v4 analysis and adds browser-engine/API coverage
and request-surface facts alongside namespaced `analysis.privacy`, `analysis.dependencies`, `analysis.security`, and
`analysis.runtimeErrors` sections. Terminal output presents functional tests, observation
coverage, the four module outcomes, and a bounded change total as one secondary-coverage
hierarchy. Current writers use report v5, attachment v5, run-part v3, privacy baseline/latest v2,
inventory/evidence v2, and proposal/independent analyzer v1. Strict historical readers cover
report/attachment v1–v5, run-part v1–v3, privacy baseline/latest v1–v2, and inventory/evidence
v1–v2. Contexts created through
`browser.newContext()` or `browser.newPage()` are detected but are not instrumented. An all-custom
or mixed suite therefore fails closed with `COVERAGE_INCOMPATIBLE` and an inconclusive module
result. Browser instances launched outside the composed fixture remain outside this detection
boundary.

Chromium remains supported by default. Firefox and WebKit instrumentation require an explicit
experimental gate; ungated tests remain functionally runnable but fail closed with unsupported
secondary coverage. The optional composed `request` fixture proxy is transparent, never reads API
response bodies, does not discover new sensitive sources, and marks every detected API call
partial and baseline-ineligible. Calls through `page.request`, `context.request`, or manually
created request contexts remain undetectable.

For source-free network-heavy tests, queryless static `GET`/`HEAD` requests and narrowly recognized
Vite development-module requests are counted but not retained until a supported source is observed;
the report records the filtered count. Arbitrary query-bearing and post-source traffic remain
eligible. Cookie values are correlated through bounded per-cookie
locations, and repeated ambient cookie propagation across asset endpoints collapses to one semantic
identity per test, origin, cookie name, and transform.

## Commands

```bash
privacyspec explain PS1001
privacyspec baseline show
privacyspec baseline propose
privacyspec baseline accept --select <proposal-id>
privacyspec baseline update
privacyspec aggregate --part path/to/part-1.json --part path/to/part-2.json
privacyspec summary
privacyspec summary --format markdown --output privacyspec-summary.md
privacyspec inventory
privacyspec inventory --format markdown --output privacy-inventory.md
privacyspec testdata
privacyspec testdata --format markdown --output test-data-hygiene.md
privacyspec testdata scan path/to/storage-state.json
privacyspec testdata scan auth/one.json auth/two.json --format markdown --output storage-state-hygiene.md
privacyspec evidence --commit <commit-id> --build-id <build-id>
privacyspec evidence --format markdown --output technical-evidence.md
```

`baseline propose` reads a strict complete latest run and the selected module baseline, then writes
a private schema-v1 proposal without changing accepted state. `baseline accept` revalidates those
snapshots and applies only exact repeated `--select` IDs, preserving every unselected accepted
entry. It requires confirmation (or `--yes`) and refuses CI. `baseline update` remains the
compatible confirmed whole-snapshot replacement command and the explicit migration path after a
custom-classifier ID rotation. Mismatch/unavailable state suppresses privacy known/new/resolved and
selective proposals; legacy v1 privacy artifacts containing custom categories require a fresh
current run and explicit whole-snapshot reacceptance. Objective privacy technical failures cannot
become privacy baseline entries; other modules retain their documented independent semantics.

The package root exports the strict proposal model/parser/reader/private writer, pure proposal
creation and selective-application functions, schema/default/limit constants, discriminated
snapshot/application types, and typed proposal errors.

`aggregate` accepts 1–128 explicit `--part` paths, reads the existing four baseline defaults, and
writes one strict schema-v5 report plus complete or fail-closed latest-run handoffs. It performs no
directory crawling, glob expansion, baseline mutation, service call, or telemetry. Valid semantic
results—including incomplete scope—return `0`; parser, mismatch, collision, and output errors
return `1`.

`summary` reads only a strict current schema-v5 unified report and defaults to terminal stdout.
It also supports bounded Markdown and an atomic mode-`0600` `--output`. Valid `PASS`, `REVIEW`,
`FAIL`, and `INCONCLUSIVE` report statuses return exit code `0`; malformed, missing, unsupported,
or unwritable input returns `1`. The command is a renderer and does not redefine reporter failure
policy. The package root exports `renderSecondaryCoverageSummary`,
`renderSecondaryCoverageMarkdown`, and `SecondaryCoverageSummaryFormat`.

The official repository Action is post-processing only: install this package, run Playwright,
aggregate expected parts when sharding, then invoke
`teddyoojo/PrivacySpec@<approved-release-ref>` with `if: always()`. It validates and renders the
report with the caller's local CLI and can upload the sanitized schema-v5 JSON artifact. It
does not install dependencies or browsers, mutate baselines, or make a valid report's semantic
status fail the Action independently. It does not discover or aggregate shards. Use an approved
release ref once publication is authorized.

`inventory` reads `privacyspec-report.json` unless `--report <path>` is supplied. It supports
terminal, JSON, CSV, and Markdown output; `--output` writes atomically with mode `0600`. It
aggregates occurrences, transformations, and observing tests by semantic flow rather than printing
duplicates. Incomplete reports remain exportable but are clearly marked `INCOMPLETE`.

`testdata` reads the same report and supports terminal, JSON, and Markdown output. It reviews only
email values observed in browser input controls and emits sanitized verdict/signal/test/control
metadata. `SYNTHETIC` recognizes IANA-reserved or explicitly configured suite domains;
`REVIEW_REQUIRED` means only that no synthetic-domain rule matched; `UNASSESSED` means the value
was outside the supported shape. Hygiene output never includes the value or domain, performs no DNS
lookup, and never changes the run result.

`testdata scan <path...>` scans only explicitly supplied Playwright storage-state/auth JSON files;
it never crawls the repository or follows symlinks. The independent
`storageStateScanSchemaVersion: 1` output contains only input indexes, structural counts,
credential/personal-data shape counts, and `TRACKED`, `IGNORED`, `UNTRACKED`, or
`GIT_UNAVAILABLE` local status. Credential-bearing state is `REVIEW_REQUIRED` when tracked,
unignored, or not classifiable by Git; ignored local state is `INFORMATIONAL`. This does not prove
publication, exposure, compromise, or legal status. File size and JSON depth/node counts are
bounded; raw paths, names, values, domains, and origins are not rendered. The technical basis is
[Playwright's authentication-state warning](https://playwright.dev/docs/auth). HAR, trace ZIP,
HTML-report, and static test-source scanning are outside this pilot.

`evidence` reads the same report and emits independent `evidenceSchemaVersion: 1` JSON or Markdown.
It records explicitly supplied build identifiers, run scope, observed categories and external
recipients, baseline/hygiene/finding totals, source mappings, and coverage/legal limitations.
Markdown deliberately separates observed technical facts, technical-control relevance, and
regulatory relevance. The output is labelled audit-supporting technical evidence; it is not an
audit opinion or legal conclusion. Incomplete runs are prominently marked and suppress conclusive
resolved counts. The command does not infer build metadata or upload, retain, or sign evidence.

## Privacy and scope

Raw sensitive values exist only transiently in browser/test-worker memory for correlation and
hygiene classification. Reports, attachments, baselines, inventory/test-data/evidence exports, and
terminal output contain sanitized semantic metadata, never collected request bodies or raw input
values or email domains. PrivacySpec has no telemetry or hosted service.

Control-to-sink correlation is scoped to one isolated Playwright test and establishes
co-observation, not temporal causation; asynchronous browser-to-worker delivery order is not used
as a clock. Response-discovered sources remain restricted to later sinks.

The stable beta supports Chromium and Playwright `>=1.58.1 <2`; Firefox/WebKit and the composed
request fixture remain opt-in experiments. It discovers high-confidence email,
telephone, password, name, postal-address, full birth-date, explicit account-identifier,
payment-card, gender-identity, and job-title controls and observes browser-side network, storage,
console, and URL flows. Expanded categories require exact autocomplete intent or corroborated
machine/accessibility metadata; gender identity and job title are autocomplete-only. Card/DOB
values also use bounded structural checks, and all correlated sources keep the six-character
minimum. Generic IDs, ordinary name-like text, short card-security/date components, and API/session
tokens remain unclassified. `personal.*` categories are technical observations, not PCI,
special-category, or other legal determinations. Experimental first-party JSON response discovery
is opt-in and still recognizes only valid email and phone values under explicit JSON-key semantics.
Application-specific categories use bounded exact declarative DOM classifiers. Custom personal
categories may be high or medium confidence; custom secrets require corroborated high confidence.
Callbacks, regular expressions, selectors, and custom response/storage/URL/JavaScript discovery
are not supported, and built-ins always win. PrivacySpec does not observe backend-only transfers
and is not a legal compliance certification tool. Its inventory is technical input to privacy
review, not a complete GDPR Article 30 record of processing activities.

See the repository README and API/privacy documentation for the complete beta contract.
