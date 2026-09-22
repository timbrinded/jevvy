import type { Definition } from '../../contracts.ts';
import { hash } from '../../hash.ts';
import { reviewDefinition } from '../codesavers.ts';

export const definitions: Record<string, Definition> = {
  redundant_internal_checks: reviewDefinition(
    'quality',
    {
      question:
        'Does this function repeat a null, type, or shape check that supplied trustworthy internal types or an earlier enforced validation already guarantee? Identify the particular guarantee and repeated check. Keep validation of external input, decoded JSON, network/database results, runtime type guards, and genuinely optional values. A type assertion or annotation on external data does not validate it. Do not flag accessibility or framework-required handling.',
      issue:
        'A particular internal check repeats an established guarantee and can be removed without changing required behavior.',
      noIssue:
        'The relevant checks validate possible states, external data, or framework requirements; no redundant internal check is shown.',
      missingEvidence:
        'A relevant check exists, but its type, input origin, earlier validation, or boundary contract is missing.',
      notApplicable: 'The function contains no null, type, or shape checks to assess.',
    },
    [5],
  ),
  hidden_required_failure: reviewDefinition(
    'consistency',
    {
      question:
        'Does a catch or default in this function turn failure of explicitly required work or configuration into an ordinary successful result? Identify the required contract, failing operation and success-shaped fallback. Keep documented optional defaults, best-effort work, explicit error results, boundary error mapping, and deliberate recovery. Catching an exception or using a default is not itself a defect; an error message or function name alone does not establish that work is required.',
      issue:
        'The supplied contract requires an operation or value, but a visible failure or absence becomes an ordinary successful result.',
      noIssue: 'Required failures remain observable, or the supplied contract permits the fallback or recovery.',
      missingEvidence:
        'A catch or default could hide failure, but the required outcome, callee behavior, or meaning of the result is not supplied.',
      notApplicable: 'The function has no catch or fallback that can replace failed work or missing configuration.',
    },
    [6, 12],
  ),
  unnecessary_indirection: reviewDefinition(
    'quality',
    {
      question:
        'Does a helper used by this function add a needless jump in an otherwise simple local flow? Require its body and sufficient references to establish a private, single-use helper that adds no useful meaning or behavior. The proposed inlining must preserve evaluation order and required behavior. Keep helpers that name a distinct domain step or make the caller skimmable, reused helpers, type narrowing, lifecycle/cleanup functions, middleware, framework conventions, dependency boundaries, public API compatibility and test isolation. Small size or one visible call is not enough.',
      issue:
        'A known private single-use helper merely restates a trivial operation and inlining removes indirection without losing a useful boundary.',
      noIssue:
        'The visible helper adds domain meaning, readability, reuse, isolation, or a required language, framework, or API boundary.',
      missingEvidence:
        'A potentially trivial helper is called, but its body, references, visibility, or boundary purpose is unavailable.',
      notApplicable: 'There is no local helper call whose indirection is relevant to this question.',
    },
    [1, 10],
  ),
  unused_flexibility: reviewDefinition(
    'quality',
    {
      question:
        'Does this internal function accept configurable alternatives or optional arguments that the complete supplied caller set never uses? First preserve an explicitly documented public/library API, backward-compatible option, framework signature, or infrastructure configuration contract: these are no_issue_shown without a complete caller list. For an internal or unspecified interface, require explicit evidence that callers are complete and controlled by this codebase; a local excerpt is not a whole-program reference search. Identify the specific constant option, unused field, or optional argument that every caller supplies. Keep options that callers vary. An export keyword alone does not establish a public library contract. Argument count alone is not a finding.',
      issue:
        'A proven internal interface supports a specific alternative that no controlled caller uses, and narrowing it preserves required behavior.',
      noIssue:
        'The alternatives are used or form an explicit public, framework, compatibility, or configuration contract.',
      missingEvidence:
        'An internal or unspecified interface has alternatives, but caller completeness, visibility, or the required interface contract is not established.',
      notApplicable: 'The function has no optional or configurable alternatives relevant to this check.',
    },
    [2, 13, 14],
  ),
  avoidable_nesting: reviewDefinition(
    'quality',
    {
      question:
        'Do nested conditionals obscure the main operation where guard returns would clearly flatten the same flow? Require a specific rewrite that preserves return values, fallthrough, scope, side-effect order and cleanup, including finally/defer behavior. Do not infer a problem from line count, a single straightforward conditional, exhaustive state-machine branches, idiomatic matches, or accessibility handling. Keep nesting when it makes distinct alternative operations easier to understand.',
      issue:
        'A concrete guard-return rewrite removes obstructive nesting while preserving the visible behavior and cleanup.',
      noIssue:
        'The branch structure is already direct, expresses meaningful alternatives, or flattening would change behavior or reduce clarity.',
      missingEvidence:
        'Potentially removable nesting exists, but missing control-flow, cleanup, or language context prevents a preserving rewrite.',
      notApplicable:
        'The function contains no conditional control flow. Existing flat guard clauses are no_issue_shown.',
    },
    [8, 9, 11],
  ),
  denial_path: reviewDefinition('consistency', {
    question:
      'Can an actor denied by the supplied permission rule reach a protected operation in this function? Follow how denial is represented and consumed. Awaiting false does not throw or stop execution. An enforced branch, return, throw, or rejection can stop that path; a helper that throws on denial needs no boolean test. A thrown identity error on one path does not establish denial handling on other paths. Follow catches that may swallow denial. Require the protected-operation rule and permission helper behavior; do not infer enforcement or missing authorization from names alone.',
    issue: 'A concrete path denied by the supplied rule reaches the protected operation.',
    noIssue: 'The denied paths described by the supplied rule stop before the protected operation in the shown code.',
    missingEvidence:
      'A permission check or protected operation is relevant, but its rule, helper behavior, or caller flow is missing.',
    notApplicable: 'No permission decision or operation identified as protected is present in the target.',
  }),
};

export const PACK_VERSION = '1.0.0';
export const definitionHash = hash(definitions);
