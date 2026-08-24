# PrivacySpec — Continuous privacy QA for Playwright

PrivacySpec is a passive privacy/security data-flow regression layer for existing Playwright tests.
It observes what ordinary functional journeys already cause the browser to do, correlates
high-confidence sensitive inputs with runtime sinks, and reports sanitized semantic changes without
requiring compliance-specific test cases.

PrivacySpec is available as a public 0.x beta from npm and is developed in the public
[`teddyoojo/PrivacySpec`](https://github.com/teddyoojo/PrivacySpec) repository. Install the beta
channel explicitly while its contracts are still evolving:

```bash
npm i -D @privacyspec/playwright@beta
```

PrivacySpec observes technical facts. It is not a legal compliance certification tool and does not
determine lawful basis, processor status, necessity, or regulatory applicability.

## Observe, regress, and provide evidence

- **OBSERVE:** turn the current Playwright run into an aggregated runtime privacy inventory;
- **REGRESS:** explain which review-relevant flows are known, new, or resolved and why a new
  semantic identity differs;
- **EVIDENCE:** retain sanitized, source-traceable technical facts for privacy and security review.

These outputs describe browser-side observations, not legal status. The inventory can inform
privacy records, but is not a complete GDPR Article 30 record of processing activities. Article 30
also requires purposes, data-subject categories, retention periods, safeguards, and other context
that PrivacySpec cannot observe. See [GDPR Article 30](https://eur-lex.europa.eu/eli/reg/2016/679/art_30/oj).

## What the beta does

- composes once with a Playwright shared fixture and reporter;
- discovers high-confidence email, telephone, password, name, postal-address, full birth-date,
  explicit account-identifier, payment-card, gender-identity, and job-title values from conservative
  DOM-control semantics;
- optionally discovers email and phone sources in bounded first-party JSON responses;
- supports bounded declarative DOM classifiers for application-specific `custom.personal.*` and
  high-confidence `custom.secret.*` categories;
- classifies observed browser-input email test data conservatively without DNS lookups;
- observes browser requests, URLs, request headers/bodies, console output, and browser storage;
- correlates exact, case-normalized, URL/form-encoded, Base64, and SHA-256 representations;
- evaluates the six scoped rules PS1001–PS1006;
- compares contextual review findings with an explicitly accepted semantic baseline;
- inventories runtime dependency origins, reviews accepted first-party security-posture changes,
  and detects selected hidden browser/runtime failures through the same passive event stream;
- writes one concise secondary-coverage hierarchy and a mode-`0600`, schema-v5 JSON report;
- renders that strict current report as a bounded terminal or GitHub-flavored Markdown CI summary;
- exports that report as a versioned terminal, JSON, CSV, or Markdown runtime inventory;
- exports a versioned terminal, JSON, or Markdown test-data hygiene review;
- scans explicitly supplied Playwright storage-state files for sanitized credential/personal-data
  structure and local Git hygiene without crawling the repository;
- exports a versioned JSON or Markdown audit-supporting technical evidence bundle;
- keeps raw sensitive values transient and provides no telemetry or hosted service.

The stable beta boundary remains Playwright + Chromium. Firefox/WebKit instrumentation and the
composed Playwright `request` fixture observer are explicit experiments, disabled by default and
fail closed when their guarantees are incomplete. First-party JSON response discovery is also
experimental, disabled by default, and limited to recognized email/phone keys plus valid value
shapes. PrivacySpec does not observe backend-only transfers, non-JSON/third-party response bodies,
WebSocket payloads, or arbitrary JavaScript transformations.

Expanded DOM discovery uses exact HTML autocomplete intent or corroborated `name`/`id` and
accessible-label hints. Card numbers require a bounded Luhn-valid shape; full payment expiry and
birth dates are structurally checked. Values shorter than six characters, generic identifiers,
ordinary person-like text, card security codes, and API/session/JWT tokens are not classified.
Gender identity and job title require exact standardized autocomplete intent. `personal.*`
categories are technical observations, not PCI, special-category, or other legal determinations.
Custom classifiers are exact declarative DOM-control tables only: no callbacks, regular
expressions, selectors, configured `data-*` attributes, or custom response/storage/URL/JavaScript
source discovery. Built-in classification always wins.

## Development setup

Use the repository-pinned Node.js 24.19.0 and pnpm 11.21.0 versions:

```bash
pnpm install --frozen-lockfile
pnpm --filter @privacyspec/playwright exec playwright install chromium
pnpm build
pnpm test
pnpm check
```

The complete test command runs the package suite and the public basic Playwright example. Browser
tests may require the platform dependencies documented by Playwright.

## Playwright integration

Install the public beta with `npm i -D @privacyspec/playwright@beta`, then compose the automatic
fixture with an existing shared fixture:

```ts
// tests/fixtures.ts
import { test as projectTest } from "./project-fixtures";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(projectTest, {
  firstParty: {
    origins: ["https://app.example.test"],
  },
  sources: {
    firstPartyJsonResponses: true, // experimental; defaults to false
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
  experimental: {
    browserEngines: ["firefox", "webkit"],
    apiRequestContext: "request-fixture",
  },
  testData: {
    syntheticEmailDomains: ["test-data.my-company.internal"],
  },
});
export { expect } from "@playwright/test";
```

Keep test bodies unchanged. Add the reporter beside the existing reporter:

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

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

For a simple suite, the package also exports a precomposed `test` and Playwright `expect`.
Playwright `>=1.58.1 <2` is the supported peer range; 1.58.1 and the pinned 1.62.1 have been tested.

Custom classifiers require a 1–128 character `customClassifierConfigurationId`. Keep it for
reorder-only changes and rotate it whenever classifier semantics change. PrivacySpec persists the
ID, never matcher literals/tables or an automatic matcher digest. This classifier identity is
independent of the execution-wide `runScope.configurationId`.

For Playwright shards or explicitly coordinated processes, give every invocation the same bounded
run/configuration IDs and let Playwright provide the shard coordinate:

```ts
{
  runScope: {
    runId: process.env.PRIVACYSPEC_RUN_ID!,
    configurationId: "chromium-ci-v1",
  },
}
```

Each process writes a private create-only part under `.privacyspec-parts/<runId>/`. After retaining
all parts, run `privacyspec aggregate --part <path> --part <path> ...`. Missing parts yield a valid
`INCONCLUSIVE` report; malformed, duplicate, or mismatched parts fail the command. Per-part reports
never calculate known/new/resolved conclusions or create baseline-update handoffs. Playwright
sharding without `runScope` fails closed and disables colliding single-writer outputs.

PrivacySpec instruments Playwright's test-scoped `context` and wraps the composed worker-scoped
`browser` fixture to count contexts and pages created through `browser.newContext()` or
`browser.newPage()`. Report schema v5 retains schema-v4 analysis and adds browser-engine/API
coverage plus request-surface facts. It preserves the stable `COMPLETE`, `PARTIAL`, `INCOMPLETE`,
or `UNSUPPORTED` coverage state and the namespaced
`analysis` section for privacy, runtime dependencies, browser security posture, and hidden runtime
errors. The terminal presents functional tests, observation coverage, the four module outcomes,
and a bounded change total in that order. The current version map is report v5, attachment v5,
run part v3, privacy baseline/latest run v2, inventory/evidence v2, and proposal/independent analyzer
contracts v1. Strict historical readers remain available for report/attachment v1–v5, run part
v1–v3, privacy baseline/latest v1–v2, and inventory/evidence v1–v2.
Independently created contexts are detected but not instrumented, so both all-custom and mixed
suites fail closed with `COVERAGE_INCOMPATIBLE` instead of a false clean `PASS`. Browser instances
launched outside the composed Playwright `browser` fixture remain outside this detection boundary.

Ungated Firefox/WebKit tests run functionally but emit `UNSUPPORTED` secondary coverage and fail
the reporter. Gated tests reuse the observer pipeline and are labelled experimental in artifacts,
summaries, inventory, and evidence. The `request` experiment transparently wraps only the composed
test fixture. Every detected API call is necessarily `PARTIAL` and baseline-ineligible because
Playwright does not expose guaranteed final wire headers, injected cookies/authentication, or each
redirect hop. `page.request`, `context.request`, and manually created request contexts remain
undetectable blind spots; API arguments and responses never become new sensitive sources, and API
response bodies are never read.

To bound source-free network-heavy tests, PrivacySpec counts but does not retain queryless static
`GET`/`HEAD` requests or narrowly recognized Vite development-module requests until a supported
sensitive source is observed. The report records the filtering count. Arbitrary query-bearing and
post-source traffic remain eligible. Cookie correlation also uses bounded per-cookie locations and
collapses repeated ambient propagation across asset
endpoints, reducing inventory fan-out without raising the sink cap.

Control-to-sink correlation is scoped to one isolated Playwright test and establishes
co-observation, not temporal causation. This avoids treating asynchronous browser-to-worker event
delivery as a reliable clock. Response-discovered sources remain restricted to later sinks.

## Findings and baseline lifecycle

Objective technical findings fail the reporter. Context-dependent personal-data findings are
`REVIEW_REQUIRED` and warn by default. First-run terminal output groups duplicate runtime
occurrences by semantic identity while the sanitized JSON report retains occurrence-level test
evidence.

After reviewing a complete run:

```bash
privacyspec baseline show
privacyspec baseline propose
privacyspec baseline accept --select <proposal-id>
privacyspec baseline update
privacyspec explain PS1004
privacyspec aggregate --part path/to/part-1.json --part path/to/part-2.json
privacyspec summary
privacyspec inventory
privacyspec testdata
privacyspec testdata scan path/to/storage-state.json
privacyspec evidence --commit <commit-id> --build-id <build-id>
```

`baseline propose` reads one module's accepted baseline plus complete latest-run handoff and writes
a private, separately versioned add/change/remove proposal without changing the baseline. Review
its deterministic IDs, then pass only chosen IDs to `baseline accept`; unselected accepted entries
remain unchanged. Acceptance requires confirmation (or `--yes`), revalidates both source snapshots,
and is disabled in CI. `baseline update` remains the compatible confirmed whole-snapshot
replacement command and is the explicit migration path after rotating a custom-classifier ID.
Classifier mismatches suppress privacy known/new/resolved and selective proposals; legacy v1
privacy artifacts with custom categories require a fresh current run before reacceptance. Privacy
baselines contain only contextual semantic review identities—never a
raw or hashed test value—and objective privacy technical failures cannot be accepted.

`privacyspec summary` reads a strict current schema-v5 unified report and supports terminal or
Markdown output. It defaults to `privacyspec-report.json` and terminal stdout; use
`--format terminal|markdown`, `--report <path>`, and private atomic `--output <path>` as needed.
Valid `PASS`, `REVIEW`, `FAIL`, and `INCONCLUSIVE` reports all return exit code `0`; only missing,
malformed, unsupported, or unwritable input returns `1`. Summary rendering is post-processing and
does not replace the reporter's CI policy.

`privacyspec inventory` reads `privacyspec-report.json` by default and writes to stdout. Use
`--format terminal|json|csv|markdown`, `--report <path>`, and `--output <path>` as needed. File
output is atomic and private (`0600`). Inventory states are `OBSERVED`, `KNOWN_REVIEW`,
`NEW_REVIEW`, and `TECHNICAL_FAILURE`; a known baseline flow is never presented as legally
approved. Incomplete source reports remain exportable and are prominently marked `INCOMPLETE`.

`privacyspec testdata` reads the same report and supports
`--format terminal|json|markdown`, `--report`, and private atomic `--output`. It classifies only
email values already observed in browser input controls. `SYNTHETIC` means an IANA-reserved
example/special-use domain or explicitly configured suite domain matched;
`REVIEW_REQUIRED` means only that no synthetic-domain rule matched; and `UNASSESSED` covers values
outside the supported email shape. These observations never affect the test or PrivacySpec exit
status and do not establish whether a person or routable mailbox exists.

`privacyspec testdata scan <path...>` is a separate, explicit artifact hygiene pilot for Playwright
storage-state/auth JSON. It never crawls the repository or follows symlinks. Bounded parsing emits
only input indexes, structural counts, credential/personal-data shape counts, and local Git status
(`TRACKED`, `IGNORED`, `UNTRACKED`, or `GIT_UNAVAILABLE`). Credential-bearing state that is
tracked, unignored, or cannot be classified by Git is `REVIEW_REQUIRED`; ignored local state is
`INFORMATIONAL`. This is a review prompt, not proof of publication, exposure, account compromise,
or legal status. Input paths, cookie/localStorage names and values, origins, and domains are never
rendered. The technical basis is [Playwright's authentication guidance](https://playwright.dev/docs/auth).

`privacyspec evidence` reads the same report and supports `--format json|markdown`, `--report`,
private atomic `--output`, and optional explicit `--commit`/`--build-id` metadata. It keeps observed
technical facts, technical-control relevance, and regulatory relevance in separate sections, with
source mappings and explicit coverage/legal limitations. It does not infer build metadata, upload
artifacts, retain history, sign output, or make legal conclusions. Incomplete source runs are
prominently marked and never present resolved candidates as conclusive.

## GitHub Actions summary

The repository provides a post-processing composite Action. Install PrivacySpec in the caller,
run the existing Playwright command normally, aggregate every expected part first when sharding,
and invoke the Action with `if: always()` so a validated final report can still be summarized after
a failing test run:

```yaml
- name: Run Playwright
  run: pnpm test:e2e

- name: Publish PrivacySpec summary
  if: always()
  uses: teddyoojo/PrivacySpec@v0.1.0-beta.3
  with:
    working-directory: .
    report-path: privacyspec-report.json
```

Inputs are `working-directory` (`.`), `report-path` (`privacyspec-report.json`), `artifact-name`
(`privacyspec-report`), `upload-artifact` (`true`), and `retention-days` (`7`). The Action validates
the schema-v5 report through the caller's locally installed CLI, appends sanitized Markdown to the
GitHub Step Summary, and uploads only a private staging copy with `actions/upload-artifact@v4`.
It installs neither dependencies nor browsers and never accepts a baseline. The Action
intentionally does not discover or aggregate shard artifacts.

## Example

[`examples/basic-playwright`](examples/basic-playwright) is a runnable integration that composes
PrivacySpec with an ordinary Playwright fixture and reporter without changing the test body.

## Documentation

- [Architecture](docs/architecture.md)
- [Public API](docs/api.md)
- [Privacy design](docs/privacy-design.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Legal mapping policy](docs/legal-mapping-policy.md)
- [Release process](docs/releasing.md)
- [Changelog](CHANGELOG.md)

The source is licensed under [Apache License 2.0](LICENSE). The current release is
`@privacyspec/playwright@0.1.0-beta.3`; use the `beta` install tag. During the public beta, both the
`beta` and `latest` npm dist-tags resolve to the current prerelease.
