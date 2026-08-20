# PrivacySpec

PrivacySpec is a passive privacy and security data-flow regression layer for existing Playwright
tests. It observes high-confidence browser inputs and runtime sinks, correlates supported value
transformations, and reports sanitized semantic changes without requiring compliance-specific test
cases.

> **Public beta:** PrivacySpec has passed controlled and independently authored Playwright pilot
> validation, but has not yet accumulated broad production usage. Expect API refinement before a
> stable release.

PrivacySpec reports technical observations. It is not a legal compliance certification tool.

## Install

PrivacySpec supports Node.js `>=22.18.0`, Playwright `>=1.58.1 <2`, and Chromium.

```bash
pnpm add -D @privacyspec/playwright@beta
```

## Add it to an existing suite

Wrap the final shared fixture used by your tests:

```ts
// tests/fixtures.ts
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

Existing test bodies remain unchanged. They must import `test` from the shared fixture rather than
directly from `@playwright/test`.

Add the reporter beside your normal Playwright reporter:

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    baseURL: "http://localhost:3000",
  },
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

The configured Playwright `baseURL` origin is inferred as first party. Other application/API
origins must be configured explicitly. Development HTTP exceptions suppress the transport rule for
an exact origin; they do not classify unrelated origins as first party.

Ignore transient output while committing an explicitly reviewed baseline:

```gitignore
.privacyspec/
privacyspec-report.json
```

Run your ordinary suite:

```bash
pnpm exec playwright test
pnpm exec privacyspec baseline show
pnpm exec privacyspec baseline update
```

Review the complete first run before accepting its semantic review identities. Objective technical
failures cannot be baselined, and baseline mutation is refused in CI.

See [`examples/basic-playwright`](examples/basic-playwright) for a complete runnable integration.

## Current observation scope

PrivacySpec currently:

- discovers high-confidence email, telephone, and password controls;
- observes browser requests, URLs, headers/bodies, console output, and browser storage;
- correlates exact, case-normalized, URL/form-encoded, Base64, and SHA-256 representations;
- evaluates technical rules PS1001–PS1006;
- compares contextual findings as `NEW`, `KNOWN`, and `RESOLVED` semantic identities;
- writes concise terminal output and a mode-`0600`, schema-v1 JSON report;
- keeps raw sensitive values transient and provides no telemetry or hosted service.

It does not observe backend-to-backend transfers, response bodies, arbitrary JavaScript
transformations, WebSocket payloads, IndexedDB, or every category of personal data. Unobserved data
must not be interpreted as absent.

Playwright's own tracing, screenshots, video, reporters, and application logs can independently
retain test data. Configure those facilities according to the sensitivity of your fixtures.

## Documentation

- [Public API](docs/api.md)
- [Architecture](docs/architecture.md)
- [Privacy design](docs/privacy-design.md)
- [Legal mapping policy](docs/legal-mapping-policy.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

PrivacySpec is licensed under the [Apache License 2.0](LICENSE).
