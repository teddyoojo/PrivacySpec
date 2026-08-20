# Changelog

PrivacySpec follows semantic versioning. During the public beta, minor versions may contain API or
report-schema changes that would otherwise be considered breaking.

## 0.1.0-beta.1 — 2026-08-20

Initial public beta:

- composable Playwright fixture and reporter for Chromium suites;
- high-confidence email, telephone, and password source discovery;
- bounded network, URL, console, cookie, and web-storage observation;
- deterministic exact, case, URL/form, Base64, and SHA-256 correlation;
- six technical observation rules with contextual control/regulatory mappings;
- sanitized semantic baseline lifecycle and schema-v1 JSON reports;
- semantic aggregation of duplicate human-facing findings;
- Apache-2.0 licensing and a distributable-only npm package allowlist.

Known limits include backend-only flows, response bodies, arbitrary JavaScript transformations,
WebSockets, IndexedDB, non-Chromium browsers, and personal-data categories without strong browser
control semantics.
