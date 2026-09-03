# Contributing

PrivacySpec is a public Apache-2.0-licensed 0.x beta. Its compatibility surface is intentionally
small but real: preserve existing fixture/reporter behavior, rule IDs, schema-v1/v2 report-reader
compatibility, baseline schema v1, and baseline semantic keys unless a separately reviewed
migration says otherwise.

## Development environment

Use the versions pinned in the root manifest:

- Node.js 24.19.0;
- pnpm 11.21.0;
- Playwright 1.62.1 for repository development;
- Chromium.

Install dependencies and the pinned browser, then validate the unchanged checkout:

```bash
pnpm install --frozen-lockfile
pnpm --filter @privacyspec/playwright exec playwright install chromium
pnpm build
pnpm test
pnpm check
```

## Change discipline

- Read `AGENTS.md` and use `docs/README.md` to find the current architecture or contract before
  making structural changes.
- Keep ordinary demo tests free of PrivacySpec-specific assertions or annotations.
- Add positive and negative coverage for detector changes.
- Never commit raw personal data, passwords, tokens, request payloads, browser traces, or generated
  PrivacySpec reports.
- Keep technical observation, control relevance, and regulatory relevance separate.
- Do not describe findings as legal compliance or non-compliance determinations.
- Do not add telemetry, hosted dependencies, or new framework/browser scope without prior project
  approval.

Use generated `.test` values in tests and assert that their raw, encoded, Base64, and hashed forms
are absent from persisted artifacts. Browser-backed behavior should be tested through real Chromium
where practical.

## Changes and review

Keep commits small and coherent. A proposed change should explain behavior, tests, privacy impact,
performance impact where relevant, and known limitations. Security-sensitive fixes should follow
`SECURITY.md` rather than begin as public review material.

No contributor license agreement or developer certificate policy has been selected. Contributors
license submitted work under the repository's Apache-2.0 license; maintainers may introduce a more
explicit attestation policy only through a documented project decision.
