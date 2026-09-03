# Generic CI

The Playwright reporter and `privacyspec` CLI are the provider-neutral integration. Jenkins, Azure
DevOps, CircleCI, Buildkite, container runners, and other systems need no PrivacySpec-specific
service, proxy, certificate, or analyzer process.

## Single-process sequence

Run Playwright once, preserve its exit status, and render the report afterward when the CI system
does not have an `always`/post-step mechanism:

```bash
playwright_status=0
npx playwright test || playwright_status=$?

summary_status=0
npx privacyspec summary --format markdown --output privacyspec-summary.md || summary_status=$?

if [ "$playwright_status" -ne 0 ]; then
  exit "$playwright_status"
fi
exit "$summary_status"
```

Upload `privacyspec-report.json` and, when created, `privacyspec-summary.md` as build artifacts. The
JSON report is strict, sanitized, and written with mode `0600`; CI artifact-store permissions and
retention remain the caller's responsibility.

The summary command returns zero for valid `PASS`, `REVIEW`, `FAIL`, and `INCONCLUSIVE` reports
because it is a renderer. The Playwright reporter remains authoritative for semantic CI failure.
Summary parsing or output errors still fail the post-processing step when the Playwright command
itself succeeded.

## Shards and coordinated processes

For every intended part:

1. configure the same bounded `runScope.runId` and `configurationId`;
2. use Playwright shard coordinates or an explicit one-based `part`/`total` pair;
3. retain the generated `.privacyspec-parts/<runId>/part-<part>-of-<total>.json` artifact;
4. download every expected part into the aggregation job;
5. call `privacyspec aggregate` with every path supplied through a separate `--part` argument;
6. render and retain only the final aggregate report.

PrivacySpec accepts at most 128 explicit parts and never uses glob expansion or recursive artifact
discovery. Missing coordinates remain `INCONCLUSIVE`; invalid or incompatible parts fail the
command. Do not summarize a per-part embedded report as a complete run.

## Provider adapters

Provider-native summary panes and artifact upload helpers may consume the existing strict report,
but they must not duplicate analyzer, coverage, baseline, or exit semantics. The repository's
GitHub Action follows this post-processing-only boundary; other providers can use the same CLI
without product-specific runtime code.

## Baseline and artifact safety

- Never accept or update a baseline in CI.
- Keep proposal generation read-only and subject to ordinary artifact review.
- Restrict access and retention for all test artifacts, including non-PrivacySpec Playwright
  traces, screenshots, videos, HTML reports, and error-context files.
- Do not treat a missing report, incomplete aggregate, or unsupported observation as a clean run.
