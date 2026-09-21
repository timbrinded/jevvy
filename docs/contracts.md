# Bundle invariants

`schemaVersion` versions the JSON contract. `pack.version` and `definitionHash`
identify question meaning. `extraction.version`, NAPI version and grammar
versions identify source preparation. These are independent of the renderer.
Unknown schema versions are rejected before interpretation.

All ranges use zero-based, end-exclusive UTF-16 offsets plus one-based display
lines. Every saved excerpt must equal the corresponding slice of its frozen
source, whose SHA-256 is checked. Source IDs include path, snapshot and content
hash; unit IDs also include the comment range and extraction version. IDs do not
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

Each selected comment has every pack label, including explicit `not_evaluated`,
`not_applicable`, `error` or `cancelled` states. Excluded and removed comments are
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

New bundles use schema 1.1.0 and request-state format 2. The reader also accepts
1.0.0 bundles, validating their original request shape and question template.
The published 1.0.0 schema is retained. Pack 1.2.0 corrects the restatement
criterion;
extraction 1.0.4 includes Rust declaration attributes.

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
