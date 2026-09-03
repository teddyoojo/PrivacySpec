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
import { test as projectTest } from "./existing-fixtures";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(projectTest);
```

Add the reporter:

```ts
reporter: [["line"], ["@privacyspec/playwright/reporter"]],
```

Then run `npx playwright test`. Existing test bodies stay unchanged, and a valid Playwright
`baseURL` is automatically treated as first party.

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
```

All functional assertions passed, but the journey also sent an email-category value to an external
origin, loaded a new analytics script, and raised an unasserted page error. PrivacySpec persists
semantic facts such as `personal.email`, `external-request`, and the normalized origin—not the
email value.

## What PrivacySpec covers

| Coverage | Examples |
| --- | --- |
| Privacy flows | Supported sensitive inputs reaching URLs, requests, console, cookies, or browser storage |
| Runtime dependencies | External origins, APIs, scripts, frames, and other resources exercised by the journey |
| Browser security posture | Selected cookie, header, transport, CSP, HSTS, and CORS observations |
| Hidden runtime failures | Page and console errors, failed requests, and first-party server errors |

Existing end-to-end tests already know how to authenticate, create state, cross permission
boundaries, and reach important workflows. PrivacySpec reuses that work instead of requiring a
second privacy/security test suite.

## CI and optional baselines

The reporter is provider-neutral. Keep `privacyspec-report.json` as a private artifact or render a
bounded Markdown summary with `npx privacyspec summary --format markdown`. Sharded runs require
explicit aggregation, and CI never accepts or updates a baseline.

First-run observations do not need a baseline. Explicit local baselines can later track reviewed
`NEW`, `CHANGED`, and `RESOLVED` behavior. Run `npx privacyspec doctor` to check whether the report
contains trustworthy integration and coverage evidence.

## Trust and scope

PrivacySpec is local-only. Raw sensitive values may exist transiently in bounded browser or worker
memory for correlation, but PrivacySpec artifacts persist sanitized semantics rather than raw PII,
passwords, tokens, request bodies, console arguments, cookie values, or storage values.

Coverage is explicitly `COMPLETE`, `PARTIAL`, `INCOMPLETE`, or `UNSUPPORTED`; missing observation
does not become proof of absence. PrivacySpec observes browser-visible behavior. It is not an
active vulnerability scanner, penetration-testing replacement, backend-wide tracer, or legal
compliance verdict.

Firefox, WebKit, first-party JSON response discovery, and the composed Playwright request fixture
remain opt-in experiments.

## Documentation

See the [public API](https://github.com/teddyoojo/PrivacySpec/blob/main/docs/api.md),
[privacy design](https://github.com/teddyoojo/PrivacySpec/blob/main/docs/privacy-design.md),
[product contract](https://github.com/teddyoojo/PrivacySpec/blob/main/docs/product-contract.md), and
[validation record](https://github.com/teddyoojo/PrivacySpec/blob/main/docs/validation.md).

Apache-2.0 licensed.
