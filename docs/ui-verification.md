# Progress and results UI verification

Verified on 21 September 2026 with Pi 0.86.1. This implements the direction from [UI exploration](ui-exploration.md).

## Implemented

- Structured scan snapshots identify capture, extraction, planning, analysis, saving, completion and fatal failure. Packet totals are available before the first request. Successful, partial, failed, cancelled, active and cached counts are separate.
- One editor widget covers concurrent scans. Updates are batched; the animation clock exists only while a TUI widget is mounted. `JEVVY_ANIMATION=0` removes the clock while preserving event-driven updates.
- Commands and tools share compact result cards. Errors, cancellations, skipped assessment, source warnings and pagination remain visible. A run with no answers and request errors is labelled “No answers · requests failed”, even if its stored bundle status is `partial`.
- Expanding a card reveals the existing report page. Model-facing text, frozen evidence and result cursor fields remain available; visual compression does not shorten the model's evidence.
- `/jevvy inspect <bundle-id>` pages through comments, distributions, their frozen context and question definitions. It remembers the selected comment when switching views, supports scrolling, and uses Pi's configured cancel key. Inspection does not call Jev.
- Teardown clears the widget and timers, aborts scans and waits for persistence. Retired sessions suppress late UI updates and result messages. Terminal control characters from source data are removed from displayed text; saved evidence is unchanged.

The original string `onProgress` callback remains supported. Library callers can use the new `onEvent` callback and exported `ScanProgress` type for structured progress. Each event is an independent snapshot. Dry-runs leave planned packets unexecuted; completed packet counts include errors and cancellations and must not be interpreted as successful answers.

## Checks and evidence

Local evidence is in `.artifacts/ui-integration/` and is not part of the published package.

| Check | Observed result | Evidence |
| --- | --- | --- |
| macOS ARM64, Node 25.2.0 | Typecheck, 69 tests, build passed | `check.log` |
| Linux ARM64/glibc, Node 24 | Typecheck, 69 tests, build and Pi SDK checks passed | `linux-final-check.log` |
| Pi SDK, final build | Commands, tools, structured progress, pagination, context, result metadata and reload passed | `sdk-final.log`, `sdk-live-final.log` |
| Clean production-only install | Packed extension loaded and passed SDK checks with no development dependencies | `clean-install.log` |
| Live slash command | 40 comments, 560 answers, zero errors and cache hits | `storage/bundles/bundle_3425d28c-a5a6-4468-a500-01af53fe2555.json` |
| Model-initiated tool call | Pi invoked `jevvy_comments`; eight comments, 112 answers, no errors | `tool-result.png`, corresponding saved bundle |
| Larger live slash command | 70 comments, 980 answers, zero errors and cache hits | `storage/bundles/bundle_0136f9af-1fe3-4593-938f-236202745f07.json`, `progress.png` |
| Detail inspection | Comment probabilities and matching frozen function displayed inside Pi | `inspector-framed.png`, `frozen-source.png` |
| Linux tmux with Powerline | Preview and active progress remained visible alongside the actual third-party footer | `linux-powerline-preview.txt`, `linux-powerline-progress.txt` |
| Narrow terminal | At 40 columns, progress and the cancel command remained visible | `linux-powerline-narrow.txt` |
| Cancellation | Injected pending transport cancelled; all 112 labels marked cancelled; widget removed | `linux-powerline-cancelled.txt` |
| Provider failure | Injected HTTP 503 failures produced an explicit zero-answer failure card with 112 errors | `linux-powerline-failure.txt` |
| Static motion | Static marker displayed during active work; no animation clock in the focused test | `linux-static-progress.txt`, `test/ui.test.ts` |
| Remapped cancel | Inspector displayed and accepted Ctrl+X from isolated Pi keybindings | `linux-inspector-remapped.txt`, `linux-inspector-closed.txt` |

The Powerline coexistence checks used an isolated container without real credentials and with networking disabled. Its theme was set to `light`. Failure and cancellation tests there used a clearly test-only transport; they are not observations of a TypeSafe outage. macOS screenshots use the dark theme and render the real Pi PTY stream through xterm.

Focused tests also cover ANSI and Unicode widths, unknown totals, queued cancellation accounting, immutable progress snapshots, cache accounting, failed persistence, simultaneous scan ownership, redraw batching, timer disposal, headless operation, stale-source warnings and inspector navigation. The existing suite covers the remaining engine contracts.

## Problems found and corrected

The initial overlay allowed conversation text to show through. The final inspector pads every body row and draws an opaque frame. Source view originally selected an unrelated context by its sorted ID; it now follows the selected comment's context references. The compact layout keeps cancellation ahead of optional scope text on narrow terminals.

During development, hot reload retained an older imported renderer after a rebuild. Final visual checks therefore used a fresh Pi process. The extension's teardown and normal SDK reload path are tested; edits to installed renderer modules should be checked after restarting Pi.

These checks cover local macOS and Linux tmux. They do not establish screen-reader accessibility, behavior across every terminal emulator or SSH connection, or compatibility with every extension. Only Powerline was tested in combination. Model calibration is unchanged by this UI work; see [evaluation](evaluation.md).
