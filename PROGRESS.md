# Implementation evidence

The agreed scope is the revision 3 product sheet, macOS and Linux, latest stable Pi, all four languages, and live Jev evaluation. No publication or release ceremony is required.

## Milestones

- [x] 1. Pi compatibility and native parser feasibility on macOS and Linux.
- [x] 2. TypeBox contracts, semantic validation, synthetic bundle and renderer.
- [x] 3. TypeScript/TSX explicit-file dry-run with complete request inspection.
- [x] 4. Live Jev execution and measured rounding tolerances.
- [x] 5. Git scopes and Rust, Python and Solidity coverage.
- [x] 6. Pi commands/tools, lifecycle, caching, persistence and pagination.
- [x] 7. Clean installs, real Pi workflows, comparative evaluation and repairs.

## Observed baseline

- Published Pi 0.86.1 declares TypeBox 1.3.27 and Node >=22.19.0.
- NAPI 0.45.3, Python grammar 0.0.6, Rust grammar 0.0.7, TypeSafe SDK 0.6.0.
- No published `@ast-grep/lang-solidity` package; Solidity needs packaged native assets.
- Earlier direct API checks authenticated successfully against `jev-1.13.0`. A returned Score differed by 0.01 from the expectation computed from rounded probabilities; validation must handle documented precision rather than require machine-epsilon equality.
- Native macOS ARM64, macOS x64 under Rosetta, Linux ARM64 and emulated Linux x64 production installs confirmed. Linux checks used Debian glibc containers.

See [verification](docs/verification.md) for requirement evidence, 53 passing tests,
real Pi/live API checks and explicit platform limits. See
[evaluation](docs/evaluation.md) for the paired review: equal consistency accuracy
on the small fixture, better source-line accuracy with jevvy, and greater time
and context consumption. No publication, announcement or release gate is included.
