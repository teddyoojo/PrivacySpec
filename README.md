# PrivacySpec

**Find privacy and security regressions in the Playwright tests you already run.**

A functional test can pass while the browser sends a customer email to a new third party, loads an
unexpected analytics script, or logs an uncaught error. PrivacySpec observes the same Chromium
journey and reports those facts as sanitized secondary coverage.

- No new tests, assertions, annotations, proxy, or scan suite
- The same `playwright test` command
- Useful output on the first run; baselines are optional
- Local-only artifacts with no account, service, or telemetry

## Install and run

PrivacySpec is a public beta for Playwright `>=1.58.1 <2` and Chromium.

```bash
npm i -D @privacyspec/playwright@beta
```

Wrap the fixture your tests already import:

```ts
// tests/fixtures.ts
import { test as projectTest } from "./existing-fixtures";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(projectTest);
```

Add the reporter:

```ts
// playwright.config.ts
reporter: [["line"], ["@privacyspec/playwright/reporter"]],
```

Run the suite normally:

```bash
npx playwright test
```

Existing test bodies stay unchanged. A valid Playwright `baseURL` is automatically treated as
first party.

## See what the test did—not only whether it passed

```text
42 passed

PrivacySpec Secondary Coverage
Functional tests      PASS          42/42 passed; 42 observed
Observation coverage  COMPLETE      contexts 42/42; pages 42/42
Secondary coverage    FAIL          3 changes

Privacy               REVIEW        1 change; 8 flows
Dependencies          REVIEW        1 change; 4 origins
Security              PASS          0 changes; 6 targets
Runtime               FAIL          1 change; 1 failure

Worth reviewing
  NEW runtime failure: Uncaught page error
  NEW runtime dependency: https://analytics.example.test · script
  NEW external recipient: personal.email → external-request · https://analytics.example.test

See the private JSON report for sanitized evidence.
```

Here the application still satisfied all 42 functional assertions, but the observed journey also:

- sent an email-category value to an external origin;
- loaded a previously unseen analytics script;
- raised a page error the tests did not assert on.

The report keeps semantic facts such as `personal.email`, `external-request`, and the normalized
origin—not the email value. Output is deterministic and points to a private mode-`0600` JSON report
when more detail is available.

## What PrivacySpec covers

| Coverage | Examples |
| --- | --- |
| Privacy flows | Supported sensitive inputs reaching URLs, requests, console, cookies, or browser storage |
| Runtime dependencies | External origins, APIs, scripts, frames, and other resources exercised by the journey |
| Browser security posture | Selected cookie, header, transport, CSP, HSTS, and CORS observations |
| Hidden runtime failures | Page and console errors, failed requests, and first-party server errors |

This works because existing end-to-end tests already know how to authenticate, create state, cross
permission boundaries, and reach important workflows. PrivacySpec reuses those journeys instead of
asking you to maintain a second privacy/security test suite.

## Use it in CI

The reporter works with any CI provider that can run Playwright. Keep the JSON report as an
artifact or render a bounded Markdown summary:

```bash
npx privacyspec summary --format markdown
```

Use the included [GitHub Action](action.yml), the [GitLab guide](docs/ci/gitlab.md), or the
[provider-neutral guide](docs/ci/generic.md). Sharded runs require explicit aggregation; CI never
accepts or updates a baseline.

## Optional change tracking

The first run reports current observations without a baseline. If you later want reviewed
`NEW`, `CHANGED`, and `RESOLVED` behavior, use explicit local baseline proposals and acceptance.
Accepted observations become quiet; incomplete coverage cannot manufacture a clean resolution.

Run `npx privacyspec doctor` to check whether the current report contains trustworthy fixture,
browser, page, context, and run-scope evidence. See the [public API](docs/api.md) for baseline,
sharding, classifier, inventory, test-data, and evidence commands.

## Trust and scope

PrivacySpec is local-only. Raw sensitive values may exist transiently in bounded browser or worker
memory for correlation, but PrivacySpec artifacts persist sanitized semantics rather than raw PII,
passwords, tokens, request bodies, console arguments, cookie values, or storage values.

Coverage is explicitly `COMPLETE`, `PARTIAL`, `INCOMPLETE`, or `UNSUPPORTED`; missing observation
does not become proof of absence. Other Playwright artifacts such as traces, screenshots, videos,
HTML reports, and storage state need their own privacy review.

PrivacySpec observes browser-visible behavior. It is not an active vulnerability scanner,
penetration-testing replacement, backend-wide tracer, or legal compliance verdict. Use a tool such
as ZAP when you need crawling, proxy inspection, or active security testing.

Firefox, WebKit, first-party JSON response discovery, and the composed Playwright request fixture
remain opt-in experiments. See [validation and known limits](docs/validation.md) for the exact beta
evidence and boundaries.

## Learn more

- Users: [public API](docs/api.md), [privacy design](docs/privacy-design.md), and
  [product contract](docs/product-contract.md)
- Maintainers and coding agents: start with [AGENTS.md](AGENTS.md), then use the
  [technical project guide](docs/README.md) to load only the relevant context
- Contributors: [contributing guide](CONTRIBUTING.md), [security policy](SECURITY.md), and
  [release process](docs/releasing.md)

Apache-2.0 licensed.
