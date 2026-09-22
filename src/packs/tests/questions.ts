import type { Definition } from '../../contracts.ts';
import { hash } from '../../hash.ts';
import { reviewDefinition } from '../codesavers.ts';

export const definitions: Record<string, Definition> = {
  owned_behavior: reviewDefinition(
    'quality',
    {
      question:
        "Do this test's assertions only repeat behavior owned by an external dependency, leaving no application-owned purpose? Require a supplied manifest identifying the dependency, the asserted operation or wrapper implementation, and enough contract context to trace what determines the expected result. An external import or a thin wrapper alone is not a finding. Keep application-specific configuration, mapping, validation, transformation, error handling, integration, deliberately exposed contracts, and documented compatibility regressions. A package used for assertions, fixtures, or test infrastructure does not make the test dependency-owned. Group repeated dependency-only cases as one candidate; do not prescribe mocks merely to avoid executing a dependency.",
      issue:
        'The manifest and traced assertion establish dependency-only behavior, with no protected local decision, contract, integration, or compatibility purpose in the supplied evidence.',
      noIssue:
        'The assertions protect an identified application-owned behavior, configuration, integration, contract, or regression.',
      missingEvidence:
        'Ownership cannot be established because the manifest, implementation, configuration, or contract context is missing.',
      notApplicable:
        'The tested operation does not involve external dependency behavior; test infrastructure alone is not a subject dependency.',
    },
    [15],
  ),
  claim_assertion_gap: reviewDefinition('consistency', {
    question:
      'Does this test claim a concrete observable result that its assertions do not inspect? Use its name and supplied contract as a description of intent, then compare the asserted values with that result. Identify a specific claimed output, state change or interaction left unchecked, such as checking only truthiness instead of an empty collection. Assertion aliases and framework matchers need their semantics supplied. Keep deliberate smoke tests and checks of an explicitly narrower contract. Do not decide whether exception paths, async scheduling, or an entire suite must pass or fail; this check compares the claimed observation with the assertion targets.',
    issue:
      'A concrete result claimed by the test is not inspected by its assertions, or an unrelated weak assertion is substituted for that result.',
    noIssue:
      'The assertions inspect the claimed observable result at the stated scope, including a deliberately narrow smoke-test contract.',
    missingEvidence:
      'The claimed result, assertion semantics, aliases, or relevant setup are missing, so their relationship cannot be decided.',
    notApplicable: 'The target states no concrete observable claim that can be compared with assertions.',
  }),
  mock_bypasses_subject: reviewDefinition('consistency', {
    question:
      "Does a mock replace the very behavior this test claims to exercise, so the assertion only observes the substitute's supplied result? Trace the configured replacement through the invoked subject to the asserted value. Keep mocks of external collaborators when the test still exercises local mapping, decisions, error handling, orchestration or interactions. A mocked dependency is not itself a gap, and an interaction test can legitimately assert calls. Require the test's claim, mock behavior, and relevant subject implementation; do not infer the boundary from a mock variable name.",
    issue:
      'The claimed subject behavior is replaced by a configured mock, and the assertions only confirm the substitute rather than that claimed behavior.',
    noIssue:
      'The replacement isolates a collaborator while the assertions still inspect the claimed local behavior or interaction.',
    missingEvidence:
      'The replacement, claimed boundary, or subject implementation is not supplied well enough to trace the asserted result.',
    notApplicable: "No mock, stub, fake, or injected replacement participates in the test's claimed behavior.",
  }),
  shared_expected_logic: reviewDefinition('consistency', {
    question:
      "Does an ordinary example-based assertion compute its expected value by repeating the production decision it claims to check? Inspect the expected expression first: an expectation made only from literal numbers, strings, arrays, or objects is no_issue_shown for this check. Repeating literal constants is not recomputing an algorithm, even when a production function or configured mock returns those same constants. Next identify the test's claim. A relational property deliberately compares related executions: idempotence f(f(x)) = f(x), commutativity f(a,b) = f(b,a), an encode/decode round trip, or repeatability/determinism for the same input can constrain behavior without an independent value oracle. Such a comparison is no_issue_shown when it actually asserts that claimed relationship. Comparing f(x) with another f(x) is an issue for an ordinary correct-value claim, but is legitimate when the stated claim is repeatability or determinism. Otherwise trace actual and expected: require a visible shared call or the same nontrivial calculation/branch policy. Similar syntax and shared fixture inputs are not enough. Keep independent reference implementations and separate specifications. Identify only a shared computation that defeats the stated comparison; another defect in the test belongs to another check.",
    issue:
      'An ordinary value assertion repeats the same operation on the same input or copies its decision logic, without asserting a distinct claimed relational property.',
    noIssue:
      'The expectation is a literal value, array, or object without a repeated computation, comes from an independent reference, or checks a stated relational property across executions, including idempotence, commutativity, or same-input repeatability/determinism.',
    missingEvidence:
      'The subject or expected-value helper is missing, or independence cannot be determined from the supplied evidence.',
    notApplicable:
      'The test has no actual-versus-expected result assertion. An independently specified literal expectation is no_issue_shown.',
  }),
  irrelevant_fixture_setup: reviewDefinition(
    'quality',
    {
      question:
        "Does this test construct specific fixture state or perform setup that neither its subject, assertions, nor lifecycle requires? Require the relevant subject, helper and hook behavior before deciding that fields or operations are unused; constructor/schema requirements and side effects count as uses. Name a concrete removal that preserves the test's owned behavior and readability. Explicit setup, literal fixtures, detailed expected objects, repeated setup across independent tests, mock factories, and isolation hooks are legitimate. Field count, test length, or duplication alone is not a finding.",
      issue:
        'Specific fixture fields, objects, or setup operations are proven irrelevant to the exercised behavior and can be removed without losing isolation, requirements, or clarity.',
      noIssue:
        'The visible setup supports the exercised behavior, construction requirements, isolation, lifecycle, or independent readability.',
      missingEvidence:
        'Potentially irrelevant setup exists, but subject reads, helper effects, fixture requirements, or hooks are not supplied.',
      notApplicable: 'The target has no fixture construction or setup state relevant to this check.',
    },
    [2, 8],
  ),
};

export const PACK_VERSION = '1.0.0';
export const definitionHash = hash(definitions);
