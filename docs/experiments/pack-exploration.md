# Functions and Tests packs: exploratory results

22 September 2026. Direct calls to `jev-1.13.0` with SDK 0.6.0.

There is enough signal to continue both packs. The best function candidates concern
specific effects and how a caller handles an outcome: duplicate effects on retry,
success after failed required work, and enforcement of a denied permission. The
best test candidates concern the relationship between the claimed behavior,
assertions, expected-value calculation and mock boundary.

Whole-function or whole-suite assurances failed on small executable examples.
Resource cleanup, cancellation paths and exception-test pass/fail prediction need
source analysis or execution before a reliable finding can be produced. More
explicit prompts fixed some examples but did not consistently generalize.

This work adds experimental questions, fixtures and reports only. No production
pack, shared pack abstraction or automatic decision threshold was added. Existing
npm release work was preserved.

## What was run

- Ten ideas for each pack, initially using positive, negative and missing-context
  examples. Expectations were recorded before calls and excluded from request state.
- Same-state question revisions, followed by twenty fresh examples per pack.
  Fresh examples were queried twice; repeats measure limited stability, not extra
  independent examples.
- Eight further examples authored separately before inspecting the candidate
  results. Their exact code was executed with Node, then queried against frozen
  questions. The function cases included a correct ownership control; all four
  test challenges were defective tests.
- Focused follow-ups on authorization denial and exception-test behavior, with
  fresh controls and execution of the exact JavaScript bodies.
- **281 successful requests, 375 typed answers, 145,618 input tokens and 14,179
  output tokens.** This includes one connectivity check and the excluded fixture
  described below. No dollar cost is inferred from token counts.

The examples and labels were agent-authored. Some helper contracts were deliberately
supplied in prose. These are toy observations, not independent human judgments,
calibrated accuracy, or evidence that Jev improves a real review over Pi alone.
Most examples are JavaScript/TypeScript; the Functions exploration includes a few
Python and Rust cases. This does not establish full language support.

Sixty additional setup calls were rejected with HTTP 422 because the experiment
used the SDK helper's arguments incorrectly. They are retained separately and are
excluded from model judgments; they supplied no usage data. One initial test
fixture mixed mock APIs and is also excluded from semantic comparisons. Its valid
replacement uses a plain closure and was executed. These errors are documented in
the per-pack reports.

## Twenty candidate ideas

“Pursue” means a useful next experiment on real code, not a production verdict.

| Functions idea | Current assessment |
| --- | --- |
| 1. Caller-owned data changes before failure | Refine. Found shallow-copy mutations; results weaken with aliasing and indirect writes. |
| 2. Partial durable success | Pursue with explicit effect contracts. Useful as a reconciliation cue, not inherently a defect. |
| 3. Retry duplicates an effect | Pursue. Describe two invocations and the lost-response condition explicitly. |
| 4. Authorization prevents protected work | Pursue the narrower denial-flow question. Defer the original broad authorization verdict. |
| 5. Cancellation prevents later publication | Defer a function-wide verdict. A second await defeated the revised question. |
| 6. Failed required work becomes success | Pursue. Supply the actual success requirement and permitted fallback behavior. |
| 7. Owned resources are released | Defer a function-wide verdict. Missed an early return before `try/finally`. |
| 8. Returned data is tenant-scoped | Pursue with visible helper bodies and an explicit ownership rule. |
| 9. Secret material reaches a public sink | Pursue narrow source-to-sink judgments. Names such as `redact` are not evidence of behavior. |
| 10. Results depend on hidden inputs | Lower priority. Useful environmental-dependency cue; not a cache-safety certificate. |

| Tests idea | Current assessment |
| --- | --- |
| 1. Claimed behavior versus actual assertions | Pursue as a review cue. Caught unchecked values and vacuous loops; aliasing remains weak. |
| 2. Concrete mutant discrimination | Refine. Simple value assertions worked; exception-flow predictions failed confidently. Execute selected mutants. |
| 3. Required error contract | Split error identity from enforced failure. Defer general exception-flow verdicts. |
| 4. Mocks bypass the claimed behavior | Pursue. The answer must be relative to the stated test claim. |
| 5. Async assertions finish before the test | Supporting label. Use static checks for obvious unreturned promises and `forEach(async ...)`. |
| 6. Exact boundary cases are asserted | Refine. Map the contract to a boundary; calculate adjacent inputs in code. |
| 7. Expected result shares production logic | Pursue. Detects tests that reproduce the same faulty calculation. |
| 8. Shared state makes tests order-dependent | Refine. Include hooks, fixture lifecycle and runner isolation. |
| 9. Properties admit a degenerate implementation | Treat as a concrete-mutant question, with execution where possible. |
| 10. Required scenarios are covered | Defer. Claimed complete coverage for two catch-only tests at confidence 1.00 twice. |

Full fixtures, per-idea results, exact questions and initial wording changes are in
the [Functions report](functions-pack.md) and [Tests report](tests-pack.md).
The later experiments below supersede their initial optimistic interpretation
where stated, while preserving all original results.

## Useful pattern: describe the transition, not an abstract quality

The initial retry question asked whether retrying after a lost response can
duplicate an effect. A concrete version specified two complete invocations with
identical arguments, the first effect already committed, and its response lost.
The question asks whether the second invocation adds another effect. On the same
increment example, issue probability changed from 0.57 to 0.97. Fresh examples
also distinguished a stable deduplication key from a new key created per call.

Recovery questions improved when tied to the caller's required outcome. A failed
optional cache lookup followed by successful database retrieval satisfies a lookup
contract. Logging a failed required write and returning success does not.

For opaque helpers, an explicit `unknown` outcome matters. Initial Functions Choice
questions abstained on 9/10 missing-contract examples. Corresponding binary Noul
answers were 0.57–0.85 on all ten. A possibility question can legitimately lean
“yes” without establishing an actual concern; that number must not become a finding.

## Authorization: one useful repair survived fresh cases

The independent challenge included:

```js
async function authorize(actor) {
  if (!actor) throw new Error('missing actor');
  return actor.scopes.includes('publish');
}

await authorize(actor);
published.push(document);
```

An actor without the scope still appended the document in actual execution. The
frozen broad question selected `absent` with probability **0.99 on both calls**.
A generic comparison against the contract also selected the wrong answer.

The revised question asks:

> Can an actor denied by the supplied permission rule reach the protected write
> in the shown caller?

Its criteria distinguish an unchecked false value, an enforced branch, and a
helper that throws on denial. The source state was unchanged. It correctly
selected bypass with probability 0.99 and 0.98.

Six fresh examples then covered enforced booleans, throwing guards, reversed
branches, denial caught with an early return, swallowed denial, and an opaque
helper. Across two calls per example, the revised question matched **12/12**;
the frozen broad question matched **8/12**. Exact bodies for the five cases with
visible helpers were executed; the opaque case remains unknown by construction.

This is a promising denial-flow experiment. It is still six small examples,
not a general authorization check. Definitions and execution are in
[`denial-flow.mjs`](../../scripts/experiments/denial-flow.mjs).

## Exception tests: several apparent fixes did not generalize

The suite-coverage question accepted this pattern as testing the required errors:

```js
try {
  await read('absent', 'Ada');
} catch (error) {
  assert.equal(error.code, 'NOT_FOUND');
}
```

When `read` returns a successful value, no assertion executes and the test passes.
The exact snippet and the two-block suite were executed against an implementation
that always returns `'value'`.

| Follow-up | Result |
| --- | --- |
| Select one error obligation at a time; use the frozen error question | 7/8 matching judgments on four states queried twice. The catch-only case remained near a tie. |
| Ask whether the test passes if the operation returns normally | 4/8. Both catch-only snippets were wrong on both calls. |
| Supply an explicit always-successful replacement; use the frozen mutant question | 4/8. Catch-only tests were called mutant-killing with 0.99–1.00 probability. |
| Explicitly explain that successful `try` skips `catch` and that the contract is a requirement | 8/8 on those already-seen states. |
| Freeze that explanation and try four fresh forms twice | 4/8 for the revised question, and 4/8 for the frozen mutant question. |
| Remove the normative contract field from four cases, leaving source and replacement | 4/8. Removing the contract did not repair the failure. |

Two fresh forms are particularly useful counterexamples:

```js
try {
  await read('absent', 'Ada');
  assert.fail('expected rejection');
} catch (error) {
  assert.ok(error instanceof Error);
}
```

This test catches its own `AssertionError` and passes. The mutant question called
it a failing test with 0.99 probability twice. The revised failure-enforcement
question also got it wrong, with a less concentrated distribution.

```js
let rejected = false;
try {
  await read('absent', 'Ada');
} catch (error) {
  rejected = true;
  assert.equal(error.code, 'NOT_FOUND');
}
assert.equal(rejected, true);
```

This correctly fails when `read` returns a value. The revised question incorrectly
said enforcement was missing with probabilities 0.92 and 0.93. Making a prompt
longer to fix the first failure did not produce a reliable control-flow evaluator.

Do not use a general mutant or exception-test answer as proof of runtime behavior.
Simple value-assertion cases still provide a useful lead; execution is the final
check. Exact questions, states and executable snippets are in
[`error-obligations.mjs`](../../scripts/experiments/error-obligations.mjs).

## Suggested next experiment

Start with a small real-code sample rather than implementing all twenty labels.

- **Functions:** retry duplication, success after failed required work, and the
  revised denial-flow question. Attach the relevant helper body or explicit
  contract, preserve unknowns, and show the supporting source to Pi.
- **Tests:** mock boundary, expected-value provenance, and a specific claimed
  behavior not asserted. Use concrete mutants as executable checks, initially
  focusing on simple returned values rather than exception handling.

Keep runtime facts, arithmetic and obvious syntax checks in code. Jev can judge
the semantic relationship between a claim, an operation and its evidence. These
experiments do not establish that the added model calls save review time or cost.

## Evidence and reproduction

- [All batch totals](../../.artifacts/pack-experiments/overall-summary.json)
- [Independent execution observations](../../.artifacts/pack-experiments/challenges/oracles.json)
- [Frozen-question challenges](../../.artifacts/pack-experiments/challenge-review.json)
- [Denial wording comparison](../../.artifacts/pack-experiments/denial-revision.json)
- [Fresh denial examples](../../.artifacts/pack-experiments/denial-fresh.json)
- [Exact exception-test execution](../../.artifacts/pack-experiments/error-execution.json)
- [Fresh exception-test failures](../../.artifacts/pack-experiments/error-fresh.json)
- [Contract-field ablation](../../.artifacts/pack-experiments/error-without-contract.json)

Raw evidence is local and ignored by Git. Fixture/question scripts are in
`scripts/experiments/`; import them without making calls. The shared helper only
sends direct requests, limits concurrency to two and saves requests/results. It
does not use Jevvy's pack engine, caching or bundle contract.

Run local execution checks without model calls:

```sh
node scripts/experiments/challenges.mjs
node scripts/experiments/denial-flow.mjs --execute
node scripts/experiments/error-obligations.mjs --execute
```

Live follow-ups require `TYPESAFE_API_KEY` and Node 26. They consume API tokens
and replace their named local result files:

```sh
node scripts/experiments/challenge-review.mjs
node scripts/experiments/denial-flow.mjs
node scripts/experiments/error-obligations.mjs
node scripts/experiments/error-obligations.mjs --concrete
node scripts/experiments/error-obligations.mjs --explicit
node scripts/experiments/error-obligations.mjs --fresh
node scripts/experiments/error-obligations.mjs --without-contract
```

The per-pack reports contain the initial/revision/holdout commands. Questions were
designed using the live TypeSafe [State](https://docs.typesafe.ai/concepts/state.md),
[Choice](https://docs.typesafe.ai/primitives/choice.md), and
[documented limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md).
The observed failures above are local measurements, not claims inferred from those
documents.
