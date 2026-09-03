# Technical project guide

This is the context router for PrivacySpec maintainers and coding agents. Product users should
start with the root [`README.md`](../README.md). Coding agents should read [`AGENTS.md`](../AGENTS.md)
first, then use the task table below to load only the relevant document and code area.

## Project in one minute

PrivacySpec is an Apache-2.0, local-only Playwright package that passively observes ordinary
Chromium test journeys. It turns bounded runtime events into sanitized privacy flows, dependency
origins, browser security-posture changes, and hidden runtime failures. It compares stable semantic
identities with explicit baselines and produces terminal, JSON, inventory, test-data hygiene, and
evidence outputs.

The repository currently contains:

- `packages/privacyspec`: the published `@privacyspec/playwright` package and `privacyspec` CLI;
- `apps/demo-saas`: controlled ground truth with ordinary Playwright tests and isolated leak flags;
- `docs`: current architecture, contracts, safety policy, validation, and release guidance.

The current package is `0.1.0-beta.4`. Unified reports are schema v5, per-test attachments v5,
run parts v3, privacy baselines/latest-run handoffs v2, and inventory/evidence exports v2. Report
v1–v5, attachment v1–v5, run-part v1–v3, privacy baseline/latest v1–v2, and inventory/evidence
v1–v2 remain strict readable contracts. Independent analyzer artifacts/baselines, test-data,
storage-state, and selective proposals remain schema v1. Playwright `>=1.58.1 <2` and Chromium are
the supported beta boundary; Firefox, WebKit, and the composed request fixture remain opt-in
fail-closed experiments.

## Find context by task

| Task | Read first | Then inspect |
| --- | --- | --- |
| Understand the product or integrate it | [`README.md`](../README.md), [`api.md`](api.md) | `packages/privacyspec/src/index.ts`, `src/playwright/fixture.ts`, `src/playwright/reporter.ts` |
| Change runtime architecture or analyzers | [`architecture.md`](architecture.md) | `src/runtime/`, `src/analyzers/`, `src/playwright/`, nearest tests |
| Change privacy collection, correlation, or artifacts | [`privacy-design.md`](privacy-design.md) | `src/discovery/`, `src/observe/`, `src/correlate/`, redaction and schema tests |
| Change rules or regulatory wording | [`legal-mapping-policy.md`](legal-mapping-policy.md) | `src/rules/definitions.ts`, `src/rules/legal-map.ts`, legal-mapping tests |
| Change CLI, reports, or public exports | [`api.md`](api.md) | `src/cli/`, `src/report/`, `src/index.ts`, CLI/report tests |
| Implement the approved forward roadmap | [`NEXT_IMPLEMENTATION_PLAN.md`](NEXT_IMPLEMENTATION_PLAN.md) | Current source, tests, schemas, and the task-specific reference document |
| Maintain the zero-friction product contract | [`product-contract.md`](product-contract.md), [`PRIVACYSPEC_ZERO_FRICTION_ROADMAP.md`](PRIVACYSPEC_ZERO_FRICTION_ROADMAP.md) | Integration fixtures, reporter/CLI UX, package/root README |
| Integrate with CI providers | [`ci/generic.md`](ci/generic.md), [`ci/gitlab.md`](ci/gitlab.md) | Reporter/CLI contracts, root `action.yml` for GitHub |
| Work on controlled browser behavior | [`apps/demo-saas/README.md`](../apps/demo-saas/README.md) | `apps/demo-saas/src/`, `apps/demo-saas/tests/`, leak tests |
| Assess evidence, limitations, performance, or adoption | [`validation.md`](validation.md), [`evaluation-template.md`](evaluation-template.md) | benchmark JSON under `apps/demo-saas/benchmark/`, relevant fixtures/tests, manually retained independent records |
| Prepare a release | [`releasing.md`](releasing.md), [`CHANGELOG.md`](../CHANGELOG.md) | package manifest, package README, CI workflow |
| Contribute or report a vulnerability | [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md) | `AGENTS.md` for repository constraints |

All package-relative `src/` paths in the table refer to `packages/privacyspec/src/`.

## Code map

```text
packages/privacyspec/src/
├── playwright/        fixture, reporter, coverage, finalization, browser observers
├── runtime/           normalized event model, capabilities, analyzer host
├── analyzers/         privacy, dependencies, security posture, runtime failures
├── discovery/         conservative sensitive-source classification
├── observe/           bounded network, console, storage, and response sinks
├── correlate/         transforms, matching, redaction, stable flow semantics
├── rules/             PS1001–PS1006 and source-traceable mappings
├── baseline/          privacy semantic baseline lifecycle
├── report/            strict report schemas/readers and terminal/JSON output
├── doctor/            read-only sanitized integration diagnosis from current reports
├── inventory/         current-run privacy inventory export
├── testdata/          runtime email hygiene and explicit storage-state scan
├── evidence/          audit-supporting technical evidence export
└── cli/               command parsing and orchestration
```

Tests live beside each workspace in `test/`; real Chromium fixtures live under
`packages/privacyspec/fixtures/`; ordinary demo E2E tests live in `apps/demo-saas/tests/`.

## Common commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @privacyspec/playwright exec playwright install chromium firefox webkit

# Fast pre-change gate
pnpm check
pnpm build

# Complete local acceptance gate
pnpm check
pnpm format:check
pnpm build
pnpm test

# Useful focused commands
pnpm --filter @privacyspec/playwright test
pnpm --filter @privacyspec/demo-saas test:unit
pnpm test:e2e
pnpm benchmark
```

## Source-of-truth and documentation policy

- Current behavior: source, tests, schemas, package manifests, then current reference docs.
- Public changes: `CHANGELOG.md`.
- Current validation claims and known limits: `docs/validation.md`.
- Completed implementation chronology: Git history, not an active roadmap.
- Approved future work: `docs/NEXT_IMPLEMENTATION_PLAN.md`, subordinate to every current-state
  source above.

Current docs describe what the system does now. Avoid phase-by-phase narration, speculative task
queues, and duplicated contracts. When adding or removing a durable document, update this map and
the root README documentation list in the same change.
