# Cookbook reassessment: Jevvy as the bridge

Reviewed 21 September 2026 before implementation. This replaces the earlier recommendations in this document. The approved changes are now implemented; [handoff verification](handoff-verification.md) records the results. Findings below describe the pre-change behaviour.

## Conclusion

Keep the existing architecture. It already separates source extraction, fixed questions, Jev execution and evidence retrieval. The useful next work is to repair missing evidence, make request targeting clearer, and let Pi retrieve selected measurements efficiently. The cookbooks do not justify adding a review-policy engine or another orchestration loop.

The strongest new evidence is a Rust context defect. Jevvy omits declaration attributes such as `#[cfg(test)]`. Adding the missing source to an otherwise identical question changed Jev's answer from insufficient evidence to local support in all three paired requests. This is an improvement to the bridge, with no new semantic machinery.

## Responsibility boundaries

| Component | Owns |
| --- | --- |
| Pi's orchestrating LLM | Selecting the investigation, interpreting results, requesting more evidence, deciding what to change, editing and running development tools. |
| Jev | Answering the pack's semantic questions and returning native uncertainty. |
| Jevvy | Deterministic scope and source capture; language-aware context; authored, versioned pack questions; request execution; validation; source provenance; accessible results. |

Authoring a good pack question remains our job. Computing file offsets and enforcing source prerequisites also remain our job. Choosing which potential defect deserves action belongs to Pi. For example, exposing an explicit sort by contradiction probability serves Pi; automatically assigning review priorities would make that decision for it.

`not_evaluated` because a required source excerpt is absent is a mechanical coverage result. Jev's `insufficient_evidence` is a semantic answer. Neither should be rewritten into a generic pass/fail or confidence gate.

## Changes justified by the implementation pass

### 1. Repair evidence capture and provenance first

**Rust attributes are missing from context and change selection.**

In [context.ts](../src/packs/comments/context.ts), declaration association skips Rust attribute siblings, but context expansion handles sibling decorators only for TypeScript/TSX. The Rust function is then marked `complete_local` without its attributes.

Two reproductions:

- A file containing `/// Only compiled for tests.`, `#[cfg(test)]` and a function sends only the function as its owner context.
- Changing only `#[cfg(test)]` to `#[cfg(unix)]` selects **zero comments** in working mode. The comment, function range and captured context do not overlap the attribute edit.

Preserve the associated attributes in the exact source excerpt, apply the context budget to that full excerpt, and let attribute-only edits select attached comments. Cover multiple attributes and Rust documentation attributes without duplicating comment units. Keep macro expansion out of scope.

A live experiment used the comment “This function is compiled only for test builds” and the existing `local_consistency` question. Three requests with today's context returned `insufficient_evidence`, with probabilities 0.53–0.60. Three requests including the original attributes returned `locally_supported`, with probabilities 0.89–0.92. These were six direct, uncached requests to `jev-1.13.0`, with no changing identifier added to state. This demonstrates the consequence on one fixture, not general accuracy or calibration.

**Source freshness checks use the wrong root when Pi starts in a subdirectory.**

[scope.ts](../src/scope.ts) captures working/branch paths relative to the Git root. [currentSourceStatus](../src/render.ts) joins those paths to Pi's current directory. A working scan started in a nested directory subsequently reports an existing unchanged captured file as unavailable. Resolve freshness checks against the recorded capture root, with an explicit distinction if the caller is inspecting a different checkout. Frozen evidence must remain usable regardless.

**The documented preview alias is rejected.**

[engine.ts](../src/engine.ts) permits a resolved model ID only when the requested name ends in `-latest`. The officially documented `jev-preview` alias returns `jev-1.13.0`, which currently turns all 14 valid answers into errors. This was reproduced with both a fixture transport and a live request. Handle documented aliases explicitly, record their resolved versions, and avoid reusing their cache entries without a fresh resolution. Keep the pinned default and strict checks for pinned IDs. [Model reference](https://docs.typesafe.ai/models).

These are bounded repairs. None requires a new pack or decision policy.

### 2. Make the request an intentional projection of captured evidence

[plan.ts](../src/plan.ts) currently sends comment text, the full structural record and context references; each context contains text and role. Language, context completeness and omission reasons remain only in the bundle. Absolute owner offsets are sent even though the corresponding context excerpts have no absolute coordinates.

The request should identify the language, target occurrence and supplied context directly, with mechanically recorded completeness/omissions. Keep full source coordinates and provenance in the bundle; use excerpt-relative locations where they help Jev distinguish identical comments. Do not infer public API status, generate summaries or remove code based on a semantic relevance score.

A local probe also found that adding a blank line before otherwise identical source changes the request hash solely through structural locations. A compact inference record can avoid that unnecessary cache miss while the new bundle still records the new source positions. Keep occurrence identity separate from answer reuse.

First compare the current request with a candidate that names the relevant context directly and removes unnecessary coordinates. Use the same source and questions, including repeated comments within one function, partial context and all supported languages. Adopt a changed layout only if it preserves correct targeting and improves clarity, reuse or measured results. Flattening everything and duplicating function bodies is not an assumed improvement. The official guidance supports clear relationships and fewer indirections, not a particular JSON layout. [State](https://docs.typesafe.ai/concepts/state), [Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Preserve owner-based batching. The current byte limit is an operational bound, not a tokenizer: before increasing it, account for Jev's separate total-request and state-plus-longest-question token limits. This review did not demonstrate a default-limit overflow. [Model limits](https://docs.typesafe.ai/models).

### 3. Give Pi selective access to measurements

[render.ts](../src/render.ts) supports unit IDs and pages, but each unit returns every label. Sorting is descending only; Choice sorting uses the probability of whichever option won.

A reproduced example puts a certainly supported comment ahead of a comment with 0.70 contradiction probability when sorting by `local_consistency`. That is the current sort's definition, not an inference error, but it cannot express “show the largest contradiction probabilities.”

Add a small, explicit retrieval surface:

- Select which labels to return, including their relevant definitions when requested.
- Select ascending or descending order and a named Choice outcome. Pi supplies these choices.
- Retrieve selected units with their frozen context in one response, deduplicating shared excerpts.
- Keep full native distributions accessible, preserve execution/coverage failures, and disclose selections and pagination. Bind cursors to the complete query.

Keep source order as the default. Do not introduce a severity formula, automatic shortlist, threshold, abstention policy or hidden omission of low-ranked results. Keep the existing human inspector and progress UI; presentation changes must also reduce the model-facing payload, not merely collapse it visually.

The existing paired review already motivates this work: both arms reached 8/8 consistency classifications, while the assisted arm used 14,014 Pi tokens versus 3,707 and took longer. Its prompt required exhaustive retrieval, so it does not isolate renderer cost or predict normal selective use. Repeat it with equal review objectives and freedom for Pi to choose which evidence to inspect. [Recorded comparison](evaluation.md).

### 4. Tighten individual questions where there is a specific mismatch

Keep the current 14-label decomposition and native primitives. Multiple purpose Nouls, ordered quality Scores and a four-way consistency Choice fit their jobs.

One concrete wording gap is `restates_visible_code`: its false criterion says the comment adds rationale, constraints or other information. A meaningless comment can fail to restate code without adding useful information. Make false the actual complement of the question, and test nonsense, vague prose, useful rationale and literal restatement.

The long `reader_value` question and whole-comment `local_consistency` question merit focused boundary tests, but length alone does not justify replacing them. Preserve the useful distinction between API documentation and implementation narration, and the separation of contribution from truth. Test mixed supported/contradicted claims, external facts and incomplete descriptions. Change wording only for observed errors or demonstrable ambiguity.

Do not add a claim extractor, a second model to infer reading roles, or a semantic evidence-selection pass. Splitting a fixed pack question may be appropriate if a concrete failure warrants it; building a runtime decomposition workflow is a different product decision.

## Cookbook-by-cookbook reassessment

All 18 cookbooks from the official index and sitemap were revisited. The 18 cookbook snapshots and six supporting pages were fetched again in this pass; all 24 hashes matched the earlier same-day review. Each verdict below concerns this extension's present responsibility, not whether the cookbook is useful elsewhere.

| Cookbook | Useful lesson for Jevvy | Decision under our boundary |
| --- | --- | --- |
| [Self-consistency: nouls](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) | Preserve probabilities; distinguish repeatability from correctness. Its fresh UID changes the input between repeats. | Use identical inputs and bypass the development cache when measuring variation. Do not copy its illustrative review band or human routing. |
| [Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) | A winning label can flip while the distribution changes little; top probability and provider confidence differ. | Keep distributions visible. Do not convert low confidence into a new Jevvy verdict or import its threshold. |
| [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) | Share state across independent questions. Its timing comparison sums sequential single requests, and its answer comparison reduces distributions to scalars. | Retain current batching. Compare full answers when testing packet changes; do not promise the tutorial's speedup for our workload. |
| [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe) | A model can judge candidate relevance, but only among candidates supplied. | No new repository retrieval or relevance policy. Pi owns deciding what further source to investigate. |
| [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find) | Exact IDs make bounded selections traceable; a relative winner does not establish that a valid answer exists. | Improve direct target identification. Preserve explicit unknown/absence outcomes. Do not add a semantic span-search stage. |
| [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat) | Explicit syntax belongs in code; precise questions outperform broad wording. Independent companion questions can share a request. | Strengthen extraction and exact criteria. No semantic reformatting or reconstruction of source. |
| [Function calling](https://docs.typesafe.ai/cookbooks/function_calling) | Closed types and explicit absence prevent invented arguments. | Existing typed tools already serve this purpose. A second dispatcher duplicates Pi's work. |
| [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion) | A compact index can lead to detailed evidence retrieval; confident wrong suggestions can harm the agent. | Apply selective retrieval to existing results. Do not recommend packs or inject a chosen action into Pi's instructions. |
| [Entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment) | Companion measurements can share context. An expected Score can conceal very different distributions. | Keep native distributions and exact occurrence identities. No semantic merging of comments or routing by rounded Score. |
| [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) | Separate semantic measurements from the policy consuming them; keep source untrusted. | Preserve distinct labels. The passage filtering and routing policy belongs outside Jevvy's bridge. |
| [Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check) | Exact-source validation and semantic support are separate jobs. | Keep and strengthen excerpt provenance. A new claim-generation or review-verification tool does not follow from this lesson. |
| [Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails) | Questions supply assessments; the application supplies action policy. | Here Pi supplies the action policy. Withdraw the earlier proposal for a Jevvy review queue with thresholds and precedence. |
| [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade) | Specific source-grounded verification can help a generator correct output. Its generation/escalation loop is a separate responsibility. | Jevvy supplies the assessment step. Pi owns generating, investigating and revising. No cascade engine. |
| [Date extraction](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook) | Exact calculations and validation belong in code; semantic reading belongs to Jev. | Retain deterministic range/hash/schema work. No new numeric-contract feature or inferred defaults. |
| [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) | Candidates and copied output can stay anchored to original text. | Reinforces AST extraction and source identity. No need to add candidate selection to every comment or deduplicate distinct occurrences by text. |
| [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) | Bounded choices can support a search algorithm; its normalized path score is a ranking heuristic. | No relevant hierarchy needs traversal today. Keep overlapping purposes independent; do not add beam search or pack routing. |
| [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) | Test proposed questions against held-out outcomes and compare simple baselines. | Use focused offline pack experiments. Do not add runtime question generation, a learned quality score or a research framework as a prerequisite. |
| [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence) | Distributions can inform the consumer about uncertain specificity. | Preserve the answer. No automatic coarsening: today's consistency outcomes do not form the required hierarchy. |

Confidence remains a statistic derived from an answer's distribution, not independent verification. Sample cutoffs, means, maxima and rounded scores in the tutorials are application policies; they are not default Jevvy requirements. [Confidence reference](https://docs.typesafe.ai/confidence).

## What stays

The pass covered every runtime module under `src/`, all ten test files, the product/contract/evaluation documentation and the live/paired-evaluation entry points. Existing strengths worth preserving:

- Explicit scope, captured source and diff-based selection, including associated-code edits.
- Shared context, fixed definitions, explicit context prerequisites and bounded execution.
- SDK-managed retries, cancellation and retained partial answers.
- Native answer validation, immutable bundles, pinned-model cache checks and frozen source retrieval.
- Progress and inspector UI, with coverage separate from semantic quality.

The engine and bundle contract are comments-specific today. Extract a shared pack interface when the second real pack needs one. Functions and tests remain product directions, not work required to repair this handoff.

## Implementation sequence and verification

1. **Fix the three reproduced defects.** Regression cases for Rust attributes and attribute-only diffs; source freshness from root/subdirectories and different checkouts; pinned models and both documented aliases. Re-run the small live Rust comparison after the extractor repair.
2. **Improve deterministic retrieval.** Add label selection, explicit outcome/direction sorting and an optional combined evidence view. Check pagination, ties, missing answers, shared context and unchanged native values. Replay saved bundles to measure output size before paying for new inference.
3. **Evaluate the request projection and precise rubric repair.** Change one variable at a time. Include repeated occurrences, relocation-only edits, long comments, missing context, external claims and adversarial source. Keep a candidate only when it earns its complexity.
4. **Repeat real Pi use.** Exercise scan, selective retrieval, evidence inspection, cancellation and errors in Pi/tmux; compare source-only and assisted reviews on the same tasks. Count incorrect findings, missed issues, source-location errors, tokens and time. Expand the tasks beyond the easy existing fixture. Do not claim calibration from repeated agreement or a general code-quality gain from a small synthetic set.

Version any changed request or bundle contract deliberately. [validate.ts](../src/validate.ts) currently reconstructs saved questions using today's `questionFor` template. Changing that template or the closed request schema can make old bundles unreadable. Preserve the old reader rules for old versions and test a saved old bundle; do not weaken validation to accept arbitrary substituted evidence. Update extraction/pack identities so corrected requests cannot reuse stale answers.

No release ceremony is included. Completion means the relevant defects are repaired, the handoff is measurably usable, and the evidence above is updated with actual results.

## Evidence from this reassessment

- `npm run check`: type checking, all **69 tests**, and build passed on this macOS checkout.
- Six deterministic probes demonstrated the context omission, missed attribute-only selection, false freshness warning, alias rejection, current Choice sorting and location-only request-hash change.
- Seven live Jev requests: six paired context requests and one complete 14-question preview-alias scan. The latter reproduced the rejection of resolved-model answers.
- No new Linux, terminal UI or broader Pi comparison was run in this pass. Existing reports are earlier evidence; passing unit tests does not establish semantic accuracy.
- Ignored reproducible artifacts: `.artifacts/cookbook-review/reassessment-probes.mjs`, `reassessment-probes.json`, `reassessment-live.mjs`, `reassessment-live.json`, `reassessment-refresh.json`, and the source `manifest.json`.

This assessment records the pre-implementation findings. The approved repairs,
retrieval controls and request projection have since been implemented; see
[handoff verification](handoff-verification.md) for results and remaining limitations.
