# Product contract

PrivacySpec adds passive secondary runtime coverage to the Playwright journeys a team already
maintains. Ordinary functional tests remain the test suite: PrivacySpec observes what those tests
cause the application to do and reports sanitized technical facts that their assertions may not
cover.

## Supported happy-path budget

For the ordinary supported Playwright + Chromium integration:

| Measure | Maximum |
| --- | ---: |
| Existing files touched | 2 |
| Non-blank PrivacySpec integration lines | 10 |
| Existing test bodies changed | 0 |
| PrivacySpec assertions, annotations, or tags | 0 |
| Separate PrivacySpec processes or scan journeys | 0 |
| Proxy settings or custom certificates | 0 |

The existing `playwright test` command remains valid. A first run must produce useful current-run
observations without requiring a baseline. When Playwright provides a valid `baseURL`, the normal
path infers that first-party origin instead of requiring duplicate configuration.

Advanced configuration may improve precision or enable explicit experiments. It must not become
mandatory for first value in a supported ordinary repository.

## Test-suite invariant

Every ordinary integration must preserve:

```text
existing functional journey
+ fixture composition
+ reporter configuration
= secondary runtime coverage
```

PrivacySpec does not require a separate scan plan, dedicated privacy/security test, assertion, tag,
or per-test annotation. Existing authentication, seeded state, permissions, feature flags, and
application-specific navigation remain owned by the functional suite.

## Trust contract

Low setup effort cannot weaken result integrity:

- raw PII, passwords, tokens, request bodies, console arguments, storage values, and other
  collected sensitive values must not enter persisted artifacts or rendered output;
- unsupported or incomplete observation must fail closed and must not be presented as clean,
  absent, or resolved behavior;
- baseline acceptance remains an explicit local review action and is never automatic in CI;
- technical observations, technical-control relevance, and contextual regulatory relevance remain
  separate;
- PrivacySpec does not make legal-compliance, breach, exploitability, or causal conclusions;
- scanner breadth is not a roadmap objective.

## Feature acceptance question

Every feature must improve at least one of these outcomes without materially increasing test
maintenance:

1. useful automatic coverage;
2. integration or interpretation effort;
3. trust in the result;
4. portability of the same product contract.

If it does not, defer it. New analyzers and framework adapters are not valuable merely because they
increase feature count.

## Release gate

The automated integration-friction benchmark is the executable form of this contract. Its minimal,
shared-fixture, and setup/auth fixtures must satisfy the entire happy-path budget. Browser-matrix,
sharded, custom-context, and monorepo fixtures must report their supported, experimental, partial,
or unsupported boundaries without a false clean result.

A regression in a supported fixture is a product-friction defect and a release blocker. Timing is
recorded for review but is not a deterministic correctness assertion.

This contract is subordinate to current source, tests, schemas, and the privacy and architecture
contracts. The active delivery sequence is in
[`NEXT_IMPLEMENTATION_PLAN.md`](NEXT_IMPLEMENTATION_PLAN.md).
