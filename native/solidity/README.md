# Solidity native grammar

These unmodified macOS/Linux ARM64/x64 libraries are from the MIT-licensed
`tree-sitter-solidity@1.2.13` npm archive (author Joran Honig).
Archive SHA-1: `6f4c8fbf856d7a0ecfa73182030201d6c5f0cf74`.

NAPI loads the exported `tree_sitter_solidity` symbol through its documented
dynamic-language interface. It does not load the Node binding or execute an
installation script. The original `.node` filename is retained for provenance.
The licence is included here. The package contains only macOS and Linux assets.

To reproduce the vendoring step, download `npm pack tree-sitter-solidity@1.2.13
--ignore-scripts`, verify the archive hash, and extract `package/LICENSE` and
the four `package/prebuilds/{darwin,linux}-{arm64,x64}` directories. Native
parser loading and actual source parsing are tested on supported platforms.
