# Zero-friction adoption implementation plan

Status: approved and active

Approved: 2026-08-28

Last updated: 2026-08-29

This plan turns the product direction in
[`PRIVACYSPEC_ZERO_FRICTION_ROADMAP.md`](PRIVACYSPEC_ZERO_FRICTION_ROADMAP.md) into bounded
implementation work against the current `0.1.0-beta.3` source tree. It is subordinate to current
source, tests, schemas, manifests, and the current-state reference documents linked from
[`README.md`](README.md). The completed Steps 1–6 and release-hardening plans remain in Git and the
changelog; they are not active architectural authorities.

## Product outcome

PrivacySpec should add useful secondary runtime coverage to ordinary Playwright journeys with
near-zero incremental test work. The supported normal path must preserve this equation:

```text
existing functional tests
+ fixture composition and reporter configuration
+ no PrivacySpec assertions or scan journey
= useful, sanitized secondary coverage
```

The implementation optimizes useful signal per unit of adoption effort. Scanner breadth, analyzer
count, and framework count are not success metrics.

## Non-negotiable acceptance contract

For ordinary supported Playwright repositories, the happy path must keep:

- at most two existing files touched;
- at most ten non-blank PrivacySpec integration lines;
- zero existing test-body changes, PrivacySpec assertions, annotations, or tags;
- zero separate processes, proxy settings, custom certificates, scan suites, or authored scan
  plans;
- the same normal `playwright test` invocation;
- useful first-run output without an accepted baseline;
- inferred first-party origin when Playwright provides a valid `baseURL`;
- fail-closed `PARTIAL`, `INCOMPLETE`, or `UNSUPPORTED` results when trustworthy absence or
  resolution claims are unavailable.

Advanced configuration may improve precision, but must not become required for first value in the
supported happy path.

Every feature proposal must answer yes to at least one question without materially increasing
test maintenance:

1. Does it improve useful automatic coverage?
2. Does it reduce integration or interpretation effort?
3. Does it improve trust in the result?
4. Does it broaden portability while preserving the same product contract?

## Reconciliation with beta.3

The proposal describes several capabilities that already exist and should be protected rather than
rebuilt:

- `withPrivacySpec(existingTest)` composition and Playwright `baseURL` inference;
- first-run observations without a baseline;
- functional, observation, overall, and four-module report hierarchy;
- bounded occurrence-level test attribution outside baseline identity;
- normalized runtime events and failure-isolated analyzers;
- strict sanitized artifacts, bounded observation, and fail-closed coverage;
- explicit shard/process aggregation and custom-context incompatibility detection;
- selective, local, CI-disabled baseline proposal and acceptance;
- high-confidence built-in categories and bounded custom DOM classifiers;
- a provider-neutral reporter/CLI plus a post-processing GitHub Action;
- independent-suite usefulness, compatibility, determinism, privacy, and overhead evidence.

The active work is therefore adoption and proof work: formalize the promise, measure it, simplify
the first experience, diagnose integration from strict runtime evidence, document provider-neutral
CI, and prove the existing runtime boundary is portable enough before considering another adapter.

Implementation checkpoint (2026-08-29): Slices 1–7 are implemented and locally validated. Active
work is now evidence collection through independent, manually retained evaluations; automatic
category and framework expansion remain subject to the evidence gates below.

## Slice 1 — Product contract and onboarding

Priority: P0

Deliver:

- `docs/product-contract.md` with the acceptance budget, feature question, privacy/fail-closed
  constraints, and release-blocking supported-fixture gate;
- an adoption-first root README and a concise package README whose minimal example uses inferred
  `baseURL` and no optional configuration;
- exact output examples generated from tested renderer semantics, clearly labelled when
  illustrative;
- `docs/ci/gitlab.md` and `docs/ci/generic.md` using the existing reporter/CLI as the authoritative
  provider-neutral core;
- context-map and changelog updates for all durable public changes.

README order is: value proposition, install, minimal integration, first result, coverage modules,
why existing journeys matter, CI, optional baselines/configuration, privacy, comparison/scope, and
links. Schema and architecture detail remains in current reference docs.

Acceptance:

- the documented happy path fits the integration budget and changes no test body;
- every command, path, version, support boundary, and status word matches beta.3 source;
- wording reports technical observations rather than legal, causal, vulnerability, or compliance
  conclusions;
- root and package README examples do not drift on the normal integration path.

## Slice 2 — Automated friction benchmark

Priority: P0

Create generic local fixtures for these repository shapes:

1. minimal Playwright suite with `baseURL`;
2. shared extended fixture with auth/application helpers;
3. setup/auth project with storage state and dependent projects;
4. Chromium/Firefox/WebKit project matrix;
5. explicit sharded/process execution;
6. supported plus independent `BrowserContext` use;
7. monorepo test package consuming a shared package.

The benchmark records a versioned, reviewable result for each fixture:

```text
existing files touched
non-blank integration lines
test bodies changed
PrivacySpec assertions
new processes and commands
new environment variables
proxy/certificate settings
time to first report (informational local timing)
coverage state and fixed reason
```

Implementation requirements:

- compute structural metrics from before/after fixture inputs rather than trusting hand-authored
  claimed counts;
- run ordinary Playwright commands for behavior checks; do not add a PrivacySpec-only journey;
- reuse existing cross-engine, shard, and incompatible-context fixtures where that avoids
  duplicate browser behavior;
- keep machine/runtime timing informational and never a deterministic test assertion;
- scan generated artifacts for fixture secrets and require strict readers plus mode `0600`.

Release gate: fixtures 1–3 must meet the complete integration budget. Fixtures 4–7 must produce
their documented complete, partial, experimental, or unsupported result without a false clean
conclusion. A regression is release-blocking for the supported happy path.

## Slice 3 — First-run terminal and Markdown experience

Priority: P0

The first screen must answer, in order:

1. Did the functional tests pass?
2. Was observation complete?
3. Is secondary coverage pass, review, fail, or inconclusive?
4. Which module needs attention?
5. What bounded item or diagnostic should be inspected next?

Implementation requirements:

- keep `Functional tests`, `Observation coverage`, and `Secondary coverage` distinct;
- show privacy, dependencies, security, and runtime in fixed order;
- show at most five prioritized actionable semantic groups across the concise terminal section,
  followed by an omitted count and private JSON-report pointer;
- prioritize objective technical failures, coverage/integration blockers, new external trust
  boundaries, sensitive external flows, and remaining module changes without inventing a risk
  score;
- aggregate repeated identities and exclude accepted known observations;
- explicitly explain on a baseline-free run that current observations are useful and baseline
  review is optional for future change tracking;
- use only sanitized semantic facts and avoid causal, breach, vulnerability, violation, or legal
  claims;
- preserve strict current-report parsing and bounded Markdown behavior.

Update public renderer/reporter tests first, then update README examples from those assertions.
Do not change report, attachment, run-part, baseline, inventory, or evidence schemas for this
presentation slice.

## Slice 4 — Runtime integration doctor

Priority: P0/P1

Add:

```text
privacyspec doctor [--report <path>] [--format terminal|json]
```

The doctor reads only a strict current unified report and reports sanitized setup confidence:

- reporter artifact readable;
- fixture observations present or absent;
- supported/experimental/unsupported browser coverage;
- observed tests, contexts, pages, and request-fixture calls;
- overall coverage and fixed diagnostics;
- baseline present/absent per module, described as optional for first value;
- run-scope completeness and integration-error count.

It must not crawl the repository, import/evaluate arbitrary Playwright configuration, print test
titles or paths, echo parser payloads, or claim that an unrecorded setting such as `baseURL` was
inferred. A valid semantic result returns zero even when it diagnoses unsupported/incomplete
coverage; missing, malformed, unsupported-version, or unwritable output is a command error and
returns one. The reporter remains authoritative for CI policy.

## Slice 5 — Provider-neutral CI documentation

Priority: P1; implementation may ship with Slice 1

GitLab and generic CI guidance must:

- run the caller's existing Playwright command once;
- retain the strict sanitized report and optionally render Markdown/text with `privacyspec
  summary`;
- preserve the Playwright/reporter exit result separately from post-processing;
- aggregate every expected shard before rendering;
- never accept or mutate a baseline in CI;
- require no PrivacySpec service, proxy, certificate, scanner container, or provider-specific
  analyzer logic.

Do not add provider-specific runtime code until real user demand justifies it.

## Slice 6 — Portability proof, not a framework rewrite

Priority: P1/P2

The current pipeline already has a Playwright event adapter, normalized runtime-event union, and
framework-neutral analyzer host. Prove and tighten only the seam required for a plausible second
adapter:

- build a synthetic adapter harness that emits normalized lifecycle, request/response, console,
  page-error, source, storage, and capability events without Playwright object types;
- prove analyzer outputs and canonical identities are independent of event input order where the
  contract permits it;
- prove missing adapter capabilities propagate to module/overall inconclusive states;
- keep lifecycle wiring, browser/test identity, capture, and capability truth adapter-owned;
- keep classification, correlation, analyzers, findings, and semantic normalization in the core.

Do not refactor stable code for symmetry alone and do not change public behavior or schemas unless
a test exposes a real Playwright dependency in the core.

## Slice 7 — Local product-value evidence

Priority: continuous

Add a non-telemetric, maintainer-filled evidence template for each independent evaluation:

- files/lines/minutes to first report, test-body changes, custom rules, and CI changes;
- functional outcome, coverage state, unsupported contexts, bounded-limit facts, and overhead;
- useful/new/already-known/noise labels from explicit human review;
- whether the maintainer would leave PrivacySpec enabled in ordinary CI.

Never collect this automatically or upload it. Keep negative and unsupported outcomes. Do not turn
the provisional 80% integration, 70% default-configuration, 60% useful-signal, or retention goals
into correctness claims until enough independent records exist.

Implemented by [`evaluation-template.md`](evaluation-template.md), with aggregation and current
validation guidance in [`validation.md`](validation.md). Gathering real independent records is an
ongoing product activity rather than an automatic repository feature.

## Evidence-gated work

### Automatic category expansion

Add a built-in category only when unrelated applications demonstrate a repeated need, detection is
high-confidence and bounded, false positives have generic negative coverage, and no per-test
annotation is required. Configuration-language expansion is not a substitute for better defaults.

### Selenium JavaScript feasibility

Selenium is not part of the active implementation slices. Begin a time-boxed WebDriver BiDi spike
only after independent Playwright evidence shows that supported installations usually meet the
friction budget, useful findings require little custom configuration, users understand the output,
and maintainers would keep the tool enabled.

Any spike must establish preload timing, request/response and console/error events, browsing-context
accounting, storage/cookie visibility, deterministic finalization, and fail-closed capability
reporting. Do not ship an adapter unless ordinary Selenium test bodies remain unchanged,
integration remains small, and semantic output can safely reuse the core. Abandon the adapter if
those gates fail.

## Explicitly deferred or rejected

- active scanning, attack payloads, spider/crawler, SQLi/XSS engines, generic SAST, or generic
  secret scanning;
- hosted collection, telemetry, accounts, dashboards, backend agents, or broad GRC features;
- a PrivacySpec test DSL, required test annotations, large journey graphs, arbitrary DLP policy
  languages, or AI/LLM classification of raw runtime content;
- SARIF, provider-specific analyzer logic, or additional framework adapters solely for category
  signalling.

## Implementation order and validation

Implement Slices 1–5 in order, combining documentation-only work where coherent. Then complete the
bounded portability proof and local evidence template. Each slice updates current-state docs and
the changelog when its public contract changes.

Before each behavioral slice, run the closest tests after the required pre-change `pnpm check` and
`pnpm build`. After every coherent change, run:

```bash
pnpm check
pnpm format:check
pnpm build
pnpm test
git diff --check
```

Use local generic fixtures for adoption, renderer, CLI, architecture, and documentation work. Run
at most one short independent pilot only when local fixtures cannot represent the changed risk.
The full external matrix is reserved for independent validation, a release candidate, or an
explicit request.

Publishing, changing dist-tags, creating a GitHub release, accepting a real baseline, committing,
pushing, opening a PR, or expanding into Selenium remains outside this plan's authorization.
