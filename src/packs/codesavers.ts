import type { Definition } from '../contracts.ts';

export const CODESAVERS_COMMIT = '8f30541ac6b793a499a7c6d59b83982932e2a328';
export const CODESAVERS_URL = `https://github.com/timbrinded/kiln/blob/${CODESAVERS_COMMIT}/plugins/unslop/skills/codesaver/references/code-quality-directives.md`;

type ReviewRubric = {
  question: string;
  issue: string;
  noIssue: string;
  missingEvidence: string;
  notApplicable: string;
};

export function reviewDefinition(
  group: 'quality' | 'consistency',
  rubric: ReviewRubric,
  directives?: number[],
): Definition {
  return {
    group,
    primitive: 'choice',
    requires: 'complete_target',
    question: `${rubric.question} Judge only the target and supplied evidence. A helper name, missing context, or absence of a visible caller is not proof. Report a concrete local issue only; do not certify the function, test, or suite as correct.`,
    criteria: {
      issue: rubric.issue,
      no_issue_shown: rubric.noIssue,
      insufficient_evidence: rubric.missingEvidence,
      not_applicable: rubric.notApplicable,
    },
    ...(directives ? { source: { url: CODESAVERS_URL, directives } } : {}),
  };
}
