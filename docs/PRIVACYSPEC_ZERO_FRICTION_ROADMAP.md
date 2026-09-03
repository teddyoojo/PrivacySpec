# PrivacySpec — Zero-Friction Secondary Coverage Roadmap

**Status:** Approved product direction; executable work is tracked in
[`NEXT_IMPLEMENTATION_PLAN.md`](NEXT_IMPLEMENTATION_PLAN.md)
**Direction:** Differentiate through *near-zero incremental test work*, not scanner breadth
**Current product base:** `0.1.0-beta.3`: Playwright runtime, four analyzers, fail-closed coverage,
deterministic baselines/diffs, custom classifiers, baseline proposals, CI support, and experimental
additional browser/API surfaces
**Primary market reference:** ZAP and adjacent DAST/monitoring/test tooling
**North-star constraint:** Existing functional tests stay the test suite.

## Current-state reconciliation (2026-08-29)

This document defines product direction and the evidence gates for later expansion. It is not a
second API reference or a phase-by-phase claim about current behavior. Current source, tests,
schemas, and the reference documents routed from [`README.md`](README.md) remain authoritative;
the bounded execution sequence and acceptance criteria live in
[`NEXT_IMPLEMENTATION_PLAN.md`](NEXT_IMPLEMENTATION_PLAN.md).

The beta.3 source already provides several capabilities described below: baseURL inference,
baseline-free current-run observations, a functional/observation/four-module hierarchy, bounded
test attribution, normalized runtime events, explicit shard aggregation, fail-closed custom-context
coverage, selective baselines, high-confidence built-in categories, constrained custom DOM
classifiers, and a provider-neutral reporter/CLI with a GitHub adapter. These are trust contracts to
protect, not phases to reimplement.

The adoption-first work is:

1. formalize and release-gate the ten-line integration contract — implemented;
2. measure seven representative Playwright repository shapes with generic local fixtures —
   implemented;
3. simplify and bound first-run output around actionable secondary coverage — implemented;
4. add a strict runtime-artifact-based integration doctor — implemented;
5. publish accurate GitLab and generic CI guidance — implemented;
6. prove the existing normalized runtime seam with a synthetic adapter harness — implemented;
7. provide a local, non-telemetric adoption and usefulness evidence record — implemented; retain
   completed independent evaluations over time.

Additional automatic categories remain evidence-driven. Selenium remains a gated feasibility
spike, not an active product commitment. The numbered phases later in this document describe the
strategy; they do not override that execution order.

---

# 1. Product decision

PrivacySpec should not try to become a smaller ZAP, Burp, or generic DAST platform.

The product should optimize for a different outcome:

> **Add useful secondary runtime coverage to the functional test suite a team already maintains, with almost no additional testing work.**

The primary promise should be understandable without architecture knowledge:

> **Install PrivacySpec, wrap your existing Playwright fixture, add the reporter, and keep running the same tests. PrivacySpec observes those journeys and reports privacy behavior, runtime dependencies, browser security posture, and hidden runtime failures that the existing assertions do not cover.**

The technical differentiators already built—semantic normalization, bounded observation, fail-closed coverage, privacy-safe artifacts, deterministic baselines—remain crucial. They are the **trust machinery behind the promise**, not the headline.

---

# 2. The differentiation we should actually defend

## 2.1 The selling point

PrivacySpec should optimize:

```text
USEFUL ADDITIONAL COVERAGE
──────────────────────────
ADDITIONAL USER EFFORT
```

The product wins if a team can gain meaningful runtime information from work they already paid for:

- authentication setup;
- account/tenant creation;
- seeded state;
- application-specific navigation;
- permission handling;
- feature flags;
- checkout/profile/settings workflows;
- custom fixtures;
- CI environment setup;
- existing test data;
- existing browser coverage.

PrivacySpec should reuse that application-specific knowledge instead of asking the team to recreate it in another scanner or dedicated test suite.

## 2.2 The core invariant

Every major feature must preserve:

```text
EXISTING FUNCTIONAL TEST
+
NO NEW PRIVACYSPEC ASSERTION
+
NO SEPARATE SCAN JOURNEY
=
USEFUL ADDITIONAL INFORMATION
```

Configuration can exist for precision and advanced use cases, but ordinary value must not depend on annotating test bodies.

## 2.3 What we are *not* claiming

Do not claim that:

- ZAP cannot use regression tests;
- ZAP cannot passively observe traffic;
- existing-test reuse is unique to PrivacySpec;
- PrivacySpec has more security coverage than mature DAST tools;
- PrivacySpec replaces penetration testing;
- PrivacySpec establishes legal compliance.

ZAP explicitly supports proxying browser/regression-test traffic and passive scanning, and its Automation Framework supports broad scan workflows. Checkly also reuses existing Playwright suites for synthetic monitoring.

The defensible distinction is narrower:

> **PrivacySpec is designed to live inside the existing test execution and add multiple secondary coverage dimensions without requiring a separate scanner execution model, proxy/certificate setup, dedicated exploration suite, or new test assertions.**

---

# 3. Product contract: the “10-line test”

This should become an engineering requirement, not marketing copy.

For an ordinary supported Playwright repository, first-value integration must satisfy all of the following.

## 3.1 Integration budget

**Target:**

- no more than **2 existing files touched**;
- no more than **10 non-blank integration lines** in the normal path;
- **0 existing test bodies changed**;
- **0 PrivacySpec assertions**;
- **0 annotations/tags required**;
- **0 separate daemon/proxy processes**;
- **0 browser proxy settings**;
- **0 custom certificates**;
- **0 second test suite**;
- **0 separately authored scan plan**;
- same normal `playwright test` invocation remains valid;
- useful first-run output without first creating a baseline.

If a common repository archetype cannot meet this budget, treat that as a product-friction defect.

## 3.2 Desired normal integration

Simple repositories should be close to:

```ts
// fixtures.ts
import { test as base, expect } from "@playwright/test";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(base);
export { expect };
```

and:

```ts
// playwright.config.ts
reporter: [
  ["line"],
  ["@privacyspec/playwright/reporter"],
],
```

Optional configuration should remain optional when safe defaults can be inferred.

For example, if Playwright `baseURL` establishes a valid first-party origin, the quick start should not require duplicating it.

---

# 4. Roadmap philosophy

The roadmap is split into two types of work.

## A. Wedge work

Makes adoption easier and first value faster:

- integration simplification;
- first-run UX;
- CI portability;
- clearer reports;
- compatibility diagnostics.

## B. Trust/moat work

Makes the easy integration safe enough to leave enabled permanently:

- coverage integrity;
- bounded observation;
- semantic determinism;
- privacy-safe artifacts;
- meaningful baseline workflow;
- framework-neutral analyzer architecture.

The wedge gets users to try PrivacySpec.

The trust layer gets them to keep it.

---

# 5. Phase 0 — Freeze the product contract

**Priority:** P0
**Implementation risk:** low
**Product importance:** critical

Before adding another product capability, formalize the integration promise.

## Deliverables

Add a public/internal product contract such as:

```text
docs/product-contract.md
```

It should state:

1. PrivacySpec derives secondary coverage from existing functional journeys.
2. Ordinary use must not require PrivacySpec-specific test assertions.
3. The supported happy path must remain within the integration budget.
4. Unsupported observation fails closed.
5. Advanced configuration must not become mandatory for first value.
6. New analyzers are not automatically valuable; they must improve useful signal without material setup increase.
7. Scanner breadth is not a roadmap objective.

## Add a feature acceptance question

Every planned feature must answer:

> Does this improve useful automatic coverage, reduce integration effort, improve trust in results, or broaden portability without requiring users to maintain new test logic?

If not, defer it.

---

# 6. Phase 1 — Build a measurable friction benchmark

**Priority:** P0
**Why:** The core selling point must be tested like functionality.

Create an automated/maintainer-reviewed integration benchmark over representative Playwright repository shapes.

## 6.1 Required repository archetypes

Use generic fixtures first, then validate with independent repositories.

### Fixture A — minimal Playwright suite

- direct `@playwright/test`;
- one config;
- Chromium;
- baseURL.

Expected: minimal integration.

### Fixture B — shared custom fixture

- existing `base.extend(...)`;
- auth fixture;
- application helpers.

Expected: `withPrivacySpec(existingTest)` composition without test edits.

### Fixture C — setup/auth project

- Playwright setup project;
- storage state;
- dependent test projects.

Expected: clear supported behavior with no accidental leakage between setup and tests.

### Fixture D — multi-project browser matrix

- Chromium;
- Firefox;
- WebKit.

Expected: supported/experimental capability states are explicit and fail closed where necessary.

### Fixture E — sharded CI

- multiple Playwright shards/processes.

Expected: exact documented aggregation behavior; no false resolved/clean results.

### Fixture F — custom BrowserContext architecture

Expected: no false clean result; concise diagnostic explaining why observation is unsupported.

### Fixture G — monorepo/shared-package setup

Expected: package integration remains local to the test package and does not require repository-wide tooling.

## 6.2 Metrics

Record per fixture/repository:

```text
files touched
nonblank integration lines
test bodies changed
PrivacySpec-specific assertions
new processes
new environment variables
new certificates/proxy settings
commands added
time to first report
unsupported/incomplete reason
```

## 6.3 Release gate

For ordinary supported fixtures A–C:

```text
test body changes = 0
PrivacySpec assertions = 0
separate scan process = 0
files touched <= 2
integration lines <= 10
```

Treat regressions in this benchmark as release blockers.

---

# 7. Phase 2 — Make first-run value excellent

**Priority:** P0
**Reason:** A user should understand value before learning baselines, schemas, evidence exports, or compliance mappings.

The current product is technically rich, but the first experience must be simpler than the architecture.

## 7.1 First-run output hierarchy

The terminal should answer five questions:

```text
1. Did my Playwright tests pass?
2. Did PrivacySpec observe them completely?
3. Did PrivacySpec see anything important my assertions did not report?
4. What broad type of thing was it?
5. What should I inspect next?
```

Suggested output:

```text
PrivacySpec Secondary Coverage

Functional tests      PASS
Observation coverage  COMPLETE
Secondary coverage    REVIEW

Privacy       REVIEW   1
Dependencies  REVIEW   1
Security      PASS
Runtime       PASS

Worth reviewing

  NEW external recipient
  personal.email -> analytics.example.com

  NEW runtime dependency
  analytics.example.com

No PrivacySpec assertions were required.
```

## 7.2 First run must not require a baseline

A baseline is a regression workflow, not an onboarding prerequisite.

On first run:

- show current high-confidence observations;
- distinguish objective technical failures from contextual review;
- explain that baseline acceptance is optional for future diffs;
- do not dump hundreds of benign facts into terminal output.

## 7.3 Noise budget

Establish report-level budgets.

Suggested first-run terminal target:

- maximum 5–10 actionable groups before a “see full report” message;
- aggregate repeated facts;
- prioritize objective failures;
- then new external trust boundaries;
- then sensitive-data external flows;
- then meaningful posture/dependency changes.

Do not invent risk scoring merely to sort output.

## 7.4 No automatic causality claims

Use:

```text
observed
sent to
stored in
new external origin
uncaught error
```

Avoid:

```text
caused
breach
vulnerability
violation
```

unless independently established.

---

# 8. Phase 3 — Add an integration/coverage doctor

**Priority:** P0/P1
**Value:** Very high for the zero-friction positioning.

Implement a command focused specifically on setup confidence.

Possible interface:

```bash
privacyspec doctor
```

or:

```bash
privacyspec verify
```

## 8.1 The doctor should use existing runtime artifacts where possible

It should answer:

```text
PrivacySpec integration

Fixture observation       OK
Reporter                   OK
First-party origin         inferred from baseURL
Browser                    Chromium supported
Tests observed             42
Coverage                   COMPLETE
Baseline                   optional / not configured
CI                         detected
```

For failure:

```text
Coverage: UNSUPPORTED

Reason:
3 pages were created through an independent BrowserContext that
PrivacySpec cannot instrument safely.

Your Playwright tests are still valid.
PrivacySpec will not report this run as clean.
```

## 8.2 Do not make it a repository crawler

Avoid introducing broad static analysis merely to diagnose setup.

Prefer:

- runtime evidence;
- explicitly provided config;
- Playwright-resolved metadata;
- safe bounded checks.

## 8.3 Why this matters

The product promise becomes:

> Install → run tests → PrivacySpec tells you whether the integration is trustworthy.

That is stronger than documentation alone.

---

# 9. Phase 4 — Make CI provider-neutral

**Priority:** P0/P1
**Current direction:** GitHub support exists; portability should become explicit.

PrivacySpec should be able to say:

> **If your CI can run Playwright, it can run PrivacySpec.**

GitHub should be a first-class adapter, not the product boundary.

## 9.1 Provider-neutral core

The Playwright reporter and CLI must remain authoritative.

Provider adapters should only:

- execute/consume existing output;
- display summaries;
- upload sanitized artifacts;
- preserve exit semantics.

Do not place analyzer or baseline semantics inside GitHub-specific code.

## 9.2 GitHub

Keep/improve the existing GitHub integration:

- minimal permissions;
- clear job summary;
- optional report artifact;
- no baseline mutation;
- no external service requirement.

Hero summary:

```text
Playwright PASS
PrivacySpec REVIEW
Observation COMPLETE

2 secondary findings worth reviewing
```

## 9.3 GitLab CI

Add:

```text
docs/ci/gitlab.md
examples/ci/gitlab/.gitlab-ci.yml
```

Requirements:

- same `playwright test` execution;
- no second scanner container required by PrivacySpec itself;
- preserve exit code semantics;
- publish sanitized report as artifact;
- print a readable Markdown/text summary;
- proposal artifacts may be generated;
- accepted baselines must never be mutated automatically in CI.

Example goal:

```yaml
e2e:
  script:
    - npm ci
    - npx playwright test
  artifacts:
    when: always
    paths:
      - privacyspec-report.json
```

Keep the actual example aligned with the package's real paths and current API.

## 9.4 Generic CI guide

Add:

```text
docs/ci/generic.md
```

Cover:

- Jenkins;
- Azure DevOps;
- CircleCI;
- Buildkite;
- generic Docker/container runners.

Do not build provider-specific code unless real users justify it.

---

# 10. Phase 5 — Make “same suite, more coverage” visible in reports

**Priority:** P1
**Scope:** presentation and proof, not a new analysis engine.

Every report should reinforce:

```text
Functional coverage
+
Secondary coverage
```

not present PrivacySpec as an unrelated scanner report.

## 10.1 Primary report model

Lead with:

```text
Functional tests: PASS
Secondary coverage: REVIEW
Observation: COMPLETE
```

Then modules:

```text
Privacy
Dependencies
Security
Runtime
```

## 10.2 Show the relationship to existing tests

Lightweight test attribution is useful, but it is supporting evidence.

Example:

```text
NEW external recipient
personal.email -> analytics.example.com

Seen in:
  checkout > registered customer
  profile > update email
```

Do not make test names part of baseline fact identity.

Do not build a large “journey graph” before user demand proves it useful.

## 10.3 Required UX rule

A user must not need to understand:

- report schema versions;
- attachment versions;
- analyzer host internals;
- run-part contracts;
- canonical ordering;
- proposal digests;

to understand the first page/terminal output.

Those are implementation trust mechanisms.

---

# 11. Phase 6 — Strengthen automatic signal, not configuration burden

**Priority:** P1
**Rule:** Better defaults before more knobs.

PrivacySpec already has custom classifiers. They should remain an escape hatch, not the normal path.

## 11.1 Built-in detection policy

Add a built-in category only if all are true:

1. it appears across unrelated applications;
2. it can be detected at high confidence;
3. it creates meaningful secondary coverage;
4. false positives can be bounded;
5. it requires no per-test annotation.

Candidate expansions should be evidence-driven.

## 11.2 Custom classifier UX

Keep custom classifiers:

- bounded;
- deterministic;
- explicit;
- configuration-level;
- independent of test bodies;
- compatible with baseline/config identities.

Avoid a large DLP-style policy language.

## 11.3 Configuration burden metric

Track:

```text
percentage of useful findings produced with default configuration
```

This should rise over time.

A project that requires 30 custom rules before PrivacySpec becomes useful is failing the product promise.

---

# 12. Phase 7 — Treat baselines as optional maturity, not setup

**Priority:** P1
**Current base:** selective proposal/accept flow already exists.

Baselines should answer:

> What changed since the behavior we intentionally reviewed?

They should not be needed to justify installation.

## 12.1 Recommended workflow

```text
install
   ↓
first useful run
   ↓
team decides PrivacySpec is valuable
   ↓
baseline propose
   ↓
review
   ↓
baseline accept
   ↓
future PR diffs
```

## 12.2 README placement

Do not put baseline mechanics before first-run value.

README ordering should be:

1. what it does;
2. install;
3. minimal setup;
4. example output;
5. what it observes;
6. CI;
7. baseline workflow;
8. advanced configuration;
9. limitations.

## 12.3 Preserve safety

Do not weaken:

- CI mutation refusal;
- coverage eligibility;
- classifier compatibility;
- stale proposal protection;
- objective technical failure ineligibility.

These are part of the trust moat.

---

# 13. Phase 8 — Make integration portability an architectural goal

**Priority:** P1/P2
**Goal:** Playwright is the first adapter, not necessarily the permanent product boundary.

Do not ship Selenium yet.

First create a framework-neutral internal boundary without changing public behavior.

## 13.1 Extract/confirm a test-runtime adapter contract

Conceptually:

```ts
interface TestRuntimeAdapter {
  capabilities(): AdapterCapabilities;

  onTestStart(...): void;
  onTestEnd(...): void;

  onContext(...): void;
  onPage(...): void;
  onNavigation(...): void;

  onRequest(...): void;
  onResponse(...): void;
  onConsole(...): void;
  onPageError(...): void;

  installPreloadObserver(...): Promise<void>;
  snapshotStorage(...): Promise<void>;
}
```

The exact interface should follow current architecture rather than this illustrative shape.

## 13.2 Core boundary

Aim for:

```text
Playwright adapter
      │
      ▼
normalized runtime events
      │
      ▼
observer/analyzer core
      │
      ▼
semantic findings
```

Framework-specific code should own:

- lifecycle wiring;
- browser/test identities;
- event capture;
- capability truth.

Framework-neutral core should own:

- semantic normalization;
- classification;
- privacy-safe correlation;
- analyzers;
- findings;
- baseline semantics where feasible.

## 13.3 Validation

Before a second adapter exists:

- build a synthetic/fake adapter harness;
- prove analyzers do not depend implicitly on Playwright classes;
- prove adapter capability gaps propagate fail closed.

Do not rewrite stable code solely for architectural aesthetics.

Extract only seams needed for a plausible second adapter.

---

# 14. Phase 9 — Selenium feasibility spike, not product commitment

**Priority:** P2
**Do only after:** Playwright adoption/value evidence is positive.

Current Selenium/WebDriver BiDi makes this technically plausible: current Selenium documentation exposes cross-browser BiDi network events, console/JavaScript-error event streams, and preload-script support.

That does **not** mean feature parity is guaranteed.

## 14.1 Start with JavaScript Selenium

Reason:

- PrivacySpec core is TypeScript/Node;
- avoids immediately supporting four language bindings;
- tests whether the adapter concept is viable before multiplying packaging/support burden.

## 14.2 Spike requirements

Prototype only:

- WebDriver BiDi session detection;
- preload DOM observer;
- request/response events;
- console messages;
- JavaScript errors;
- storage/cookie observation;
- browsing-context accounting;
- capability reporting.

## 14.3 Required questions

Can Selenium provide, across target browsers:

1. observer installation before relevant application code?
2. stable network request/response events?
3. console/page-error equivalents?
4. browsing-context enumeration?
5. storage/cookie visibility?
6. deterministic lifecycle finalization?
7. sufficient capability detection to prevent false clean results?

## 14.4 Ship/no-ship gate

Do not ship `@privacyspec/selenium` unless:

```text
ordinary Selenium test bodies remain unchanged
AND
integration stays small
AND
coverage limitations can fail closed
AND
semantic output is compatible enough to share the PrivacySpec core
```

If Selenium requires invasive test rewrites, abandon the adapter.

---

# 15. Phase 10 — Real-world product-value program

**Priority:** P0 continuously
**Reason:** Ease is worthless if signal is not useful.

The core hypothesis has two factors:

```text
LOW INCREMENTAL EFFORT
×
USEFUL ADDITIONAL SIGNAL
=
PRODUCT VALUE
```

Measure both.

## 15.1 Independent adopter metrics

For each real suite:

### Setup

- files modified;
- lines added;
- minutes to first report;
- test bodies modified;
- custom rules required;
- CI changes required.

### Runtime

- overhead;
- coverage state;
- unsupported contexts;
- bounded-limit events.

### Signal

- number of actionable findings;
- number already known;
- number considered useful;
- number considered noise;
- number that changed an engineering/review decision.

### Retention

Ask:

> Would you keep PrivacySpec enabled on normal CI runs?

This is the most important product question.

## 15.2 Target product gates

Suggested targets after enough independent evidence exists:

```text
>= 80% supported installations meet the integration budget
>= 70% require no custom classifiers for first useful output
>= 60% of supported independent suites surface at least one useful
      previously-unasserted observation over a realistic evaluation period
noise low enough that maintainers would keep the reporter enabled
```

These are provisional product gates, not release correctness gates.

Revise them only from real evidence.

---

# 16. Kill/defer criteria

Do not continue expanding indefinitely.

Reconsider the product direction if, after serious independent testing:

- users consistently see no useful information;
- useful privacy findings occur only in controlled regressions;
- dependency/runtime observations are viewed as trivial;
- users disable the CI integration because of noise;
- most projects require extensive custom classifiers;
- common Playwright architectures remain unsupported;
- runtime overhead is too high for normal CI;
- the install/setup is no longer materially simpler than adding a separate scanner;
- users repeatedly prefer existing security/observability tools and would not retain PrivacySpec.

If those conditions hold, adding analyzers will not solve the product problem.

---

# 17. Features explicitly deprioritized

Unless real user evidence changes the strategy:

## Do not build next

- active vulnerability scanning;
- spider/crawler;
- attack payload engine;
- SQLi/XSS scanner;
- generic SAST;
- generic secret scanner;
- CVSS-style scoring for ordinary observations;
- backend instrumentation agent;
- hosted traffic collection;
- separate PrivacySpec test DSL;
- required per-test annotations;
- large journey graph subsystem;
- AI classification of arbitrary raw runtime content;
- complex policy language;
- SARIF just to look “security-native.”

These increase scope faster than they increase the core value proposition.

---

# 18. Competitive framing

## ZAP

ZAP is a mature web application security platform. It can:

- proxy automated regression tests;
- passively scan HTTP/WebSocket traffic;
- spider/crawl;
- run active attacks;
- execute automation plans;
- test API/security behavior.

PrivacySpec should not claim ZAP cannot work with existing tests.

The comparison should be:

```text
ZAP:
  powerful scanner/proxy platform
  → configure/explore/scan a target

PrivacySpec:
  test-native secondary coverage
  → reuse the exact application journeys already running in CI
```

The intended workflow difference:

```text
Existing Playwright suite
        │
        ├──── normal functional assertions
        │
        └──── PrivacySpec passive secondary coverage
```

not:

```text
Functional suite
        +
separate security scanning system
        +
separate exploration/auth configuration
```

## Checkly / synthetic monitoring

Checkly can reuse Playwright suites, but its primary objective is turning them into synthetic production monitors.

PrivacySpec's objective is different:

> derive additional technical coverage from the existing test execution itself.

## DAST platforms

Burp/StackHawk and similar products have much greater vulnerability-scanning breadth.

Do not compete on breadth.

Compete on:

> **useful extra technical signal per minute of setup and per line of additional test code.**

---

# 19. README redesign specification

The README currently leads too quickly with architecture/detail.

The new README should answer, in order:

```text
What is this?
Why would I install it?
How little do I have to change?
What will I actually see?
How is it different from a scanner?
What are the limitations?
```

A reader should understand the project in under one minute.

---

# 20. README hero

Recommended:

```markdown
# PrivacySpec

**Secondary runtime coverage for the Playwright tests you already have.**

Your tests verify what you explicitly asserted.
PrivacySpec observes the same test journeys and reports useful runtime
behavior those assertions do not cover.

- no new test cases
- no PrivacySpec assertions
- no proxy or certificate setup
- no separate scan suite
- local, sanitized artifacts
```

Do not lead with:

```text
Continuous privacy QA
OBSERVE / REGRESS / EVIDENCE
schema versions
technical-control mappings
```

Those can appear later.

---

# 21. README quick start

The quick start must visually prove the integration claim.

Example target:

```bash
npm i -D @privacyspec/playwright@beta
```

Then show the minimal supported fixture composition and reporter addition.

Immediately state:

> **Keep your existing test bodies unchanged. Run the same `npx playwright test` command.**

If a first-party `baseURL` can be safely inferred, use the zero-config example first.

Advanced configuration belongs below.

---

# 22. README result example

This is the most important section after installation.

Use a realistic example:

```text
$ npx playwright test

42 passed

PrivacySpec Secondary Coverage
Functional tests      PASS
Observation coverage  COMPLETE

Privacy       REVIEW
Dependencies  REVIEW
Security      PASS
Runtime       FAIL

Worth reviewing

NEW external recipient
  personal.email -> analytics.example.com

NEW runtime dependency
  analytics.example.com

NEW uncaught TypeError

Your Playwright assertions still passed.
```

The exact example must match real reporter semantics.

Do not fabricate capabilities.

---

# 23. README “What do I get?”

Keep it short.

```markdown
### Privacy behavior
Detect sensitive-data flows to URLs, network recipients, browser storage,
and console/runtime surfaces.

### Runtime dependencies
See new external origins/APIs/resources exercised by real test journeys.

### Browser security posture
Track selected cookie, header, CORS, and browser-visible security changes.

### Hidden runtime failures
Catch page errors, failed requests, console errors, and first-party server
failures that ordinary assertions can miss.
```

Then link detailed scope docs.

---

# 24. README “Why PrivacySpec?”

Use the actual differentiator.

```markdown
## Why PrivacySpec?

Your existing end-to-end suite already knows how to:

- log in
- create accounts and tenants
- navigate protected workflows
- exercise application-specific state
- reach checkout/profile/settings flows

PrivacySpec reuses that investment.

You do not maintain a second set of security/privacy journeys just to get
secondary runtime coverage.
```

This is a stronger argument than “our semantic baseline is novel.”

---

# 25. README “PrivacySpec vs ZAP”

Keep it respectful and concise.

Suggested wording:

```markdown
## PrivacySpec and ZAP

ZAP is a full web application security scanner and proxy. It can passively
inspect traffic, crawl applications, automate scans, and actively test for
many vulnerability classes.

PrivacySpec is not a replacement for ZAP.

PrivacySpec is designed for a different workflow: add it directly to the
functional test suite you already run and derive additional runtime
coverage from those same application-specific journeys.

Use ZAP when you want broad web security scanning.
Use PrivacySpec when you want near-zero-friction secondary coverage from
the tests your team already maintains.
Use both when both questions matter.
```

Do not claim ZAP requires a completely separate test suite; that would be inaccurate.

---

# 26. README “What it does not do”

Trust improves when limitations are clear.

Recommended short section:

```markdown
## Scope

PrivacySpec is not:

- an active vulnerability scanner;
- a penetration-testing replacement;
- a backend-wide data-flow tracer;
- a legal compliance verdict engine.

PrivacySpec only makes clean/resolved claims when its observation coverage
supports them. Unsupported or incomplete observation is reported as such,
not silently treated as PASS.
```

---

# 27. README structure

Target README order:

```text
1. Hero / one-sentence value proposition
2. 3–5 benefit bullets
3. Install
4. Minimal integration
5. Example output
6. What it observes
7. Why reuse existing tests matters
8. CI: GitHub / GitLab / generic
9. Optional baseline workflow
10. Advanced classifiers / experimental features
11. Privacy and safety
12. PrivacySpec vs ZAP
13. Scope / limitations
14. Links to detailed documentation
```

Keep architecture and schema detail out of the README unless required to use the package.

---

# 28. Documentation split

Move detail out of README into focused docs.

Suggested structure:

```text
docs/
  getting-started.md
  ci/
    github.md
    gitlab.md
    generic.md
  secondary-coverage.md
  coverage-integrity.md
  baselines.md
  custom-classifiers.md
  experimental-browsers.md
  api-request-observation.md
  architecture.md
  privacy-design.md
  legal-mapping-policy.md
  troubleshooting.md
```

README should sell and onboard.

Docs should specify.

---

# 29. Demonstration repository / GIF-worthy use cases

The project needs visible proof.

Keep a small demo with controlled commits/scenarios.

## Scenario A — hidden runtime failure

Existing assertion still passes.

PrivacySpec detects:

```text
NEW uncaught TypeError
```

## Scenario B — new third-party behavior

Existing checkout test still passes.

PrivacySpec detects:

```text
NEW external origin
```

## Scenario C — sensitive-data recipient change

Existing entered email is now sent to a new external recipient.

PrivacySpec detects:

```text
personal.email -> NEW external recipient
```

Clearly mark this as a controlled regression, not a vulnerability in an OSS project.

## Scenario D — coverage refuses false clean

Functional tests pass, but unsupported context architecture is used.

PrivacySpec returns:

```text
UNSUPPORTED / INCONCLUSIVE
```

These four examples communicate the product better than a long detector list.

---

# 30. Implementation priority table

| Work | User value | Differentiation | Ease | Risk | Priority |
|---|---:|---:|---:|---:|---|
| Formal 10-line integration contract | 10 | 9 | 10 | 1 | P0 |
| Integration friction benchmark | 9 | 9 | 7 | 2 | P0 |
| First-run terminal UX | 10 | 8 | 7 | 3 | P0 |
| `doctor` / integration verification | 9 | 8 | 6 | 3 | P0/P1 |
| README rewrite | 10 | 9 | 9 | 2 | P0 |
| GitLab CI guide/template | 8 | 6 | 9 | 2 | P1 |
| Generic CI guide | 8 | 6 | 10 | 1 | P1 |
| Lightweight observing-test attribution | 7 | 3 | 7 | 3 | P1/P2 |
| More automatic high-confidence categories | 7 | 5 | 5 | 6 | P2, evidence-driven |
| Adapter abstraction | 8 | 8 | 4 | 7 | P2 |
| Selenium JS feasibility spike | 8 | 8 | 4 | 7 | P2 after adoption proof |
| Full Selenium product | unknown | potentially 9 | 2 | 9 | Gate on spike/users |
| Journey graph subsystem | 5 | 3 | 3 | 6 | Defer |
| Active scanner | 7 | 1 | 1 | 10 | Reject |
| Backend agent | 7 | 2 | 1 | 10 | Reject for now |

`Ease`: 10 = easiest.
`Risk`: 10 = highest product/engineering risk.

---

# 31. Release sequence

## Next release — Adoption-first

Scope only:

- formal integration contract;
- friction benchmark;
- first-run summary improvements;
- README rewrite;
- integration doctor if implementation remains bounded;
- GitLab + generic CI documentation.

**No new analyzer.**

Success criterion:

> A new Playwright user understands the product and gets a useful result with no test-body changes in minutes.

## Following release — Portability foundation

Scope:

- internal adapter boundary;
- synthetic adapter tests;
- capability contract cleanup;
- optional lightweight test attribution;
- cross-browser graduation only where validated.

Success criterion:

> Core analysis no longer depends unnecessarily on Playwright implementation details.

## Later experimental release — Selenium feasibility

Only if Playwright adoption evidence is positive.

Scope:

- JavaScript Selenium adapter prototype using WebDriver BiDi;
- no stable support promise;
- capability matrix;
- independent suite validation.

Success criterion:

> Same product contract can plausibly survive outside Playwright.

---

# 32. Product proof gates before expanding beyond Playwright

Do not invest heavily in Selenium until all are true:

1. independent Playwright users can integrate within the friction budget;
2. users get useful findings without extensive custom configuration;
3. users understand output without maintainer explanation;
4. users keep PrivacySpec enabled in CI;
5. runtime overhead remains acceptable;
6. unsupported/incomplete runs remain a minority in intended use;
7. at least several independent teams/repos demonstrate repeat value.

If those are not true, Selenium multiplies an unproven product rather than growing a proven one.

---

# 33. North-star metrics

Track these as product metrics.

## Setup friction

```text
median files changed
median integration lines
median minutes to first result
% test bodies unchanged
% installs requiring custom classifier config
```

## Runtime value

```text
useful findings / supported suite
noise findings / supported suite
% runs COMPLETE
median overhead
```

## Retention

```text
% evaluators who would keep PrivacySpec enabled in CI
```

The retention metric should dominate feature count.

---

# 34. Final implementation rule

The project should consciously choose:

> **breadth of reuse over breadth of scanning.**

A successful PrivacySpec should eventually be able to say:

> **Already have browser tests? Add PrivacySpec and make them tell you more.**

Today that means Playwright.

If the model proves itself, adapters such as Selenium can extend the same idea.

The product should never require teams to rebuild the application-specific journey knowledge they already encoded in their functional suites.

That is the direction worth defending.
