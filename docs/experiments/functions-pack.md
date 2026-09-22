# Functions pack: first experiments

Date: 2026-09-22. Model: `jev-1.13.0`. SDK: `@typesafe-ai/sdk` 0.6.0.

There is a useful next experiment here: narrow judgments about retry effects,
error recovery, tenant scoping, and secret data flow. Whole-function cleanup and
cancellation checks are not reliable enough in this sample. Both missed small,
executable counterexamples after a wording revision had fixed the initial cases.
A later independent challenge also exposed a high-confidence authorization miss;
defer that broad verdict and investigate whether denied access actually stops the
protected action.

This is a manual exploration, not a production pack or an accuracy benchmark.
The examples and expected labels were written by an agent. Fifty distinct toy
functions are much simpler than project code. Contracts deliberately provide
facts that a real pack would have to obtain from source, types, or a reviewer.
Agreement with these labels does not establish calibrated confidence, bug-finding
accuracy, or value over direct Pi review.

## Ten ideas and what happened

`Initial` means three distinct cases: concern present, concern absent, and missing
helper context. `Revised` uses the same three states and two calls per state.
`Fresh` means two new cases per idea, each called twice, after questions froze.
Counts measure matching **judgments**, not independent examples.

| Idea | Initial | Revised | Fresh | Decision and reason |
| --- | ---: | ---: | ---: | --- |
| Caller-owned data changed before failure | 3/3 | — | 4/4 | **Refine.** Recognized shallow-copy aliasing, but issue probability was only 0.61–0.68. Select the write and failure path before judging. |
| Partial durable success | 3/3 | — | 4/4 | **Refine.** Useful retry/reconciliation cue. Python insert-then-notify had only 0.69–0.72 issue probability. Requires effect contracts. |
| Retry creates a duplicate effect | 3/3 | 6/6 | 4/4 | **Retain.** Explicit two-invocation wording improved the result. Caught a new deduplication key generated inside each call. |
| Authorization precedes protected work | 3/3 | — | 4/4 | **Defer broad verdict; investigate denial flow.** The original unchecked boolean case was weak. A later independent variant was incorrectly ruled safe at 0.99 probability twice; see below. |
| Cancellation prevents publication after an await | 2/3 | 6/6 | 3/4 | **Defer whole-function verdict.** Missed cancellation during a second await and changed its answer across repeats. |
| Failure becomes an ordinary success result | 3/3 | 6/6 | 4/4 | **Retain.** Explicit success requirements distinguished recovery from empty/default success results. |
| Owned resources released on every exit | 2/3 | 6/6 | 2/4 | **Defer whole-function verdict.** Missed an early return before `try/finally` twice. Ownership wording alone did not fix control flow. |
| Returned data belongs to the caller's tenant | 3/3 | — | 4/4 | **Retain, with contracts.** Detected an ineffective late check; accepted a visible filter in a neutrally named helper. |
| Secret material reaches a public sink | 3/3 | 6/6 | 4/4 | **Retain, narrow scope.** Traced through a misleading `redact()` implementation and respected destructuring that removed the password. |
| Identical arguments can produce different results | 3/3 | — | 4/4 | **Retain as a lower-priority cue.** Separated environmental inputs from deterministic arithmetic named `randomScore`. This does not certify that caching is safe. |

No idea is rejected as impossible. The rejected approach is to treat a bare
yes/no probability as a sufficient verdict when relevant helper behavior is
unknown. The deferred ideas need better source selection before more prompt tuning.

## Experiment design

The request state contains only `language`, `code`, and `contracts`. Fixture IDs,
expected labels, and the idea name are retained outside the request state.
Expected labels are saved before live calls. Initial cases include TypeScript and
Python. Fresh cases add Rust RAII cleanup. There is no claim of broad language
coverage.

Each initial request asks a Choice and a Noul independently over the same state.
Choice options are `issue`, `absent`, and `unknown`. The ten positive examples are
local concerns, not automatic proof that the code violates a real product's
requirements. For example, a partial durable effect can be intentional; its useful
output is a review cue about reconciliation.

Initial Choice results matched 28/30 labels. It abstained on 9/10 intentionally
opaque-helper examples. The Noul answered at least 0.5 on **all ten** of those
unknown examples, from 0.57 to 0.85. A yes/no question about what *can* happen can
reasonably read as a possibility question; it must not be interpreted as evidence
that the concern is established. An explicit unknown outcome gave a more useful
interface in this sample.

Five questions were revised after inspecting initial results. No source or
contract state changed for this comparison. Revisions were tried twice per state:
30/30 matched the labels. The frozen questions then produced 37/40 matching
judgments on twenty fresh examples. The failures were not used to tune these
frozen questions further. These repeated calls measure limited response stability,
not additional independent examples.

## The wording changes that helped

| Concern | Change | Same-state result |
| --- | --- | --- |
| Retry | Replace the abstract phrase “retry safety” with two complete invocations, identical arguments, and a lost first response. Ask whether the second creates an additional effect. | Incrementing money moved from 0.57 to 0.97 issue probability. |
| Cancellation | Specify cancellation during an await; ask about the continuation and explain that `throwIfAborted` stops an aborted continuation synchronously. | A correctly placed final check changed from an incorrect 0.77 issue probability to 0.92 absent probability, twice. |
| Recovery | Judge the explicit caller success requirement; distinguish optional failures with valid fallback from logging and continuing. | Valid database fallback moved from 0.56 to 0.88 absent probability. |
| Cleanup | Establish ownership first. Do not infer it from custom `open` or `get` names. Count context managers, `finally`, and Rust drop. | Opaque ownership changed from an incorrect 0.83 issue probability to 0.99 unknown probability. |
| Secrets | Trace original secret material into the specified sink. Distinguish constants and documented boolean verification results. | Redaction moved from 0.79 to 0.95–0.96 absent probability; an opaque sanitizer moved from 0.64 to 0.99 unknown probability. |

The longer questions also weakened some results. The revised Python leak example
had issue probability 0.64 and 0.77, compared with 0.90 initially. An opaque
cancellation helper retained only 0.56–0.60 unknown probability. Prompt expansion
is not a general improvement.

## Exact retained questions

The reproducible definitions, including every Choice option, are exported as
`finalQuestions(idea)` from
[`scripts/experiments/functions.mjs`](../../scripts/experiments/functions.mjs).
The export has no live-call side effect. These are the exact leading questions for
the strongest candidates:

**Retry:**

> Consider two complete invocations with identical arguments: the first committed its effect but its response was lost; the second invocation now runs. Does the second invocation create an additional externally visible effect? Judge the supplied implementation and contracts, not the function name.

**Recovery:**

> Using the explicit success requirement, can the caller receive a normal success result even though that requirement was not met? A failed optional step followed by a fallback that meets the same requirement is successful recovery. A diagnostic log is not recovery. Treat missing recovery contracts as unknown.

**Tenant scoping:**

> Can this function return another tenant's data to the caller? Judge the supplied code and contracts only.

**Secret data flow:**

> Trace secret values to the specified public return or logging sink. Is original secret material present in any value delivered to that sink? A constant redaction marker does not contain the secret. A documented boolean verification result is not original secret material. Do not treat sending a password to its verifier as a log/public-return leak. If a transformation's relevant behavior is missing, select unknown.

In a real pack, preserve the explicit uncertainty option. An opaque `creditOnce`,
`repositoryFor`, `guard`, or `sanitize` helper does not establish its own behavior.
The caller must obtain the relevant implementation or mark the finding unresolved.

## Counterexamples worth keeping

The exact fresh fixtures below were executed with small mocks after inference.
Their runtime observations are in
[runtime-probes.json](../../.artifacts/pack-experiments/functions/runtime-probes.json).

```js
const handle = await files.open(path);
if (handle.size === 0) return [];
try {
  return await parse(handle);
} finally {
  await handle.close();
}
```

The empty-file path opened one owned handle and closed none. Jev selected
`absent` both times, with probabilities 0.69 and 0.56. A visible `finally` was not
enough evidence that every path reaches it.

```js
const first = await load();
signal.throwIfAborted();
const result = await transform(first);
publish(result);
```

Cancellation during `transform` still published `LOADED`. Jev selected `issue`
once at 0.51, then `absent` at 0.58. The final state was aborted in the runtime probe.

The probe also confirmed that an unchecked boolean `authorize(user)` allowed a
reader to delete a document, and a shallow clone changed caller-owned quantity
from 5 to 6 before throwing. Jev selected the expected labels, but with weak
separation. Those examples should remain in any later evaluation.

Two fresh examples included comments instructing the reviewer to produce the
wrong answer. Both selected the expected Choice labels. This small check does
not establish prompt-injection resistance: the shallow-copy example remained weak.

## Later independent challenge

Another agent supplied four additional function examples with executed oracles.
The frozen questions were called twice per example. These eight requests are
separate from the 100 original valid calls and do not change the tables above.
Raw results are in
[challenge-review.json](../../.artifacts/pack-experiments/challenge-review.json).

The authorization example `f-03` contains this relationship:

```js
async function authorize(actor) {
  if (!actor) throw new Error("missing actor");
  return actor.scopes.includes("publish");
}

await authorize(actor);
published.push(document);
```

The caller ignores `false`. The executed oracle confirmed that an actor without
the publish scope still appends a document. The frozen authorization question
selected `absent` with probability **0.99** and confidence **0.98** on both calls.
A separate generic contract question also selected the wrong answer, `consistent`,
with probabilities 0.83 and 0.80. High reported confidence did not protect against
this error.

The two mutation challenges selected the expected issue labels: 0.91/0.89 and
0.79/0.73 probability. The valid cleanup control selected `absent`, but only at
0.58/0.56. The authorization result changes the recommendation: investigate a
narrow question about what happens when authorization returns denial, rather than
use the current broad authorization verdict. The frozen definitions remain
unchanged. Further focused experiments are recorded in the
[combined exploration](pack-exploration.md).

## What to try next

1. Give retry and recovery judgments a small real-code dataset with independently
   checked contracts and outcomes. Compare their added value with direct Pi review.
2. Select candidate writes, sinks, checks, and relevant helper bodies with source
   tooling. Ask Jev about a specific relationship, with source spans available to
   the reviewer. A generic function-wide verdict hides which path was inspected.
3. Keep cleanup and cancellation out of automatic findings until a path-based
   experiment survives the counterexamples above. AST control-flow facts may be
   a better starting point than another whole-function prompt revision.
4. Measure both abstention quality and false positives on ordinary correct code.
   Do not adopt a probability threshold from this small balanced toy set.

## Evidence, usage, and reproduction

| Round | Valid requests | Distinct states in round | Matching Choice judgments | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial | 30 | 30 | 28 | 14,136 | 1,719 |
| Same-state revision | 30 | 15 already used above | 30 | 15,918 | 1,210 |
| Fresh examples | 40 | 20 | 37 | 20,734 | 1,963 |
| Total | 100 | 50 across all rounds | 95 | 50,788 | 4,892 |

Median observed request latency was 247.5 ms; maximum was 669 ms. Two requests ran
concurrently. These timings include transport and do not predict full pack latency.
There were no service errors in the 100 valid requests.

Before the valid runs, an incorrect SDK constructor call put Choice criteria inside
instructions. The server rejected all 30 requests with HTTP 422. Those failed
attempts are preserved separately as `initial-transport-failed.json`; they are
not model judgments and supplied no token-usage data. Total HTTP attempts: 130.
The constructor usage was corrected to `choice(instructions, criteria)` and
`noul(instructions)`. The shared runner now checks this schema before sending.

Raw requests, responses, full distributions, confidence, token usage, expected
labels, and per-call timing are preserved in:

- [Initial responses](../../.artifacts/pack-experiments/functions/initial.json)
- [Revised responses](../../.artifacts/pack-experiments/functions/refined.json)
- [Fresh responses](../../.artifacts/pack-experiments/functions/holdouts.json)
- [Aggregate usage](../../.artifacts/pack-experiments/functions/summary.json)

Each response file also has a `.cases.json` snapshot written before inference and
one file per completed call. `.artifacts` is local, ignored experiment evidence.
The source script retains the cases and questions needed to reproduce the runs.

From the repository with Node 26 and `TYPESAFE_API_KEY` available:

```sh
node scripts/experiments/functions.mjs initial
node scripts/experiments/functions.mjs refined
node scripts/experiments/functions.mjs holdouts
node scripts/experiments/functions.mjs summary .artifacts/pack-experiments/functions/holdouts.json
```

These commands make live billable requests and replace the named result files.
The script uses the direct TypeSafe API through the shared experiment helper; it
does not use the Jevvy scan engine. The model is pinned to `jev-1.13.0`.

Question design follows the live TypeSafe documentation for
[Choice](https://docs.typesafe.ai/primitives/choice),
[Noul](https://docs.typesafe.ai/primitives/noul), and
[state](https://docs.typesafe.ai/concepts/state), read on the experiment date.
