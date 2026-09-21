import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compile } from 'typebox/compile';
import { BundleSchema, type Question } from '../src/contracts.js';
import { answerError, validateBundle } from '../src/validate.js';
import { scan } from '../src/engine.js';
import { fixture, syntheticResponse } from './helpers.js';
import { hash } from '../src/hash.js';

const question: Question = { type: 'score', instructions: 'clarity', criteria: ['zero', 'one', 'two', 'three'] };
const answer = { type: 'score', score: 2.97, confidence: 0.97, probabilities: { 0: 0, 1: 0, 2: 0.02, 3: 0.98 }, legend: { 0: 'zero', 1: 'one', 2: 'two', 3: 'three' } };
test('rounded Score accepts observed 0.01 discrepancy without changing values', () => {
  const original = structuredClone(answer);
  assert.equal(answerError(answer, question), undefined);
  assert.deepEqual(answer, original);
  assert.match(answerError({ ...answer, score: 2.8 }, question)!, /inconsistent/);
});
test('wrong types, missing levels, extra fields, non-finite and coerced values are rejected', () => {
  for (const bad of [{ ...answer, score: '2.97' }, { ...answer, surprise: true }, { ...answer, score: Infinity }, { ...answer, confidence: NaN }, { ...answer, probabilities: { 0: 0, 3: 1 } }, { ...answer, legend: { ...answer.legend, 3: 'wrong' } }]) assert.ok(answerError(bad, question));
});
test('Choice supports ties but rejects non-maximal or invented choices', () => {
  const q: Question = { type: 'choice', instructions: 'choose', criteria: { a: 'A', b: 'B' } };
  assert.equal(answerError({ type: 'choice', choice: 'b', confidence: 0, probabilities: { a: 0.5, b: 0.5 } }, q), undefined);
  assert.ok(answerError({ type: 'choice', choice: 'b', confidence: 1, probabilities: { a: 1, b: 0 } }, q));
  assert.ok(answerError({ type: 'choice', choice: 'c', confidence: 1, probabilities: { a: 1, b: 0 } }, q));
});
test('schema serialisation preserves shape checking and has a stable dialect/id', async t => {
  const f = await fixture({ 'one.ts': '// example\nfunction f() {}' }); t.after(f.cleanup);
  const r = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  const serialised = JSON.parse(JSON.stringify(BundleSchema));
  assert.match(serialised.$id, /1\.0\.0/); assert.match(serialised.$schema, /2020-12/);
  const check = Compile(serialised);
  assert.ok(check.Check(r.bundle));
  assert.ok(!check.Check({ ...r.bundle, unknown: 1 }));
});
test('semantic checks reject valid-shaped misrouting, wrong coverage and evidence substitution', async t => {
  const f = await fixture({ 'one.ts': '// why\nfunction f() {}' }); t.after(f.cleanup);
  const r = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir }, transport: async request => syntheticResponse(request) });
  const mutate = (fn: (bundle: typeof r.bundle) => void) => { const b = structuredClone(r.bundle); fn(b); assert.throws(() => validateBundle(b), /invariant/); };
  mutate(b => { b.coverage.labels.ok--; });
  mutate(b => { Object.values(b.executions)[0]!.bindings.q_0!.labelId = 'local_consistency'; });
  mutate(b => { const e = Object.values(b.executions)[0]!; e.request.state.comments.comment_0!.text = 'injected'; e.requestHash = hash(e.request); });
  mutate(b => { delete b.units[0]!.labels.writing_clarity; });
  mutate(b => { b.units[0]!.context.refs.push('missing'); });
  mutate(b => { b.units[0]!.context.status = 'partial'; });
});
