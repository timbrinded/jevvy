# Bundle invariants

`schemaVersion` versions the JSON contract. `pack.version` and `definitionHash`
identify question meaning. `extraction.version`, NAPI version and grammar
versions identify source preparation. These are independent of the renderer.
Unknown schema versions are rejected before interpretation.

All ranges use zero-based, end-exclusive UTF-16 offsets plus one-based display
lines. Every saved excerpt must equal the corresponding slice of its frozen
source, whose SHA-256 is checked. Source IDs include path, snapshot and content
hash; unit IDs also include the target range and extraction version. Code-unit IDs
include their pack. IDs do not
promise identity across refactors.

TypeBox compiles the closed bundle and answer schemas. Validation never coerces,
defaults, strips or repairs provider data. Explicit TypeScript checks then verify
question IDs, primitives, option/level sets, legends, chosen maxima (ties allowed),
request/target/context correspondence, complete label maps, unique bindings,
source hashes, coverage and execution provenance. A malformed envelope or extra
question ID invalidates its packet. An independent missing/invalid answer leaves
valid answers usable and marks that packet partial.

Live TypeSafe responses observed on 21 September 2026 expose values rounded to
hundredths. A score of 2.97 accompanied probabilities implying 2.98. The validator
therefore allows 0.005 per returned probability in the sum, and
`0.005 * (1 + sum(level indices))` for expected-score correspondence, plus 1e-9
for floating-point arithmetic. For four levels the score tolerance is 0.035.
This is an explicit policy based on observed precision, not a claim that the
provider guarantees this precision forever. Values remain untouched. Bounds,
legend equality and choice maximality are checked separately.

Each selected unit has every pack label, including explicit `not_evaluated`,
`not_applicable`, `error` or `cancelled` states. Excluded and removed units are
separate inventories. `complete_local` describes the selected local recipe;
external claims can still require unavailable evidence. Errors/cancellation never
become numeric scores. A completed run describes finished processing, not good
comments or universal factual certainty.

Requests use local comment/context keys so snapshot-specific IDs are not the
only identity of reusable inference. A manifest binds each opaque question ID
to its unit, label, target and source contexts. Cache reuse is revalidated through
the current manifest and records the originating bundle. Aliases are not cached.

Configuration defaults are applied explicitly before validation. Pi may coerce
tool arguments according to host behaviour, but Jev response and persisted bundle
validation always use non-corrective checks.

## Request versions and retrieval

New bundles use schema 2.0.0. Comments retain request-state format 2 and their
pack 1.2.0 definitions. Functions and Tests use format 3, `state.targets`, a
matching `packId`, and context paths. The reader also accepts 1.0.0 and 1.1.0
comment bundles with their original request shapes and templates. Both published
comment schemas remain unchanged. Extraction 2.0.0 adds code units and JavaScript.

Code structures identify `function` or `test`, syntax, name, owning range and
framework where known. The bundle kind, pack ID, unit kind and request format
must agree. A `complete_target` prerequisite requires a bound same-file excerpt
covering the whole target and excludes unavailable, oversized or parse-recovered
targets. Omitted surrounding helpers can still require an `insufficient_evidence`
answer. This prerequisite does not assert that all dependencies are available.

Explicit `contextFiles` add frozen supporting sources, including JSON manifests
and text contracts. Cross-file context is permitted only for these selected files,
from the target's snapshot. Branch scans read supporting files from the selected
head. Paths cannot escape the scope. Omitted or unreadable supporting files are
recorded; context budgets are shared with local evidence. Excerpt-relative target
occurrences are emitted only for the target's own source. Request paths and text
are checked against the saved sources. Cache keys include pack identity, version,
definition hash, extraction and the complete request.

Format 2 names the language, context status, omissions and target occurrence
ranges relative to supplied excerpts. Owner names/kinds remain, while file-wide
owner offsets stay in the bundle. Questions name their context keys directly.
The validator reconstructs this projection from the frozen source. Relocating an
unchanged unit can reuse answers without reusing its old source coordinates.
Rust attribute-only changes select attached documentation, and attribute size
counts toward the context budget. Freshness is checked against the capture root;
viewing from outside that scope produces a separate warning.

Results can project selected labels, include their definitions, and include
shared frozen contexts once per page. Unsuccessful statuses remain visible even
for omitted labels. Source ordering remains the default. Explicit sorting accepts
ascending/descending direction and a Choice outcome; missing values always sort
last, with source order breaking ties. Without an outcome, Choice sorting retains
its original winning-probability meaning and names it in the response. Cursors
bind all effective query options, including label selection, included evidence
and page size. Retrieval never invokes Jev or changes saved answers.

Optional `minProbability` and `minConfidence` filters require a label sort and
an explicit Choice outcome. They filter before pagination, exclude unavailable
answers, and are included in cursor identity. They do not assign findings, change
raw results, or establish empirical precision. An explicit unknown outcome can be
selected just like any other outcome.
