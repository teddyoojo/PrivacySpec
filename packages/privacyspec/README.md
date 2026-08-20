# @privacyspec/playwright

PrivacySpec adds passive, sanitized privacy and security data-flow regression to existing
Playwright tests. This package is an experimental public beta.

Install the explicit `beta` tag. npm also exposes this first and currently only registry version
through its default tag; that does not indicate stable support.

PrivacySpec reports technical observations. It is not a legal compliance certification tool.

## Install

```bash
pnpm add -D @privacyspec/playwright@beta
```

Requirements: Node.js `>=22.18.0`, Playwright `>=1.58.1 <2`, and Chromium.

## Integrate

Wrap the final fixture used by existing tests:

```ts
import { test as projectTest, expect } from "@playwright/test";
import { withPrivacySpec } from "@privacyspec/playwright";

export const test = withPrivacySpec(projectTest, {
  firstParty: {
    origins: ["https://api.example.test"],
  },
  dev: {
    allowInsecureOrigins: ["http://localhost:3000"],
  },
});

export { expect };
```

Add the reporter beside your existing reporter:

```ts
export default defineConfig({
  use: { baseURL: "http://localhost:3000" },
  reporter: [
    ["line"],
    [
      "@privacyspec/playwright/reporter",
      {
        baselinePath: "privacyspec-baseline.json",
        latestRunPath: ".privacyspec/latest-run.json",
        reportPath: "privacyspec-report.json",
        failOnNewReviewFindings: process.env.CI === "true",
      },
    ],
  ],
});
```

Existing test bodies remain unchanged. The root export also provides a precomposed `test` and
Playwright `expect` for suites without custom fixtures.

## Baselines and explanations

```bash
pnpm exec playwright test
pnpm exec privacyspec baseline show
pnpm exec privacyspec baseline update
pnpm exec privacyspec explain PS1001
```

Baseline updates require a complete run and explicit confirmation and are refused in CI. Objective
technical failures cannot be accepted into the baseline.

## Privacy and scope

Raw sensitive values exist only transiently in bounded browser/test-worker memory. PrivacySpec
artifacts contain sanitized semantic metadata, not collected request bodies, console arguments,
storage values, or raw inputs. The package has no telemetry or hosted service.

Current discovery covers high-confidence email, telephone, and password controls. Current sinks
cover browser network, URL, console, cookies, and web storage. Backend-only flows, response bodies,
arbitrary JavaScript transformations, WebSockets, IndexedDB, and non-Chromium browsers are outside
the beta scope.

See the [PrivacySpec repository](https://github.com/teddyoojo/PrivacySpec) for the complete example,
API, privacy design, security policy, and limitations.
