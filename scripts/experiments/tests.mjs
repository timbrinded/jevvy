import { choice } from '@typesafe-ai/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { runBatch } from './query.mjs';

const outputRoot = '.artifacts/pack-experiments/tests';
const evidenceRule = 'Use only the supplied source and contract. Do not infer the body of an omitted helper.';

const ideas = [
  {
    id: 'claim',
    title: 'Claim versus observable assertion',
    question: 'Does this test verify the behavior claimed by its name?',
    criteria: {
      verified: 'The visible assertions verify the named behavior.',
      gap: 'The visible assertions could pass while the named behavior is false.',
      unknown: 'An omitted helper or missing contract prevents deciding what is verified.',
    },
    cases: [
      ['verified', { test: "test('sorts numerically', () => { assert.deepEqual(sort([10, 2]), [2, 10]); });" }],
      ['gap', { test: "test('sorts numerically', () => { assert.equal(sort([10, 2]).length, 2); });" }],
      [
        'unknown',
        {
          test: "test('sorts numerically', () => { checkSort(sort([10, 2])); });",
          omitted: 'checkSort is imported; its body is unavailable.',
        },
      ],
    ],
  },
  {
    id: 'mutant',
    title: 'Concrete mutant discrimination',
    question: 'Would the supplied test fail when run against the replacement implementation?',
    criteria: {
      killed: 'The replacement causes an assertion to fail.',
      survives: 'The replacement passes all visible assertions.',
      unknown: 'Missing helper definitions or runtime behavior prevent deciding.',
    },
    cases: [
      [
        'killed',
        {
          original: 'function unique(xs) { return [...new Set(xs)]; }',
          replacement: 'function unique(xs) { return xs; }',
          test: 'assert.deepEqual(unique([1, 1, 2]), [1, 2]);',
        },
      ],
      [
        'survives',
        {
          original: 'function unique(xs) { return [...new Set(xs)]; }',
          replacement: 'function unique(xs) { return xs; }',
          test: 'assert.deepEqual(unique([1, 2]), [1, 2]);',
        },
      ],
      [
        'unknown',
        {
          replacement: 'function unique(xs) { return xs; }',
          test: 'assert.deepEqual(unique(sample()), expected());',
          omitted: 'sample and expected are imported and unavailable.',
        },
      ],
    ],
  },
  {
    id: 'error',
    title: 'Specific error contract',
    question: 'Does the test verify the required error contract?',
    criteria: {
      specific: 'The assertions distinguish the required error from unrelated failures.',
      broad: 'The assertions accept unrelated failures or do not require an error.',
      unknown: 'The assertion helper or error contract is unavailable.',
    },
    cases: [
      [
        'specific',
        {
          contract: 'load rejects with an error whose code is E_PERMISSION when access is denied.',
          test: "await assert.rejects(() => load('private'), { code: 'E_PERMISSION' });",
        },
      ],
      [
        'broad',
        {
          contract: 'load rejects with an error whose code is E_PERMISSION when access is denied.',
          test: "await assert.rejects(() => load('private'));",
        },
      ],
      [
        'unknown',
        {
          contract: 'load rejects with an error whose code is E_PERMISSION when access is denied.',
          test: "await expectDenied(() => load('private'));",
          omitted: 'expectDenied is imported and unavailable.',
        },
      ],
    ],
  },
  {
    id: 'mock',
    title: 'Mock bypasses behavior under test',
    question: 'Does mocking bypass the claimed behavior in this test?',
    criteria: {
      bypass: 'The test replaces the implementation responsible for the claimed behavior and asserts the stub result.',
      exercised: 'The claimed behavior is executed; mocks replace only a boundary outside that behavior.',
      unknown: 'The implementation or mock boundary is missing, so execution of the behavior cannot be determined.',
    },
    cases: [
      [
        'bypass',
        {
          contract: 'send retries once when transport throws.',
          test: "test('retries after transport error', async () => { const send = mock.fn(async () => 'ok'); assert.equal(await send(), 'ok'); });",
        },
      ],
      [
        'exercised',
        {
          contract: 'send retries once when transport throws.',
          implementation:
            'async function send(transport) { try { return await transport(); } catch { return await transport(); } }',
          test: "const transport = mock.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok'); assert.equal(await send(transport), 'ok'); assert.equal(transport.mock.calls.length, 2);",
        },
      ],
      [
        'unknown',
        {
          contract: 'send retries once when transport throws.',
          test: "const send = makeSenderFixture(); assert.equal(await send(), 'ok');",
          omitted: 'makeSenderFixture is imported; its body is unavailable.',
        },
      ],
    ],
  },
  {
    id: 'async',
    title: 'Async outcome observed before completion',
    question: 'Does the test runner wait for the asynchronous assertion?',
    criteria: {
      waited: 'The assertion is awaited, returned, or completed through an explicit runner callback.',
      detached: 'The test can finish before the asynchronous assertion runs.',
      unknown: 'Runner or helper completion semantics are not supplied.',
    },
    cases: [
      [
        'waited',
        {
          framework: 'node:test. A returned Promise is awaited by the runner.',
          test: "test('loads', async () => { const value = await load(); assert.equal(value, 3); });",
        },
      ],
      [
        'detached',
        {
          framework: 'node:test. A returned Promise is awaited by the runner.',
          test: "test('loads', () => { load().then(value => { assert.equal(value, 3); }); });",
        },
      ],
      [
        'unknown',
        {
          test: "customTest('loads', () => { runCheck(async () => assert.equal(await load(), 3)); });",
          omitted: 'customTest and runCheck are imported; their scheduling semantics are unavailable.',
        },
      ],
    ],
  },
  {
    id: 'boundary',
    title: 'Exact boundary behavior covered',
    question: 'Does the suite assert both sides of the precise boundary required by the contract?',
    criteria: {
      covered: 'Assertions check the exact boundary and its immediately adjacent input.',
      gap: 'Visible cases miss the exact boundary or the adjacent input needed to distinguish inclusive from exclusive behavior.',
      unknown: 'Test data, assertion helper, or the boundary rule is unavailable.',
    },
    cases: [
      [
        'covered',
        {
          contract: 'canEnter(age) is true for integer ages >= 18.',
          test: 'assert.equal(canEnter(17), false); assert.equal(canEnter(18), true);',
        },
      ],
      [
        'gap',
        {
          contract: 'canEnter(age) is true for integer ages >= 18.',
          test: 'assert.equal(canEnter(16), false); assert.equal(canEnter(21), true);',
        },
      ],
      [
        'unknown',
        {
          contract: 'canEnter(age) is true for integer ages >= 18.',
          test: 'for (const row of ageCases) assert.equal(canEnter(row.age), row.allowed);',
          omitted: 'ageCases is imported and its rows are unavailable.',
        },
      ],
    ],
  },
  {
    id: 'oracle',
    title: 'Expected result shares production decision logic',
    question:
      'Is the expected result independently specified rather than calculated with the same production decision logic?',
    criteria: {
      independent: 'The expected result is a literal, external contract, or independently specified reference.',
      shared: 'The expected result calls the same implementation or same decision helper as the actual result.',
      unknown: 'The expected-value computation or implementation is missing.',
    },
    cases: [
      [
        'independent',
        {
          implementation:
            'function total(price) { return withTax(price); } function withTax(price) { return price * 1.2; }',
          test: 'assert.equal(total(100), 120);',
        },
      ],
      [
        'shared',
        {
          implementation:
            'function total(price) { return withTax(price); } function withTax(price) { return price * 1.2; }',
          test: 'assert.equal(total(100), withTax(100));',
        },
      ],
      [
        'unknown',
        {
          implementation: 'function total(price) { return withTax(price); }',
          test: 'assert.equal(total(100), expectedTotal(100));',
          omitted: 'withTax and expectedTotal are imported; their definitions are unavailable.',
        },
      ],
    ],
  },
  {
    id: 'isolation',
    title: 'Cross-test shared-state dependence',
    question: 'Can the supplied tests give different outcomes when their execution order changes?',
    criteria: {
      order_dependent: 'One test changes state observed by another without a visible reset.',
      isolated: 'Each test receives fresh state or the state is reset between tests.',
      unknown: 'Missing fixture lifecycle or setup prevents deciding.',
    },
    cases: [
      [
        'order_dependent',
        {
          framework: 'Tests run sequentially in the same process.',
          suite:
            "const users = []; test('adds', () => { users.push('Ada'); assert.equal(users.length, 1); }); test('empty', () => { assert.equal(users.length, 0); });",
        },
      ],
      [
        'isolated',
        {
          framework: 'Tests run sequentially; beforeEach runs before every test.',
          suite:
            "let users; beforeEach(() => { users = []; }); test('adds', () => { users.push('Ada'); assert.equal(users.length, 1); }); test('empty', () => { assert.equal(users.length, 0); });",
        },
      ],
      [
        'unknown',
        {
          suite:
            "const users = sharedFixture(); test('adds', () => { users.add('Ada'); }); test('empty', () => { assert.equal(users.count(), 0); });",
          omitted: 'sharedFixture and global lifecycle hooks are unavailable.',
        },
      ],
    ],
  },
  {
    id: 'property',
    title: 'Metamorphic property admits degenerate implementation',
    question: 'Would the property test reject the supplied degenerate implementation?',
    criteria: {
      rejects: 'At least one visible property assertion fails for the degenerate implementation.',
      accepts: 'All visible property assertions hold for the degenerate implementation.',
      unknown: 'Generators, helpers, or relevant property details are unavailable.',
    },
    cases: [
      [
        'rejects',
        {
          contract: 'normalize removes duplicate items.',
          replacement: 'function normalize(xs) { return []; }',
          test: 'for (const xs of [[1, 2], [1, 1]]) { const result = normalize(xs); for (const x of xs) assert.ok(result.includes(x)); }',
        },
      ],
      [
        'accepts',
        {
          contract: 'normalize removes duplicate items.',
          replacement: 'function normalize(xs) { return []; }',
          test: 'for (const xs of [[1, 2], [1, 1]]) { assert.deepEqual(normalize(normalize(xs)), normalize(xs)); }',
        },
      ],
      [
        'unknown',
        {
          contract: 'normalize removes duplicate items.',
          replacement: 'function normalize(xs) { return []; }',
          test: 'for (const xs of generatedCases()) assertProperty(normalize, xs);',
          omitted: 'generatedCases and assertProperty are unavailable.',
        },
      ],
    ],
  },
  {
    id: 'scenario',
    title: 'Missing scenario from an explicit contract',
    question: 'Which contract scenario is missing from the visible test suite?',
    criteria: {
      missing_record: 'The suite does not assert behavior when the requested record does not exist.',
      forbidden: 'The suite does not assert behavior when an existing record belongs to another user.',
      none: 'The suite asserts both missing-record and wrong-owner behavior.',
      unknown: 'Imported test cases or helpers make scenario coverage unavailable.',
    },
    cases: [
      [
        'missing_record',
        {
          contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
          test: "await assert.rejects(() => read('owned-by-Ada', 'Grace'), { code: 'FORBIDDEN' });",
          fixture: 'owned-by-Ada is an existing record owned by Ada.',
        },
      ],
      [
        'none',
        {
          contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
          test: "await assert.rejects(() => read('missing', 'Ada'), { code: 'NOT_FOUND' }); await assert.rejects(() => read('owned-by-Ada', 'Grace'), { code: 'FORBIDDEN' });",
          fixture: 'missing is absent; owned-by-Ada is an existing record owned by Ada.',
        },
      ],
      [
        'unknown',
        {
          contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
          test: 'await runReadScenarios(read);',
          omitted: 'runReadScenarios is unavailable.',
        },
      ],
    ],
  },
];

function initialCases() {
  return ideas.flatMap(idea =>
    idea.cases.map(([expected, state], index) => ({
      id: `${idea.id}-${index + 1}`,
      state,
      questions: { result: choice(`${idea.question} ${evidenceRule}`, idea.criteria) },
      expected: { result: expected },
    })),
  );
}

async function executionChecks() {
  const records = [];
  for (const [label, implementation, values, expected] of [
    ['dedup-original', xs => [...new Set(xs)], [1, 1, 2], [1, 2]],
    ['dedup-mutant-killed', xs => xs, [1, 1, 2], [1, 2]],
    ['dedup-mutant-survives', xs => xs, [1, 2], [1, 2]],
  ]) {
    try {
      assert.deepEqual(implementation(values), expected);
      records.push({ label, outcome: 'passes' });
    } catch (error) {
      records.push({ label, outcome: 'fails', message: error.message });
    }
  }
  const empty = () => [];
  records.push({
    label: 'empty-normalizer-idempotence',
    outcome: [
      [1, 2],
      [1, 1],
    ].every(xs => JSON.stringify(empty(empty(xs))) === JSON.stringify(empty(xs)))
      ? 'passes'
      : 'fails',
  });
  records.push({
    label: 'empty-normalizer-membership',
    outcome: [
      [1, 2],
      [1, 1],
    ].every(xs => xs.every(x => empty(xs).includes(x)))
      ? 'passes'
      : 'fails',
  });
  const observations = [];
  const delayed = new Promise(resolve => setTimeout(() => resolve(3), 10));
  const detached = () => {
    delayed.then(value => observations.push(value));
  };
  const returned = detached();
  records.push({
    label: 'detached-return',
    returned: String(returned),
    observationsBeforeCompletion: [...observations],
  });
  await delayed;
  records.push({ label: 'detached-completion', observationsAfterCompletion: [...observations] });
  records.push(...executionChecksForFailures());
  records.push(await executionCheckRetry());
  records.push(await executionCheckVacuousCoverage());
  await writeFile(`${outputRoot}/execution-checks.json`, `${JSON.stringify(records, null, 2)}\n`);
}

function executionChecksForFailures() {
  const input = [2, 1];
  const before = input;
  input.sort();
  assert.deepEqual(input, before);
  const user = { preferences: { theme: 'dark' } };
  const snapshot = { ...user };
  user.preferences.theme = 'light';
  assert.deepEqual(user, snapshot);
  const saveWithoutError = () => undefined;
  let errorAssertionRan = false;
  try {
    saveWithoutError('');
  } catch (error) {
    errorAssertionRan = true;
    assert.equal(error.code, 'INVALID');
  }
  const acceptsWrongBoundary = n => n >= 4;
  assert.equal(acceptsWrongBoundary(5), true);
  assert.equal(acceptsWrongBoundary(6), true);
  return [
    { label: 'mutating-sort-alias-assertion', outcome: 'passes', mutatedInput: input },
    { label: 'nested-mutation-shallow-snapshot', outcome: 'passes', mutatedUser: user },
    { label: 'missing-throw-catch-only', outcome: 'passes', errorAssertionRan },
    { label: 'wrong-lower-boundary-5-and-6', outcome: 'passes', violatingInput4Accepted: acceptsWrongBoundary(4) },
  ];
}

async function executionCheckRetry() {
  const send = async transport => {
    try {
      return await transport();
    } catch {
      return await transport();
    }
  };
  let attempts = 0;
  const transport = async () => {
    attempts++;
    if (attempts === 1) throw new Error('offline');
    return 'ok';
  };
  assert.equal(await send(transport), 'ok');
  assert.equal(attempts, 2);
  return { label: 'real-retry-with-boundary-fake', outcome: 'passes', attempts };
}

async function executionCheckVacuousCoverage() {
  const read = async () => 'value';
  let assertions = 0;
  try {
    await read('absent', 'Ada');
  } catch (error) {
    assertions++;
    assert.equal(error.code, 'NOT_FOUND');
  }
  try {
    await read('Ada-row', 'Grace');
  } catch (error) {
    assertions++;
    assert.equal(error.code, 'FORBIDDEN');
  }
  return { label: 'two-scenario-catch-only-suite', outcome: 'passes', assertions };
}

export const baselineQuestions = Object.fromEntries(
  ideas.map(idea => [idea.id, choice(`${idea.question} ${evidenceRule}`, idea.criteria)]),
);

const probes = [
  [
    'claim-side-effect',
    'claim',
    'gap',
    {
      test: "test('sorts without mutating its input', () => { const xs = [2, 1]; assert.deepEqual(sort(xs), [1, 2]); });",
    },
  ],
  [
    'claim-alias',
    'claim',
    'gap',
    {
      test: "test('preserves input', () => { const input = [2, 1]; const before = input; sort(input); assert.deepEqual(input, before); });",
    },
  ],
  [
    'mutant-unreached',
    'mutant',
    'survives',
    {
      original: 'function discount(n) { return n >= 10 ? n - 2 : n; }',
      replacement: 'function discount(n) { return n > 10 ? n - 2 : n; }',
      test: 'assert.equal(discount(11), 9); assert.equal(discount(9), 9);',
    },
  ],
  [
    'mutant-exact',
    'mutant',
    'killed',
    {
      original: 'function discount(n) { return n >= 10 ? n - 2 : n; }',
      replacement: 'function discount(n) { return n > 10 ? n - 2 : n; }',
      test: 'assert.equal(discount(10), 8);',
    },
  ],
  [
    'error-vacuous-catch',
    'error',
    'broad',
    {
      contract: 'save must throw an error with code INVALID for the empty string.',
      test: "try { save(''); } catch (error) { assert.equal(error.code, 'INVALID'); }",
    },
  ],
  [
    'error-class-contract',
    'error',
    'specific',
    {
      contract: 'parse must throw an instance of SyntaxError for malformed JSON.',
      test: "assert.throws(() => parse('{'), SyntaxError);",
    },
  ],
  [
    'mock-real-retry',
    'mock',
    'exercised',
    {
      contract: 'send retries once when transport throws.',
      implementation:
        'async function send(transport) { try { return await transport(); } catch { return await transport(); } }',
      test: "let attempts = 0; const transport = async () => { attempts++; if (attempts === 1) throw new Error('offline'); return 'ok'; }; assert.equal(await send(transport), 'ok'); assert.equal(attempts, 2);",
    },
  ],
  [
    'mock-auth-bypass',
    'mock',
    'bypass',
    {
      contract: 'Service.authorize must reject users that do not own the resource.',
      implementation:
        'async function read(user, resource) { await service.authorize(user, resource); return db.read(resource); }',
      test: "test('rejects non-owner', async () => { service.authorize = async () => { throw new Error('forbidden'); }; await assert.rejects(() => read('Grace', 'Ada-record'), /forbidden/); });",
    },
  ],
  [
    'async-foreach',
    'async',
    'detached',
    {
      framework: 'node:test awaits only the Promise returned by its test callback.',
      test: "test('all loads', async () => { [1, 2].forEach(async id => { assert.equal(await load(id), id); }); });",
    },
  ],
  [
    'async-return-chain',
    'async',
    'waited',
    {
      framework: 'node:test awaits the Promise returned by its test callback.',
      test: "test('load', () => load().then(value => assert.equal(value, 3)));",
    },
  ],
  [
    'boundary-upper',
    'boundary',
    'covered',
    {
      contract: 'A password is accepted if its length is at most 32 ASCII characters.',
      test: "assert.equal(valid('x'.repeat(32)), true); assert.equal(valid('x'.repeat(33)), false);",
    },
  ],
  [
    'boundary-wrong-neighbour',
    'boundary',
    'gap',
    {
      contract: 'At least 5 attempts are required for unlock.',
      test: 'assert.equal(unlock(5), true); assert.equal(unlock(6), true);',
    },
  ],
  [
    'oracle-snapshot-regenerated',
    'oracle',
    'shared',
    {
      implementation: 'function serialize(record) { return JSON.stringify(record); }',
      test: 'const snapshot = serialize(record); assert.equal(serialize(record), snapshot);',
    },
  ],
  [
    'oracle-independent-helper',
    'oracle',
    'independent',
    {
      contract: 'The approved examples specify 100 cents becomes 120 cents after tax.',
      implementation:
        'function total(price) { return withTax(price); } function withTax(price) { return price * 1.2; }',
      test: 'function expectedTotal(price) { return new Map([[100, 120]]).get(price); } assert.equal(total(100), expectedTotal(100));',
    },
  ],
  [
    'isolation-explicit-reset',
    'isolation',
    'isolated',
    {
      framework: 'Tests run sequentially.',
      suite:
        "const cache = new Map(); test('put', () => { cache.clear(); cache.set('x', 1); assert.equal(cache.size, 1); }); test('empty', () => { cache.clear(); assert.equal(cache.size, 0); });",
    },
  ],
  [
    'isolation-environment',
    'isolation',
    'order_dependent',
    {
      framework: 'Tests run sequentially; FEATURE_X is initially absent.',
      suite:
        "test('enabled', () => { process.env.FEATURE_X = '1'; assert.equal(enabled(), true); }); test('off by default', () => { assert.equal(enabled(), false); });",
      implementation: "function enabled() { return process.env.FEATURE_X === '1'; }",
    },
  ],
  [
    'property-symmetry',
    'property',
    'accepts',
    {
      contract: 'sameMembers returns true exactly when two arrays contain the same set of values.',
      replacement: 'function sameMembers(a, b) { return true; }',
      test: 'for (const [a, b] of [[[1], [2]], [[1, 2], [2, 1]]]) assert.equal(sameMembers(a, b), sameMembers(b, a));',
    },
  ],
  [
    'property-ordering',
    'property',
    'rejects',
    {
      contract: 'sortAscending sorts numbers.',
      replacement: 'function sortAscending(xs) { return xs; }',
      test: 'for (const xs of [[2, 1], [1, 3, 2]]) { const ys = sortAscending(xs); for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1] <= ys[i]); }',
    },
  ],
  [
    'scenario-both-missing',
    'scenario',
    'both_missing',
    {
      contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
      test: "assert.equal(await read('owned-by-Ada', 'Ada'), 'value');",
      fixture: 'owned-by-Ada exists, is owned by Ada, and contains value.',
    },
  ],
  [
    'scenario-caught-without-assertion',
    'scenario',
    'missing_record',
    {
      contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
      test: "try { await read('missing', 'Ada'); } catch {} await assert.rejects(() => read('owned-by-Ada', 'Grace'), { code: 'FORBIDDEN' });",
      fixture: 'missing is absent; owned-by-Ada exists and belongs to Ada.',
    },
  ],
];

function casesFor(rows, questions) {
  return rows.map(([id, idea, expected, state]) => ({
    id,
    state,
    questions: { result: questions[idea] },
    expected: { result: expected },
  }));
}

export const finalQuestions = {
  ...baselineQuestions,
  claim: choice(
    {
      question: 'For the supplied inputs, do the visible assertions establish every behavior claimed by the test name?',
      method:
        'Follow actual values and object identities. A before-value that aliases a mutable input is not a preserved snapshot. Ask whether the assertions can pass while a named behavior is false. Do not demand proof for untested inputs.',
      evidence: evidenceRule,
    },
    ideas[0].criteria,
  ),
  error: choice(
    {
      question: 'Does this test both require the operation to fail and distinguish the error required by the contract?',
      method:
        'Check the path where the operation returns successfully as well as the error path. A catch block with an error assertion does not require an exception if the no-exception path contains no failure assertion.',
      evidence: evidenceRule,
    },
    ideas[2].criteria,
  ),
  boundary: choice(
    {
      question:
        'Do the assertions cover the two immediately neighboring inputs on opposite sides of the contract boundary?',
      method:
        'For integer minimum k with >= k, require k-1 rejected and k accepted. For maximum k with <= k, require k accepted and k+1 rejected. Merely testing the threshold and an adjacent input on the same permitted side is a gap. Read the actual inclusive/exclusive rule.',
      evidence: evidenceRule,
    },
    ideas[5].criteria,
  ),
  scenario: choice(baselineQuestions.scenario.instructions, {
    ...ideas[9].criteria,
    both_missing: 'Neither missing-record nor wrong-owner behavior is asserted in the visible suite.',
  }),
};

function revisionCases() {
  const revised = new Set(['claim', 'error', 'boundary', 'scenario']);
  return [
    ...initialCases()
      .filter(item => revised.has(item.id.split('-')[0]))
      .map(item => ({ ...item, questions: { result: finalQuestions[item.id.split('-')[0]] } })),
    ...casesFor(
      probes.filter(([, idea]) => revised.has(idea)),
      finalQuestions,
    ),
  ];
}

const heldouts = [
  [
    'claim-nested-alias',
    'claim',
    'gap',
    {
      test: "test('does not change nested preferences', () => { const user = { preferences: { theme: 'dark' } }; const before = { ...user }; applyDefaults(user); assert.deepEqual(user, before); });",
    },
  ],
  [
    'claim-deep-snapshot',
    'claim',
    'verified',
    {
      test: "test('does not change nested preferences', () => { const user = { preferences: { theme: 'dark' } }; const before = structuredClone(user); applyDefaults(user); assert.deepEqual(user, before); });",
    },
  ],
  [
    'mutant-floor',
    'mutant',
    'killed',
    {
      original: 'function pages(n) { return Math.floor(n / 2); }',
      replacement: 'function pages(n) { return Math.round(n / 2); }',
      test: 'assert.equal(pages(9), 4);',
    },
  ],
  [
    'mutant-output-type',
    'mutant',
    'survives',
    {
      original: 'function pages(n) { return Math.floor(n / 2); }',
      replacement: 'function pages(n) { return Math.round(n / 2); }',
      test: "assert.equal(typeof pages(9), 'number');",
    },
  ],
  [
    'error-catch-promise',
    'error',
    'broad',
    {
      contract: 'connect must reject with code TIMEOUT.',
      test: "await connect().catch(error => assert.equal(error.code, 'TIMEOUT'));",
    },
  ],
  [
    'error-reject-predicate',
    'error',
    'specific',
    {
      contract: 'connect must reject with code TIMEOUT.',
      test: "await assert.rejects(connect, error => error.code === 'TIMEOUT');",
    },
  ],
  [
    'mock-expiry-boundary',
    'mock',
    'exercised',
    {
      contract: 'valid returns false when token expiry is at or before now.',
      implementation: 'function valid(token, now) { return token.expires > now(); }',
      test: 'const clock = () => 500; assert.equal(valid({ expires: 500 }, clock), false);',
    },
  ],
  [
    'mock-signature-stub',
    'mock',
    'bypass',
    {
      contract: 'verifySignature rejects a forged signature.',
      implementation: 'async function accept(token) { return await verifySignature(token); }',
      test: "test('rejects forged signatures', async () => { verifySignature = async () => false; assert.equal(await accept('forged-token'), false); });",
    },
  ],
  [
    'async-all',
    'async',
    'waited',
    {
      framework: 'node:test waits for its returned Promise.',
      test: "test('all results', () => Promise.all([3, 4].map(async id => assert.equal(await load(id), id))));",
    },
  ],
  [
    'async-timer-return',
    'async',
    'detached',
    {
      framework: 'node:test waits for a returned Promise, not timers. setTimeout returns a timer handle.',
      test: "test('result', async () => { setTimeout(async () => assert.equal(await load(), 4), 0); });",
    },
  ],
  [
    'boundary-exclusive-lower',
    'boundary',
    'covered',
    {
      contract: 'Integers strictly greater than 7 are accepted.',
      test: 'assert.equal(accept(7), false); assert.equal(accept(8), true);',
    },
  ],
  [
    'boundary-exclusive-upper',
    'boundary',
    'gap',
    {
      contract: 'Integers strictly less than 8 are accepted.',
      test: 'assert.equal(accept(6), true); assert.equal(accept(7), true);',
    },
  ],
  [
    'oracle-unknown-reference',
    'oracle',
    'unknown',
    {
      implementation: 'function encode(value) { return encodeInternal(value); }',
      test: 'assert.equal(encode(value), referenceEncoding(value));',
      omitted: 'encodeInternal and referenceEncoding definitions are unavailable.',
    },
  ],
  [
    'oracle-external-example',
    'oracle',
    'independent',
    {
      contract: 'The documented wire representation of false is the ASCII string no.',
      implementation: "function encode(value) { return value ? 'yes' : 'no'; }",
      test: "assert.equal(encode(false), 'no');",
    },
  ],
  [
    'isolation-immutable',
    'isolation',
    'isolated',
    {
      framework: 'Tests run sequentially in one process.',
      suite:
        "const rate = 1.2; test('small', () => assert.equal(10 * rate, 12)); test('large', () => assert.equal(100 * rate, 120));",
    },
  ],
  [
    'isolation-hidden-reset',
    'isolation',
    'unknown',
    {
      suite:
        "const session = openSession(); test('writes', () => session.set('name', 'Ada')); test('empty', () => assert.equal(session.size(), 0));",
      omitted: 'openSession and its automatic per-test lifecycle are unavailable.',
    },
  ],
  [
    'property-constant-reverse',
    'property',
    'accepts',
    {
      contract: 'reverse reverses an array.',
      replacement: 'function reverse(xs) { return []; }',
      test: 'for (const xs of [[1], [2, 3]]) assert.equal(reverse(xs).length, reverse([...xs]).length);',
    },
  ],
  [
    'property-identity-reverse',
    'property',
    'rejects',
    {
      contract: 'reverse reverses an array.',
      replacement: 'function reverse(xs) { return xs; }',
      test: 'for (const xs of [[1, 2], [3, 4]]) assert.equal(reverse(xs)[0], xs.at(-1));',
    },
  ],
  [
    'scenario-owner-missing',
    'scenario',
    'forbidden',
    {
      contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
      test: "await assert.rejects(() => read('absent', 'Ada'), { code: 'NOT_FOUND' });",
      fixture: 'absent does not exist.',
    },
  ],
  [
    'scenario-two-vacuous',
    'scenario',
    'both_missing',
    {
      contract: 'read(id, user) throws NOT_FOUND for missing records and FORBIDDEN for another owner.',
      test: "try { await read('absent', 'Ada'); } catch (error) { assert.equal(error.code, 'NOT_FOUND'); } try { await read('Ada-row', 'Grace'); } catch (error) { assert.equal(error.code, 'FORBIDDEN'); }",
      fixture: 'absent does not exist; Ada-row exists and is owned by Ada.',
    },
  ],
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir(outputRoot, { recursive: true });
  const round = process.argv[2] ?? 'initial';
  if (round === 'initial') {
    await executionChecks();
    await runBatch(initialCases(), `${outputRoot}/initial-valid.json`);
  } else if (round === 'probes') {
    await runBatch(casesFor(probes, baselineQuestions), `${outputRoot}/probes.json`);
  } else if (round === 'revision') {
    await writeFile(`${outputRoot}/final-questions.json`, `${JSON.stringify(finalQuestions, null, 2)}\n`);
    await runBatch(revisionCases(), `${outputRoot}/revision.json`);
  } else if (round === 'heldout') {
    await runBatch(casesFor(heldouts, finalQuestions), `${outputRoot}/heldout.json`, { repeats: 2 });
  } else if (round === 'execution') {
    await executionChecks();
  } else {
    throw new Error(`Unknown round: ${round}`);
  }
}
