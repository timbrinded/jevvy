# Paired review observation

The latest [16-comment comparison](handoff-verification.md#selective-retrieval-and-actual-pi-review)
lets Pi choose its retrieval. Both arms classified 16/16 correctly; the assisted arm
had better source-line accuracy and used more model tokens. The eight-comment runs
below are retained as earlier observations.

A [subsequent repair and retest](exploratory-retest.md#quality-and-comparison-limits)
repeated this comparison: both arms achieved 8/8 consistency classifications and
8/8 source lines; source-only took 8.127 seconds and 3,707 Pi tokens, assisted took
10.732 seconds and 14,014 Pi tokens plus Jev inference. The original observation
below is retained for comparison; neither run establishes a general advantage.

On 21 September 2026, two fresh Pi 0.86.1 sessions reviewed the same eight
synthetic TypeScript comments using `google/gemini-3.8-flash`. Both received the
same review task and source-data trust instruction. The baseline had only the
read tool. The assisted session also had jevvy's scan and retrieval tools and
was instructed to scan and retrieve every comment before interpreting results.
Neither could modify files. This is a small controlled example, not a general
accuracy or speed benchmark.

| Measurement | Source-only review | jevvy-assisted review |
| --- | ---: | ---: |
| Wall time | 8.761 s | 21.661 s |
| Pi model input tokens, summed across turns | 1,131 | 9,580 |
| Pi model output tokens, as reported by provider | 2,098 | 5,107 |
| Pi model total tokens | 3,229 | 14,687 |
| Correct local-consistency classifications | 8/8 | 8/8 |
| Correct comment source lines | 2/8 | 8/8 |
| False contradiction findings | 0 | 0 |
| Missed planted contradictions | 0 of 1 | 0 of 1 |

The assisted run additionally used Jev 1.13.0: 17,043 input tokens and 2,355 output
tokens, 112 successful labels across eight comments, no cache hits, and 1.116 s
inside the Jev pipeline. Its tools were `read`, `jevvy_comments`, and
`jevvy_results`; the baseline used `read` alone.

Both reviews found the false `undefined` return claim, preserved uncertainty
about the fictional Acme gateway, and ignored the instruction embedded in a
hostile source comment. The assisted report explicitly identified the increment
comment as a restatement; the baseline only described its factual accuracy.
Both preserved ordinary API documentation as valid and suggested clarification
of vague prose. Neither found additional consistency defects on this fixture.

The classifications reviewed against the source were:

| Comment line | Expected local consistency |
| --- | --- |
| 1 | contradicted |
| 8 | locally_supported |
| 17 | insufficient_evidence |
| 22 | locally_supported |
| 28 | no_checkable_claim |
| 33 | no_checkable_claim |
| 37 | locally_supported |
| 41 | no_checkable_claim |

This result demonstrates a functioning model/tool handoff and accurate source
association. It does **not** establish that jevvy is cheaper, faster, or generally
more accurate than direct review. On this small example it consumed substantially
more context and time. The value shown is a repeatable, structured, auditable
label bundle; its usefulness on larger reviews remains workload-dependent.

An earlier run with the more verbose default report also classified all eight
correctly; it consumed 15,453 Pi input tokens in the assisted arm. That motivated
showing point estimates in the default report while retaining full native
distributions through `jevvy_results`. Model variability and changed context
recipes mean the two runs are not a controlled isolated measurement of that
renderer change.

Reproduce with `node scripts/compare-reviews.mjs` after building, with existing
Gemini and TypeSafe credentials. Full event traces and summary measurements are
in ignored `.artifacts/comparison/`. This script is development evaluation only;
the product's extraction, questions and renderer make no generative-LLM calls.
