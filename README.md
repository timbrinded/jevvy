# jevvy

jevvy is a [Pi](https://github.com/earendil-works/pi) extension that uses
[Jev](https://docs.typesafe.ai/) to review code comments. It assesses what comments
explain, how clearly they communicate, and whether nearby code supports their
claims. Pi receives the results with their source evidence and decides what to
improve. Jevvy scans leave source files unchanged.

The comments pack supports TypeScript/TSX, Rust, Python and Solidity, including
documentation comments and Python docstrings.

![Comments and local code are sent to Jev for assessment, then saved as source-linked results for Pi.](docs/images/how-it-works.svg)

## Install

Requires Pi, Node 26 and Git on macOS or Linux, ARM64 or x64.
See [tested environments](docs/verification.md#platform-and-host) for platform coverage.

```sh
pi install git:github.com/timbrinded/jevvy
cd /path/to/your/project
pi
```

Restart an existing Pi session after installation. Add `-l` to the install
command to install only for the current project.

In Pi, preview the comments affected by your working changes:

```text
/jevvy comments --working --dry-run
```

A dry-run shows the selected comments and planned requests without API calls or
an API key. For live analysis, set `TYPESAFE_API_KEY` in your shell before
starting Pi, then omit `--dry-run`. Requests use your TypeSafe account.

## Scan comments

| Scope | Command |
| --- | --- |
| Named files | `/jevvy comments --files src/example.ts src/other.ts` |
| Working changes | `/jevvy comments --working` |
| Branch changes | `/jevvy comments --base origin/master --head HEAD` |

File paths are relative to Pi's working directory. Working scans compare against
HEAD and include non-ignored untracked files. Branch scans compare the base/head
merge-base with head; replace `origin/master` with your base branch.

Diff scans include unchanged comments attached to changed code. A clean working
tree has no changes to review; use `--files` to scan existing files. Add
`--dry-run` to any scan to preview it, or use `/jevvy cancel` to stop a running scan.

## Read results

Each scan saves a **bundle** containing the assessments and the source used to
make them. The result card shows coverage, errors and the bundle ID. Completed
answers remain available after cancellation or failures in other requests.

Open the inspector to browse comments, saved source and question definitions:

```text
/jevvy inspect <bundle-id>
```

Left and right change pages, up and down scroll, and Tab switches views. Escape
or your configured Pi cancel key closes the inspector.

Retrieve an overview or a page of comments:

```text
/jevvy results <bundle-id>
/jevvy results <bundle-id> --view units --limit 5
```

Pi can also scan and retrieve results through the `jevvy_comments` and
`jevvy_results` tools. Reading saved results makes no API calls. See the
[sample report](examples/jevvy-results.example.md) for the output format; its
values are synthetic.

## Data and settings

Live scans send selected comments and their code context to TypeSafe. Context
can include an entire small file. Reports and retrieved code enter Pi's model
conversation. Bundles store full captured files locally so results retain the
source as it was when scanned.

Bundles and cached answers are stored in `~/.cache/jevvy`. Set `JEVVY_STORAGE_DIR`
to change this location; keep it outside tracked project files. Saving a new
bundle removes results and cached answers older than 30 days by default.

For other settings, set `JEVVY_CONFIG` to a JSON object that overrides the
[configuration defaults](src/config.ts).

## Development

Use the Node version in [.node-version](.node-version) and the pnpm version in
[package.json](package.json). TypeScript 7 checks types and builds the library;
Node runs the tests directly.

```sh
git clone https://github.com/timbrinded/jevvy.git
cd jevvy
pnpm install --frozen-lockfile
pnpm run check
pnpm run smoke
pnpm exec pi install .
```

`check` runs formatting, lint, typecheck, tests and build. `smoke` checks Pi
integration. Neither makes paid API calls. Use `pnpm run smoke:live` with
`TYPESAFE_API_KEY` for a live check.

The last command registers the checkout as a local Pi package. Restart Pi after
source edits.

- [Verification](docs/verification.md): test coverage and detailed checks.
- [Bundle contract](docs/contracts.md): schemas, validation and retrieval rules.
