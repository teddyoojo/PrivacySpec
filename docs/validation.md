# Validation and known limits

This document summarizes the evidence that supports the current beta. It is not a running
implementation journal and does not make legal, production-security, or universal performance
claims.

## Local acceptance contract

Every repository change is expected to pass:

```bash
pnpm check
pnpm format:check
pnpm build
pnpm test
```

The full test command covers strict models and readers, deterministic serialization, analyzer and
baseline behavior, privacy redaction, synthetic fixtures, controlled leak cases, and the 15-test
Chromium demo suite. Changes to fixture/reporter compatibility or observation behavior may also
need one risk-selected external smoke; pure docs, models, renderers, and CLI changes do not.

## Integration-friction contract

`pnpm benchmark:friction` measures structural before/after integration changes for seven generic
Playwright repository shapes. It computes touched files, added non-blank lines, test-body changes,
PrivacySpec assertions, added commands/processes/environment variables, and proxy/certificate
settings from the fixture trees rather than trusting hand-authored counts. Runtime timing remains
`null` in this deterministic structural gate and may be recorded separately as informational local
evidence.

The current supported happy-path fixtures satisfy the product contract:

| Fixture | Files touched | Integration lines | Test-body changes | Test import changes | New commands/processes/env | Expected coverage |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Minimal direct import | 2 | 2 | 0 | 1 | 0 | `COMPLETE` |
| Shared custom fixture | 2 | 6 | 0 | 0 | 0 | `COMPLETE` |
| Setup/auth project | 2 | 3 | 0 | 0 | 0 | `COMPLETE` |

The browser-matrix fixture records ungated Firefox/WebKit as
`COVERAGE_UNSUPPORTED_BROWSER_ENGINE`; the independent-context fixture records
`COVERAGE_INCOMPATIBLE`; the sharded fixture requires one explicit aggregation command and run ID;
and the monorepo fixture confines integration to the test package. Existing controlled browser and
reporter tests named in the benchmark manifest remain the behavior evidence for those boundaries.

The zero-friction contract, structural benchmark, and concise first-run reporting slice was
validated locally on 2026-08-28 with 320 package tests, 22 demo Node tests, and 15 demo Chromium
tests. The gate includes deterministic global terminal prioritization and bounds, strict private
artifact preservation, all seven integration archetypes, and end-to-end reporter/baseline
lifecycle assertions. No external repository pilot was run because the changed docs, renderers,
CLI-facing output, and synthetic fixture structure are represented by local fixtures.

The read-only runtime integration doctor slice was validated locally on 2026-08-29 with 325 package
tests, 22 demo Node tests, and 15 demo Chromium tests. Doctor coverage includes ready,
experimental/partial, unsupported/not-established, legacy/malformed/missing, invalid-argument,
stdout-failure, deterministic diagnostic-bound, and adversarial non-echo cases. No external
repository pilot was run because the command derives only a sanitized projection from the existing
strict current report and does not change collection, fixture, reporter, or compatibility behavior.

The synthetic runtime-adapter portability proof was validated locally on 2026-08-29 with 328
package tests, 22 demo Node tests, and 15 demo Chromium tests. A framework-object-free harness feeds
plain normalized lifecycle, network, console, page-error, source, storage, and capability data into
all four current analyzers. The tests preserve canonical results across four permitted input orders
and propagate missing adapter capabilities to four unsupported module coverages and an overall
inconclusive schema-v5 report. No external pilot was run because this is a generic local proof of
the existing analyzer seam, not a new production adapter or compatibility claim.

## Independent product-value evidence

Use [`evaluation-template.md`](evaluation-template.md) to retain local, manually reviewed evidence
from every independent evaluation, including failed integrations, unsupported coverage, noise, and
decisions not to retain PrivacySpec. The record separates structural effort, runtime coverage and
limits, comparable overhead measurements, human signal labels, and the keep-enabled decision.
PrivacySpec never generates, collects, or uploads these records.

The roadmap's provisional adoption percentages are product-learning hypotheses only. Aggregate
them only after enough independent records exist, with explicit numerators, denominators, and
eligibility rules; they are not current beta validation or correctness claims.

The `0.1.0-beta.4` release candidate was validated on 2026-09-03 from a frozen workspace lockfile.
The complete local gate passed 328 package tests, 22 demo Node tests, and 15 demo Chromium tests.
The exact 356,741-byte npm tarball from a fresh public checkout contains 380 entries limited to
compiled `dist/`, the executable CLI launcher, package metadata, README, and license. Its SHA-256 is
`a729a364319e6b23d9834bc1d478e278d676037d4c08ac281995e9dd673be5df`. Known fixture-secret
canaries were absent. Clean tarball installations with Playwright 1.58.1 and 1.62.1 each completed
an ordinary Chromium form/request journey with complete observation, schema-v5 mode-`0600` output,
no retained raw email canary, and `privacyspec doctor` setup confidence `ready`. No schema version
or supported-browser boundary changed in this release.

The release-candidate local gate recorded on 2026-08-22 passed 227 package tests, 22 demo Node
tests, and 15 demo Playwright tests. Current-head results should always be established by rerunning
the local gate rather than treating those counts as permanent.

The unreleased Steps 1–2 local gate recorded on 2026-08-23 passed 249 package tests, 22 demo Node
tests, and 15 demo Playwright tests. The Step 2 slice includes table-driven semantic classifier
boundaries, strict artifact-category propagation, worker-side reclassification, and real-Chromium
event/fallback capture with prohibited-value assertions. No external repository matrix was run for
the repository-independent DOM classifier change.

The Step 3 local gate recorded on 2026-08-23 passed 261 package tests, 22 demo Node tests, and 15
demo Playwright tests. It adds strict synthetic run-part/parser tests, many input-order
permutations, complete/partial/zero-test/duplicate/mismatch scope cases, four-module aggregation,
baseline/latest-run eligibility, private create-only writes, hostile payload rejection, reporter
shard-coordinate behavior, and a controlled real-Chromium two-shard integration. Repository CI
also aggregates those controlled parts before the local composite Action consumes the final
schema-v4 report. No external repository matrix was run because the changed boundary is covered by
local reporter/process fixtures.

The Step 4 local gate recorded on 2026-08-23 passed 280 package tests, 22 demo Node tests, and 15
demo Playwright tests. It adds all-module missing/known/add/change/remove proposal coverage,
selection-none/one/many and explicit removal behavior, deterministic source permutations,
complete aggregate handoffs, partial/incomplete rejection, stale/tampered/unknown/duplicate/cross-
module protection, interactive/non-interactive/CI policy, strict version/field/order/size/path/
symlink handling, atomic private writes with failure preservation, hostile-value non-persistence,
whole-baseline update compatibility, and public-root export coverage. No external repository matrix
was run because the changed models, artifact IO, pure application logic, and CLI boundary are fully
represented by controlled local fixtures.

The Step 5 local gate recorded on 2026-08-23 passed 288 package tests, 22 demo Node tests, and 15
demo Playwright tests. It covers category grammar and configuration bounds, normalized
high/medium exact matching, high-confidence-only custom secrets, built-in precedence,
browser/worker reclassification, ambiguity fail-closed behavior, real-Chromium event and fallback
capture, family-driven rules, strict artifact/export propagation, test-data unsupported-category
results, prohibited-value scans, baselines, and selective proposals. No external repository matrix
was run because the classifier remains a repository-independent DOM-control table exercised by
synthetic and real-browser fixtures.

The Step 6 local gate recorded on 2026-08-23 passed 299 package tests, 22 demo Node tests, and 15
demo Playwright tests. It covers transparent composed-request proxying, supported/skipped argument
shapes, fixed blind spots and bounds, failure/5xx/header/cookie behavior, no response-body reads or
source discovery, request-surface separation, strict old/current schema readers, fail-closed
aggregation, and reporter-level baseline ineligibility. The gated controlled engine fixture passed
Chromium and Firefox locally, and ungated Firefox passed functionally while the reporter failed
closed as required. The pinned WebKit binary was installed but could not launch on this host
because its GTK/GStreamer libraries require administrator installation; repository CI installs
those dependencies and is configured to run the gated three-engine fixture, validate its schema-v5
report, and exercise ungated Firefox and WebKit negative controls. This local record therefore does
not claim a completed WebKit execution.

The corrected release-hardening local gate recorded on 2026-08-24 passed 316 package tests, 22 demo
Node tests, and 15 demo Playwright tests. It adds explicit classifier-configuration migration coverage,
strict attachment v1–v5/run-part v1–v3/privacy baseline and latest-run v1–v2/inventory and evidence
v1–v2 compatibility matrices, duplicate and hostile-input rejection, bounded API option walking,
and zero-test shard handling. The package suite was repeated independently with the same 316/316
result. The exact 368-entry `0.1.0-beta.2` tarball had SHA-256
`717141f4c76f4c48e14c4dc825c07bd85a72ee7315cb675fd269f59cc408b4cd` and was installed into clean
Playwright 1.58.1 and 1.62.1 fixtures. Each passed its Chromium custom-classifier smoke with
complete secondary coverage, including a rerun with hostile-shaped synthetic input. All 16 JSON
artifacts parsed strictly, had mode `0600`, and excluded the raw input, URL-encoded, Base64,
SHA-256, credential, and matcher representations; only the explicit classifier configuration ID
was present in privacy latest-run files.

The `0.1.0-beta.3` release tree was validated on 2026-08-24 with the frozen workspace lockfile,
the complete local gate, and the same 316 package, 22 demo Node, and 15 demo Chromium tests. Its
exact 368-entry tarball has SHA-256
`c4febcded3071baa4c6d5d83cf1b1bd670d87d4b6f439badea68dba3f1dd8c3b` and npm integrity
`sha512-ZOctxo824a7/wAvMmRobwyfamJ4irrlDA7RkYvIm3wOBl7anlx9kdfXEhHpRllFEjNOuw91MEaDChne2LKEdYA==`.
Clean tarball installs with Playwright 1.58.1 and 1.62.1 each passed a Chromium custom-classifier
flow with complete observation coverage and all four modules passing. Their 16 generated JSON
artifacts parsed strictly, had mode `0600`, and excluded the raw hostile input and its lower-case,
upper-case, URL-encoded, Base64, SHA-256, and matcher-literal representations. The tarball contains
only the package license, README, executable launcher, compiled distribution, and package metadata;
targeted scans found no internal-repository identifier, known raw fixture value, or bearer-shaped
credential. The six-repository matrix was not repeated because the release commit changes only
release metadata, current-version documentation, and the reported tool version relative to the
already validated corrected candidate.

## Release-hardening candidate validation

The pinned six-repository matrix was repeated twice on 2026-08-24 from that same corrected tarball.
Disposable integrations changed only dependency metadata and locks, Playwright configuration,
shared fixture composition, and import routing. Upstream application code, test bodies, assertions,
and fixed selections were unchanged.

| Repository and pinned source | Playwright | Functional result | Observation coverage | Important outcome |
| --- | ---: | --- | --- | --- |
| Epic Stack `da819d69af1bb66b19cfee35ad81aa8502d0be05` | 1.58.1 | 24/24 passed twice | `COMPLETE` | The first candidate exposed an optional-delimiter endpoint-identity gap. The generic repair produced the same 57-target security identity set and 112 total technical/review changes in both corrected runs. |
| Actual Budget `1c5255f753fc5bb37665659288b48932cd12aa7e` | 1.61.1 | 141/141 passed twice | `UNSUPPORTED` | Both runs failed closed with `COVERAGE_INCOMPATIBLE`, 141/282 contexts, and 0/141 instrumented application pages. |
| Bulletproof React `9506629ed003a561c6627735480cce4994244bb4` | 1.59.1 | 3/3 passed twice | `COMPLETE` | Repeated the same eight privacy and one dependency changes; localhost HTTP remained a technical observation. |
| Mermaid Live Editor `10ef944db6a46500e1684873b27cfed790d1035d` | 1.60.0 | 39 passed and 4 upstream skips, twice | `INCOMPLETE` | Both runs stayed inconclusive and retained the same two dependency identities rather than resolving incomplete scope. |
| Northlight `451be58368752bec611c4eb00219d1a6117bc690` | 1.61.1 | 12/12 passed twice | `COMPLETE` | Negative control: both runs produced zero changes and all four module outcomes passed. |
| NiiVue PWA `f4f373ec917e875572ecc371e7757c8927c70755` | 1.60.0 | 18/18 passed twice | `COMPLETE` | Repeated the same four dependency and five sanitized runtime identities, including an uncaught page-error observation. |

All 96 matrix artifacts parsed through their strict readers, were regular mode-`0600` files, and
passed scans for prohibited persisted fields, email-shaped or bearer credentials, and known raw,
case, URL, Base64, Base64url, and SHA-256 representations of the generated Bulletproof candidate.
Canonical semantic projections matched between both runs in all six repositories after excluding
timestamps, durations, first-seen/occurrence metadata, and raw observation/request/response
counters. No baseline was accepted.

The PR pipeline for pre-repair head `a09ec68` was user-confirmed green. The endpoint repair changes
the candidate package bytes, so candidate CI and the configured WebKit gate must pass again on the
updated PR head before the release-hardening verdict can become `PASS` or the PR should be merged.

## Controlled performance reference

The immutable controlled records are stored under `apps/demo-saas/benchmark/` and contain only
durations and non-sensitive runtime metadata.

| Workload | Median | Relative to uninstrumented |
| --- | ---: | ---: |
| Uninstrumented 15-test demo reference | 5.736 s | — |
| Observer, rules, baseline, terminal, and schema-v1 JSON reporting | 5.752 s | +0.28% |

These five-run measurements were recorded on 2026-08-19/20 using the same Node 24.19.0,
Playwright 1.62.1, Chromium, and Linux/WSL2 host. They show that the initial privacy pipeline was
within the prototype's 15% target on the controlled workload; they are not a current cross-platform
benchmark. Run `pnpm benchmark` to collect a fresh local sample.

## Independent beta validation

The comprehensive release-candidate matrix was recorded on 2026-08-22 against package source
commit `e2447c9`. Integrations were disposable and limited to dependency metadata, configuration,
shared fixture composition, and import routing; upstream application code, test bodies, assertions,
and fixed test selections were not changed.

| Repository | Functional result | Observation coverage | Important outcome |
| --- | --- | --- | --- |
| Epic Stack | 24/24 passed twice | `COMPLETE` | Stable security/runtime identities after endpoint canonicalization repair. |
| Actual Budget | 141/141 passed twice | `UNSUPPORTED` | Failed closed because application pages used independent contexts; no false clean result. |
| Bulletproof React | 3/3 passed twice | `COMPLETE` | Repeated privacy/dependency observations; localhost HTTP facts remained technical, not vulnerability claims. |
| Mermaid Live Editor | 39 passed, 4 upstream skips, twice | `INCOMPLETE` | Preserved incomplete scope and bounded a high-volume request stream. |
| Northlight | 12/12 passed twice | `COMPLETE` | Negative control: all modules passed with no changes. |
| NiiVue PWA | 18/18 passed twice | `COMPLETE` | Repeated a sanitized uncaught page-error identity; human review labelled the narrow observation useful. |

An Eclipse test slice failed before PrivacySpec was installed and was excluded. That rejection is
part of the validation discipline: upstream failures are not attributed to PrivacySpec or tuned
away by changing the selection.

The matrix established:

- identical semantic projections across two valid runs in all six instrumented repositories;
- fail-closed handling for unsupported and incomplete coverage;
- 96/96 generated artifacts parsed through their strict reader, had mode `0600`, and passed
  targeted prohibited-value scans;
- a 5.1% median paired delta across eight fresh timed samples; one +27.4% Bulletproof sample fell to
  +18.4% on repeat and remains a variance worth remeasuring before a performance claim;
- useful natural product signal in 4 of 5 eligible repositories after explicit human labeling.

## What the evidence does not establish

- stable Firefox/WebKit support, other test frameworks, distributed/hosted shard coordination,
  arbitrary process discovery, or production hosting parity; controlled opt-in engine fixtures and
  local explicit Playwright shard/process aggregation are covered, but broader CI-matrix artifact
  transport remains caller-owned;
- observation of backend-to-backend traffic, WebSocket payloads, deep service-worker behavior,
  IndexedDB, or arbitrary JavaScript transformations;
- completeness when applications bypass the composed Playwright `browser` fixture;
- API traffic through `page.request`, `context.request`, manually created request contexts, or
  implicit wire headers/cookies/authentication and intermediate redirect hops;
- application intent, root cause, exploitability, processor authorization, lawful basis, or legal
  compliance;
- a universal runtime-overhead bound.

External pilots are reproductions and regression evidence, not reasons for repository-specific
production logic. A fix is accepted only when it can be expressed as a general invariant and tested
with controlled fixtures.

## Historical evidence

The removed phase-by-phase validation journal remains available in Git. For the exact pilot
commits, commands, artifact hashes, raw counters, adjudication record, and release-gate tables, use:

```bash
git show c04ef7c:docs/benchmark.md
```

Completed prototype and secondary-analyzer roadmaps are likewise retained by Git history rather
than kept as current instructions.
