# Demo SaaS

This workspace is controlled ground truth for PrivacySpec. It is an in-memory application,
not a production service.

From the repository root, build and start the three local origins:

```bash
pnpm build
pnpm demo
```

- Application: `http://localhost:3100`
- Fake third party: `http://127.0.0.1:4100`
- Deliberately insecure external receiver: `http://127.0.0.1:4200`

Clean behavior is the default. Set one leak flag to `1` before starting the demo to introduce a
specific browser-side data flow:

| Flag | Deliberate behavior |
| --- | --- |
| `DEMO_LEAK_EMAIL_TO_ANALYTICS` | Send a saved customer email to the fake third party. |
| `DEMO_LEAK_PHONE_TO_ANALYTICS` | Send a saved customer phone number to the fake third party. |
| `DEMO_LEAK_EMAIL_IN_URL` | Put a saved customer email in the current URL query. |
| `DEMO_LEAK_EMAIL_LOCALSTORAGE` | Write a saved customer email to `localStorage`. |
| `DEMO_LEAK_EMAIL_CONSOLE` | Write a saved customer email to the browser console. |
| `DEMO_LEAK_PASSWORD_EXTERNAL` | Send the submitted login password to the fake third party. |
| `DEMO_LEAK_HASHED_EMAIL_EXTERNAL` | Send a SHA-256 digest of a normalized customer email to the fake third party. |
| `DEMO_LEAK_HTTP_EXTERNAL` | Send a saved customer email to the dedicated insecure external receiver. |
| `DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL` | Send a customer email from a completed first-party JSON response to analytics. |

The two external recipients are intentionally distinct. The shared PrivacySpec fixture allows the
fake analytics origin as a local-development transport exception when isolating PS1004, while the
dedicated insecure receiver remains untrusted for deterministic PS1002 coverage.

The fake analytics server does not log or retain payload values. Its in-memory diagnostics contain
only event names and top-level field names so leak delivery can be checked without creating another
raw-data artifact.

## Playwright suite

Install the pinned Chromium build once, then run the ordinary functional suite from the repository
root:

```bash
pnpm --filter @privacyspec/demo-saas exec playwright install chromium
pnpm test:e2e
```

The 15 tests exercise customer, search, invitation, support, settings, and authentication behavior.
They use Chromium only and keep traces, screenshots, and video disabled. The same suite can run with
any single leak flag enabled; its assertions cover business-visible behavior rather than the seeded
data flows.

Set `PRIVACYSPEC_FIRST_PARTY_JSON_RESPONSES=1` to opt the demo fixture into the experimental
response observer. The response-origin leak case enables it without changing the ordinary customer
test body.

Run the five-pass clean baseline benchmark with:

```bash
pnpm benchmark
```

The benchmark method and current validation summary are documented in `docs/validation.md`.

## Semantic baseline

The demo's accepted review-flow baseline is committed as `privacyspec-baseline.json`. Clean mode has
no accepted contextual flows, so the initial baseline is empty. Every completed run writes the
sanitized handoff `.privacyspec/latest-run.json`; it contains semantic review-flow identities only,
not test values, request payloads, or test names.

From the repository root:

```bash
pnpm privacyspec baseline show
pnpm privacyspec baseline update
pnpm privacyspec inventory
```

`baseline update` replaces the baseline with the latest complete run after confirmation. Use
`--yes` only for deliberate non-interactive local updates. Baseline mutation is disabled when `CI`
is enabled. Run the full intended Playwright scope first: an update deliberately removes accepted
flows that the latest run did not observe, so updating from a filtered subset can erase unrelated
entries. Do not update while a Playwright run is active; concurrent processes need distinct reporter
`latestRunPath` values. New `REVIEW_REQUIRED` flows warn by default. Technical failures are never
accepted or suppressed by the baseline and always fail the run.
