# Pi package and npm releases

Jevvy is one npm package containing one Pi extension. `package.json` is the
manifest for both. No separate Pi manifest or registry submission is required:
Pi's package gallery discovers npm packages with the `pi-package` keyword.
See the [official Pi package guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).

## Release identity and license

The first regular version is `jevvy@0.1.0`. Check npm and GitHub Releases for
publication status. Do not reuse the removed `0.1.0-alpha.0` and
`0.1.0-alpha.1` versions.

Jevvy uses [Apache-2.0](../LICENSE), also declared in `package.json`.
Retain the separate notices for the vendored Solidity grammar in
`native/solidity/LICENSE` and the adapted Codesavers material in
[the pack documentation](packs.md#source-and-license).

Before publishing, verify npm authentication, merge the release preparation,
run package CI and verify the archive. After the first publication, configure
npm trusted publishing for later versions.

## Manifest and package contents

| Field | Purpose |
| --- | --- |
| `name`, `version` | npm identity, currently `jevvy@0.1.0`. |
| `keywords: ["pi-package", ...]` | Pi gallery discovery. |
| `pi.extensions: ["./src/extension.ts"]` | Pi's extension entry point, included in the archive and Git checkout. |
| `description`, `homepage`, `repository`, `bugs` | Public package description and support links. |
| `files` | Explicit archive contents: source, built library, native grammars, schemas, examples and documentation. |
| `exports` | Built JavaScript library entry points. These are separate from Pi's source entry point. |
| `dependencies` | Runtime parsers and TypeSafe SDK. |
| `peerDependencies` | Pi host packages and TypeBox, with the wildcard ranges specified by Pi. |
| `engines`, `os`, `cpu`, `libc` | Node 26, macOS or glibc Linux, ARM64 or x64. |
| `publishConfig` | Public access on `https://registry.npmjs.org/`. |

The [npm manifest reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
defines the npm fields. The platform declarations match the shipped native parser
assets and tested Linux libc. Windows, other architectures and musl Linux are
outside this release's support boundary.

Keep the TypeScript source entry point: it lets Pi install directly from Git
without a compiler or an existing `dist/` directory. `prepack` builds the library
exports for npm archives. Do not add an install-time build or bundle Pi itself.

The gallery also accepts optional `pi.image` (PNG, JPEG, GIF or WebP) and
`pi.video` (MP4) URLs. A real inspector screenshot or short demo can be added
later. The existing SVG diagram is useful in the README, but is not a supported
gallery preview format. See [Pi's gallery metadata rules](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#gallery-metadata).

## Build and check the release archive

Use the Node version in `.node-version` and the pnpm version in `package.json`.
If using nvm, `nvm use` selects the installed project version.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run smoke
pnpm run pack:release
pnpm run check:package
node scripts/clean-install.mjs --source
npm publish .artifacts/jevvy.tgz --dry-run --ignore-scripts
```

`pack:release` writes `.artifacts/jevvy.tgz`. `check:package` installs that archive
with npm and production dependencies, leaving Pi peers to the separate host.
It checks real Pi manifest discovery, all parsers, both tools, the slash command,
saved results, reload, installation and removal. The source-only check verifies
Git-style distribution without built output or a TypeScript compiler. These
checks make no paid API calls.

Inspect the archive listing from npm's dry-run. It must contain the manifest,
extension source, built exports, all bundle schemas, all four native Solidity
assets and the project and vendored licenses. Local caches, credentials,
`node_modules`, research and test artifacts must be absent.

The `Package and publish` workflow runs checks on pull requests and pushes to
`master`. It builds one archive, then checks clean installations on Linux and
macOS using that same archive. A manual run also validates without publishing
unless its `publish` input is explicitly enabled. These jobs are configured;
their first GitHub run must pass before their platform results can be claimed.

## First publication

Commit and merge the release files first. Use a clean checkout of the release
commit and complete the checks above. Confirm the intended name and version
with `npm view jevvy versions --json`; an unpublished package can return E404.

Authenticate interactively with the intended npm account. Do not add a token
to this repository or paste it into a release log.

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish .artifacts/jevvy.tgz --access public --tag latest --ignore-scripts
npm view jevvy@0.1.0 version dist.integrity --json
```

This is the real publication command. Complete npm's account/2FA prompt when
required. If name ownership blocks publication, resolve it with npm or use an
account-scoped name; do not assume the unpublished name is available.

After registry verification, tag the exact tested commit `v0.1.0` and create
its GitHub release. Neither action publishes through the prepared workflow;
publication is a separate manual workflow action. This prevents a second
publication attempt after the initial local bootstrap.

The first local publication does not carry GitHub build provenance. Subsequent
OIDC releases do. Trusted publisher configuration is package-level; use the
package's Settings page after this first publication.

## Set up trusted publishing once

In the npm package settings, add this GitHub Actions trusted publisher:

| Setting | Value |
| --- | --- |
| Organization or user | `timbrinded` |
| Repository | `jevvy` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty; this workflow has no GitHub environment. |
| Allowed action | Enable direct `npm publish`. |

The workflow uses a GitHub-hosted runner with `id-token: write`. It publishes
the archive that passed installation checks, with provenance and no long-lived
`NPM_TOKEN`. The pinned Node version includes a suitable npm CLI; npm requires
11.5.1 or later for trusted publishing. See [npm's setup guide](https://docs.npmjs.com/trusted-publishers/).

## Later versions

1. Update `package.json` to an unused version, record the changes in the GitHub
   release notes, and merge after CI passes.
2. Tag the merged commit `v<version>` and push the tag.
3. Run the release workflow for that tag with publication enabled. For example:

   ```sh
   gh workflow run publish.yml --ref v0.1.1 -f publish=true
   ```

4. Wait for the package, installation and publication jobs to finish. Verify
   the version, integrity and dist-tag in npm, then publish the GitHub release.
5. Test `pi install npm:jevvy@<version>` in a clean Pi environment.

The workflow rejects branch-based publication and tags that do not match
`package.json`. Versions containing a prerelease suffix publish under `next`;
regular versions publish under `latest`. A published version cannot be overwritten:
fix the issue and publish a new version.

After publication, the default user install command becomes:

```sh
pi install npm:jevvy
```

Users can pin a version with `pi install npm:jevvy@0.1.0`, try it with
`pi -e npm:jevvy`, or update an unpinned install with `pi update npm:jevvy`.
Check [the Pi gallery](https://pi.dev/packages) after npm indexing; adding the
keyword does not prove that the gallery has refreshed yet.
