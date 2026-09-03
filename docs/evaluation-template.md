# Independent evaluation record

Copy this file for each independent PrivacySpec evaluation and complete it manually. Store the
copy only where the evaluator intends; PrivacySpec does not collect, generate, or upload this
record. Keep unsuccessful, unsupported, noisy, and abandoned evaluations as well as positive ones.

This is product-learning evidence, not a compliance assessment or a release correctness result.
Do not enter raw PII, passwords, tokens, request or response bodies, console arguments, storage
values, proprietary test data, or unsanitized artifact messages. Use opaque repository and
evaluation IDs when the project identity is sensitive.

## Evaluation identity

| Field | Value |
| --- | --- |
| Evaluation ID | `<opaque-id>` |
| Evaluator and relationship to PrivacySpec | `<maintainer / independent user / other>` |
| Repository ID and revision | `<public name or opaque-id>; <revision>` |
| Evaluation dates | `<start>` to `<end>` |
| PrivacySpec version/revision | `<version>` |
| Playwright and Chromium versions | `<versions>` |
| Normal test command and scope | `<sanitized command and scope>` |
| Evaluation runs reviewed | `<count>` |

State any relationship that could bias the result. An evaluation is independent only when its
repository is not a PrivacySpec fixture and its reviewer is not merely reproducing an expected
controlled regression.

## Integration effort

Measure the path from a working existing Playwright suite to the first strict schema-v5 report.
Count PrivacySpec integration changes only; explain concurrent unrelated changes separately.

| Measure | Result | How measured or exception |
| --- | ---: | --- |
| Existing files touched | `<count>` | `<paths summarized without sensitive names>` |
| Non-blank integration lines added | `<count>` | `<method>` |
| Minutes to first schema-v5 report | `<minutes or not-achieved>` | `<start/end definition>` |
| Existing test bodies changed | `<count>` | `<none expected on supported path>` |
| Existing test imports changed | `<count>` | `<shared-fixture migration is not a body change>` |
| Custom classifiers or rules required | `<count>` | `<why each was required>` |
| CI workflow changes | `<count and summary>` | `<none / reporter wiring / aggregation / other>` |
| Added commands, processes, or environment variables | `<count and summary>` | `<include shard aggregation>` |
| Proxy or certificate changes | `<count and summary>` | `<none expected>` |

First-report outcome: `<achieved / not achieved>`

Integration blockers or friction defects:

- `<fixed diagnostic code or sanitized description; write none only when there were none>`

## Runtime outcome and coverage

Copy only sanitized facts from the strict report and, when useful, `privacyspec doctor`. Never copy
free-form error payloads into this record.

| Measure | Result |
| --- | --- |
| Functional outcome | `<passed / failed / interrupted / not established>` |
| Overall secondary result | `<pass / review required / technical failure / inconclusive>` |
| Observation coverage | `<complete / partial / incomplete / unsupported>` |
| Setup confidence | `<ready / limited / not-established>` |
| Tests observed / selected | `<count> / <count or unavailable>` |
| Contexts observed / instrumented | `<count> / <count>` |
| Pages observed / instrumented | `<count> / <count>` |
| Browser support | `<supported / experimental / unsupported / unavailable>` |
| API-request fixture | `<not used / observed / partial / unavailable>` |

Unsupported or incompletely observed contexts and fixed diagnostic codes:

- `<coverage diagnostic code and count; do not reinterpret it as a clean result>`

Bounded-limit events:

- `<fixed limit/coverage code and sanitized count; write none only when the report establishes none>`

Other relevant limitations:

- `<sanitized limitation>`

## Runtime overhead

Use the same repository revision, test scope, machine class, and runner settings for reference and
instrumented measurements. Prefer several alternating runs and report medians; do not convert a
small local sample into a universal performance claim.

| Measure | Result |
| --- | ---: |
| Reference runs | `<count>` |
| Instrumented runs | `<count>` |
| Reference median wall time | `<duration or not measured>` |
| Instrumented median wall time | `<duration or not measured>` |
| Median absolute delta | `<duration or not measured>` |
| Median relative delta | `<percent or not measured>` |
| Important variance or environment notes | `<notes>` |

## Human signal review

Review stable semantic groups rather than raw occurrences. Assign exactly one label to every group
reviewed:

- `NEW_USEFUL`: useful and not already covered by the team's tests, monitoring, or review process;
- `ALREADY_KNOWN_USEFUL`: accurate and useful context, but already known or asserted elsewhere;
- `NOISE`: technically observed but not useful enough to retain in ordinary review;
- `NOT_REVIEWED`: no human judgment was made.

| Sanitized semantic identity | Module/rule | Label | Reason | Changed a decision? |
| --- | --- | --- | --- | --- |
| `<stable ID or sanitized category/sink/host>` | `<module / rule ID>` | `<label>` | `<sanitized rationale>` | `<yes / no>` |

| Review total | Count |
| --- | ---: |
| Semantic groups reviewed | `<count>` |
| `NEW_USEFUL` | `<count>` |
| `ALREADY_KNOWN_USEFUL` | `<count>` |
| `NOISE` | `<count>` |
| `NOT_REVIEWED` | `<count>` |
| Groups that changed an engineering/review decision | `<count>` |

Default-configuration result: `<useful output without custom classifiers: yes / no / not established>`

Explain any configuration needed to obtain or suppress signal:

- `<configuration and why; write none only when none was needed>`

## Retention decision

Would the maintainer leave PrivacySpec enabled on ordinary CI runs?

`<yes / conditionally / no / not enough evidence>`

Reason and conditions:

- `<include noise, overhead, unsupported coverage, maintenance, and interpretation concerns>`

Follow-up decision:

- `<keep enabled / extend evaluation / disable / could not integrate>`

## Evaluator conclusion

Most useful previously unasserted observation, if any:

- `<sanitized semantic fact or none>`

Most important product limitation or friction defect:

- `<sanitized limitation or none>`

Additional notes:

- `<notes>`

## Aggregation guidance

Aggregate records without dropping negative or unsupported outcomes. Report the numerator,
denominator, and eligibility rule for every percentage. In particular:

- integration-budget rates include every attempted supported installation and retain failures;
- default-configuration rates state whether custom classifiers were required before useful output;
- useful-signal rates require explicit human review over a realistic evaluation period;
- retention rates include `conditionally`, `no`, and `not enough evidence` as separate outcomes;
- unsupported/incomplete coverage and unmeasured overhead remain visible rather than becoming
  implicit passes.

The roadmap's 80% integration, 70% default-configuration, and 60% useful-signal targets are
provisional product-learning gates after enough independent records exist. They are not correctness
claims, compliance claims, or pass/fail criteria for an individual evaluation.
