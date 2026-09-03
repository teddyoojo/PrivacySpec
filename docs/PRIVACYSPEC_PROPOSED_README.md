> Source draft retained for product-direction review. The root `README.md` and package README are
> the current onboarding contracts; update those rather than treating this draft as current state.

# PrivacySpec

**Secondary runtime coverage for the Playwright tests you already have.**

Your Playwright tests verify what you explicitly asserted. PrivacySpec observes the **same test journeys** and reports useful runtime behavior those assertions do not cover.

- **No new test cases**
- **No PrivacySpec assertions**
- **No proxy or certificate setup**
- **No separate scan suite**
- **Local, sanitized artifacts**

PrivacySpec is privacy-first, with additional coverage for runtime dependencies, browser security posture, and hidden runtime failures.

> **Current status:** beta. Keep the documented coverage limitations in mind before treating a clean run as conclusive.

## Install

```bash
npm i -D @privacyspec/playwright@beta
```

## Add it to your existing Playwright suite

Compose PrivacySpec with the fixture you already use:

```ts
import { test as projectTest } from "./existing-fixtures";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(projectTest);
```

Add the PrivacySpec reporter beside your existing reporter:

```ts
export default defineConfig({
  reporter: [
    ["line"],
    ["@privacyspec/playwright/reporter"],
  ],
});
```

**Keep your existing test bodies unchanged.**

Run the same command you already run:

```bash
npx playwright test
```

For repositories that need explicit first-party or classifier configuration, add only the relevant options to `withPrivacySpec(...)`.

## What you get

A normal functional run can still pass while PrivacySpec exposes runtime behavior the assertions did not cover:

```text
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

> The example above illustrates PrivacySpec's output model. Exact wording/counts depend on the current release and observed application behavior.

## What PrivacySpec observes

### Privacy behavior

PrivacySpec can correlate supported sensitive inputs with browser-visible runtime sinks such as network requests, URLs, storage, and console activity.

It retains sanitized semantics rather than raw personal data.

### Runtime dependencies

See external origins, APIs, scripts, and resources actually exercised by your existing application journeys.

This is behavior-based dependency coverage—not a dump of every HTTP request.

### Browser security posture

Track selected browser-visible security properties and meaningful regressions such as cookie/header/CORS posture where the current observer has sufficient evidence.

### Hidden runtime failures

Surface browser/runtime failures that ordinary functional assertions may ignore, including supported page errors, console failures, failed requests, and first-party server errors.

## Why reuse existing tests?

A mature end-to-end suite already contains expensive application knowledge:

- authentication;
- account and tenant setup;
- seeded state;
- protected navigation;
- permissions;
- checkout/profile/settings workflows;
- feature flags;
- application-specific edge cases.

PrivacySpec reuses that work.

You do **not** maintain a second privacy/security journey suite just to reach the same application states.

```text
Existing Playwright suite
          │
          ├── functional assertions
          │
          └── PrivacySpec secondary coverage
```

The goal is simple:

> **Add useful technical coverage without adding more test journeys to maintain.**

## CI

PrivacySpec's core reporter and CLI are CI-provider agnostic.

If your CI can run Playwright, it can run PrivacySpec.

### GitHub Actions

Use the repository's documented GitHub integration for a concise secondary-coverage summary and sanitized artifacts.

### GitLab CI

A minimal GitLab job can run the same Playwright command and retain the PrivacySpec report:

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

Use the exact artifact paths/configuration documented for the current release.

### Other CI systems

Jenkins, Azure DevOps, CircleCI, Buildkite, and other runners can use the same provider-neutral Playwright reporter/CLI workflow.

## Optional regression baselines

You can get useful current-run observations without a baseline.

Once a team wants to track accepted runtime behavior over time, PrivacySpec supports explicit baseline review rather than silently accepting new behavior.

Typical workflow:

```bash
privacyspec baseline propose \
  --module privacy \
  --proposal .privacyspec/baseline-proposal.json

privacyspec baseline accept \
  --select <proposal-id> \
  --yes
```

Baseline acceptance is an explicit technical review action. It is not a legal approval and does not turn objective technical failures into accepted behavior.

CI does not automatically accept baseline changes.

## Coverage integrity

PrivacySpec distinguishes a clean observation from an inability to observe.

Supported coverage states include:

```text
COMPLETE
PARTIAL
INCOMPLETE
UNSUPPORTED
```

An unsupported/incomplete run is not silently reported as clean.

This matters when a test architecture creates browser contexts or execution paths PrivacySpec cannot safely instrument.

```text
Functional tests: PASS
Observation:      UNSUPPORTED
PrivacySpec:      INCONCLUSIVE
```

**No observation is not treated as proof of absence.**

## Custom classifications

PrivacySpec includes conservative built-in classification and bounded custom DOM classifiers for application-specific fields.

Custom classifiers are configuration-level extensions; they are not annotations you must add to each test.

Built-in classifications take precedence, ambiguous rules fail closed, and classifier configuration participates in compatibility checks so configuration changes cannot silently masquerade as resolved application behavior.

## Experimental surfaces

Some browser engines and request/API observation capabilities may be experimental in the current beta.

Experimental support remains capability-aware: if PrivacySpec cannot observe a surface completely enough to justify absence/baseline conclusions, it reports partial/inconclusive coverage instead of a clean result.

See the current API and architecture documentation for the exact support matrix.

## Privacy by design

Raw sensitive values may exist transiently during runtime correlation, but persisted PrivacySpec artifacts are designed to contain sanitized semantic evidence.

PrivacySpec does not intentionally persist collected:

- raw personal data;
- passwords;
- credentials;
- request bodies;
- response bodies;
- cookie values;
- raw runtime event payloads.

PrivacySpec is local and does not require a hosted telemetry service.

## PrivacySpec and ZAP

[ZAP](https://www.zaproxy.org/) is a full web application security scanner and proxy. It can passively inspect traffic, crawl applications, automate scans, and actively test for many vulnerability classes.

**PrivacySpec is not a replacement for ZAP.**

PrivacySpec is designed for a different workflow: add it directly to the functional test suite you already run and derive additional runtime coverage from those same application-specific journeys.

Use **ZAP** when you want broad web security scanning.

Use **PrivacySpec** when you want near-zero-friction secondary coverage from the test suite your team already maintains.

Use both when both questions matter.

## Scope

PrivacySpec is not:

- an active vulnerability scanner;
- a penetration-testing replacement;
- a backend-wide data-flow tracer;
- a legal compliance verdict engine.

Browser-side observation cannot reveal server-to-server behavior that never reaches the observed browser/test surface.

PrivacySpec only makes clean/resolved claims when its observation coverage supports them.

## More

See the repository documentation for:

- public API and configuration;
- architecture;
- coverage integrity;
- baseline workflow;
- privacy design;
- custom classifiers;
- experimental browser/API support;
- technical/legal mapping policy;
- release and validation process.

PrivacySpec is licensed under Apache-2.0.
