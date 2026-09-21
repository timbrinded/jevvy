# Fixes and exploratory retest — 21 September 2026

The defects reproduced in the [first assessment](exploratory-assessment.md) are
fixed in the working tree based on `8bb76d17cf9af9bccbdec0eb76902e9b310e827a`.
The repeated exercise supports using Jevvy for supervised comment review. It
still does not establish calibrated probabilities or an accuracy advantage over
direct Pi review.

## Changes and observed results

| Finding | Change | Retest |
| --- | --- | --- |
| `/jevvy cancel` waited for completion | Interactive command handlers yield while the scan runs. A second command scan is rejected while one is active. Cancellation retains completed answers; shutdown/reload and session switching abort and await command work. Headless commands still await completion. | Three uncached 120-packet scans stopped in 1.089–1.109 seconds after cancellation was sent about one second into each run. Each retained six completed packets (84 labels) and marked the other 1,596 labels cancelled. Previously both scans completed all 120 packets despite cancellation. |
| Decorated methods supplied only the decorator | Association skips decorator siblings and context includes the decorators plus complete method. The full span counts against the context budget. | Decorated and undecorated `return 99` methods whose comments say “Returns zero” both classified as contradicted in all three live repetitions. TS and TSX regression tests assert the actual body, both decorators, ownership and size-limit behavior. |
| Trailing comments lost ownership; module names were wrong | Recognize comments after closing braces and unwrap declaration names without searching unrelated descendants. | The trailing exported-function comment now owns `first`; Python module documentation has a null name rather than `__init__`. Blank-separated prose remains unresolved. |
| Initial results concealed uncertain choices | Keep the full consistency distribution and confidence in the initial report. Keep score confidence and explain that these are model estimates. | A regression test preserves the original 0.36/0.33/0.29 near tie. The real Python example remains visibly uncertain in its saved answers. |
| Reports were bulky and failed-file reasons were hidden | Show bounded comment excerpts and context references initially; retrieve full source and dry-run request JSON explicitly. Show diagnostics before comment cards. | Missing-file reason appeared immediately in Pi. The boundary dry-run fell from 11,914 to 1,986 characters. Real-source initial reports fell from 10,552 to 5,827 characters for Jevvy and 8,359 to 6,505 for Python. The Jevvy file contents changed during repair, so that comparison is not perfectly controlled. |
| Reader-value judgments did not distinguish reading locations well | Define the caller as reading an API signature and documentation without the body, and the maintainer as reading the implementation. Refine rubric levels 1 and 2 accordingly. | Richer API-contract comments increased from 1.46–1.57 to 1.72–1.77. Four fresh API/internal pairs showed the expected ordering in two runs; vague and name-only controls stayed below the API contracts. |

Extraction is now version `1.0.3`, the comments pack `1.1.0`, and the renderer
`1.1.0`. Request/definition/extraction cache keys prevent old evaluations from
being reused for the new recipe. The bundle schema remains `1.0.0`; old bundles
still retain their original definitions and evidence. The synthetic bundle and
rendered sample were regenerated.

## Repeated coverage

The same 32 predeclared consistency cases passed in all three final uncached runs
across TypeScript, Rust, Python and Solidity: 96 matching observations from 32
distinct cases. Together with the eight quality/adversarial probes, each run
contained 40 comments and 560 valid labels. Runs took 3.500, 3.613 and 4.151 seconds.
Embedded instructions remained ineffective, and incomplete descriptions were not
treated as contradictions.

The five Jevvy source files now contain 15 selected comments, yielding 210 valid
labels. Python `textwrap.py` again yielded 45 selected comments, two exclusions,
598 valid labels and 32 explicit unevaluated labels. No API/validation errors
occurred in those final runs. The eight attachment/size probes, Git working and
branch selection, removed-comment inventory, rename handling, stale-source
notices and cursor rejection were repeated successfully.

The earlier weak contradiction on `textwrap._split` became
`insufficient_evidence`, tied with `locally_supported` at 0.35; contradicted was
0.28 and provider confidence 0.14. This remains an uncertain judgment. The changed
answer is not proof of an accuracy improvement: the experiment changed shared
questions and includes model variability. The concrete repair is that the
distribution is available immediately instead of presenting a bare verdict.

## Interactive and platform checks

Actual Pi 0.86.1 ran in a PTY with a retained BSD `script` transcript, not tmux.
Tests covered live and dry slash scans, missing-file output, cancellation,
post-cancellation recovery, reload, model-driven scan and pagination, frozen
context inspection and a repeated scan using all eight cached packets.

Reloading during an active scan also retained a cancelled bundle: 12 completed
packets, including six cache hits, and 1,512 cancelled labels. A headless CLI
dry-run completed successfully after the interactive lifecycle change.

| Environment | Verification |
| --- | --- |
| macOS ARM64, Node 25.2.0 | Typecheck, all 60 tests, build, Pi SDK check, fresh production-only packed install, live API runs and interactive PTY exercise passed. |
| Linux ARM64, Node 24 Debian container | Fresh dependency install, typecheck, all 60 tests, build and Pi SDK commands/tools/reload passed. |
| Linux x64, Node 24 Debian container under emulation | Same 60-test/build/Pi check passed. |

These tests add seven cases to the original 53-test suite and strengthen the
existing decorator assertion. The extension regression test uses a controlled
aborting transport; the PTY tests supply the independent real-host/live-API check.
Linux tests were headless, and macOS x64 was not rechecked in this exercise.

## Quality and comparison limits

The ten fresh reader-value probes were written after the rubric revision and
were not used to tune it. Four API contracts outranked equivalent internal
narration by 0.24–0.57 points across two uncached runs. Vague/name-only controls
scored 0.75–0.94. Ordinary `countItems` documentation still scored about 1.03,
close to its internal counterpart: documenting syntax alone does not guarantee
additional reader value.

Those ordinal expectations were assigned by the implementing agent, before the
calls. They are evidence of intended behavior on these cases, not independent
human agreement or statistical calibration. Do not turn the scores into an
automatic acceptance threshold on this evidence.

The source-only versus assisted Pi comparison was repeated with the same eight
comments, model and task:

| Measurement | Source only | Jevvy assisted |
| --- | ---: | ---: |
| Correct consistency outcomes | 8/8 | 8/8 |
| Correct source lines | 8/8 | 8/8 |
| Wall time | 8.127 s | 10.732 s |
| Pi input tokens | 1,149 | 13,312 |
| Pi output tokens | 2,558 | 702 |
| Pi total tokens | 3,707 | 14,014 |

The assisted arm also incurred Jev inference. It retrieved the remaining comment
page and read the implementation before interpreting the labels. This run showed
no accuracy advantage. Its lower elapsed time than the earlier assisted run is
an observation, not an isolated measurement of the renderer change.

The product's demonstrated value is a repeatable, source-linked set of judgments
that Pi can inspect. Whether that improves larger reviews enough to justify the
extra inference remains an open evaluation question.

## Evidence

Ignored `.artifacts/retest/` retains the terminal recording, full frozen bundles,
fixture manifests, comparison event streams and execution logs. Final repeated
source runs are under `final/`; focused decorator/API comparisons are in
`focused-0.json` through `focused-2.json`; the fresh cases and predeclared ordering
are in `heldout.json` and `heldout-expectations.json`. Platform results are in
`check.log`, `linux-arm64-final.log`, `linux-x64-final.log`, `pi-sdk.log` and
`clean-install.log`. `tested-source-sha256.json` identifies the tested implementation files.

Final interactive cancellation bundle:
`bundle_93dea6d1-6949-48dc-91bf-47d4fc250763`.
Active-reload cancellation bundle:
`bundle_6e2192f1-5599-43f9-8759-d1bba0db7315`.
The original observations remain under `.artifacts/exploration/` for comparison.
