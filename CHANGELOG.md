# Changelog

All notable changes to PrivacySpec are recorded here.

## Unreleased

## 0.1.0-beta.4 — 2026-09-03

### Added

- A zero-friction product contract and active adoption roadmap with a release-blocking integration
  budget, explicit current-state reconciliation, and evidence gates for category/framework growth.
- Provider-neutral GitLab and generic CI guides that reuse the existing Playwright reporter and
  CLI, preserve exit semantics, require explicit shard aggregation, and prohibit CI baseline
  mutation.
- A versioned structural integration-friction benchmark over seven Playwright repository shapes,
  with computed release gates for touched files, integration lines, unchanged test bodies,
  assertions, commands, environment, and proxy/certificate setup.
- `privacyspec doctor` with strict current-report input, deterministic terminal/JSON setup
  confidence, fixed-code and count-only diagnostics, optional-baseline context, semantic-result
  exit zero, and no repository/configuration crawling or sensitive report-payload replay.
- A framework-object-free synthetic runtime-adapter harness proving that the existing normalized
  event/analyzer seam preserves canonical four-module semantics across permitted input orders and
  propagates adapter-owned missing capabilities to module and overall inconclusive states.
- A manually completed, local-only independent-evaluation record for integration effort, coverage,
  bounded limits, comparable overhead, explicit human signal labels, and the keep-enabled decision,
  with negative and unsupported outcomes retained and no automatic collection or upload.

### Changed

- The root and package READMEs now lead with a concrete passing-test/secondary-finding example,
  keep installation and capabilities concise, and route technical depth through the maintainer and
  coding-agent project guide instead of duplicating reference documentation.
- Project planning now prioritizes measurable setup friction, first-run comprehension, integration
  diagnosis, and portability proof over scanner or analyzer breadth.
- Terminal secondary coverage now leads with a compact functional/observation/module hierarchy,
  globally caps prioritized actionable semantic groups at five, states omissions and optional
  baseline status, and leaves verbose occurrence, mapping, performance, and module evidence in
  strict private artifacts instead of replaying it after the summary.

### Compatibility

- Persisted schema versions and the supported Playwright `>=1.58.1 <2` plus Chromium boundary are
  unchanged. The `doctor` command is additive; Firefox, WebKit, and composed request observation
  remain explicit fail-closed experiments.

## 0.1.0-beta.3 — 2026-08-24

### Added

- Explicit custom-classifier compatibility IDs, persisted only as bounded semantic provenance in
  privacy attachments, baselines/latest runs, and run parts, with mismatch/unavailable suppression
  and an explicit whole-baseline migration path.
- Bounded exact attachment v1–v5 parsing and public strict inventory/evidence v1/v2 object/file
  readers with historical readable unions, canonical consistency checks, and symlink rejection.
- Per-call API-request object capture budgets for depth, nodes, entries, locations, and retained
  bytes, including fail-closed sparse/deep/cyclic/proxy handling and post-exhaustion body shutdown.

- `privacyspec summary` with strict current-report input, backward-compatible terminal output, bounded
  sanitized Markdown, deterministic actionable findings, and atomic private file output.
- Public `renderSecondaryCoverageMarkdown` and `SecondaryCoverageSummaryFormat` exports.
- A post-processing-only composite GitHub Action that writes the Step Summary and optionally
  uploads the validated schema-v5 report from a private temporary staging file.
- High-confidence DOM discovery for semantic name, postal-address, full birth-date, explicit
  account-identifier, payment-card, gender-identity, and job-title controls, including semantic
  select controls, corroborated metadata fallbacks, and bounded card/date validation.
- Explicit reporter `runScope` mode with create-only private schema-v1 process/shard parts,
  Playwright shard-coordinate validation, and collision-free run-specific default paths.
- `privacyspec aggregate` and public strict part reader/pure aggregation API for deterministic
  privacy, dependency, security, runtime, functional, performance, test-data, and coverage merging.
- Complete-run-only four-module baseline comparison/latest-run eligibility, missing-part
  diagnostics, duplicate/mismatch rejection, zero-test shard handling, and bounded hostile-input
  protection.
- `privacyspec baseline propose` and `baseline accept` with a separate strict schema-v1 proposal,
  deterministic semantic selection IDs, four-module add/change/remove diffs, stale/tampered source
  verification, explicit selective mutation, and preservation of unselected accepted entries.
- Public baseline-proposal models, constants, typed errors, strict parser/reader/private writer,
  pure proposal creation, and pure selective application APIs.
- Bounded declarative DOM classifiers for application-specific custom personal/secret categories,
  worker-side reclassification, built-in precedence, ambiguity fail-closed coverage, family-driven
  rules, strict artifact/export propagation, and selective-proposal participation.
- Explicit Firefox/WebKit and composed `request` fixture experiments with per-engine capability
  tables, transparent seven-method API proxying, bounded argument/response-posture observation,
  fixed blind spots, request-surface flows, and narrow controlled CI fixtures.

### Changed

- Attachments are now v5, run parts v3, and privacy baselines/latest-run handoffs v2. Unified
  reports remain v5 and inventory/evidence remain v2; proposal and independent analyzer contracts
  remain v1. All supported historical versions retain strict readers, and mixed run-part versions
  reject.
- Legacy attachments and run parts expose unavailable classifier provenance rather than inferred
  compatibility. Legacy v1 privacy artifacts with custom categories require a fresh run and
  explicit whole-baseline reacceptance; matcher literals/tables/digests are never persisted.
- Endpoint canonicalization now collapses bounded random-prefix structured instance handles that
  end in a delimiter, preventing generated path values from creating unstable security identities.

- Strict report, baseline, test-data, inventory, and evidence validation accepts built-in and
  validated custom categories through the shared category-family helpers.
- DOM classification keeps the six-character correlation floor and excludes generic identifiers,
  arbitrary person/address recognition, short DOB/card components, and API/session/JWT tokens.
  First-party JSON response discovery remains limited to email and phone.
- Custom source expansion remains DOM-control-only; response, storage, cookie, URL, and JavaScript
  source surfaces remain closed.
- Detected Playwright sharding without explicit `runScope` now fails closed and disables colliding
  single-writer report/latest paths. The GitHub Action remains post-processing-only; repository CI
  now produces two controlled shard parts and aggregates them before the Action smoke test.
- Unified reports became schema v5 and inventory/evidence became v2 in the secondary-coverage
  expansion; the current release-hardening version map above supersedes the earlier attachment,
  run-part, and privacy baseline/latest versions.
- The package CLI now uses a tracked executable launcher so fresh workspace installs create the
  `privacyspec` shim before `dist` is built, including the local GitHub Action smoke path.
- Baseline proposal creation is read-only; selective and compatible whole-snapshot mutation remain
  local, confirmed, and CI-disabled. Proposal/selective paths reject collisions and symlinks, and
  proposal/baseline writes remain atomic and private.

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
- The release candidate passed the complete independent repository matrix summarized in
  `docs/validation.md`.

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
