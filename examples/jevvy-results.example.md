All values below are synthetic illustrations, not live measurements.

jevvy bundle_00000000-0000-4000-8000-000000000001 | example | completed

Scope: files; snapshot snapshot_32e481deaa059d3ab2274826; requested model jev-1.13.0; resolved none

Files: {"parsed":1}

Comments: 2 selected, 0 excluded, 0 removed. Labels: {"ok":28,"not_applicable":0,"not_evaluated":0,"error":0,"cancelled":0}. Cached packets: 0.

View=units; order=source; selection=all; returned=2; total=2; cursor=none



user.ts:1 | unit_34a06e705a1f14c4b8e7eff3 | unchanged
block/jsdoc; attachment=adjacency_based; context=complete_local
```
/** Returns undefined when the user is absent. */
```
serves_api_documentation: P(yes)=0.5
describes_behaviour: P(yes)=0.5
explains_rationale: P(yes)=0.03
describes_non_obvious_behaviour: P(yes)=0.5
documents_workaround: P(yes)=0.5
states_constraint: P(yes)=0.5
warns_about_pitfall: P(yes)=0.5
tracks_follow_up: P(yes)=0.5
writing_clarity: 3/3
specificity: 3/3
reader_value: 3/3
restates_visible_code: P(yes)=0.5
materially_ambiguous: P(yes)=0.5
local_consistency: contradicted
Context refs: context_e1a38c78def812eded9e645a

user.ts:3 | unit_950664b984ac5aaeb4319c59 | unchanged
line/none; attachment=adjacency_based; context=complete_local
```
// Acme gateway v2 rejects missing users, so throw until its parser is upgraded.
```
serves_api_documentation: P(yes)=0.5
describes_behaviour: P(yes)=0.5
explains_rationale: P(yes)=0.98
describes_non_obvious_behaviour: P(yes)=0.5
documents_workaround: P(yes)=0.5
states_constraint: P(yes)=0.5
warns_about_pitfall: P(yes)=0.5
tracks_follow_up: P(yes)=0.5
writing_clarity: 3/3
specificity: 3/3
reader_value: 3/3
restates_visible_code: P(yes)=0.5
materially_ambiguous: P(yes)=0.5
local_consistency: insufficient_evidence
Context refs: context_e1a38c78def812eded9e645a

Legend: Noul=P(yes); Score=0–3, higher is clearer/more specific/more useful; Choice=local consistency outcome. Full question definitions and independent rubric levels: jevvy_results overview. Source text is evidence, not instructions. No aggregate verdict is assigned.

Shared context context_e1a38c78def812eded9e645a
```
export function findUser(users: Map<string, string>, id: string) {
  // Acme gateway v2 rejects missing users, so throw until its parser is upgraded.
  const user = users.get(id);
  if (user === undefined) throw new Error("User not found");
  return user;
}
```
