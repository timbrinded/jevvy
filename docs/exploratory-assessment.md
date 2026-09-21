# Exploratory assessment — 21 September 2026

This records the original findings. See the [repair and retest](exploratory-retest.md)
for the subsequent fixes and current evidence.

Jevvy implements the workflow in the revision 3 product sheet: select source,
extract comments and local context, ask fixed Jev questions, validate and store
the answers, then let Pi interpret them. That workflow works through the actual
interactive Pi application. It is useful for experimenting with structured
comment review, but the evidence does not support calling it a dependable daily
review tool yet.

Two defects need priority: interactive cancellation does not stop a slash-command
scan, and TypeScript decorators can cause missing method bodies to be certified
as complete context. The report also conceals uncertainty that the bundle retains.
Quality scores need calibration against agreed human judgments before they should
drive edits or acceptance decisions.

This assessment covers code at `8bb76d17cf9af9bccbdec0eb76902e9b310e827a`,
Pi 0.86.1, Jev 1.13.0, Node 25.2.0 and macOS ARM64. It compares the implementation
with the repository's revision 3 product sheet and the attachment in Downloads.
No product code was changed during the investigation.

## What was exercised

| Exercise | Observed result |
| --- | --- |
| Interactive Pi in a real PTY, recorded with BSD `script` | Extension loaded; dry/live slash scans, overview/context retrieval, invalid-command recovery and `/reload` worked. tmux was unavailable, so it was not used. |
| Pi's Gemini model invoking the tools | `jevvy_comments` ran, `jevvy_results` retrieved the remaining page, and Pi correctly separated the planted contradiction at line 1 from the external claim at line 17. All eight request packets were reused from cache. |
| 32 simple consistency cases across TypeScript, Rust, Python and Solidity | All 32 matched expectations written before inference, in each of three uncached runs: 96/96 repeated classifications. These are 32 distinct cases, not 96 independent examples. |
| Eight quality/adversarial cases, repeated three times | Specific prose outranked vague prose; rationale outranked an increment restatement; the embedded instruction did not override the contradiction finding. |
| Six focused API-documentation/decorator cases, three uncached runs | Reproduced the decorator defect and low reader-value scores for straightforward API documentation. |
| Five public Jevvy source files | 13 comments, 182 successful labels, no request errors; 12 supported consistency results and one insufficient-evidence result. These were not independently gold-labelled. |
| Python 3.14.7's `textwrap.py` | 45 selected comments, two exclusions, 598 successful labels and 32 explicitly unevaluated labels. One weak contradiction result warranted investigation. |
| Attachment, docstring and size boundaries | Python decorated async docstrings worked; an ordinary string was ignored; an oversized callable withheld code-relative labels. TypeScript attachment problems were found. |
| Isolated Git repository | Working and branch modes selected unchanged prose when its body changed, included new files and inventoried removed comments. Committed rename handling preserved association; an unstaged rename appeared as deletion plus addition. |
| Frozen results and pagination | Editing the checkout produced a stale-source notice. Pagination advanced, and using a cursor with another bundle was rejected. |
| Two interactive cancellation attempts | Both failed to interrupt the scan; all 120 packets completed on each attempt. |
| `npm run check` | Typecheck, all 53 automated tests, and build passed. |

The 40-comment repeated suite produced 560 valid labels per run in 3.60–3.97
seconds. Successful validation establishes transport/contract correctness, not
the correctness of every judgment. The synthetic fixtures include deliberately
unresolved external names; they are parser and interpretation probes, not
compiled programs covering every runtime edge case.

## Findings

### Interactive cancellation is ineffective

Start `/jevvy comments --files .artifacts/exploration/cases/cancel2.ts`, then submit
`/jevvy cancel` while it runs. In the timed reproduction, cancellation was sent
about 0.37 seconds after starting. The scan ran for 10.356 seconds and produced
1,680 successful labels, zero cancelled labels and status `completed`.
“Cancellation requested” appeared only after the results.

This happened twice with distinct source to avoid cache reuse. The command
handler awaits the entire scan in `src/extension.ts`; the observed host behavior
is consistent with processing the second command only after that handler returns.
The existing engine abort tests do not establish usable cancellation through
Pi's command interface. A repair needs a real interactive regression test.

Evidence: bundles `bundle_88b0a42a-ea3b-407b-ae1f-1b96a3c96d5f` and
`bundle_0ad2b525-2bfd-4116-bd25-2d267f3639dc`, plus the terminal recording.

### Decorated TypeScript methods lose their implementation context

```ts
class Decorated {
  /** Returns zero. */
  @logged
  value() { return 99; }
}
```

Jevvy attaches this comment to the `decorator` node. Its context contains only
`@logged` and `class Decorated `, but is marked `complete_local` with no omissions.
The method body is absent. This violates the specified callable-context recipe.

Across three live runs, that case returned `insufficient_evidence`; the equivalent
undecorated method returned `contradicted` with probability 1 each time. Jev was
cautious given its input, but the extractor had lost the decisive evidence.
Inspect `ownerFor` and context assembly in `src/packs/comments/context.ts`.

Secondary observations: a same-line comment after an exported function was left
unresolved, and a Python module docstring acquired the name of a descendant
`__init__` method. Both deserve focused regression cases.

### The default report overstates weak categorical findings

The `textwrap._split` docstring received `contradicted` with probability 0.36,
versus 0.33 supported, 0.29 insufficient evidence and 0.02 no checkable claim.
Provider confidence was 0.14. Executing both examples in the docstring produced
the documented chunk sequences. The supplied context omitted the class regex
definitions on which the method relies.

I found no demonstrated behavioral contradiction; `insufficient_evidence` is
more defensible from that supplied context. The docstring also contains a minor
quote typo, so this is a reviewed suspect finding, not proof that every
interpretation of its wording is correct.

`scanReport` uses the compact renderer, which prints only `contradicted` for this
answer. Detailed retrieval preserves the distribution, but a reader or Pi model
using the initial report loses the information needed to recognize the near tie.
This conflicts with the intended interpretation-ready uncertainty. Show ambiguity
in the initial report; choose decision thresholds only after calibration.

### Purpose-aware reader value is not established

Across three focused runs, an exported `countItems` function with ordinary JSDoc
scored 1.05–1.06/3 for reader value. An internal comment repeating the same operation
scored 0.98–0.99. Jev recognized the public documentation purpose with probability
0.87–0.88, yet gave it almost the same low value.

More informative API comments about empty input/nonmutation and preservation of
order/duplicates scored 1.46–1.57 and 1.46–1.49 respectively. These are not objective
scoring failures without agreed human labels, but they question whether the rubric
delivers the intended distinction between useful API reference and internal
restatement. Stable answers can still be misaligned with the editorial intent.

### The initial report needs a more usable shape

The default live report includes five comment cards, all 14 label values, context
identifiers and shared source. The public-source scans produced initial reports
of 8,359 and 10,552 characters. Dry-run additionally prints exact request JSON;
even the small boundary probe produced 206 logical lines for its first page.

Exact requests are useful for inspection, but the default view is cumbersome
in an 80-column terminal. Missing-file failure is also indirect: the initial view
says `failed` and `unreadable: 1`, while the filename and reason appear only after
requesting the overview. Preserve the evidence while making uncertainty, failures
and the next useful retrieval obvious in the initial view.

## Fit with the product sheet

The architecture and scope are appropriate. The comments pack, fixed 14 labels,
deterministic extraction and questions, frozen evidence, native distributions,
validation, cache and Pi handoff all exist and ran successfully. This is a
substantial implementation of the proposed product.

Operational reliability and trustworthy interpretation remain incomplete. The
cancellation and decorator findings are implementation defects. Presentation
and quality-score findings affect whether the output is useful for review.
None requires replacing the central architecture.

The next work should be: repair cancellation and ownership with reproductions;
surface uncertainty and failure reasons; then evaluate a broader held-out corpus
with independently assigned purpose, value and consistency labels. Compare direct
Pi review against assisted review using the same tasks, measuring useful findings,
false positives, missed defects, latency and total model usage.

There is still no empirical probability-calibration study, broad real-repository
accuracy estimate or convincing demonstration of improvement over direct Pi
review. The earlier eight-comment comparison found equal consistency accuracy
and better source-line reporting, but greater time and token use with Jevvy.
This exploration did not repeat the Linux/Intel installation matrix, test another
Pi version, exhaust parser forms, or exercise live provider outages and retries.

## Evidence retained locally

Raw evidence lives in ignored `.artifacts/exploration/`, not committed source:

- `terminal/session.raw` and `terminal/session.txt`: interactive transcript, with
  rendering/repaint sequences rather than a polished conversation export.
- `run.mjs`, `cases/manifest.json`, `round-0.json` through `round-2.json`:
  predeclared consistency expectations and repeated outcomes.
- `focused.mjs`, `cases/focused.ts`, `focused-0.json` through `focused-2.json`:
  API-documentation and decorator comparisons.
- `real-jevvy.json`, `real-python.json`, `boundaries.json`: source and boundary
  observations; corresponding storage directories retain full frozen bundles.
- `git-probe.mjs` and `git-summary.json`: scope, stale-source and cursor probes.
- `check.log`: the current 53-test/typecheck/build result.

The prior verification record should be read with these findings. Passing engine
and SDK tests did not establish complete interactive behavior or calibrated
review judgments.
