# Verification evidence

Checked on 21 September 2026 against the revision 3 product sheet. Milestones
1–7 are implemented and verified to the bounds below. This is a record of
working behaviour, not a publication or release approval process.

## Platform and host

Pi 0.86.1 and TypeBox 1.3.27 are pinned. Production installs use the packed
archive in an empty temporary npm project with `--omit=dev`, then exercise the
registered Pi tools, command, frozen context retrieval and session reload.

| Environment | Node | Full suite, typecheck and build | Clean production install and Pi tools |
| --- | --- | --- | --- |
| macOS ARM64, native | 25.2.0 | 53 tests passed | Passed |
| macOS x64, Rosetta | 24.21.0 | Not rerun on this architecture | Passed |
| Linux ARM64, Debian bookworm container | 24.21.0 | 53 tests passed | Passed |
| Linux x64, emulated Debian bookworm container | 24.21.0 | 53 tests passed | Passed |

Each production smoke test parses TypeScript, TSX, Python, Rust and Solidity.
The reload assertion obtains a new tool instance after `session.reload()` and
parses Solidity again. Tests use Pi's real SDK/session runtime. The paired model
review also invokes the registered tools through Pi. Interactive terminal layout
has not been visually assessed. Linux results cover glibc; musl and other Linux
distributions were not tested. x64 checks use emulation, not physical Intel hosts.
Node 22.19 is the dependency minimum, not an additional tested runtime.

## Requirements checked

| Milestone | Evidence |
| --- | --- |
| 1. Host and parser feasibility | Pinned Pi/TypeBox integration; all four packaged native platform variants loaded; explicit process-wide grammar conflict test. |
| 2. Results contract | Compiled, noncoercive TypeBox checks; malformed/misrouted answers, wrong primitives, exact option/legend sets, rounded distributions, reference and coverage integrity; JSON Schema roundtrip; synthetic 28-answer example and rendered snapshot. |
| 3. TypeScript dry-run | Full-file AST extraction; TSX, wrappers, Unicode, CRLF and BOM; ownership and shared context; exact planned request JSON with no inference. |
| 4. Live Jev | Real authenticated SDK and Pi-tool requests to pinned Jev 1.13.0; 196 successful labels in each final five-file run; no error or cancelled labels. |
| 5. Scopes and languages | Merge-base/head and working snapshots; nonignored untracked files, renames, removed comments, deletion-only changes, unchanged prose on changed code; forced edit-during-capture failure; Rust nested/docs/attributes, Python genuine docstrings/decorators/async, Solidity NatSpec/modifiers. |
| 6. Operational behaviour | Shared command/tool engine; immutable persisted bundles validated on load; cache reuse/invalidation; bounded parallelism; SDK-owned retry test; deadline and cancellation with retained results; request/context budgets; pagination, sorting and stale-source detection. |
| 7. End-to-end verification | Real Pi commands/tools, fresh-session reload, clean packed installs, live API calls and the measured source-only versus assisted review in `evaluation.md`. |

Parser recovery and oversized or ambiguous ownership produce explicit gaps.
Code-relative labels require complete local evidence. These tests verify those
boundaries rather than claim cross-file understanding, macro expansion or
inherited documentation resolution.

## Live evidence

The retained direct SDK run is
`bundle_e636f415-4e18-405c-9f12-3ba98c0b4f16`: five parsed files, 14 selected
comments, one excluded directive, 196 successful labels, no cache hits, no
diagnostics, requested and resolved model `jev-1.13.0`. Capture through completion
took 1.836 seconds. Its frozen bundle is in the ignored local artifacts directory.

The final Pi live smoke run is
`bundle_e067b512-bd46-4668-b068-1089e87e0a0e`: the same coverage and 196 successful
labels, no cache hits. The script asserts completed status and the exact expected
counts, so a successful tool invocation with incomplete labels cannot pass. Its
temporary storage is removed after verification; the assertion log is retained.
Credentials are read from the environment and are neither printed nor stored.

The paired review found the same eight consistency classifications in both arms.
jevvy improved source-line accuracy on that example but increased elapsed time
and model context. See `evaluation.md` for the actual measurements and limits.

## Reproduce

From the checkout:

```sh
npm ci
npm run check
node scripts/pi-check.mjs
node scripts/pi-check.mjs --live
node --import tsx scripts/live-check.ts
npm pack --pack-destination .artifacts
node scripts/clean-install.mjs
```

Live commands require `TYPESAFE_API_KEY`. The comparison additionally requires
the Gemini credential and uses `node scripts/compare-reviews.mjs`. Normal tests
use fixture transport and do not spend API credits.

Local evidence lives under ignored `.artifacts/`: `macos-final-check.log`,
`linux-arm64-final.log`, `linux-x64-final.log`, `clean-macos-*-final.log`,
`clean-linux-*-final.log`, `pi-live-final.log`, `latest-live.json`, and
`comparison/summary.json`. Reproduction scripts are development files in the
checkout, not runtime dependencies of the packed extension.
