# jevvy

jevvy gives Pi a repeatable comments-analysis workflow: capture source, extract
comments and local context, ask fixed Jev questions, validate the answers, and
return a source-linked results bundle. Pi interprets the evidence. jevvy does
not rewrite source or generate a review verdict.

## Use with Pi

Requires Node >=22.19, Git, and **Pi 0.86.1** (the latest stable version checked
for this implementation). Native parser assets are supplied for macOS and Linux,
ARM64 and x64. See `docs/verification.md` for the actual tested combinations.

From this checkout:

```sh
npm ci
npm run build
npm exec -- pi -e ./dist/extension.js
```

Set `TYPESAFE_API_KEY` in the process environment before running live scans.
Dry-runs and reading retained results require no key. No API key is stored in a
bundle or configuration file.

```text
/jevvy comments --files src/session.ts src/client.ts --dry-run
/jevvy comments --working
/jevvy comments --base origin/main --head HEAD
/jevvy results <bundle-id>
/jevvy results <bundle-id> --view units --limit 5
/jevvy results <bundle-id> --view context --ids <context-id>
/jevvy cancel
```

The agent tools are `jevvy_comments` and `jevvy_results`. Commands and tools use
the same engine and schemas. Results show their returned count, total and cursor;
pass that cursor to retrieve the next page. `--sort <label-id>` explicitly sorts
unit results by a named label while retaining all units. Missing values sort last.

File mode analyses eligible comments in explicitly selected files. Branch mode
uses the resolved base/head merge-base and head blobs. Working mode compares HEAD
against captured working files, including non-ignored untracked files. Working
captures are consistent per file, not globally atomic across the repository.

Supported languages: TypeScript, TSX, Rust, Python and Solidity. Comment-looking
strings are excluded; Python docstrings and literal Rust doc attributes are
recognised. Macros and inherited Solidity documentation are not expanded.

## Results and limits

The canonical output is a versioned immutable JSON bundle. It contains fixed
label definitions, native probability distributions, exact source/context,
request manifests, model versions, usage, exclusions and explicit failure states.
Frozen source files are retained in the bundle so excerpts and source hashes can
be validated again on load; shared contexts are stored once. Only selected
comment/context packets are sent to Jev, not the entire captured files.

The 14 dimensions cover purpose, clarity, specificity, reader value, ambiguity,
restatement and local consistency. Value assumes claims are true; consistency
assesses the separate question of local support. `insufficient_evidence` is a
successful semantic answer. An error is never converted to zero or uncertainty.

Dry-run pages include the exact planned request JSON. Live pages contain compact
comment cards; overview supplies the complete question/rubric legend, and context
views retrieve the unchanged supporting source. Output omissions and pagination
are explicit. No model-authored explanation is invented from a numeric answer.

Unresolved attachment, parser recovery or oversized context prevents labels
requiring complete local evidence from running. Text-only labels can still run.
Source text is treated as evidence rather than trusted instructions, including
in the fixed Jev questions and Pi report.

## Configuration

`JEVVY_STORAGE_DIR` changes the default `~/.cache/jevvy` location. Optional
`JEVVY_CONFIG` is a JSON object overriding these settings:

| Setting | Default |
| --- | --- |
| `model` | `jev-1.13.0` |
| `requestConcurrency` / `parseConcurrency` | 3 / 2 |
| `maxContextChars` | 12000 |
| `maxRequestBytes` | 64000 |
| `requestTimeoutMs` / `runTimeoutMs` | 30000 / 300000 |
| `maxRetries` | 2, owned by the SDK |
| `retentionDays` | 30 |
| `storageDir` | `JEVVY_STORAGE_DIR` or `~/.cache/jevvy` |

The default Jev version is pinned to the model verified by live tests. An explicit
`jev-latest` override is supported but does not reuse cached evaluations, because
an alias can resolve differently between runs. Cache keys include exact request
content, model, pack definition hash and parser versions. Invalid responses are
not cached as successes. Completed results survive cancellation and other packet
failures. A fresh scan always creates a new bundle.

Retained source can contain private code. Bundles/cache use private filesystem
permissions and live outside tracked source by default. Keep the storage
directory outside the repository. The endpoint is the official TypeSafe API;
an unrelated `TYPESAFE_BASE_URL` override cannot redirect source uploads.

## Development checks

```sh
npm run check
node scripts/pi-check.mjs
node --import tsx scripts/live-check.ts
```

The normal suite uses fixtures and fake transport. The live script calls Jev and
saves its evidence under ignored `.artifacts/`. `pi-check.mjs --live` exercises
the real SDK through Pi's registered tool. No publishing is part of these checks.

The public schema is `schemas/comments-bundle-1.0.0.json`; its TypeBox source is
`src/contracts.ts`. Additional correspondence invariants and rounding tolerances
are documented in `docs/contracts.md`.
