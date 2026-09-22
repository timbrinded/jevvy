// Split a failed suite-wide coverage judgment into explicit error obligations.
import { choice } from '@typesafe-ai/sdk';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { finalQuestions } from './tests.mjs';
import { runBatch } from './query.mjs';

const missingBlock = "try { await read('absent', 'Ada'); } catch (error) { assert.equal(error.code, 'NOT_FOUND'); }";
const deniedBlock = "try { await read('Ada-row', 'Grace'); } catch (error) { assert.equal(error.code, 'FORBIDDEN'); }";
const normalReturn = choice(
  'Suppose the read operation returns a successful value and neither throws nor rejects. Does the supplied test pass on that path? Follow the success path, ignoring the error path.',
  {
    passes: 'A successful read allows this test to finish without an assertion failure.',
    fails: 'This test fails if read succeeds, because an error is required.',
    unknown: 'Missing runner or assertion-helper behavior prevents deciding.',
  },
);

const requiredFailure = choice(
  {
    question: 'Does this test enforce failure when read violates its error contract by returning a value normally?',
    semantics:
      'The contract describes required behavior, not guaranteed implementation behavior. Consider a defective read that returns a value. A successful try body skips its catch block; assertions inside catch do not execute. A test enforces a required error only if the no-error path itself fails, such as assert.rejects or an explicit fail after the awaited call.',
  },
  {
    enforced: 'The test fails on the normal-return path, so the required error is enforced.',
    missing: 'The normal-return path can complete without failing the test.',
    unknown: 'Missing helper or runner details prevent tracing the normal-return path.',
  },
);

export const cases = [
  {
    id: 'e-01',
    state: { contract: 'read must reject with code NOT_FOUND for an absent record.', test: missingBlock },
    expected: { error: 'broad', normalReturn: 'passes' },
  },
  {
    id: 'e-02',
    state: { contract: 'read must reject with code FORBIDDEN for a record owned by another user.', test: deniedBlock },
    expected: { error: 'broad', normalReturn: 'passes' },
  },
  {
    id: 'e-03',
    state: {
      contract: 'read must reject with code NOT_FOUND for an absent record.',
      test: "await assert.rejects(() => read('absent', 'Ada'), { code: 'NOT_FOUND' });",
    },
    expected: { error: 'specific', normalReturn: 'fails' },
  },
  {
    id: 'e-04',
    state: {
      contract: 'read must reject with code FORBIDDEN for a record owned by another user.',
      test: "await assert.rejects(() => read('Ada-row', 'Grace'), { code: 'FORBIDDEN' });",
    },
    expected: { error: 'specific', normalReturn: 'fails' },
  },
].map(item => ({
  ...item,
  state: { ...item.state, framework: 'JavaScript with node:assert/strict; the snippet is awaited to completion.' },
  questions: { error: finalQuestions.error, normalReturn },
}));

export const freshCases = [
  [
    'e-05',
    "try { await read('absent', 'Ada'); assert.fail('expected rejection'); } catch (error) { assert.ok(error instanceof Error); }",
    'passes',
  ],
  ['e-06', "await read('absent', 'Ada').catch(error => assert.equal(error.code, 'NOT_FOUND'));", 'passes'],
  [
    'e-07',
    "await read('absent', 'Ada').then(() => assert.fail('expected rejection'), error => assert.equal(error.code, 'NOT_FOUND'));",
    'fails',
  ],
  [
    'e-08',
    "let rejected = false; try { await read('absent', 'Ada'); } catch (error) { rejected = true; assert.equal(error.code, 'NOT_FOUND'); } assert.equal(rejected, true);",
    'fails',
  ],
].map(([id, test, outcome]) => ({
  id,
  state: {
    contract: 'read must reject with code NOT_FOUND for an absent record.',
    test,
    framework: 'JavaScript with node:assert/strict; the snippet is awaited to completion.',
    replacement: "async function read(id, user) { return 'value'; }",
  },
  expected: {
    normalReturn: outcome,
    requiredFailure: outcome === 'passes' ? 'missing' : 'enforced',
    mutant: outcome === 'passes' ? 'survives' : 'killed',
  },
}));

async function executeCases() {
  const observations = [];
  const wholeSuite = {
    id: 'whole-suite',
    state: { test: `${missingBlock} ${deniedBlock}` },
    expected: { normalReturn: 'passes' },
  };
  for (const item of [...cases, ...freshCases, wholeSuite]) {
    const source = `import assert from 'node:assert/strict'; export async function run(read) { ${item.state.test} }`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    let outcome = 'passes';
    try {
      await module.run(async () => 'value');
    } catch (error) {
      assert.equal(error.code, 'ERR_ASSERTION');
      outcome = 'fails';
    }
    assert.equal(outcome, item.expected.normalReturn);
    observations.push({ id: item.id, outcome, test: item.state.test });
  }
  await mkdir('.artifacts/pack-experiments', { recursive: true });
  await writeFile('.artifacts/pack-experiments/error-execution.json', JSON.stringify(observations, null, 2));
  console.log(JSON.stringify({ executed: observations.length, matched: observations.length }));
}

if (import.meta.main) {
  if (process.argv.includes('--execute')) await executeCases();
  else if (process.argv.includes('--without-contract')) {
    const selected = [cases[0], cases[2], freshCases[0], freshCases[3]];
    await runBatch(
      selected.map(item => ({
        id: item.id,
        state: {
          test: item.state.test,
          framework: item.state.framework,
          replacement: "async function read(id, user) { return 'value'; }",
        },
        questions: { mutant: finalQuestions.mutant },
        expected: { mutant: item.expected.normalReturn === 'passes' ? 'survives' : 'killed' },
      })),
      '.artifacts/pack-experiments/error-without-contract.json',
      { repeats: 2 },
    );
  } else if (process.argv.includes('--fresh')) {
    await runBatch(
      freshCases.map(item => ({ ...item, questions: { requiredFailure, mutant: finalQuestions.mutant } })),
      '.artifacts/pack-experiments/error-fresh.json',
      { repeats: 2 },
    );
  } else if (process.argv.includes('--concrete')) {
    await runBatch(
      cases.map(item => ({
        ...item,
        state: { ...item.state, replacement: "async function read(id, user) { return 'value'; }" },
        questions: { mutant: finalQuestions.mutant },
        expected: { mutant: item.expected.normalReturn === 'passes' ? 'survives' : 'killed' },
      })),
      '.artifacts/pack-experiments/error-concrete.json',
      { repeats: 2 },
    );
  } else if (process.argv.includes('--explicit')) {
    await runBatch(
      cases.map(item => ({
        ...item,
        questions: { requiredFailure },
        expected: { requiredFailure: item.expected.normalReturn === 'passes' ? 'missing' : 'enforced' },
      })),
      '.artifacts/pack-experiments/error-explicit.json',
      { repeats: 2 },
    );
  } else await runBatch(cases, '.artifacts/pack-experiments/error-obligations.json', { repeats: 2 });
}
