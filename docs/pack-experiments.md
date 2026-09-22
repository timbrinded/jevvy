# Functions and Tests pack experiments

The production packs were exercised through `scan({ pack, ... })`, including
source capture, AST extraction, explicit supporting files, request planning,
the real Jev transport, answer validation, and saved bundles. The experiment
runner imports the production engine; it does not duplicate prompts or replace
the provider with a synthetic response.

The work completed **110 real provider requests and 648 typed answers**, with
**zero provider or answer-validation errors**. Provider usage was **357,698 input
tokens and 38,511 output tokens**. These requests cover **50 distinct fixture
cases: 21 Functions and 29 Tests**, plus repeated and revised queries. Each scan
asks every applicable pack question, while only explicitly labeled checks count
toward the comparison tables below.

These are development examples, not a representative accuracy benchmark. Some
questions were changed after inspecting failures; later replays of those
examples are regression checks, not independent evidence. Most semantic
examples use TypeScript or JavaScript. This work does not establish equal
semantic performance across every supported extraction language.

## Method and evidence

- Model pinned to `jev-1.13.0`; the production transport uses the explicit
  `https://api.typesafe.ai` endpoint.
- At most two concurrent scans, one request at a time per scan, and zero retries.
- Every run uses a fresh storage directory inside `.artifacts/pack-build/`.
  All 110 measured requests reached the provider; none reused a cached answer.
- Every case declares its expected check and outcome before inference. The
  frozen case catalog is saved outside the captured source roots. Gold labels
  and case descriptions are not inserted into model requests.
- All extraction and context prerequisites are checked by a dry run before the
  first live request in a batch. Full bundles preserve the exact definitions,
  requests, evidence, answers, model, usage, and definition hashes.
- **27 distinct authored fixture cases were executed from their exact captured
  source**, using Node's test runner or imports. This verifies selected concrete
  behavior; it does not automatically establish every semantic rubric judgment.

The upstream dependency-only and owned-retry controls are exact source copies
from Kiln commit `8f30541ac6b793a499a7c6d59b83982932e2a328`. Their original
manifests and implementation files are supplied through `contextFiles`. No
upstream fixture dependencies were installed; these controls were inspected as
source evidence, not claimed as executed runtime tests. The
[pinned upstream fixtures](https://github.com/timbrinded/kiln/tree/8f30541ac6b793a499a7c6d59b83982932e2a328/plugins/unslop/skills/codesaver/evals/files)
and [license notice](packs.md#source-and-license) identify their source.

## Runs and changes

| Artifact directory | Cases | Prespecified checks matched | Typed answers | Purpose |
| --- | ---: | ---: | ---: | --- |
| `initial-01` | 29 | 25 / 30 | 181 | Initial questions, positive controls, negative controls, missing evidence, and upstream fixtures. |
| `fresh-01` | 12 | 10 / 13 | 73 | Fresh examples after clarifying public-interface and non-issue outcome precedence. |
| `oracle-revision-01` | 6 | 6 / 6 | 30 | Previously failed idempotence example plus five fresh relational-property and copied-computation cases. |
| `final-01` | 46 | 43 / 48 | 279 | Complete catalog replay at that point; exposed a literal-object false positive. |
| `literal-revision-01` | 14 | 15 / 15 | 70 | Literal-scope repair, eleven regression cases, and three fresh controls. |
| `determinism-control-01` | 1 | 0 / 1 | 5 | Fresh explicit determinism test exposed an overbroad same-input rule. |
| `determinism-revision-01` | 2 | 2 / 2 | 10 | Narrow determinism repair, replayed with the ordinary-value self-comparison positive. |

Do not combine these rows into an accuracy percentage. They mix revised
questions, repeated examples, different questions, and purposefully constructed
cases. The final determinism change was checked on the two specified cases;
the entire catalog was not rerun after that last narrow change.

The initial run also exposed two overlapping outcome definitions. Existing flat
guards could be either `no_issue_shown` or `not_applicable`, as could a literal
expected value. The definitions now give these cases `no_issue_shown` and reserve
`not_applicable` for absence of the relevant comparison or control flow. The
initial frozen gold labels and results remain unchanged. The current catalog
uses the clarified outcomes; relabeling is not counted as a model improvement.

Three preparation attempts failed before inference: the runner initially passed
an empty `contextFiles` array, expected the wrong dry-run status reason, and
expected a static name for an upstream template-literal test registration. The
runner was corrected to follow the public scan contract and extracted metadata.
Those attempts made no provider requests. The completed preflight is retained
under `preflight-04`.

## What worked

Required-failure and permission-path examples produced useful findings without
misclassifying their explicit recovery and guard controls:

| Comparison | Observed outcome |
| --- | --- |
| Invalid required JSON configuration is caught and returned as `status: 'ready'`. | `hidden_required_failure: issue`; replay `P(issue) = 0.97`. Exact execution returned ordinary success for invalid input. |
| Invalid optional cache data deliberately falls back to `{}`. | `no_issue_shown`, matching the stated optional-cache contract. |
| Permission helper returns `false`, but the caller ignores it and writes. | `denial_path: issue`; replay `P(issue) = 0.85`. Exact execution appended a document for an actor with no scope. |
| Boolean denial is checked, or a throwing guard stops the write. | `no_issue_shown` for both controls. Exact execution stopped before the write. |
| The same caller is supplied without the permission helper. | `insufficient_evidence`; initial probability 0.96. |
| A throwing permission denial is caught and ignored before the write. | `issue`; replay `P(issue) = 0.74`. Exact execution confirmed the write. |

The Tests pack found several direct local relationships:

- A test claiming numeric sorting asserts only result length. Jev reported the
  assertion gap; the exact test passed while its output remained `[10, 2]`.
- A test claiming name normalization replaces the normalization operation with
  a mock returning the expected string. `mock_bypasses_subject` identified the
  bypass. A control that mocked loading while exercising real normalization
  remained `no_issue_shown`.
- A fee test repeats production's wrong divisor in its expected calculation.
  `shared_expected_logic` identified the shared computation. Exact execution
  passed while both values were 1,000 instead of the contracted 100.
- A large invoice fixture contains state the supplied implementation never
  reads. The setup check identified it. The constructor-required-field control
  remained `no_issue_shown`.
- Kiln's direct `slugify` case matrix produced `owned_behavior: issue`, with
  `P(issue) = 0.91` in both measured full-context runs. Removing the supplied
  manifest changed the focused verdict to `insufficient_evidence`.
- Kiln's retry configuration and telemetry tests remained `no_issue_shown`.
  Removing the wrapper implementation produced `insufficient_evidence` for the
  focused ownership check. The full-context outcomes were diffuse: replay
  `P(no_issue_shown)` was 0.58 and 0.56, so these are useful controls rather than
  evidence of strong confidence calibration.
- Fresh article-path and documented URL-compatibility tests were retained as
  application-owned behavior despite using the same dependency.

## Failures that changed the rubric

`shared_expected_logic` initially treated legitimate relational properties as
shared-oracle defects. The idempotence assertion
`normalize(normalize(x)) === normalize(x)` received `issue` with probability
0.83. The question now identifies the claimed relationship before treating two
production calls as redundant. Fresh commutativity, round-trip, and sorting
idempotence controls then received `no_issue_shown`; an ordinary same-input
self-comparison and a copied branch calculation remained `issue`.

A subsequent full replay exposed a second scope error. A literal expected
object received `issue` with probability 0.52, and an assertion against a mock's
literal return value received a second, inappropriate shared-computation
finding. The question now inspects the expected expression first. Literal
numbers, strings, arrays, and objects do not repeat an algorithm merely because
production returns the same constants. Fresh literal array and nested object
controls received `no_issue_shown` with probability 0.99; a computed field inside
an expected object still received `issue` with probability 0.95.

The final independent challenge was an explicitly named determinism test that
compares two calls with the same input. It received `issue` with probability
0.80 under the overbroad same-input sentence. That sentence now distinguishes a
claim about the correct value from a claim about repeatability. The corrected
question retained the ordinary correct-value self-comparison as `issue`
(`P = 0.93`) and classified the stated determinism test as `no_issue_shown`
(`P = 1.00`). Exact execution of the determinism fixture passed. This last repair
has only the paired regression evidence shown here, not a new broad benchmark.

## Remaining limits

The four focused misses in the Functions replay were conservative outcomes:

| Candidate | Replay result |
| --- | --- |
| Redundant checks on an internally validated non-nullable type. | `no_issue_shown`; issue probability 0.22. |
| Short function with three nested guard conditions. | `no_issue_shown`; issue probability 0.38. |
| Private option whose supplied callers always pass the same value. | `insufficient_evidence`; probability 0.60. |
| A second nested guard example with several main-path operations. | `no_issue_shown`; issue probability 0.48. |

A repeated check after an explicit local validation did produce an issue, but
the replay distribution was split: `P(issue) = 0.49` and
`P(no_issue_shown) = 0.46`. The trivial-helper finding was also weak, at issue
probability 0.54. These simplicity checks should remain optional review signals.
They do not yet justify automated enforcement or a claim of reliable recall.

Provider confidence measures concentration of a particular answer distribution,
not observed correctness for this product. The experiments did not estimate
calibrated per-check thresholds. The packs therefore preserve the distribution,
abstentions and provider confidence without a default cutoff or aggregate quality
score. Missing evidence and a non-issue answer are separate outcomes; silence is
not a correctness certificate.

## Reproduce and inspect

Use the repository's Node 26 and pnpm versions. The runner sets `TMPDIR` and all
storage paths inside the project. Live mode requires `TYPESAFE_API_KEY` in the
environment; the runner never records the credential.

```sh
node scripts/pack-check.mjs --run review-dry
node scripts/pack-check.mjs --execute --run review-execution
node scripts/pack-check.mjs --live --run review-live
node scripts/pack-check.mjs --live --cases t23,t29 --run review-determinism
```

Run names must be new, so an earlier result is not overwritten. Semantic
disagreements are recorded rather than asserted away; provider failures produce
a nonzero exit code. Original artifacts are ignored local files:

```text
.artifacts/pack-build/overall-summary.json
.artifacts/pack-build/<run>/cases.json
.artifacts/pack-build/<run>/run.json
.artifacts/pack-build/<run>/<case>.dry-run.json
.artifacts/pack-build/<run>/<case>.bundle.json
.artifacts/pack-build/<run>/<case>.result.json
.artifacts/pack-build/<run>/summary.json
.artifacts/pack-build/execution-01/execution.json
.artifacts/pack-build/execution-02/execution.json
.artifacts/pack-build/execution-03/execution.json
.artifacts/pack-build/execution-04/execution.json
.artifacts/pack-build/execution-05/execution.json
```

Final frozen definition hashes:

- Functions: `acf31269a2cf26f10ae664231a7b10b697ae451ff343d356d32f8bf977a2ea5f`
- Tests: `8c999bbfe6977b5e7b904a7cd34aeb43e1cdc0ac5b6483c531ec11c0c21b3202`

See [pack usage and provenance](packs.md) for the final questions' scope and
license. Formatting, lint and typecheck validate the implementation separately
from these model experiments; real Pi/tmux and archive-install validation are
recorded by the release verification work.
