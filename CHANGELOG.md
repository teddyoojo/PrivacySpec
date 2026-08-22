# Changelog

All notable changes to PrivacySpec are recorded here.

## Unreleased

## 0.1.0-beta.2 — 2026-08-22

### Added

- `privacyspec inventory` with terminal, JSON, CSV, and Markdown formats, bounded schema-v1 report
  input, deterministic aggregation, explicit incomplete-run handling, and atomic private output.
- Versioned `inventorySchemaVersion: 1` models and public report reader/inventory exports.
- Deterministic `NEW_RECIPIENT`, `NEW_CATEGORY`, `NEW_ENDPOINT`, `NEW_LOCATION`, `NEW_TRANSFORM`,
  and `NEW_FLOW` explanations for new review flows.
- Experimental opt-in first-party JSON response discovery for email and phone sources, with strict
  key/value semantics, private provenance, fixed parsing/work limits, and sanitized skip coverage.
- Explicit schema-v1/v2 report types and strict version-specific plus union readers.
- Runtime browser-input email hygiene classification as `SYNTHETIC`, `REVIEW_REQUIRED`, or
  `UNASSESSED`, including IANA-reserved and suite-configured synthetic domains.
- `privacyspec testdata` with terminal, JSON, and Markdown formats, a separately versioned
  test-data model, strict report validation, and atomic private output.
- `privacyspec evidence` with independent `evidenceSchemaVersion: 1` JSON and Markdown, explicit
  build identifiers, scope/observation/mapping summaries, prominent incomplete-run handling, and
  atomic private output.
- Stable `COMPLETE`, `PARTIAL`, `INCOMPLETE`, and `UNSUPPORTED` observation coverage with aggregate
  browser, context, page, navigation, network, console, and storage-capable-page counters.
- Detection for independent contexts/pages created through the composed Playwright `browser`
  fixture, including mixed supported/custom-context suites.
- Bounded per-test observer finalization with explicit incomplete-coverage diagnostics and
  repeatability digests for semantic ordering and browser navigation/popup teardown.
- A unified secondary-coverage hierarchy for functional outcome, observation coverage, privacy,
  runtime dependencies, browser security posture, hidden runtime errors, and bounded changes.
- Strict schema-v4 reports with namespaced privacy, dependency, security, and runtime-error
  analysis sections.

### Changed

- Endpoint-bearing privacy, security, and runtime analyzers now share one bounded,
  repository-independent canonicalization primitive for semantic identities. Generic opaque and
  random-prefix composite instance segments collapse while static route vocabulary and
  representation suffixes remain distinct.
- Public messaging now describes PrivacySpec as “Continuous privacy QA for Playwright” across
  OBSERVE, REGRESS, and EVIDENCE outputs.
- Package metadata and documentation align with the public `0.1.0-beta.2` npm/GitHub release and
  advertise `npm i -D @privacyspec/playwright@beta`.
- Main reports use schema v4; per-test privacy attachments remain schema v3, while inventory output
  remains `inventorySchemaVersion: 1` and independent analyzer artifacts/baselines remain schema
  v1.
- Schema-v2 reports now include a versioned, sanitized test-data section. Hygiene results remain
  non-failing and never persist an observed value or its domain.
- Terminal output presents the functional result, observation coverage, all four analysis modules,
  and changes as one bounded hierarchy. Detected custom-context or incomplete module coverage fails
  closed instead of allowing a clean secondary `PASS`.
- Dependency, security, and runtime-failure artifact producers and strict validators now share a
  locale-independent UTF-16 code-unit ordering contract across nested inventories, findings,
  diagnostics, fingerprints, cookies, and test references.
- Analyzer attachment constructors and schema-v1 baseline, latest-run, and report writers now emit
  canonical deep copies that round-trip through their strict readers; duplicate and non-canonical
  persisted input remains rejected.
- Runtime-failure identities now use a synchronous rendered-console snapshot, a bounded normalized
  first line, stable parser families, and normalized static bundler hashes rather than asynchronous
  structured arguments or transient parser fragments.
- Benign `ERR_ABORTED` failures are ignored only for GET/HEAD or static-resource requests;
  non-idempotent aborts and stronger request failures remain observable.

### Known limitations

- Endpoint canonicalization is intentionally lexical rather than router-aware. An unusual static
  segment that exactly resembles a generated instance identifier can be conservatively collapsed.
- Runtime identity is first-line and family based: later stack detail, unavailable rendered text,
  and transient parser tokens are deliberately collapsed, while genuinely different error families
  remain distinct.
- Raw browser-event counts can vary without changing semantic coverage. A relevant application-level
  cancellation may require review if it appears only as a filtered benign abort.
- The release candidate passed the complete independent repository validation matrix.

### Compatibility

- Report-schema-v1/v2/v3 readers, attachment-schema-v1/v2/v3 reporter input, baseline schema v1,
  baseline semantic keys, rule IDs, fixture composition, reporter configuration, and existing CLI
  behavior remain supported.
- Dependency, security, and runtime-failure public APIs, semantic keys, rule IDs, and schema-v1
  artifact/baseline shapes are unchanged by the canonical-order repair.
- The beta.2 release preserves existing public exports, semantic keys, rule IDs, report
  versions, and schema-v1 artifact/baseline shapes. Unreleased runtime baselines need no format
  migration; identities for filtered benign aborts or collapsed parser fragments can disappear on
  the next guarded acceptance.

## 0.1.0-beta.1 — 2026-08-20

### Added

- Passive source, network, URL, storage, and console observation for existing Playwright journeys.
- Deterministic correlation, PS1001–PS1006, semantic baseline comparison, terminal/JSON reporting,
  and source-traceable control/regulatory mappings.
- OSS documentation, read-only CI validation, npm package-content validation, and Apache-2.0
  licensing.
- Playwright 1.58.1 compatibility and validation against the pinned 1.62.1 development version.

### Known limitations

- Browser-side observation cannot reveal backend-only sources or transfers.
- First-run aggregation groups semantic endpoint decisions, not shared application root causes.
- The beta is Chromium-first and does not inspect response bodies.
