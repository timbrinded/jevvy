# Tests pack: direct Jev experiments

22 September 2026. These are toy experiments, not a production pack or a calibrated benchmark.

Mock boundaries, shared oracles and direct gaps between named behavior and assertions are the strongest current review leads. These remain conditional: alias examples had weak confidence, and positive controls matter. Concrete mutant questions worked on simple value assertions, but later execution-backed checks exposed confident errors on exception handling. Keep mutant labels as narrow leads that require execution; defer general error-flow and scenario-coverage verdicts. One scenario counterexample produced a wrong answer at confidence **1.00 twice**.

## Method and evidence

- Model: `jev-1.13.0`; SDK: `@typesafe-ai/sdk` 0.6.0; Node 26.9.0.
- Direct `systemOne` requests through `scripts/experiments/query.mjs`; no Jevvy harness or production changes.
- Every question uses Choice with an explicit `unknown` option. Raw distributions, model, usage, source state, question text, expected labels and elapsed times are retained.
- Expected labels were saved before each batch. Fixture identifiers and expected labels were not sent in the model state.
- One initial triplet per idea: a positive case, a negative case, and unavailable evidence. Then two more difficult probes per idea. Four questions were revised on the **same source states**. Finally, frozen questions received two fresh cases per idea, each queried twice.
- The examples and labels were authored by an agent. The repeats are stability checks, not extra independent examples. This is all JavaScript-like source; it does not establish Rust, Python or Solidity performance.
- Runtime checks are small hand-transcribed equivalents of selected examples, not execution of every fixture string. They cover the deduplication mutants, degenerate normalizer, detached completion, aliased snapshots, missing throws, a wrong boundary and a real retry loop.
- Thirty early requests received HTTP 422 because the experiment incorrectly called the SDK's positional `choice(instructions, criteria)` helper with an object. They supplied no semantic evidence. They remain in `initial.jsonl`; the valid rerun is `initial-valid.json`.
- Initial `mock-2` mixed mock APIs. It is excluded from semantic counts, even though Jev returned the intended label. Probe `mock-real-retry` replaces it with an explicit closure and counter, and that code was executed locally.

Artifacts are in `.artifacts/pack-experiments/tests/` (ignored local files). The runner writes JSON arrays despite the historic failed file's `.jsonl` suffix. Each batch also has a `.cases.json` file and one snapshot per request.

| Round | Distinct source cases | Requests | Matched prewritten label | Purpose |
|---|---:|---:|---:|---|
| Initial valid | 30, including 1 excluded fixture | 30 | 29/29 interpretable | Simple contrasts and missing context |
| Probes | 20 | 20 | 16/20 | Difficult contrasts; includes one unavailable answer option |
| Revision | 20 reused states | 20 | 20/20 | Wording/criteria changes only |
| Held out | 20 fresh states | 40 | 19/20 cases on both repeats | Frozen-question check |

Valid responses used **50,772 input tokens and 4,650 output tokens**. Median measured request time was **242.5 ms**, range **197–706 ms**, with two requests in flight. These timings exclude orchestration and writing fixtures. There were no transport errors in the four valid batches. No cost estimate is inferred from token counts.

A separate agent prepared four further test counterexamples before seeing these results. After the questions were frozen, the parent queried each twice: an empty-loop assertion, truthiness of an incorrect array, an expected value using the same faulty formula, and a UI assertion that omitted the wrong active text. All eight primary labels matched the execution-backed expectation. These four cases are all negative controls; they do not measure false alarms. Their requests are separate from the 110 above. See the local [independent challenge records](../../.artifacts/pack-experiments/challenge-review.json).

## The ten ideas

Initial and probe columns count distinct cases. The held-out column counts distinct cases; both repeats selected the same label in every case.

| Idea | Initial | Probe | Revised states | Held out | Decision |
|---|---:|---:|---:|---:|---|
| 1. Named behavior versus assertions | 3/3 | 1/2 | 5/5 | 2/2 | **Refine.** Useful gaps; object aliases remain uncertain. |
| 2. Concrete mutant discrimination | 3/3 | 2/2 | — | 2/2 | **Refine narrowly.** Value-assertion leads require execution; later exception cases fail. |
| 3. Required error contract | 3/3 | 1/2 | 5/5 | 2/2 | **Defer general verdicts.** Later exception-flow checks contradict the initial promise. |
| 4. Mock bypass of tested behavior | 2/2, 1 excluded | 2/2 | — | 2/2 | **Retain.** Requires the real implementation and explicit boundary. |
| 5. Async assertion completion | 3/3 | 2/2 | — | 2/2 | **Retain as support.** Static detection should handle obvious forms. |
| 6. Exact boundary asserted | 3/3 | 1/2 | 5/5 | 2/2 | **Refine.** Useful with a supplied contract; avoid delegating simple arithmetic. |
| 7. Oracle shares decision logic | 3/3 | 2/2 | — | 2/2 | **Retain.** Can expose a test that repeats the implementation. |
| 8. Shared state and test order | 3/3 | 2/2 | — | 2/2 | **Refine.** Fixture lifecycle context is essential. |
| 9. Property admits a degenerate implementation | 3/3 | 2/2 | — | 2/2 | **Refine within mutant workflow.** Avoid a separate generic property-quality score. |
| 10. Missing contract scenario | 3/3 | 1/2 | 5/5 | 1/2 | **Defer.** Confidently mistakes conditional assertions for enforced outcomes. |

### 1. Named behavior versus observable assertions

Initial contrast: `sort([10, 2])` compared with `[2, 10]` versus checking only length. Jev separated both. An imported assertion helper without its body produced `unknown`.

The harder test claimed to preserve the input, assigned `before = input`, called a potentially mutating sort, then compared `input` with `before`. Jev initially answered `verified`, confidence 0.37. The assertion compares the same object and cannot establish preservation.

Revision: explicitly follow object identity and evaluate all named behavior for the supplied inputs. Same state changed to `gap`, confidence 0.85. A fresh nested shallow-copy example was correctly identified as a gap, but confidence was only 0.25 on both repeats. A deep `structuredClone` snapshot was correctly accepted, at 0.48/0.53. This is a candidate for review hints, not a verdict that a test proves its name universally.

### 2. Concrete mutant discrimination

Question: **“Would the supplied test fail when run against the replacement implementation?”** Options: `killed`, `survives`, `unknown`.

A deduplication test with repeated input rejected an identity replacement; a test with already-unique input did not. Both outcomes were executed locally. A `>= 10` to `> 10` mutation survived tests at 9 and 11, but failed the test at 10. Fresh `floor` to `round` examples separated exact-value assertions from output-type assertions. The model also abstained when generated inputs and expected values were unavailable.

This is a bounded question with an executable follow-up. It requires candidate replacement behaviors to be supplied or constructed elsewhere. Jev did not invent mutants in this experiment. Later checks below show that the same frozen question does not reliably trace exception paths, even with an explicit replacement that always returns a value. The original value-assertion matches remain valid; they do not support a general mutant-verdict feature.

### 3. Required error contract

The initial question distinguished an exact error-code assertion from “throws anything.” But it called a catch-only assertion specific at confidence **0.89**, even though the test passes when the operation returns normally.

Revised question: **“Does this test both require the operation to fail and distinguish the error required by the contract?”** The instructions explicitly inspect the successful-return path. On identical source, the answer became `broad`, confidence 0.38. Fresh Promise `.catch(...)` and `assert.rejects(..., predicate)` cases were correctly distinguished at 0.64–0.88.

The two requirements must remain together: observing an error type does not establish that an error is required. However, the later checks below show that this wording is insufficient for reliable exception-flow judgments. Defer the general label. An `unknown` result remains appropriate when the assertion helper body is absent.

### 4. Mock bypass of tested behavior

Question: **“Does mocking bypass the claimed behavior in this test?”** Options: `bypass`, `exercised`, `unknown`.

Stubbing `send` itself and checking its fixed return value bypasses retry behavior. Running a real retry loop against a transport closure that fails once exercises the retry logic. A test that stubs the authorizer to throw does not test the authorizer's ownership decision, even if a caller observes the error correctly.

Fresh examples separated a fixed clock outside real expiry logic from a replaced signature verifier. Jev labelled both correctly at confidence 0.92–0.99. This must remain relative to the stated claim: the same mock may be appropriate for a caller's error propagation test.

### 5. Async assertion completion

Question: **“Does the test runner wait for the asynchronous assertion?”** Options: `waited`, `detached`, `unknown`.

Jev separated awaited assertions from an unreturned `.then(...)`, and caught `forEach(async ...)` despite an enclosing async test callback. Fresh `Promise.all` and timer-callback cases also worked. Runner semantics were supplied; an unknown runner/helper produced `unknown`.

The toy execution check confirmed that the detached callback returned `undefined` before the assertion ran. This is a useful supporting label, but much of the visible syntax can be checked without model inference. Keep Jev for wrappers or semantic context that the static extractor cannot resolve.

### 6. Exact boundary behavior

The initial question incorrectly accepted tests at 5 and 6 for “at least 5” at confidence **0.94**. Both inputs are on the accepted side; an incorrect minimum of 4 also passes.

Revised question: **“Do the assertions cover the two immediately neighboring inputs on opposite sides of the contract boundary?”** The instructions define the accepted/rejected pair for inclusive minimums and maximums. The same failure became `gap`, confidence 0.98. Fresh exclusive `> 7` and `< 8` cases worked at 0.97–0.99.

The remaining question is value: code should calculate neighbors once a concrete boundary and input domain are known. Jev may help map natural-language contracts to candidate scenarios, but these results do not justify asking it to do all boundary arithmetic.

### 7. Shared oracle logic

Question: **“Is the expected result independently specified rather than calculated with the same production decision logic?”** Options: `independent`, `shared`, `unknown`.

An expected tax result computed with the production tax helper was `shared`; a literal expected amount was `independent`. A snapshot regenerated from the implementation inside the same test was also `shared`. A helper with an explicit approved example table was correctly treated as independent despite being a helper call. Missing helper definitions produced `unknown` rather than assumed independence.

This is about the origin of the expected result, not a blanket prohibition on helper functions or snapshots. “Independent” also does not prove that the expected value is correct.

### 8. Shared state and order dependence

Question: **“Can the supplied tests give different outcomes when their execution order changes?”** Options: `order_dependent`, `isolated`, `unknown`.

Jev separated a shared mutable array from `beforeEach` reset; recognized per-test manual reset and environment-variable contamination; and accepted fresh read-only shared constant use. Hidden fixture lifecycle returned `unknown` at 0.64/0.70 on fresh cases.

The toy results support local hints. Real test files often depend on global hooks, worker isolation and framework configuration. A production pack must include those facts or abstain. It must not infer that absent setup does not exist.

### 9. Degenerate implementations and properties

Question: **“Would the property test reject the supplied degenerate implementation?”** Options: `rejects`, `accepts`, `unknown`.

Idempotence alone accepted a normalizer that always returns `[]`; membership preservation rejected it. Symmetry accepted a comparison that always returns `true`. Ordering rejected an identity sorter. These are semantic observations about a supplied counterexample, not a universal property-strength rating.

A fresh constant-empty reverse implementation satisfied a weak length-equality property, but Jev's correct answer had confidence only 0.32/0.37. A different reverse property rejected identity with confidence 0.99. Treat this as a narrow value-assertion subtype of mutant investigation, and require execution before presenting a mutant outcome as established. Later exception-flow failures rule out a general inference-only verdict.

### 10. Missing contract scenarios

The initial options represented missing-record coverage, wrong-owner coverage, complete coverage and unknown evidence. A suite that covered neither could not be represented. Adding `both_missing` repaired that **question-design** defect on the identical state.

The fresh failure is more serious. A test suite had two catch blocks asserting the expected codes, but no assertion that either operation throws. Jev said no scenario was missing at confidence **1.00 on both repeats**. A replacement `read` that always returns a value passes the suite with **zero assertions executed**; this was executed locally.

Do not expose a reassuring “required scenarios covered” signal from this question. The follow-up below tested an explicit violation per error obligation, but that also failed. Separately labelling visible stimuli and asserted observations remains an untested alternative; it must not be presented as a validated coverage workflow.

## Later exception-flow checks change the recommendation

The parent continued from `scenario-two-vacuous` with four separate rounds, **32 additional requests**. These requests, their tokens and their outcomes are not included in the original 110-request totals above. The original question definitions and original results remain frozen.

First, the parent split the two catch blocks into separate obligations and added two correct `assert.rejects` controls. This changed the evidence unit, not just the wording. Then it supplied an explicit replacement, `async function read(id, user) { return 'value'; }`. A further prompt stated the relevant JavaScript execution rules. Finally, four fresh exception forms tested that revised prompt and the original mutant question together.

| Follow-up round | Distinct cases × repeats | Result |
|---|---:|---|
| Individual error obligations | 4 × 2 | Frozen error question 7/8 matches; separate hypothetical normal-return question 4/8. |
| Explicit always-returning replacement | Same 4 × 2 | Frozen mutant question 4/8. Both catch-only blocks wrongly labelled `killed` on both repeats. |
| Explicit language-rule prompt | Same 4 × 2 | Revised required-failure question 8/8. This repairs the development examples only. |
| Fresh exception forms | 4 new × 2 | Revised required-failure question 4/8; frozen mutant question also 4/8, with different failures. |

The fresh failures matter more than the repaired examples:

- `assert.fail(...)` inside a `try` can itself be caught by a broad `catch`. The replacement returns normally, `assert.fail` throws, and `assert.ok(error instanceof Error)` accepts that assertion error. Execution passes. The frozen mutant question instead selected `killed` with probability **0.99** on both repeats, confidence 0.98. The explicit-language question also selected the wrong answer, at lower confidence.
- An optional Promise `.catch(...)` does not run when the replacement fulfills. Execution passes. The frozen mutant question selected `killed` with probability **0.95/0.96**, confidence 0.93/0.95. The explicit-language question handled this form correctly.
- A separate `rejected` flag asserted after `try/catch` correctly fails if the replacement returns. Execution fails. The explicit-language question incorrectly called failure enforcement missing, probability **0.92/0.93**, confidence 0.87/0.89. The frozen mutant question handled this form correctly.
- A two-argument `.then(successFailure, errorCheck)` correctly failed on normal return, and both questions identified that control.

These later checks execute the **exact supplied test strings** with the replacement, unlike the hand-transcribed equivalents in the original round. The execution results are saved in [error-execution.json](../../.artifacts/pack-experiments/error-execution.json). Requests and responses are in [error-obligations.json](../../.artifacts/pack-experiments/error-obligations.json), [error-concrete.json](../../.artifacts/pack-experiments/error-concrete.json), [error-explicit.json](../../.artifacts/pack-experiments/error-explicit.json) and [error-fresh.json](../../.artifacts/pack-experiments/error-fresh.json). The parent runner is [error-obligations.mjs](../../scripts/experiments/error-obligations.mjs).

The conclusion changes because the simple examples did not cover sufficient exception-flow diversity. Prompt changes can repair a particular family without generalizing to another. Mock boundaries, shared oracles and direct assertion-claim gaps remain promising on the evidence collected. Mutant inference should be restricted to a lead for execution, and general exception-flow verdicts remain deferred. Further state ablations are tracked by the [consolidated exploration report](pack-exploration.md); they are separate from the totals here.

## Questions, reproduction and next experiment

All exact instructions and criteria are in `finalQuestions`, exported by `scripts/experiments/tests.mjs`, and in `.artifacts/pack-experiments/tests/final-questions.json`. Importing the script does not call Jev. The four revisions changed only questions/criteria; their source states can be compared directly in the saved requests.

With Node 26 and `TYPESAFE_API_KEY` already in the environment:

```sh
node scripts/experiments/tests.mjs execution
node scripts/experiments/tests.mjs initial
node scripts/experiments/tests.mjs probes
node scripts/experiments/tests.mjs revision
node scripts/experiments/tests.mjs heldout
```

The live commands consume API tokens and overwrite the corresponding local result files. Preserve a copy in the repository if retaining an earlier run. `execution` uses no API and writes the small runtime checks. The historical invalid mock fixture in `initial` remains excluded; use `mock-real-retry` in the probes as its valid replacement.

The next useful experiment is a small sample of real changed tests with the implementation, helper bodies and framework lifecycle attached. Focus first on mock boundaries, shared oracles and direct assertion-claim gaps. For mutant leads, execute the supplied replacement before reporting whether a test rejects it. Compare useful observations and context cost with ordinary code review. These toy matches do not establish review benefit.

SDK state/question separation follows the [State guide](https://docs.typesafe.ai/concepts/state.md). Choice definitions and complete answer options follow the [Choice guide](https://docs.typesafe.ai/primitives/choice.md). Confidence is distribution concentration, not empirical correctness; see [Confidence](https://docs.typesafe.ai/confidence.md). Live documentation was read for this experiment.
