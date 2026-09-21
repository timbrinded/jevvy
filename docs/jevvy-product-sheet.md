> **Legacy filename:** this is a synchronised copy of the jevvy revision 3 product sheet, retained under its former filename. The product is named **jevvy**. Use `jevvy-product-sheet.md` as the canonical filename.

# jevvy — Product sheet

**Revision:** 3 · 21 September 2026\
**Status:** Proposed MVP; this is a product and contract design, not an implemented release.\
**Replaces:** jevvy revision 2 and the earlier pi-jev product sheet.\
**Purpose:** Give Pi a repeatable, parallel workflow for turning code comments and their context into useful semantic and qualitative labels.

## Product definition

**jevvy prepares an interpretation-ready results bundle.** It selects source material, assembles canonical questions and context, runs Jev, validates the answers, and presents the bundle to Pi’s orchestrating LLM.

A pack owns that entire recipe—not merely a prompt. The first release includes the **comments pack**, supporting TypeScript/TSX, Rust, Python and Solidity. Functions and methods are extracted as context, not independently analysed. Functions and tests packs, and SQL support, remain deferred.

```text
Git scope → captured source → @ast-grep/napi extraction
          → comment/context packets → fixed Jev questions
          → bounded parallel execution → validation
          → versioned results bundle → deterministic Pi view
          → orchestrator interpretation
```

The product is deliberately opinionated about what makes comments informative, specific, understandable and useful. Its output includes those judgements alongside structural observations. The orchestrator decides how their combination should affect a review or edit.

There are no generative-LLM calls during extraction, context assembly, question assembly or report rendering. No runtime research loop, generated questions, repository-wide semantic index or generic workflow language is required.

## Consolidated design decisions

| Decision | Revised position |
|---|---|
| Identity | The extension is **jevvy**; commands and tools use that name. |
| Qualitative assessment | Explicitly assess reader value and specificity as well as clarity, ambiguity and local consistency. |
| Comment kind | Represent documentation form separately from semantic purpose. Allow multiple purposes, including explanations of non-obvious behaviour and workarounds. |
| Output | A stable, versioned JSON bundle is the canonical deliverable. Pi receives a deterministic, readable projection of it. |
| Validation | TypeBox is the single schema system for tool parameters, configuration, pack data, request manifests, Jev answer shapes and the public bundle. Derive TypeScript types from those schemas; use explicit TypeScript checks for request correspondence and cross-field invariants. |
| Extraction | Embed `@ast-grep/napi`; remove the mandatory ast-grep CLI installation. Ship or register the required language grammars. |

**Revision 3 change:** standardise on TypeBox throughout, remove the second schema library and schema-parity bridge, and align imports with the supported Pi release. The comments vocabulary, context recipes and JSON bundle format are unchanged.

## First-release scope and interface

| Area | Commitment |
|---|---|
| Input | Local Git branch changes, working changes or explicitly selected files. |
| Pack | Comments only, including comments inside test files. |
| Languages | TypeScript/TSX, Rust, Python and Solidity. Solidity requires explicit native grammar packaging work. |
| Processing | Deterministic selectors, context recipes, label definitions and rendering; Jev supplies the semantic and qualitative answers. |
| Operation | Explicit invocation, bounded concurrency, dry-run, cancellation, partial results and cache reuse. |
| Deliverable | Immutable bundle, compact model-facing report, source-linked detail retrieval and coverage accounting. |
| Not included | SQL, function/test-specific labels, automatic source rewriting, always-on monitoring, cross-file reasoning, custom-pack marketplace. |

Proposed command surface:

```text
/jevvy comments --base origin/main --head HEAD
/jevvy comments --working
/jevvy comments --files src/session.ts src/client.ts
/jevvy comments --working --dry-run
/jevvy results <bundle-id>
```

`jevvy_comments` exposes the scan to the agent. `jevvy_results` retrieves an overview, paginated units or specified context from an existing bundle. Both routes use the same engine.

**Branch mode** compares the supplied base/head merge-base with head. **Working mode** compares HEAD with captured working-tree contents and separately includes non-ignored untracked files. **File mode** considers all eligible comments in the selected files. The report records the resolved scope instead of silently choosing a base branch. Git provides the snapshot and diff operations. [1]

Capture each selected file once, hash it, and use that captured content throughout the run. Working-tree captures are not claimed to be a globally atomic repository snapshot. Detect edits during capture where possible; never join a diff from one file version to an AST from another.

Dry-run performs extraction, association, context assembly and request planning, but no Jev inference. It exposes exactly which source and questions would be submitted, together with exclusions and size-limit decisions.

## Comments pack: selection and context

### Select whole comment units

Parse complete source files. Use the old and new diff ranges to select comment blocks rather than attempting to parse patch fragments.

Include added or modified comments and unchanged comments attached to changed code. Record removed comments without labelling them as current comments. Handle deletion-only code changes and file renames explicitly.

For example, an unchanged comment promising `undefined` becomes eligible when its implementation changes to throw an error. A resulting inconsistency does not establish which side should change; that remains for the orchestrator.

Group adjacent line comments using language-specific rules. Preserve paragraphs, tags and code examples. Recognised licences and machine directives are inventoried but excluded from qualitative prose checks by default. Mixed directives and explanatory prose should retain an analysable prose unit where it can be separated reliably.

### Language adapters

| Language | Extraction requirements |
|---|---|
| TypeScript/TSX | Line/block comments, JSDoc-style blocks, functions, arrow functions, methods, exports and decorators. A JSDoc-shaped block is not automatically correct API documentation. |
| Rust | Ordinary, inner and outer documentation comments; nested block comments; items, methods and literal `#[doc = "..."]` attributes where supported. No macro expansion. |
| Python | `#` comments and actual module/class/function docstrings, including decorated and asynchronous functions. Arbitrary multiline strings are not automatically comments or docstrings. |
| Solidity | Ordinary comments and NatSpec documentation; declarations, modifiers and documentation tags. Preserve `@inheritdoc` but do not resolve inherited documentation in v1. |

These conventions are grounded in the relevant language documentation. Recognise the form deterministically; Jev assesses what the content communicates. [2][3][4]

### Assemble local supporting context

| Placement | Default context |
|---|---|
| Documentation attached to a callable | Complete callable signature/body, relevant wrappers and the enclosing declaration header. |
| Leading/trailing implementation comment | Associated statement or block, enclosing callable signature and bounded syntactically related surroundings. |
| Documentation on a field, type, class or module | Relevant declaration/header and locally relevant members where the recipe calls for them; not an entire large file by default. |
| Unattached or ambiguous comment | Comment and bounded local surroundings, with ownership explicitly unresolved. |

Record attachment as `syntactic`, `adjacency_based` or `unresolved`. Include how it was established. The nearest declaration is not automatically the owner.

Context records distinguish `complete_local`, `partial` and `unavailable`, with reasons such as an oversized owner, ambiguous attachment or parse error. “Complete local” does not imply that all runtime dependencies have been supplied.

Each label declares its context prerequisites. Text-only labels may still run when implementation context is unavailable; code-relative labels must not quietly run against an incomplete substitute. Do not truncate code without recording the omission, and do not insert a generated summary in its place.

## Comment taxonomy and qualitative labels

### Form and purpose are separate

Structural fields describe `syntax` and `documentationStyle`: for example, block comment plus `natspec`, outer documentation comment plus `rustdoc`, or string literal plus `python_docstring`. Include recognised tags, declaration kind and attachment evidence. Use `unknown` where the adapter cannot establish the form.

Semantic labels describe purpose. A rustdoc block may also explain a workaround, document surprising behaviour and warn about an invariant. A single exclusive “comment kind” would lose that combination.

The initial pack defines the following **14 dimensions**. Each definition includes exact instructions, criteria, required context and a stable identifier. Native Jev answers are preserved. Noul supplies a proposition probability, Choice a distribution across alternatives, and Score a distribution across described ordered levels. [5][6]

| Group | Label | Type | Question being answered |
|---|---|---|---|
| Purpose | `serves_api_documentation` | Noul | Does this comment explain how a caller should use or understand the associated API, rather than merely how its internals are implemented? |
| Purpose | `describes_behaviour` | Noul | Does it describe an operation, result or observable behaviour? |
| Purpose | `explains_rationale` | Noul | Does it state why a design or implementation choice was made? |
| Purpose | `describes_non_obvious_behaviour` | Noul | Does it describe surprising, counterintuitive, exceptional or easily misunderstood behaviour? |
| Purpose | `documents_workaround` | Noul | Does it identify a deliberate workaround or compatibility accommodation? |
| Purpose | `states_constraint` | Noul | Does it state a precondition, invariant or restriction that a caller or maintainer must preserve? |
| Purpose | `warns_about_pitfall` | Noul | Does it identify a concrete mistake or adverse consequence to avoid? |
| Purpose | `tracks_follow_up` | Noul | Does it record unfinished work, a known limitation or a future action? |
| Quality | `writing_clarity` | Score | How readily can the intended reader understand the wording? |
| Quality | `specificity` | Score | How concretely does it identify the subject and the details relevant to its purpose? |
| Quality | `reader_value` | Score | Assuming its factual claims are valid, how much does it contribute at its intended reading location? |
| Quality | `restates_visible_code` | Noul | Is the comment predominantly a direct restatement of the supplied code? |
| Quality | `materially_ambiguous` | Noul | Are materially different interpretations of behaviour, responsibility or conditions plausible? |
| Consistency | `local_consistency` | Choice | Is a checkable claim contradicted, supported or not decidable from the supplied implementation? |

“Describes non-obvious behaviour” classifies the comment’s subject; it is not a finding that the code is defective. “Documents workaround” does not prove that the external limitation actually exists.

### Score rubrics

All initial qualitative scores use four levels, indexed 0–3. Each level is independently described; labels such as “better than the previous level” are not used. Jev’s Score documentation recommends concrete descriptions and a single dimension per question. [6]

| Dimension | Level 0 | Level 1 | Level 2 | Level 3 |
|---|---|---|---|---|
| `writing_clarity` | Intended meaning cannot be recovered reliably. | Meaning requires substantial inference because wording or references are unclear. | Meaning is understandable, with minor avoidable difficulty. | Wording communicates its intended meaning directly and unambiguously. |
| `specificity` | Generic wording identifies no useful subject or condition. | A subject is named, but the detail needed to understand the point is missing. | The relevant subject and claim are concrete enough for the stated purpose. | The decisive condition, consequence, example or constraint is identified precisely enough to guide the reader. |
| `reader_value` | No usable contribution for the expected reader at this location. | Limited contribution; the reader gains little beyond immediately available information. | Helps the expected reader use or maintain the code without unnecessary investigation. | Preserves important non-obvious knowledge or helps prevent a concrete misuse or maintenance error. |

**Purpose-aware value:** API reference documentation can be valuable even when the implementation makes the same fact obvious. An internal comment can justify its presence by recording history, rationale, external constraints or intentional oddities. Brevity alone is not low specificity, and extra length alone is not greater value.

`reader_value` measures communication contribution separately from truth. A precise, clear explanation can still contradict the code. The bundle keeps both signals so the orchestrator can reason about that interaction.

No aggregate “good comment percentage” is produced in v1. The product is not avoiding quality judgements; it is keeping the reasons for those judgements visible.

### Local consistency outcomes

Use `contradicted`, `locally_supported`, `insufficient_evidence` and `no_checkable_claim`. One explicit local contradiction takes precedence over other supported claims. In the absence of contradiction, material claims requiring unseen evidence yield `insufficient_evidence` rather than unsupported certainty.

An incomplete description is not automatically contradictory. For example, “returns a cached user when present” does not itself exclude fetching a user when absent. Such examples belong in the pack’s fixtures.

## Stable results contract

### Report-shape options

| Option | Advantage | Cost | Decision |
|---|---|---|---|
| Flat label matrix | Compact and easy to scan or sort. | Weak source association; encourages treating every number alike; awkward partial/error states. | Useful as a derived overview, not the canonical result. |
| Self-contained object per comment | Each item contains all its context and answers; straightforward to consume. | Repeats a shared function for every comment and makes packet provenance harder to maintain consistently. | Useful as a detail view. |
| Versioned bundle with shared contexts and a deterministic renderer | Stable machine contract, original evidence, deduplication, complete distributions and readable LLM presentation. | Requires explicit references and a small renderer. | **Chosen.** |

Store one JSON bundle and generate all views from it. This is ordinary normalisation of repeated context, not a graph database or extensible reporting framework.

### Bundle shape

The following is a contract outline. Define the concrete TypeBox schemas in `contracts.ts` and derive types with `Type.Static<typeof Schema>`. The schemas themselves are JSON Schema; publish their JSON-serialisable form rather than maintaining a separate schema or conversion pipeline. This outline is not a second hand-maintained type definition. [10]

```ts
{
  schemaVersion: "1.0.0",
  kind: "jevvy.comments.bundle",
  bundleId: string,
  producer: { name: "jevvy", version: string },
  pack: { id: "comments", version: string, definitionHash: string },
  extraction: { version: string, napiVersion: string, grammars: {...} },
  run: { mode, status, scope, snapshotId, requestedModel, resolvedModel },
  definitions: { [labelId]: { group, primitive, question, criteria, requires } },
  sources: { [sourceId]: { path, snapshot, contentHash, encoding } },
  contexts: { [contextId]: { sourceId, range, role, text } },
  units: [{
    id, sourceId, range, text,
    structure: { syntax, documentationStyle, owner, attachment },
    change,
    context: { status, refs, omissions },
    labels: { [labelId]: LabelResult }
  }],
  executions: { [packetId]: { requestHash, origin, bindings, model, usage } },
  coverage: { files, units, labels },
  diagnostics: [...]
}
```

Definitions travel with the report: a consumer does not need to guess whether `2.6` means a level index, probability or risk score. The same pack assets supply both request criteria and report legends. Do not generate a separate explanation with another LLM.

Contexts retain original source excerpts. Multiple comments on one function refer to the same context ID. The full captured file need not be copied into the bundle when selected excerpts are sufficient.

Executions preserve the mapping from each Jev question ID to its unit, label and relevant context. Question IDs are opaque routing keys; the request instructions themselves identify the target. [5]

### Label result states

An evaluated label has `status: "ok"`, its `packetId`, and a native answer:

```ts
// Native fields are retained rather than converted into one generic score.
{ type: "noul", noul: number }
{ type: "choice", choice: string, probabilities: {...}, confidence: number }
{ type: "score", score: number, probabilities: {...}, legend: {...}, confidence: number }
```

Other states are explicit: `not_applicable`, `not_evaluated`, `error` and `cancelled`, each with an appropriate reason. An error is not encoded as zero or 0.5. `insufficient_evidence` is a successful semantic answer to a Choice question, not an execution failure. Provider confidence is retained with its documented meaning, not presented as an independent verifier. [5][7]

Each selected unit has a state for every pack label. Missing answers cannot vanish through an absent map entry. Excluded and removed units are accounted for separately in coverage rather than masquerading as completed evaluations.

### References, completeness and evolution

Use opaque, snapshot-specific IDs. Unit identity incorporates source identity, range and extraction version; it is not a promise to recognise the same logical comment across arbitrary refactors.

Normalise ranges to explicitly named **UTF-16 offsets**, zero-based and end-exclusive, for JavaScript string slicing; include one-based display lines. Keep source hashes and verify the selected excerpt against its source. NAPI coordinate behaviour must be fixture-tested with Unicode and CRLF rather than inherited from CLI JSON assumptions. Its current implementation converts internal offsets for JavaScript, despite a misleading byte-offset annotation in its declarations. [8]

Coverage distinguishes file discovery/parse outcomes, selected/excluded/removed comment units, and label execution states. Cache reuse is an additional property of completed execution, not a separate mutually exclusive category of comment.

A completed run means processing finished for its selected scope—not that every claim is decidable or every comment is good. Partial, cancelled and failed runs retain usable results and explicit gaps.

`schemaVersion` versions bundle shape; `pack.version` versions questions, rubrics and their meaning; extraction and model versions remain separately visible. A change in meaning needs a new pack version even when the field name is unchanged. Unknown schema versions must be negotiated or rejected before parsing; strict consumers must not silently reinterpret them.

### Example bundle

The companion `jevvy-results.example.json` demonstrates two comments sharing one function context: a clear documentation claim that contradicts the implementation, and a useful rationale comment whose external claim cannot be verified locally. It includes all 14 definitions and all 28 label results.

All values are synthetic. Example mode allows null model/parser metadata and `origin: "synthetic"`; live runs require actual resolved versions. Dry-runs record planned tasks without invented answers.

The move to TypeBox changes schema authoring and validation, not the wire format. The companion JSON remains unchanged and does not require a `schemaVersion` bump solely for this dependency change. Implementing the full schema and running the fixture through both validation stages remain release-acceptance requirements.

### What the LLM receives

The default model-facing output contains a run/coverage header, a compact label legend and source-grouped comment cards. Each card includes comment text, structural form, quality results and context references. Related cards share their enclosing code rather than repeating it.

For large results, `jevvy_results` supports `overview`, `units` and `context` views. Every page includes the bundle ID, selection/order, returned count, total count and continuation cursor. A details view expands the exact frozen context. A pagination limit must never be presented as all results.

A table can show point estimates for quick scanning, while full distributions and missing-data states remain retrievable. Default ordering is source order; an explicit sort may prioritise a named label without dropping low-scoring comments. Do not manufacture an overall review verdict.

The bundle is the stable contract; the renderer has its own version. Markdown layout can improve without changing the underlying data. Mechanical rendering may describe a label value but must not invent a model-authored explanation of why it was assigned.

Pi’s documented tool result separates model-visible `content` from rendering/state `details`. Put the readable report in `content`; retain the complete bundle or its persistent reference in `details` and extension storage. A JSON object placed only in `details` is not an LLM handoff. [9]

## TypeBox contracts and response wiring

### One schema system

Use TypeBox for tool arguments, configuration, serialisable pack definitions, packet manifests, provider-answer shapes and the public bundle. Define each schema once, infer its TypeScript type with `Type.Static`, and reuse the same tool-argument schema in Pi and the standalone engine entry point. There is no second schema language, translation layer or schema-parity test suite. TypeBox builds JSON Schema and supports runtime checking as well as static type inference. [9][10]

**Version baseline:** the upstream Pi manifest inspected on 21 September 2026 uses `typebox` **1.3.27**. Target and test a specific Pi/TypeBox pair; the proposed imports are `Type` from `typebox` and `Compile` from `typebox/compile`, matching that host. Do not mix these with older `@sinclair/typebox` / `TypeCompiler` examples. Supporting an older Pi generation would be an explicit compatibility decision, not a reason to ship both schema libraries. The user's installed Pi version has not been inspected. [24][25]

Keep schemas JSON-native: strings for timestamps, plain objects/arrays and finite numbers. Model answer variants and execution states with unions of objects carrying required literal discriminators such as `type` or `status`. Set `additionalProperties: false` on each closed jevvy-owned object; dictionaries have explicit value schemas. Avoid codecs, transformations and JavaScript-only types in the published contract. Export the serialised schema with a stable identifier, declared JSON Schema dialect and resolved references, and round-trip it in tests. [10][11]

### Two validation stages

**Shape validation:** compile trusted schemas once and reuse their validators. Use `Check` on untrusted input and `Errors` for diagnostics after failure. This covers required fields, discriminators, types, numeric bounds and unknown fields. Schema construction alone does not validate data. Do not clean, default, cast or convert provider answers into validity; use the non-corrective check path. Configuration defaults, where supported, are a separate, explicit preparation step. [11]

**Correspondence and semantic validation:** ordinary TypeScript checks enforce relationships to the exact request and to the rest of the bundle. Verify expected question IDs and primitive types; exact Choice option and Score level sets; selected Choice membership and consistency with a maximum-probability option, allowing ties; Score legend and index range; finite probabilities in [0,1]; distribution totals and expected-score consistency within a documented floating-point tolerance. Check source/context/packet references, unique bindings, per-unit label completeness and coverage totals. These are application invariants, not a reason for another validation library.

Use a manifest mapping opaque question IDs to `{unitId, labelId}` rather than array positions or ambiguous string splitting. A correctly shaped answer attached to the wrong question is invalid. Independent answer failures can produce a partial packet; a malformed envelope or untrustworthy mapping invalidates the packet. Invalid results are never cached as successful evaluations.

Unknown provider metadata may be explicitly accepted and retained diagnostically, while jevvy-owned bundle objects stay closed. Missing answers, changed option sets and wrong primitives are not discarded or repaired silently. Never insert a fabricated probability to satisfy a schema.

Keep the official `@typesafe-ai/sdk` behind a thin transport adapter. The SDK supplies its client and typed questions; TypeBox and the correspondence checks enforce jevvy's runtime boundary. Validate assembled bundles before storage, rendering or return, and validate loaded bundles again before interpretation. [12]

### Pi integration

Pass the canonical tool-argument schema directly to `registerTool`. Keep model-facing tool schemas simple and use Pi's documented `StringEnum` helper for string enums where required by provider compatibility. The result bundle is not a tool-argument schema, so it can retain its tagged answer unions without flattening them for an LLM provider. [9]

Pi's current tool-argument validator performs conversions. Do not reuse that coercive path for Jev responses or persisted bundles: share schema definitions, but call jevvy's non-corrective validators at those boundaries. The command route and tool route converge on the same validated engine input and semantic checks. [26]

The published JSON Schema specifies the portable data shape; the adjacent contract documentation specifies the additional correspondence and semantic invariants. Both stages must succeed before jevvy treats a result as valid. No additional validation framework is required.

## Embedded ast-grep: capability plan

### Why NAPI

`@ast-grep/napi` gives the TypeScript code direct access to parsed roots, nodes, fields, relatives and captures. Parse captured Git content in memory, reuse the tree for several selectors and build context without spawning a CLI or parsing its JSON output. These are architectural benefits; a specific speedup remains to be measured. [13][14]

The switch changes the integration, not just the package name. Replace CLI `scan`, flags and `sgconfig` assumptions with typed rule objects, direct traversal, explicit file selection and application-owned scheduling.

### Features used deliberately

| Capability | jevvy use |
|---|---|
| `parse` / `parseAsync` | Parse each captured version once. Use bounded asynchronous parsing where appropriate; parse concurrency and Jev request concurrency are separate controls. |
| `find` / `findAll`, `kind`, node-scoped regex | Inventory comment nodes and eligible declarations; use regex only within already recognised syntax for delimiters/tags. |
| Code patterns, `context`/`selector`, `$NAME`, `$$$BODY` | Match structural variants and collect named subjects, parameters or statement sequences where source-shaped patterns are clearer. |
| `getMatch` / `getMultipleMatches` | Retrieve actual captured nodes, not just matched text, so their source ranges and parents remain available. |
| `parent`, `ancestors`, `field`, `fieldChildren` | Find owners, unwrap exports/decorators and extract signatures/bodies without broadening to an entire file. |
| `children`, `namedChildren`, sibling traversal | Group comment blocks, distinguish punctuation from semantic children, recognise docstring positions and apply attachment rules. |
| `inside`, `has`, `follows`, `precedes`, `stopBy`, `field` | Express bounded local relationships. Do not accidentally associate a nested comment with an unrelated outer declaration. |
| `all`, `any`, `not`, `utils`, `matches`, constraints | Reuse language-specific selectors and restrict captures. Keep them as small TypeScript objects, not a new rule DSL. |
| `nthChild` / `ofRule` | Useful for first-relevant-statement selection; direct child traversal is equally acceptable when clearer for docstrings. |
| `text`, `range`, `kind`, `isNamed` | Preserve exact excerpts, classify syntax and intersect source spans with the diff. |
| `transform` / `getTransformed` | Optional derived text for delimiter removal or compact headers; retain untouched original text and coordinates. |
| `findInFiles` / `parseFiles` | Available for broad file discovery/parsing, but not the default for snapshot-sensitive PR work because they read files directly. |
| Grammar-specific type maps | Use where maintained definitions help catch selector mistakes; do not require a generated universal AST type system. |

These capabilities are exposed by the NAPI API and the underlying ast-grep rule engine. Match objects and available helpers must be tested against the pinned package, rather than assuming every CLI configuration field is accepted. [13][14][15][16]

**Strictness:** relaxed/signature pattern matching can ignore comments. Inventory comments directly, rather than relying on an encompassing code pattern to preserve them. [17]

**Error recovery:** syntax trees can contain recovery/error nodes. Detect and record affected ranges. Do not claim successful comment coverage merely because parsing returned a root.

**No mutation:** do not call `replace`/`commitEdits` on reviewed source. CLI outline, lint suppression handling, rule-test commands and CLI-specific JSON streaming are not runtime dependencies. Extract compact declaration headers using node fields; test rules and packets in the TypeScript test suite.

### Language packages and registration

NAPI bundles JavaScript-family languages, including TypeScript/TSX, rather than all languages available in the CLI. Python and Rust have maintained `@ast-grep/lang-python` and `@ast-grep/lang-rust` packages. Register the full dynamic-language set together. [14][18][19]

`registerDynamicLanguage` is documented as a once-per-process operation. Initialise once, guard hot reloads, and smoke-test every required language. A second registration is not a mechanism for adding another grammar. Test coexistence with another extension that uses NAPI; detect unavailable/conflicting registration instead of reporting an empty successful scan. [13][20]

**Solidity stays in scope, but a ready-made `@ast-grep/lang-solidity` package was not verified in this review.** The upstream ast-grep language crate uses `tree-sitter-solidity`; package a compatible native grammar and register it through the documented dynamic-language interface unless a suitable maintained package is verified during implementation. This is a packaging/release gate, not a request for the LLM to compensate. [20][21]

Language packages may require installation scripts to place their platform-specific native libraries. Test the actual Pi production install, permitted build-script settings and target operating-system/architecture combinations. All required parser assets must be runtime dependencies, not dev-only tooling. [9][18][19]

## Execution, caching and lifecycle

Batch compatible comments around shared local code. Ask independent questions together; do not first classify a comment and then serially construct the remaining labels. Structural metadata is already available to the fixed questions. Jev supports independent questions against shared state. [22]

Do not place unrelated functions into one request solely to reduce request count. The question ledger, target mapping and compatible shared context define request boundaries; model context limits and budgets provide upper bounds. [22][23]

Maintain separate bounds for native parsing and API requests. `parseAsync` uses threads for parsing, but subsequent JavaScript traversal is not automatically parallel. Avoid unbounded `Promise.all` over a repository; yield between extraction batches and check cancellation. [15]

Use the SDK’s retry facilities deliberately, with one overall run deadline and request cancellation. Avoid multiplying retries across SDK and scheduler layers. Failed or cancelled tasks remain explicit in the bundle; completed work is preserved.

Cache validated results by canonical request content, pinned/resolved model, pack definition hash and relevant extraction version. Rebind cached answers through a verified manifest and retain execution provenance. Supporting-code changes invalidate affected packets even when the comment itself is unchanged.

Use deterministic packet ordering and packing so unrelated edits do not unnecessarily invalidate every request. Keep exact prompt/rubric definitions in pack assets. A cache miss does not promise identical probabilities to a previous inference.

Persist immutable bundles outside tracked source by default, with configurable retention. A rerun produces a new bundle. Preserve the source snapshots used to build retained excerpts; mark any comparison with the current checkout as stale when hashes differ.

Only selected context is sent to Jev. Keep API keys out of bundles and source control, and treat comment content as data rather than trusted pack instructions. No production call to another LLM is hidden in a fallback path.

## Dependency and module choices

| Dependency | Role |
|---|---|
| `@ast-grep/napi` | Embedded parsing, structural matching and AST traversal. |
| `@ast-grep/lang-python`, `@ast-grep/lang-rust` | Verified dynamic grammar packages; pinned and tested with NAPI. |
| Packaged Solidity native grammar | Required integration item; do not invent an unverified package dependency. |
| `typebox` | Single schema system for Pi parameters and engine/bundle contracts; inferred types, native JSON Schema and runtime validators through `typebox/compile`. Align with the tested Pi version. |
| `@typesafe-ai/sdk` | Official Jev client and typed question construction. |
| Pi extension API | Host integration, commands, cancellation and rendering; registered tools reuse the canonical TypeBox parameter schemas. |
| Node built-ins + Git executable | File capture, hashing, persistence and Git comparisons. No ast-grep CLI required. |

Use ordinary TypeScript modules:

```text
src/
  extension.ts
  scope.ts
  ast.ts
  jev.ts
  contracts.ts     # TypeBox schemas and inferred types
  validate.ts      # Cached validators and correspondence checks
  bundle.ts
  render.ts
  packs/comments/
    questions.ts
    context.ts
    languages/
    fixtures/
```

A simple bounded queue can be implemented locally; adopt an extra scheduler dependency only when it removes real complexity. No database, agent framework or generic plugin engine is required for the MVP.

## Release acceptance

| Area | Required evidence |
|---|---|
| Extraction | Fixtures for all selected language forms, nesting, wrappers, comment-looking strings and parser-recovery cases. |
| Context and Git scope | Correct ownership, deletion-only changes, unchanged documentation on changed code, renames, untracked files and captures that change during a run. |
| Native packaging | Clean production install and parsing on declared platforms; hot reload and dynamic-registration tests; a verified Solidity parser path. |
| Contract | TypeBox shape checks plus correspondence checks; valid fixtures and malformed/misrouted answers; closed-object rejection; missing/extra IDs and wrong primitives; distribution/score invariants; reference and coverage integrity; schema/data serialisation round trips; explicit partial/error states. Provider answers must never be coerced or repaired. |
| Host compatibility | Register canonical parameter schemas in the supported Pi version; verify provider-compatible enums and the shared command/tool engine path; test the pinned TypeBox imports and standalone validation. No separately maintained tool-schema copy. |
| Rendering | Snapshot tests proving no facts or labels are invented, shared context is preserved, score scales remain visible and pagination is disclosed. |
| Qualitative labels | Hand-reviewed examples distinguishing useful documentation from pointless repetition, clear falsehoods from unclear truths, and meaningful workarounds from vague “weird behaviour” notes. |
| Execution | Cancellation, caching, retries, context budgets and partial successes tested without requiring live calls in ordinary unit tests. |
| Engineering outcome | Compare supported review tasks with and without jevvy: useful observations, false signals, missed issues, context consumed, elapsed time and API usage. |

## Deferred expansion

A **functions pack** could label changed functions by local semantic characteristics such as I/O, state mutation, authorisation and retry behaviour. A **tests pack** could label scenarios and visible assertions. Neither needs a detailed design before the comments workflow works.

**SQL remains deferred** pending dialect and grammar choices. Runtime LLM-assisted onboarding, custom packs, cross-file context enrichment and continuous annotation also remain later work.

**First-release outcome:** an engineer or coding agent invokes one repeatable command and receives a validated, source-linked bundle that says what comments are doing, how well they communicate, and whether their local claims appear consistent—without first spending an LLM turn constructing the workflow.

## Source documentation

The original source review was conducted on 18 September 2026. TypeBox and the relevant Pi integration sources were checked again on 21 September 2026 for revision 3; unrelated dependency claims are retained from the prior review. Behaviours specified for jevvy are proposed design decisions. This document revision does not constitute a full TypeBox implementation, live Jev benchmark or cross-platform NAPI installation test.

[1]: https://git-scm.com/docs/git-diff "Git: git-diff"
[2]: https://peps.python.org/pep-0257/ "Python: docstring conventions"
[3]: https://doc.rust-lang.org/reference/comments.html "Rust Reference: comments"
[4]: https://docs.soliditylang.org/en/latest/natspec-format.html "Solidity: NatSpec"
[5]: https://docs.typesafe.ai/api "TypeSafe AI: request and answer contracts"
[6]: https://docs.typesafe.ai/primitives/score "TypeSafe AI: Score and rubric design"
[7]: https://docs.typesafe.ai/confidence "TypeSafe AI: confidence semantics"
[8]: https://raw.githubusercontent.com/ast-grep/ast-grep/main/crates/napi/src/sg_node.rs "NAPI: node ranges and string offsets"
[9]: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md "Pi: extensions, tool schemas and results"
[10]: https://raw.githubusercontent.com/sinclairzx81/typebox/1.3.27/readme.md "TypeBox 1.3.27: JSON Schema construction and static types"
[11]: https://raw.githubusercontent.com/sinclairzx81/typebox/1.3.27/src/compile/validator.ts "TypeBox 1.3.27: non-corrective Check, Errors and corrective operations"
[12]: https://docs.typesafe.ai/sdk/javascript "TypeSafe AI: JavaScript/TypeScript SDK"
[13]: https://ast-grep.github.io/guide/api-usage/js-api "ast-grep: JavaScript API and dynamic registration"
[14]: https://ast-grep.github.io/reference/api "ast-grep: NAPI reference"
[15]: https://raw.githubusercontent.com/ast-grep/ast-grep/main/crates/napi/types/api.d.ts "NAPI: parseAsync and file operations"
[16]: https://ast-grep.github.io/reference/rule.html "ast-grep: rule object reference"
[17]: https://ast-grep.github.io/advanced/match-algorithm "ast-grep: matching strictness"
[18]: https://raw.githubusercontent.com/ast-grep/langs/main/packages/python/package.json "Python grammar package manifest"
[19]: https://raw.githubusercontent.com/ast-grep/langs/main/packages/rust/package.json "Rust grammar package manifest"
[20]: https://raw.githubusercontent.com/ast-grep/ast-grep/main/crates/napi/types/registerDynamicLang.d.ts "NAPI: dynamic language registration contract"
[21]: https://raw.githubusercontent.com/ast-grep/ast-grep/main/crates/language/Cargo.toml "Upstream parser dependency and NAPI feature sets"
[22]: https://docs.typesafe.ai/primitives "TypeSafe AI: shared-state questions"
[23]: https://docs.typesafe.ai/models "TypeSafe AI: models and limits"

[24]: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/package.json "Pi: upstream TypeBox dependency baseline"
[25]: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/core/extensions/loader.ts "Pi: TypeBox module resolution for extensions"
[26]: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/utils/validation.ts "Pi: tool-argument validation and coercion"
