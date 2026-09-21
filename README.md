# Javi

**Comment analysis for Pi, powered by Jev.**

Javi helps a coding agent examine what a comment says, how useful it is, and
whether the nearby implementation supports its claims. It captures source,
asks Jev a fixed set of questions, and gives Pi structured answers linked to
that exact source. Pi interprets the evidence; the extension leaves source
files unchanged.

The repository is **Javi**. The extension and npm package are named **`jevvy`**,
which is also the name used by its commands, tools and environment variables.
[Pi](https://github.com/badlogic/pi-mono) is the coding-agent host;
[Jev](https://docs.typesafe.ai/) supplies the semantic and qualitative evaluations.

![Clockwise workflow: capture source, prepare comments and context, ask Jev, validate answers, retain a frozen bundle, then let Pi interpret the results.](docs/images/how-it-works.svg)

[Quick start](#quick-start) · [What it evaluates](#what-it-evaluates) ·
[Results](#read-the-results) · [Verification](docs/verification.md)

## Quick start

Requires **Node ≥22.19**, **Git**, and macOS or Linux on ARM64 or x64.
This checkout installs the tested **Pi 0.86.1** and its matching TypeBox version.
The [verification record](docs/verification.md) lists the actual tested runtimes,
including the emulated x64 checks and Linux glibc coverage.

```sh
git clone https://github.com/timbrinded/Javi.git
cd Javi
npm ci
npm run build
npm exec -- pi -e ./dist/extension.js
```

Inside Pi, start with the included fixture. A dry-run needs no API key and shows
exactly which comments, context and questions would be submitted:

```text
/jevvy comments --files fixtures/comments.ts --dry-run
```

For a live scan, set `TYPESAFE_API_KEY` in the shell environment **before launching
Pi**, then omit `--dry-run`:

```text
/jevvy comments --files fixtures/comments.ts
```

The scan returns comment cards, coverage counts and a bundle ID for retrieving
the full results. Live inference uses your TypeSafe account. Credentials are
read from the environment and are not saved in bundles or configuration files.

To analyse another project, launch this checkout's Pi binary from that project's
directory, supplying the absolute extension path:

```sh
cd /path/to/your/project
/path/to/Javi/node_modules/.bin/pi -e /path/to/Javi/dist/extension.js
```

Replace both paths with your local directories. File arguments resolve against
Pi's working directory; working and branch scans use that directory's repository.

## Choose what to scan

| Scope | Command | Selection |
| --- | --- | --- |
| Explicit files | `/jevvy comments --files src/example.ts src/other.ts` | All eligible comments in the named files. |
| Working changes | `/jevvy comments --working` | HEAD compared with captured working files, including non-ignored untracked files. |
| Branch changes | `/jevvy comments --base origin/master-branch --head HEAD` | The base/head merge-base compared with head. Use your repository's base branch. |

Add `--dry-run` to any scope to inspect the planned requests without inference.
Branch comparison needs changes relative to its base to produce selected comments.
Changes select whole comments, including unchanged prose attached to changed
code; removed comments are recorded separately. Captures remain consistent per
file, without claiming a globally atomic working-tree snapshot.

The language adapters recognise TypeScript/TSX comments and JSDoc, Rust comments
and literal doc attributes, Python comments and genuine docstrings, and Solidity
comments and NatSpec. They distinguish comments from comment-looking strings.
Macros and inherited Solidity documentation are not expanded. Recognised licences
and machine directives are inventoried and excluded from prose evaluation.

## What it evaluates

Each selected comment receives a state for **14 labels**, where a label is a
fixed evaluation dimension with a published question and criteria.

| Group | Dimensions |
| --- | --- |
| Purpose | API documentation, behaviour, rationale, non-obvious behaviour, workarounds, constraints, pitfalls and follow-up work |
| Quality | Writing clarity, specificity, reader value, restatement of visible code and material ambiguity |
| Consistency | Whether a checkable claim is locally supported, contradicted, undecidable from the supplied evidence, or absent |

Purpose and form are separate: a JSDoc block can document an API, explain a
workaround and warn about a pitfall at the same time. Reader value assumes the
comment's claims are true; local consistency tests the separate question of
whether the supplied implementation supports them.

Jev returns proposition probabilities (**Noul**), distributions across named
outcomes (**Choice**), or distributions over described levels from 0 to 3
(**Score**). The bundle retains these native answers. Provider confidence is not
independent proof, and `insufficient_evidence` is a valid consistency answer.

## Read the results

The initial report contains source locations, comment text, compact label values
and shared supporting code. Retrieve definitions, full native distributions or
exact frozen context using the returned bundle ID:

```text
/jevvy results <bundle-id>
/jevvy results <bundle-id> --view units --limit 5
/jevvy results <bundle-id> --view units --limit 5 --cursor <cursor>
/jevvy results <bundle-id> --view context --ids <context-id>
/jevvy results <bundle-id> --view units --sort reader_value
/jevvy cancel
```

Every page identifies its selection, order, returned count, total and continuation
cursor. Continue with the same view, selection and order. Units default to source
order; label sorting is descending and keeps missing values last.

Pi can call **`jevvy_comments`** and **`jevvy_results`** directly. These tools and
the slash commands share one engine and the same schemas. The readable report is
in the tool's model-visible content, with a persistent bundle reference in its
metadata. The renderer supplies no invented explanation or aggregate verdict.

Each scan creates an immutable, versioned JSON bundle containing definitions,
answers, source, deduplicated contexts, request manifests, model versions, usage
and coverage. Source hashes and excerpts are validated when saving and loading.
The [synthetic example](examples/jevvy-results.example.md) shows the report;
its [JSON bundle](examples/jevvy-results.example.json) shows the complete contract.

Missing, failed and cancelled evaluations remain explicit; they never become
zero scores or fabricated probabilities. Completed answers survive cancellation
and other request failures. When attachment is unresolved, parsing recovers from
an error, or context exceeds its budget, labels needing complete local evidence
are withheld while text-only labels can still run. Source text is treated as
evidence rather than trusted instructions in the questions and report.

## Data and configuration

Live requests send selected comments and their extracted context to the official
TypeSafe API. **A context can span an entire small file.** Full captured source
also remains in the local bundle so results can be checked against frozen
evidence. The compact report and retrieved context enter Pi's model conversation.
An unrelated `TYPESAFE_BASE_URL` value cannot redirect Jev requests.

Bundles and cached answers use private filesystem permissions and default to
`~/.cache/jevvy`, with 30-day retention. Use `JEVVY_STORAGE_DIR` to change that
location; keep retained source outside tracked project files.

The optional **`JEVVY_CONFIG` environment variable** contains a JSON object
whose fields override these defaults:

| Setting | Default |
| --- | --- |
| `model` | `jev-1.13.0` |
| `requestConcurrency` / `parseConcurrency` | `3` / `2` |
| `maxContextChars` | `12000` |
| `maxRequestBytes` | `64000` |
| `requestTimeoutMs` / `runTimeoutMs` | `30000` / `300000` |
| `maxRetries` | `2`, owned by the SDK |
| `retentionDays` | `30` |
| `storageDir` | `JEVVY_STORAGE_DIR` or `~/.cache/jevvy` |

Validated answers can be reused when the exact request, pinned model, pack
definition and parser versions match. Invalid responses are not cached as
successes. The explicit `jev-latest` override disables cache reuse because its
resolved model may change. Reading retained results requires no API key, and a
fresh scan always produces a new bundle even when it reuses cached answers.

## Development and evidence

```sh
npm run check                           # Typecheck, 53 fixture tests, build
node scripts/pi-check.mjs              # Real Pi tools, command and reload
node scripts/pi-check.mjs --live       # Live inference through Pi
node --import tsx scripts/live-check.ts # Direct live SDK check
```

Ordinary tests use fixture transport and spend no API credits. Live checks use
your TypeSafe credential and save evidence under ignored `.artifacts/`.

The recorded checks passed on macOS and Linux, including clean production
installs. Live runs evaluated 14 comments across all supported languages with
196 successful labels. The [verification record](docs/verification.md) gives
commands, platform limits and the behaviours checked.

In the small [paired review](docs/evaluation.md), source-only and assisted reviews
made the same eight consistency classifications. The assisted review produced
more accurate source lines but consumed more time and model context. This
supports the demonstrated workflow, not a general accuracy or speed claim.

The [public JSON Schema](schemas/comments-bundle-1.0.0.json) comes directly from
[TypeBox contracts](src/contracts.ts). Additional correspondence rules and
observed rounding tolerances are documented in [bundle invariants](docs/contracts.md).
