# Pack evaluation fixtures

`cases.mjs` declares source evidence and expected outcomes before inference.
The expectations remain outside the captured scan workspace. Source names use
neutral case identifiers; verdicts are never added to source or Jev requests.

Run `node scripts/pack-check.mjs` for dry-run capture and planning. Add `--live`
for real production `scan` requests against pinned `jev-1.13.0`, or `--execute`
for the executable subset only. Results and captured requests are saved beneath
`.artifacts/pack-build/`. See the script help for case and output selection.

The files beneath `upstream/` are exact copies from timbrinded/kiln commit
`8f30541ac6b793a499a7c6d59b83982932e2a328`:

```text
plugins/unslop/skills/codesaver/evals/files/dependency-only/package.json
plugins/unslop/skills/codesaver/evals/files/dependency-only/slugify.test.js
plugins/unslop/skills/codesaver/evals/files/owned-retry/package.json
plugins/unslop/skills/codesaver/evals/files/owned-retry/retry.js
plugins/unslop/skills/codesaver/evals/files/owned-retry/retry.test.js
```

They are covered by Kiln's MIT license, Copyright (c) 2025 timbo. The full license
notice is retained in [the pack documentation](../../docs/packs.md#source-and-license).
The evaluation does not install those upstream fixture dependencies. Their
source is used as evidence; execution checks cover the locally authored subset.
