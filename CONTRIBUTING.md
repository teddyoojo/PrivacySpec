# Contributing

Thanks for helping improve PrivacySpec. Bug reports, sanitized compatibility reports,
documentation fixes, and focused code changes are welcome during the public beta.

## Development environment

Use Node.js 24.19.0, pnpm 11.21.0, Playwright 1.62.1, and Chromium for repository development:

```bash
pnpm install --frozen-lockfile
pnpm --filter @privacyspec/playwright exec playwright install chromium
pnpm check
pnpm build
pnpm test
```

## Change discipline

- Keep ordinary example tests free of PrivacySpec-specific assertions or annotations.
- Add positive and negative coverage for detector changes.
- Never commit raw personal data, passwords, tokens, request payloads, browser traces, or generated
  PrivacySpec reports.
- Keep technical observation, control relevance, and regulatory relevance separate.
- Do not describe findings as legal compliance or non-compliance determinations.
- Do not add telemetry, hosted dependencies, framework/browser scope, or broad data classifiers
  without a focused design discussion.

Use generated `.test` values in tests and verify that raw, encoded, Base64, and hashed forms are
absent from persisted artifacts. Browser behavior should be tested through real Chromium where
practical.

Open an issue before undertaking a large architectural change. Pull requests should explain their
behavior, tests, privacy impact, performance impact where relevant, and known limitations.

Contributions intentionally submitted to this repository are provided under the Apache License
2.0, as described by the license's contribution terms. PrivacySpec currently requires neither a
separate CLA nor a DCO sign-off.

Security-sensitive reports should follow [SECURITY.md](SECURITY.md) instead of beginning in a
public issue.
