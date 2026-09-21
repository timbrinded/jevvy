# Pi UI exploration

Research and local testing: 21 September 2026. Pi 0.86.1, macOS ARM64.

The implementation and subsequent tests are recorded in [UI verification](ui-verification.md). The rest of this document describes the earlier prototype.

Jevvy should use a small live widget above the editor and a compact, expandable result card. This gives scans a visible place in the conversation while leaving the editor available. An optional detail view can follow once the progress and result states work reliably.

## Extensions examined

GitHub stars are a rough interest signal, not installed-user counts. These are leading relevant repositories found through public search, not an exhaustive ranking of the ecosystem. Counts and source revisions are recorded in `.artifacts/ui-research/repositories.json`.

| Extension | Stars | Pattern worth borrowing |
| --- | ---: | --- |
| [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | 8,088 | A bounded dashboard widget; fewer rows at narrow widths; detailed dashboard on demand. |
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | 3,717 | Compact result rows, explicit hidden-detail hints, animated live state, Unicode-aware clipping. |
| [pi-messenger](https://github.com/nicobailon/pi-messenger) | 710 | Shared live state with change listeners; refresh clocks run only while work is active. |
| [working-activity](https://github.com/ccch1mneyyy/working-activity) | 660 | Activity-specific text and elapsed time make a working indicator informative. |
| [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) | 436 | Coalesce redraw requests and cancel pending redraws during cleanup. |
| [pi-atelier](https://github.com/michaelmjhhhh/pi-atelier) | 257 | Detail panels and explicit overlay lifetime management. Its current split-pane implementation also adapts Pi internals; that is too much compatibility surface for Jevvy's initial UI. |

Specific source evidence:

- [Autoresearch dashboard rendering](https://github.com/davebcn87/pi-autoresearch/blob/939ede8220daad440eac6bb7b6e315cc283e0a64/extensions/pi-autoresearch/index.ts#L1398): public `setWidget`, measured width, bounded row counts.
- [Subagent rendering](https://github.com/nicobailon/pi-subagents/blob/1ac7b5e2652e9571164847ac2905ab4aded92791/src/tui/render.ts): capped compact output, expand hints, grapheme-aware truncation.
- [Messenger refresh lifecycle](https://github.com/nicobailon/pi-messenger/blob/09937ed647a1b07a3b595bf75943feacb80ff123/overlay.ts#L201): start/stop progress timers according to current activity.
- [Powerline scheduler](https://github.com/nicobailon/pi-powerline-footer/blob/e365bf96d16c84066d19bac5b33c9e3bbf7eac3a/render-scheduler.ts): one pending redraw, an earlier deadline can replace it, explicit cancellation.
- [Atelier split-pane implementation](https://github.com/michaelmjhhhh/pi-atelier/blob/ede825e152e7356d780de647f91cc1c2ccf9bb60/src/split-pane.ts): minimum main-pane width plus adapters for host rendering/layout.
- [Pi's public extension API](https://pi.dev/docs/latest/extensions): `setWidget`, custom tool/message renderers, and expandable result rendering. The installed 0.86.1 documentation was used to build this experiment.

The prototype reimplements patterns; it copies no third-party source. Four repositories have GitHub-detected MIT licenses. Messenger and Powerline declare MIT in package metadata, but GitHub did not identify a license file. Check the actual license text before any future code transplant.

## Local experiment

`scripts/ui-lab/extension.js` is an opt-in extension around the existing scan engine. It is not registered in Jevvy's package and does not change the shipped extension. `panel.js` contains the small renderer; `panel.test.js` exercises layout and lifecycle behavior.

The experiment uses a real Pi process in a PTY. A local xterm viewer renders its actual terminal byte stream for screenshots. These are terminal captures, not mockups. The viewer is read-only over HTTP; test commands enter through a local control file.

The panel uses three or four lines: activity and elapsed time, scope when space permits, measured packet progress, and cancellation. Before a total is known, it shows active requests. It never estimates a percentage or ETA. Packet completion means processing has finished, not that an answer succeeded.

Completion removes the live widget and leaves a compact transcript card with explicit answer/error/cancellation counts. Pi's expand action shows the existing evidence report. That report remains in message content for the model; visual compression does not remove evidence from model context. The report is still paginated: expansion is not a substitute for retrieving later result pages.

### Observed runs

| Scenario | Result |
| --- | --- |
| Live TypeScript fixture | 8 comments, 112 answers, no errors, 2.7 seconds. |
| Live five-file fixture | 14 comments, 196 answers, no errors, 2.9 seconds. |
| Live larger fixture | 40 comments, 560 answers, no errors: 5.4 and 4.3 seconds; final fresh-process run 5.2 seconds. |
| Mixed transport | One real successful request and seven injected failures: 14 answers, 98 errors, visibly partial. |
| All requests fail | Injected transport errors: 0 answers, 112 errors. Engine status is currently `partial`. |
| Cancel a stalled transport | 112 cancelled labels; live widget removed; no continuing redraw timer. Stall was injected, not a measured provider outage. |
| Start a new Pi session during a stall | Old work cancelled and persisted; no late result card or widget in the new session. |
| Resize the actual terminal | 100 → 40 → 100 columns. At 40 columns, cancellation remains visible. |
| Type during a stall | Draft text stayed visible and editable while the spinner updated. |
| Expand results | Pi's expand shortcut revealed source references, probabilities, limitations, and the pagination cursor. |

Each live run used separate storage and reported zero cached packets. Timings are individual observations, not performance estimates.

Six focused tests pass: ANSI/Unicode width constraints across 1–160 columns; unknown progress totals; terminal-control sanitization; cancellation and timer cleanup; session-switch retirement; and headless errors with distinct compact/expanded output. The 1-column checks prove bounded rendering, not usability at that width.

Powerline's original redraw scheduler also passed a direct local experiment: 1,000 scheduled requests produced one redraw; cancellation prevented a pending redraw; an urgent update replaced a later deadline without a duplicate. Two upstream editor-profiler tests passed. Entire upstream extensions were not installed and tested as an integration suite.

Jevvy's existing check command also passed: typecheck, 60 tests, and build.

### Findings to carry into implementation

1. Emit structured progress events from the engine: capture, extraction, plan ready, packet started/finished, persistence, and terminal result. Include run ID, total, active, successful, failed, cancelled, and cached counts. The prototype parses existing progress strings and only learns the total after the first completion; production should not depend on string parsing.
2. Share a presentation state between slash-command widgets and tool `renderCall`/`renderResult`. The experiment covers the slash-command path; tool rendering still needs integration work.
3. Keep the default result to a few lines. Show scope, coverage and exceptions first. Put distributions, definitions, frozen context and pagination in expansion or an explicit detail view. Do not invent an overall quality score or call model confidence verified accuracy.
4. Mount one component per run. Batch event-driven redraws, keep animation modest, and offer a static setting. Clear timers, subscriptions and widgets on completion, cancellation, reload, session switch and shutdown. Late callbacks must not update a new session.
5. Prefer theme roles and ordinary terminal glyphs. Measure display width, handle combining marks and emoji, sanitize source-controlled display strings, and retain essential actions at narrow widths. Coexist with the user's footer instead of replacing it.
6. Make zero-answer failure visually explicit even if the bundle currently says `partial`. Keep mixed results and cancelled work distinguishable from successful completion.

Two prototype issues were found during use: the first narrow layout dropped its cancel hint, and shortcut hints lost their key text after the test-only TUI dependency was installed beside the extension. The layout now prioritizes cancellation. Hint rendering uses the public key text directly with a descriptive empty-binding case. Removing the test dependency link and starting a fresh Pi process restored `ctrl+o`; the final screenshots verify that state. Keep the test dependency isolated and use Pi's host-provided TUI in the extension.

## Reproduce

Build Jevvy, then load only the opt-in experiment:

```sh
pnpm run build
node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js --no-extensions -e ./scripts/ui-lab/extension.js
```

Inside Pi, use `/ui-lab live`, `/ui-lab partial`, `/ui-lab error`, `/ui-lab stall`, `/ui-lab cancel`, or `/ui-lab static`. `live` and `partial` need `TYPESAFE_API_KEY`; `partial` makes one real request. Extra file paths may follow the mode. The static command toggles spinner refresh during a run. Runs persist under `.artifacts/ui-research/runs`.

For the focused Node tests, install the matching TUI package locally to the experiment; Pi normally supplies it while loading extensions:

```sh
mkdir -p .artifacts/ui-research/runtime
printf '{"private":true}\n' > .artifacts/ui-research/runtime/package.json
pnpm --dir .artifacts/ui-research/runtime add --ignore-scripts @earendil-works/pi-tui@0.86.1
ln -s ../../.artifacts/ui-research/runtime/node_modules scripts/ui-lab/node_modules
node --test scripts/ui-lab/panel.test.js
unlink scripts/ui-lab/node_modules
```

Evidence is under `.artifacts/ui-research`: `events.jsonl`, `results.json`, `prototype-tests.log`, `check.log`, terminal captures, screenshots, and `discovery.json`. Provider credentials are not recorded.

Remaining coverage: interactive Linux/tmux/SSH terminals, light themes, remapped shortcuts, screen-reader behavior, concurrent tool and slash-command runs, and coexistence with actual third-party footer/sidebar extensions. Production event and renderer integration is not implemented by this exploration.
