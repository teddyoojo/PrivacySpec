# Basic Playwright example

This example adds PrivacySpec to an ordinary one-test Playwright suite. The application accepts an
email through a first-party JSON request; PrivacySpec observes the semantic flow without changing
the test body.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @privacyspec/playwright exec playwright install chromium
pnpm test:example
```

The generated `.privacyspec/` handoff and `privacyspec-report.json` are ignored runtime artifacts.
