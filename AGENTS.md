# AGENTS.md

## Start here

PrivacySpec is a local, passive secondary-coverage layer for existing Playwright suites. It reuses
ordinary functional journeys to observe privacy/security-relevant browser behavior, compare stable
semantic changes, and produce sanitized technical evidence without per-test compliance code.

Use [`docs/README.md`](docs/README.md) as the project context map. It points to the right document
and code area for each kind of task. [`docs/NEXT_IMPLEMENTATION_PLAN.md`](docs/NEXT_IMPLEMENTATION_PLAN.md)
is the explicitly approved active forward plan and remains subordinate to current source, tests,
schemas, and reference documentation. The completed prototype and secondary-analyzer roadmaps are
historical; their detail belongs in Git and the changelog.

For a new task, read only:

1. this file;
2. the task row in `docs/README.md`;
3. the linked current-state document and relevant source/tests.

## Sources of truth

Use this order when information disagrees:

1. current source, tests, package manifests, and schemas;
2. current reference docs linked from `docs/README.md`;
3. `CHANGELOG.md` and `docs/validation.md` for release and validation history;
4. Git history for completed plans and detailed historical evidence.

Do not restore a completed roadmap as an architectural authority. Update current-state docs in the
same change whenever a public contract, architecture boundary, privacy guarantee, or validation
claim changes.

## Product constraints

The core thesis is:

> PrivacySpec observes what ordinary functional tests already cause the application to do,
> identifies privacy/security-relevant changes, and explains why those observations may matter —
> without asking QA engineers to write compliance tests.

- Keep ordinary Playwright test bodies free of PrivacySpec annotations and assertions.
- Keep the tool local-only, passive, and Playwright + Chromium first.
- Do not add telemetry, hosted services, accounts, AI/LLM dependencies, a browser fork, full dynamic
  taint tracking, other browser/test-framework adapters, dashboards, or broad GRC features without
  explicit user approval.
- Do not add repository-specific production logic to satisfy an external pilot. A fix must express
  a repository-independent invariant and have generic synthetic/property coverage.
- Surface negative validation results and unsupported coverage honestly. Never manufacture a clean
  result from incomplete observation.

## Privacy and security invariants

Never persist raw PII, passwords, tokens, request bodies, console arguments, storage values, or
other sensitive test values.

Raw sensitive values may exist only transiently in bounded browser/test-worker memory when needed
for correlation or hygiene classification. They must not appear in baselines, reports, analyzer
artifacts, logs, snapshots, attachments, generated screenshots, telemetry, or committed fixtures.

Persist semantic facts instead: data category, sink, boundary/recipient, normalized endpoint,
structured location, transform, test attribution, stable identity, rule ID, and sanitized counts.
Treat any raw-value persistence as a privacy/security defect. Read `docs/privacy-design.md` before
changing collection, correlation, serialization, report parsing, or artifact output.

## Legal and compliance wording

PrivacySpec reports technical observations; it is not a legal compliance certification tool.
Keep these layers separate:

1. observed technical fact;
2. relevant technical control;
3. contextual regulatory relevance.

Use `TECHNICAL_FAILURE`, `REVIEW_REQUIRED`, and `INFORMATIONAL`. Do not label an application
`compliant`, `non-compliant`, or in violation of GDPR/NIS2. Legal mapping changes require primary
authoritative sources and the review process in `docs/legal-mapping-policy.md`.

## Change workflow

Before changing code or product behavior:

- inspect `git status` and recent history;
- read the task-specific context from `docs/README.md`;
- run `pnpm check` and `pnpm build`;
- run the closest existing tests when the previous committed full-local gate is green.

After a change, run the complete local gate:

```bash
pnpm check
pnpm format:check
pnpm build
pnpm test
```

Fix regressions before handoff. Summarize changed files, behavior, validation, and limitations.
Keep commits small and coherent when a commit is requested; do not rewrite history.

The full independent repository matrix is not routine validation. Use at most one short external
pilot slice only when local fixtures cannot represent the changed risk:

- fixture/reporter/version compatibility: minimal Playwright 1.58.1 package smoke;
- custom-context coverage: controlled mixed-context fixture or one representative external test;
- response/storage/privacy correlation: a small authentication/smoke slice;
- high-volume network behavior: a small journey or the local load fixture;
- models, renderers, schemas, CLI, or documentation: no external pilot.

Run the full external matrix only for dedicated independent validation, a release candidate, or an
explicit user request.

## Toolchain and release safety

Use the pinned workspace toolchain: Node.js 24.19.0, pnpm 11.21.0, TypeScript, Playwright Test, and
Chromium. Do not silently change major runtime/tool versions.

Publishing a package, changing npm dist-tags, creating a GitHub release, transferring the
repository, or accepting a baseline requires explicit user authorization. See `docs/releasing.md`.
