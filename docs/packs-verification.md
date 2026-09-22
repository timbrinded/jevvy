# Functions and Tests verification

22 September 2026, native Linux x64, Node 26.9.0, pnpm 11.26.0 and Pi 0.86.1.
This records implementation and terminal checks. The separate
[live experiment report](pack-experiments.md) records model judgments, failed
examples and rubric revisions. Neither report establishes production accuracy.

## Implementation checks

The full project check passed formatting, lint, TypeScript, all 118 tests, and
the production build. Tests cover:

- Exact AST source ranges and pack identities across supported languages.
- Test imports, aliases, shadowing, named callbacks, subtests and skipped suites.
- Full-target prerequisites, oversized evidence and parser recovery.
- Explicit implementation/manifest context, scope confinement, branch snapshots,
  cache invalidation and frozen evidence after source changes.
- Request/definition/path binding and rejection of substituted pack metadata.
- Loading schema 1.0.0 and 1.1.0 comment bundles without rewriting them.
- Fixed-pack Pi tools, commands, progress, cancellation, inspector views, outcome
  filters and query-bound pagination.

Independent review found and helped repair runner/context shadowing, nested
CommonJS binding resolution, and declaration-order handling for skipped named
suites. A related named Node callback case now retains nested subtests. These
are regression tests of actual extraction behavior.

## Real Pi checks

`scripts/pi-packs-check.mjs` loads the extension through the package manifest and
uses Pi's registered tools. Both dry and live runs verified four function units
with 24 labels and three test units with 15 labels. Live runs used Jev 1.13.0 and
returned every label without provider errors. Repeat scans used the cache.
Retrieval verified filters, full definitions, supporting source, pagination and
session reload. The original comments smoke also passed.

A separate interactive Pi instance ran in an isolated tmux server and agent
directory under `.artifacts/pack-build/`. It exercised:

| Terminal action | Observed result |
| --- | --- |
| Functions and Tests dry runs | Correct pack names, selected counts and planned labels; no answers invented. |
| Functions and Tests live scans | Completed cards with 24 and 15 answers respectively, no errors. |
| Filter a saved test result | Explicit probability/confidence filters retained the shared-calculation candidate. |
| Inspector tabs and scrolling | Test source, supporting implementation, full distributions, and rubric provenance were visible. |
| Resize from 120×40 to 80×24 | Inspector reflowed and scrolling/navigation remained usable. |
| Cancel a 20-function live scan | Saved cancelled bundle with all 120 labels cancelled; no result represented as clean. |
| `/reload` followed by another scan | New tool instance completed a live test scan. |
| Change a supporting source after a scan | Retrieval warned that `functions.ts` was stale and kept the original frozen evidence. |

After the final rubric revision, `/reload` and live scans of both packs again
completed with all 39 answers. The saved definition hashes matched the final
source: Functions `acf31269a2cf26f10ae664231a7b10b697ae451ff343d356d32f8bf977a2ea5f`
and Tests `8c999bbfe6977b5e7b904a7cd34aeb43e1cdc0ac5b6483c531ec11c0c21b3202`.

The cancellation happened before any answers completed. Retention of completed
answers when other work is cancelled is covered separately by the automated
engine tests. Terminal captures and frozen bundles remain local and ignored by
Git; no credentials were recorded in the evidence files.

## Installation

`scripts/clean-install.mjs` now runs both Pi smoke scripts. Checks cover:

- An npm archive installed with production dependencies and Pi-supplied peers.
- A source-only installation with no `dist` directory or TypeScript compiler.
- Manifest discovery, original comment parsers, both code-pack tools, retrieval,
  reload, and package removal through the real Pi CLI.

These checks cover the current Linux x64 environment. Prior platform checks in
[verification.md](verification.md) remain historical; the new packs were not
tested on macOS or ARM64 during this task. No npm publication was performed.

## Reproduce

```sh
pnpm run check
pnpm run smoke
pnpm run smoke:packs
pnpm run smoke:packs:live
node scripts/pack-check.mjs --execute --run local-execution
node scripts/pack-check.mjs --live --run local-live
pnpm pack --out .artifacts/jevvy.tgz
node scripts/clean-install.mjs .artifacts/jevvy.tgz
node scripts/clean-install.mjs --source
```

Live commands require `TYPESAFE_API_KEY` and consume API tokens. Evaluation run
names must be unique; the runner refuses to overwrite previous evidence.
Normal tests and dry Pi smoke checks make no paid API calls. See
[packs.md](packs.md) for supported registrations and inference limits.

Local logs include `.artifacts/pack-build/check-final.log`,
`pi-comments-smoke.log`, `pi-packs-dry.log`, `pi-packs-live.log`,
`clean-archive.log`, `clean-source.log`, `tmux-summary.json`, and
`tmux-*.txt`. The semantic experiment report links its separate batch outputs.
