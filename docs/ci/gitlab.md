# GitLab CI

PrivacySpec uses the same Playwright process and command a project already runs. It does not need a
second scanner container, proxy, certificate, hosted service, or GitLab-specific analyzer.

## Single-process job

After adding the PrivacySpec fixture and reporter, a minimal job can retain the strict sanitized
report while preserving the Playwright/reporter exit result:

```yaml
e2e:
  script:
    - npm ci
    - npx playwright install --with-deps chromium
    - npx playwright test
  artifacts:
    when: always
    paths:
      - privacyspec-report.json
    expire_in: 7 days
```

The reporter already prints the terminal secondary-coverage hierarchy. The artifact path above is
the current default; use the configured `reportPath` if the project overrides it.

To create a bounded Markdown summary in a later artifact-processing job, run:

```bash
npx privacyspec summary --format markdown --output privacyspec-summary.md
```

The summary command validates and renders an existing report. It does not replace the original
Playwright/reporter exit policy: every valid semantic status returns zero, while missing,
malformed, unsupported-version, or unwritable input returns one.

## Parallel or sharded jobs

Every intended part must use one caller-owned `runScope.runId` and `configurationId`. Let
Playwright supply shard coordinates, retain each private part artifact, and pass all explicit part
paths to `privacyspec aggregate` in a final job before rendering or publishing the report.

Missing parts produce a valid `INCONCLUSIVE` aggregate. Duplicate, malformed, or mismatched parts
fail aggregation. The GitLab artifact transport and job dependency graph remain caller-owned;
PrivacySpec does not crawl artifact directories or infer a complete shard set from the files it
happens to find.

## Baselines

CI may create a read-only proposal artifact for review, but it must never run `baseline accept` or
`baseline update`. Accepted baseline mutation is an explicit local, confirmed action and is
disabled whenever `CI` is set.

Only sanitized PrivacySpec artifacts should be retained. Playwright traces, screenshots, videos,
HTML reports, and error-context artifacts have separate data-retention behavior and must be
reviewed independently.
