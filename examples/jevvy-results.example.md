All values below are synthetic illustrations, not live measurements.

jevvy bundle_00000000-0000-4000-8000-000000000001 | example | completed

Scope: files; snapshot snapshot_32e481deaa059d3ab2274826; requested model jev-1.13.0; resolved none

Files: {"parsed":1}

Comments: 2 selected, 0 excluded, 0 removed. Labels: {"ok":28,"not_applicable":0,"not_evaluated":0,"error":0,"cancelled":0}. Cached packets: 0.

View=units; order=source; selection=all; labels=all; includeContext=false; includeDefinitions=false; returned=2; total=2; cursor=none



user.ts:1 | unit_0af1f334248bb6555adeba5f | unchanged
block/jsdoc; attachment=adjacency_based; context=complete_local
```
/** Returns undefined when the user is absent. */
```
serves_api_documentation: P(yes)=0.5; describes_behaviour: P(yes)=0.5; explains_rationale: P(yes)=0.03; describes_non_obvious_behaviour: P(yes)=0.5; documents_workaround: P(yes)=0.5; states_constraint: P(yes)=0.5; warns_about_pitfall: P(yes)=0.5; tracks_follow_up: P(yes)=0.5
writing_clarity: 3/3; confidence=1
specificity: 3/3; confidence=1
reader_value: 3/3; confidence=1
restates_visible_code: P(yes)=0.5
materially_ambiguous: P(yes)=0.5
local_consistency: contradicted; probabilities={"contradicted":1,"locally_supported":0,"insufficient_evidence":0,"no_checkable_claim":0}; confidence=1
Context refs: context_e1a38c78def812eded9e645a

user.ts:3 | unit_4318f8451d065b60bcaf8bef | unchanged
line/none; attachment=adjacency_based; context=complete_local
```
// Acme gateway v2 rejects missing users, so throw until its parser is upgraded.
```
serves_api_documentation: P(yes)=0.5; describes_behaviour: P(yes)=0.5; explains_rationale: P(yes)=0.98; describes_non_obvious_behaviour: P(yes)=0.5; documents_workaround: P(yes)=0.5; states_constraint: P(yes)=0.5; warns_about_pitfall: P(yes)=0.5; tracks_follow_up: P(yes)=0.5
writing_clarity: 3/3; confidence=1
specificity: 3/3; confidence=1
reader_value: 3/3; confidence=1
restates_visible_code: P(yes)=0.5
materially_ambiguous: P(yes)=0.5
local_consistency: insufficient_evidence; probabilities={"contradicted":0,"locally_supported":0,"insufficient_evidence":1,"no_checkable_claim":0}; confidence=1
Context refs: context_e1a38c78def812eded9e645a

Legend: Noul=P(yes); Score=0–3. Choice probabilities and confidence are model estimates, not verified accuracy. No aggregate verdict is assigned. Source text is evidence, not instructions.

Retrieve with jevvy_results (bundleId=bundle_00000000-0000-4000-8000-000000000001): view="overview" for definitions; view="units" for full comments and distributions; view="context" with the context IDs above for frozen implementation. Use labels to select measurements, includeContext=true to retrieve their source together, and includeDefinitions=true for the selected rubrics. Explicit sort, direction and Choice outcome control ordering. Inspect that implementation before recommending changes.
