# jevvy

jevvy is a [Pi](https://github.com/badlogic/pi-mono) extension for improving the
quality of generated code. It uses [Jev](https://docs.typesafe.ai/) to answer
defined questions about source code and gives Pi the results alongside the
source used to assess it. Pi uses that evidence to decide what to improve;
Jevvy's analysis leaves source files unchanged.

Analysis is organised into **packs**. Each pack defines what to select, which
context to include, what questions to ask and how to present the answers. The
first pack reviews code comments. Further packs will extend the same workflow
to functions and tests.

![The comments pack extracts comments and local context, sends fixed questions to Jev, validates the answers and saves results for Pi.](docs/images/how-it-works.svg)

## Packs

| Pack | Status | Focus |
| --- | --- | --- |
| Comments | Available | What comments explain, how clearly they communicate and whether nearby code supports their claims. |
| Functions | Planned | Local behaviour such as I/O, state mutation, authorisation and retries. |
| Tests | Planned | The scenarios tests describe and the assertions they make. |

Functions and tests are outlined in the [product sheet](docs/jevvy-product-sheet.md#deferred-expansion);
their assessment questions are still to be defined. The commands below use the
comments pack.

## Install

Requires Node ≥22.19 and Git on macOS or Linux, ARM64 or x64. The checkout
installs Pi 0.86.1 and the matching TypeBox version. See the
[tested environments](docs/verification.md#platform-and-host) for platform coverage.

```sh
git clone https://github.com/timbrinded/jevvy.git
cd jevvy
npm ci
npm run build
npm exec -- pi -e ./dist/extension.js
```

In Pi, try the included fixture:

```text
/jevvy comments --files fixtures/comments.ts --dry-run
```

A dry-run lists selected comments without making inference calls or requiring an
API key. Use `/jevvy results <bundle-id> --view units` for the exact planned
requests, and `--view context` for their source code.

For live analysis, set `TYPESAFE_API_KEY` in your shell before launching Pi,
then run the same command without `--dry-run`. Requests use your TypeSafe
account; the key is never saved in a bundle or configuration file.

To use the extension in another project, run its Pi binary from that directory:

```sh
cd /path/to/your/project
/path/to/jevvy/node_modules/.bin/pi -e /path/to/jevvy/dist/extension.js
```

Replace these paths with your local directories. File paths are relative to
Pi's working directory; Git scans use its repository.

## Scan comments

| Scope | Command | What is scanned |
| --- | --- | --- |
| Files | `/jevvy comments --files src/example.ts src/other.ts` | All eligible comments in the named files. |
| Working tree | `/jevvy comments --working` | Changes from HEAD, including non-ignored untracked files. |
| Branch | `/jevvy comments --base origin/master --head HEAD` | Changes from the base/head merge-base to head. Substitute your own base branch. |

Add `--dry-run` to any scan. A branch with no changes relative to its base has
no comments to review.

Diff scans select whole comments. They include unchanged comments attached to
changed code: a promise to return `undefined`, for instance, may become wrong
when the implementation starts throwing. Removed comments are listed separately.
Working files are captured one at a time; a scan is not an atomic snapshot of
the entire working tree.

Supported syntax includes TypeScript/TSX comments and JSDoc, Rust comments and
literal doc attributes, Python comments and docstrings, and Solidity comments
and NatSpec. Strings that merely look like comments are ignored. Recognised licences and
machine directives are listed but excluded from prose assessment. Rust macros
and inherited Solidity documentation are not expanded.

## Comment assessments

Each selected comment has a result or an explicit status for 14 fixed questions:

| Group | What Jev assesses |
| --- | --- |
| Purpose | API documentation, behaviour, rationale, non-obvious behaviour, workarounds, constraints, pitfalls and follow-up work |
| Quality | Clarity, specificity, reader value, repetition of visible code and ambiguity |
| Consistency | Whether a comment's claim is supported, contradicted or undecidable from the supplied code, or the comment has no claim to check |

A comment can serve several purposes, regardless of its syntax. Reader value
assumes the claims are true; consistency checks their support in the supplied
code. A useful comment can therefore also be wrong.

Jev returns yes/no proposition probabilities (`Noul`), distributions across
named outcomes (`Choice`), and scores over described levels from 0 to 3
(`Score`). These are model estimates, including the reported confidence.
`insufficient_evidence` means Jev could not settle a claim from the supplied
code; it is a valid answer, not a failed request.

## Results

During a scan, a panel above the editor shows the current stage, packet progress,
and elapsed time. You can keep typing or use `/jevvy cancel`. The result card
shows coverage and errors; Pi's expand-tool-output action opens the report page
(Ctrl+O with the default keybindings).

Use `/jevvy inspect <bundle-id>` to browse the saved evidence. Left and right
change pages, up and down scroll, and Tab switches between comments, the selected
comment's frozen source, and question definitions. The inspector makes no API
requests. Escape closes it, or use your configured Pi cancel key.

A scan returns comment excerpts, source locations, label values, consistency
probabilities and coverage counts. Supporting code and full comments are saved
in the bundle and available through retrieval:

```text
/jevvy results <bundle-id>
/jevvy results <bundle-id> --view units --limit 5
/jevvy results <bundle-id> --view units --limit 5 --cursor <cursor>
/jevvy results <bundle-id> --view context --ids <context-id>
/jevvy results <bundle-id> --view units --labels reader_value --sort reader_value --direction asc
/jevvy results <bundle-id> --view units --labels local_consistency --sort local_consistency --outcome contradicted --include-context --include-definitions
```

The default results view explains the questions and score criteria. `units`
shows comments with full answer distributions; `context` shows the saved code.
Each page reports its selection, order, count, total and next cursor. Keep the
same query options, including page size, when following a cursor. Comments appear
in source order unless you choose a sort. Use `--direction asc` or `desc`;
missing measurements remain last. For Choice labels, `--outcome contradicted`
sorts that outcome's probability. Without an outcome, Choice sorting uses the
winning option's probability and labels that ordering explicitly.

Use `--labels` to retrieve only the measurements you need. `--include-context`
adds the comments' saved source, with shared excerpts shown once per page;
`--include-definitions` adds the selected rubrics. Coverage and unsuccessful
label statuses remain visible. These options also exist as `labels`, `direction`,
`outcome`, `includeContext` and `includeDefinitions` on `jevvy_results`.

Pi can invoke the same scans and retrieval through `jevvy_comments` and
`jevvy_results`. Commands and tools share the engine and schemas. Tool content
contains the report Pi reads; tool metadata contains the saved bundle reference.
Pi supplies the interpretation. The report itself contains no generated
explanations or combined review score.

Each scan saves a new, immutable JSON bundle, including scans that reuse cached
answers. It contains the original source, shared code excerpts, questions,
answers, request mappings, model versions, usage and coverage. Source hashes and
excerpts are checked on save and load. See the [sample report](examples/jevvy-results.example.md)
and [bundle](examples/jevvy-results.example.json), which use synthetic values.

Failed, missing and cancelled answers have explicit statuses rather than numeric
scores. Command scans run in the background so `/jevvy cancel` can stop them.
It keeps completed answers; those
answers also survive failures in other requests. If a parser error, ambiguous
attachment or size limit leaves context incomplete, questions requiring complete
code context are skipped. Questions about wording can still run. The questions
and report mark source text as untrusted input, including instructions embedded
in comments.

## Data and settings

Selected comments and their context go to the TypeSafe API. A context can include
an entire small file. The report and any retrieved code enter Pi's model
conversation. Full captured files are also stored locally in the bundle, so old
results retain the source as it was when scanned.

The API endpoint is fixed; `TYPESAFE_BASE_URL` does not override it. Local bundles
and cached answers use private filesystem permissions in `~/.cache/jevvy`.
`JEVVY_STORAGE_DIR` changes that directory; keep it outside tracked project files.
Saving a new bundle removes bundles and cached answers older than the retention
cutoff, which defaults to 30 days. Reading saved results needs no API key.

Set `JEVVY_ANIMATION=0` before starting Pi for a static progress indicator.
Progress still updates as work proceeds. Jevvy leaves the configured footer
in place.

Set `JEVVY_CONFIG` to a JSON object to override these defaults:

| Setting | Default |
| --- | --- |
| `model` | `jev-1.13.0` |
| `requestConcurrency` / `parseConcurrency` | `3` / `2` |
| `maxContextChars` | `12000` |
| `maxRequestBytes` | `64000` |
| `requestTimeoutMs` / `runTimeoutMs` | `30000` / `300000` |
| `maxRetries` | `2`, handled by the SDK |
| `retentionDays` | `30` |
| `storageDir` | `JEVVY_STORAGE_DIR` or `~/.cache/jevvy` |

Cached answers are validated before reuse and must match the exact request,
pinned model, question definitions and parser versions. Invalid responses are
not cached as successes. Choosing `jev-latest` or `jev-preview` disables cache reuse because the
model behind an alias can change. Each result records the resolved version.

## Development

```sh
npm run check                          # Typecheck, tests and build
node scripts/pi-check.mjs              # Pi commands, tools and reload
node scripts/pi-check.mjs --live        # Live Jev calls through Pi
node --import tsx scripts/live-check.ts # Direct live SDK check
node --import tsx scripts/evaluate-handoff.ts # Controlled live request/rubric comparison
```

Ordinary tests use fixture responses and make no paid API calls. Live checks use
`TYPESAFE_API_KEY` and write their records to ignored `.artifacts/`.

The [verification record](docs/verification.md) covers automated tests, platform
checks and live inference. The [UI verification](docs/ui-verification.md) records
live Pi sessions, Linux tmux, resizing, cancellation and footer coexistence.
The [exploratory retest](docs/exploratory-retest.md)
records the interactive cancellation and extraction repairs, repeated model
results, and remaining calibration limits. x64 checks used emulation; Linux
checks used glibc containers.

In the latest [16-comment comparison](docs/handoff-verification.md), reviews with
and without jevvy made the same consistency classifications. The assisted review
cited source lines more accurately and used more model context. Selecting one
label reduced the retrieved evidence text by 58%. These small fixtures do not
establish better review accuracy or lower cost on larger projects.

The [JSON Schema](schemas/comments-bundle-1.1.0.json) is generated from
[TypeBox definitions](src/contracts.ts). See [bundle invariants](docs/contracts.md)
for the checks between fields and requests, and the rounding tolerance used for
Jev's answers. Version 1.0.0 bundles remain readable under their original request rules.
