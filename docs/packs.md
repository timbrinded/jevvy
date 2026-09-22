# Functions and Tests packs

These packs produce source-linked review candidates. Each question examines one
function or test and its supplied evidence. They do not execute code, prove
correctness, or establish whole-program or whole-suite coverage.

Both packs use four named Choice outcomes:

| Outcome | Meaning |
| --- | --- |
| `issue` | The supplied evidence supports the particular issue defined by this rubric. Inspect the source before accepting the finding. |
| `no_issue_shown` | This check found no issue in the supplied evidence. This is not a safety certificate. |
| `insufficient_evidence` | A relevant contract, helper, assertion, manifest, or reference is missing. |
| `not_applicable` | The target does not contain the subject of this particular check. |

These model outcomes differ from processing states such as `not_evaluated`,
`error`, and `cancelled`. An API error or skipped question is never a clean result.

The [production-pack experiment report](pack-experiments.md) records the live
queries, rubric changes, executable controls, and remaining weak checks.

## Run a pack

In Pi, use a dry run to inspect extraction and the planned request before live
inference:

```text
/jevvy functions --files src/orders.ts --dry-run
/jevvy tests --files test/orders.test.ts --context-files src/orders.ts package.json --dry-run
```

Remove `--dry-run` to query Jev. The same commands support `--working` and
`--base <ref> [--head <ref>]` instead of `--files`.

The programmatic `scan` input selects `pack: 'functions'` or `pack: 'tests'`.
The omitted pack remains `comments`. `contextFiles` explicitly supplies related
implementations, manifests, or contracts:

```typescript
await scan(
  {
    pack: 'tests',
    mode: 'files',
    files: ['test/orders.test.ts'],
    contextFiles: ['src/orders.ts', 'package.json'],
  },
  { cwd: process.cwd() },
);
```

Supplying a manifest does not establish behavior ownership by itself. Include
the implementation and relevant contract when a test exercises a wrapper or
depends on a documented compatibility rule. Helpers are not inferred from names,
and Jevvy does not automatically retrieve an entire call graph.

The `complete_target` prerequisite requires the complete selected code unit in
supplied evidence. Surrounding file omissions remain visible. This permits a
small complete function in a large file to be assessed without pretending that
all callers, helpers, or contracts are available. A question that needs such
missing evidence must return `insufficient_evidence`.

Functions are extracted from body-bearing declarations, methods and callable
expressions. Recognized test and setup callbacks are kept out of that pack.
Tests support direct Node/Jest/Vitest registrations and common aliases/modifiers,
Python pytest/unittest conventions, Rust test attributes, and Foundry test
functions. Skipped/todo tests are excluded. Arbitrary custom wrappers, runtime
registration, imported callback bodies and macro expansion are not resolved.
Unsupported callback references are inventoried rather than inferred from their
names. Working/branch scans select changed files and their local evidence; they
do not discover all unchanged tests affected by a change in another file.

## Functions 1.0.0

| Label | Decision | Origin |
| --- | --- | --- |
| `redundant_internal_checks` | Does an internal check repeat a trustworthy type or an earlier enforced validation? | Codesavers #5 |
| `hidden_required_failure` | Does a catch or default turn explicitly required failed work into ordinary success? | Codesavers #6, #12 |
| `unnecessary_indirection` | Does a proven private single-use helper add a needless jump without a useful boundary? | Codesavers #1, #10 |
| `unused_flexibility` | Does a controlled internal interface support alternatives unused by its complete supplied caller set? | Codesavers #2, #13, #14 |
| `avoidable_nesting` | Can guard returns remove obstructive nesting while preserving effects, returns, scope, and cleanup? | Codesavers #8, #9, #11 |
| `denial_path` | Can a path denied by an explicit permission rule reach the protected operation? | Jevvy experiment |

The first five checks adapt Codesavers' simplicity guidance. Their exceptions are
part of each question. Boundary parsing and error mapping, public interfaces,
framework signatures, lifecycle functions, accessibility, meaningful domain
helpers, and exhaustive state machines can require code that superficially
resembles a simplification candidate. Size, argument count, and one visible call
do not establish a finding.

`unused_flexibility` requires explicit evidence that the caller set is complete.
An ordinary source excerpt does not provide that guarantee. It is expected to
abstain when a complete set of controlled callers is unavailable.

`denial_path` is a separate correctness question derived from the
[denial-flow experiments](experiments/pack-exploration.md). It follows boolean,
throwing, and caught-denial paths. It needs the permission rule and helper
behavior; it does not infer security requirements from function names or claim
to perform a security review.

## Tests 1.0.0

| Label | Decision | Origin |
| --- | --- | --- |
| `owned_behavior` | Do assertions only repeat an external dependency's behavior without protecting a local purpose? | Codesavers #15 |
| `claim_assertion_gap` | Is a concrete claimed result left unchecked by the assertion targets? | Jevvy experiment |
| `mock_bypasses_subject` | Does a mock replace the behavior the test claims to exercise? | Jevvy experiment |
| `shared_expected_logic` | Does the expected value repeat the production operation or decision being tested? | Jevvy experiment |
| `irrelevant_fixture_setup` | Is particular fixture state or setup demonstrably unnecessary for this test? | Codesavers #2, #8 and test exceptions |

Codesavers #15 requires a dependency manifest, the actual asserted behavior, and
enough implementation and contract context to establish ownership. Keep tests
that protect local configuration, transformation, error handling, integration,
an explicitly exposed application contract, or a documented compatibility
regression. A package used for assertions, test infrastructure, or fixtures does
not make the tested behavior dependency-owned. An external import alone is not a
finding.

The test pack permits explicit setup, detailed assertions, literal fixtures,
repeated setup that keeps tests independently readable, mock factories, and
lifecycle hooks. `irrelevant_fixture_setup` needs enough subject and helper code
to distinguish irrelevant state from construction requirements, effects, and
isolation. It does not flag a test because it is long or has many fixture fields.

The three Jevvy questions complement this ownership review. They do not predict
whole-test pass/fail through exception handling or certify suite coverage. Our
[earlier experiments](experiments/tests-pack.md) produced confidently wrong
answers on those broader questions, including a test that catches its own
assertion failure. Exact execution is needed for those claims.

## Confidence and review

Jev's complete outcome distribution and provider confidence are preserved.
Neither is interpreted as a calibrated defect probability. The packs contain no
default acceptance cutoff and no combined quality score.

To order review candidates, retrieve one label and sort by its `issue`
probability. Include the frozen definitions and context to inspect the result:

```text
/jevvy results <bundle-id> --view units --labels denial_path --sort denial_path --outcome issue --direction desc --include-context --include-definitions
```

Optional result filters apply to saved answers and do not require another Jev
request. A chosen threshold is a review setting, not a demonstrated precision
guarantee. Measure each check on representative labeled examples before adopting
an acceptance policy. Keep repeated queries and related example variants in the
same evaluation split. Record missed defects as well as false findings; a high
threshold can hide useful findings without correcting confident mistakes.

Changes to questions, outcomes, exceptions, or provenance change the definition
hash. Pack versions identify the intended rubric revision separately from the
bundle schema and source extraction versions.

## Source and license

Codesavers comes from [timbrinded/kiln](https://github.com/timbrinded/kiln), Unslop
0.4.1, pinned to commit
[`8f30541ac6b793a499a7c6d59b83982932e2a328`](https://github.com/timbrinded/kiln/commit/8f30541ac6b793a499a7c6d59b83982932e2a328).
The upstream default branch was `master` when verified on 22 September 2026.

The adapted source is the
[Codesavers skill](https://github.com/timbrinded/kiln/blob/8f30541ac6b793a499a7c6d59b83982932e2a328/plugins/unslop/skills/codesaver/SKILL.md),
[code-quality directives](https://github.com/timbrinded/kiln/blob/8f30541ac6b793a499a7c6d59b83982932e2a328/plugins/unslop/skills/codesaver/references/code-quality-directives.md),
and [gotchas](https://github.com/timbrinded/kiln/blob/8f30541ac6b793a499a7c6d59b83982932e2a328/plugins/unslop/skills/codesaver/references/gotchas.md).
Each derived definition includes its pinned source URL and directive numbers.
Jevvy's experimental correctness questions have no Codesavers source field.

Upstream Codesavers reviews changed code for avoidable complexity and tests for
application-owned purpose. Jevvy adapts those principles to selected code units
and structured outcomes; it does not reproduce every directive or the original
review workflow. The upstream skill explicitly excludes general correctness,
security, performance, architecture, and technical-specification review.

The following notice applies to the adapted Codesavers material, under its
[MIT license](https://github.com/timbrinded/kiln/blob/8f30541ac6b793a499a7c6d59b83982932e2a328/LICENSE):

```text
MIT License

Copyright (c) 2025 timbo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
