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
  sources: { firstPartyJsonResponses: true }, // experimental; defaults to false
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

PrivacySpec instruments Playwright's test-scoped `context` and wraps the composed worker-scoped
`browser` fixture. Report schema v4 retains the aggregate observation counters from schema v3 and
adds namespaced `analysis.privacy`, `analysis.dependencies`, `analysis.security`, and
`analysis.runtimeErrors` sections. Terminal output presents functional tests, observation
coverage, the four module outcomes, and a bounded change total as one secondary-coverage
hierarchy. Report schemas v1–v3 remain readable; the independent module artifacts and baselines
remain schema v1. Contexts created through `browser.newContext()` or `browser.newPage()` are
detected but are not instrumented. An all-custom or mixed suite therefore fails closed with
`COVERAGE_INCOMPATIBLE` and an inconclusive module result. Browser instances launched outside the
composed fixture remain outside this detection boundary.

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
privacyspec baseline update
privacyspec inventory
privacyspec inventory --format markdown --output privacy-inventory.md
privacyspec testdata
privacyspec testdata --format markdown --output test-data-hygiene.md
privacyspec testdata scan path/to/storage-state.json
privacyspec testdata scan auth/one.json auth/two.json --format markdown --output storage-state-hygiene.md
privacyspec evidence --commit <commit-id> --build-id <build-id>
privacyspec evidence --format markdown --output technical-evidence.md
```

`baseline update` requires a complete latest run and explicit confirmation. It refuses mutation in
CI. Objective technical failures cannot be accepted into the baseline.

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

The beta supports Chromium and Playwright `>=1.58.1 <2`. It discovers high-confidence email,
telephone, and password controls and observes browser-side network, storage, console, and URL
flows. Experimental first-party JSON response discovery is opt-in and recognizes only valid email
and phone values under explicit JSON-key semantics. It does not observe backend-only transfers and
is not a legal compliance certification tool. Its inventory is technical input to privacy review,
not a complete GDPR Article 30 record of processing activities.

See the repository README and API/privacy documentation for the complete beta contract.
