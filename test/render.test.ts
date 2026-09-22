import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scan } from '../src/engine.ts';
import { render, scanReport, currentSourceStatus } from '../src/render.ts';
import { parseCommand } from '../src/command.ts';
import { fixture, syntheticResponse } from './helpers.ts';
import { requestTargets } from '../src/request.ts';

test('pagination discloses totals, preserves source order and binds its cursor', async t => {
  const f = await fixture({ 'one.ts': '// first\nfunction first() {}\n// second\nfunction second() {}' });
  t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  const page = render(bundle, { bundleId: bundle.bundleId, view: 'units', limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.returned, 1);
  assert.ok(page.cursor);
  assert.match(page.text, /not the complete result/);
  assert.match(page.text, /first/);
  assert.doesNotMatch(page.text, /\/\/ second/);
  const next = render(bundle, { bundleId: bundle.bundleId, view: 'units', limit: 1, cursor: page.cursor });
  assert.match(next.text, /second/);
  assert.equal(next.cursor, null);
  assert.throws(() => render(bundle, { bundleId: bundle.bundleId, view: 'context', cursor: page.cursor! }), /Cursor/);
});
test('frozen context survives source changes and reports staleness', async t => {
  const f = await fixture({ 'one.ts': '// reason\nfunction first() { return 1; }' });
  t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  await writeFile(join(f.root, 'one.ts'), '// changed\nfunction first() {return 2;}');
  const page = render(bundle, { bundleId: bundle.bundleId, view: 'context' });
  assert.match(page.text, /return 1/);
  assert.doesNotMatch(page.text, /return 2/);
  assert.match((await currentSourceStatus(bundle, f.root))[0]!, /stale/);
  assert.match(scanReport(bundle).text, /No aggregate verdict/);
});
test('command routes enforce explicit scopes and preserve quoted paths', () => {
  assert.deepEqual(parseCommand('comments --files "my file.ts" other.py --dry-run'), {
    action: 'comments',
    input: { mode: 'files', files: ['my file.ts', 'other.py'], dryRun: true },
  });
  assert.throws(() => parseCommand('comments'), /Invalid/);
  assert.throws(() => parseCommand('comments --working --files one.ts'), /exactly one/);
  assert.throws(() => parseCommand('comments --files "unclosed'), /Unclosed/);
  assert.throws(() => parseCommand('comments --base'), /requires/);
});

test('initial report preserves near-tied choice probabilities and exposes failed-file reasons', async t => {
  const f = await fixture({ 'one.ts': '/** Returns one. */\nfunction first() { return 1; }' });
  t.after(f.cleanup);
  const { bundle } = await scan(
    { mode: 'files', files: ['one.ts', 'missing.ts'] },
    {
      cwd: f.root,
      persist: false,
      config: { storageDir: f.storageDir },
      transport: async request => {
        const response = syntheticResponse(request);
        for (const [id, question] of Object.entries(request.questions))
          if (question.type === 'choice')
            response.answers[id] = {
              type: 'choice',
              choice: 'contradicted',
              confidence: 0.14,
              probabilities: {
                contradicted: 0.36,
                locally_supported: 0.33,
                insufficient_evidence: 0.29,
                no_checkable_claim: 0.02,
              },
            };
        return response;
      },
    },
  );
  const text = scanReport(bundle).text;
  assert.match(text, /missing.ts: Selected file does not exist/);
  assert.match(text, /contradicted.*probabilities=.*0.36.*0.33.*0.29/);
  assert.match(text, /confidence=0.14/);
  assert.match(text, /Inspect that implementation/);
  assert.doesNotMatch(text, /return 1;/);
  assert.match(render(bundle, { bundleId: bundle.bundleId, view: 'context' }).text, /return 1;/);
});
test('dry-run keeps exact planned requests available without flooding the initial report', async t => {
  const f = await fixture({ 'one.ts': '// reason\nfunction first() { return 1; }' });
  t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  assert.doesNotMatch(scanReport(bundle).text, /"questions":/);
  assert.match(scanReport(bundle).text, /exact planned requests/);
  assert.match(render(bundle, { bundleId: bundle.bundleId, view: 'units' }).text, /"questions":/);
});

async function filteringFixture(t: TestContext) {
  const f = await fixture({
    'one.ts': ['first', 'second', 'third', 'fourth'].map(name => `// ${name}\nfunction ${name}() {}`).join('\n'),
  });
  t.after(f.cleanup);
  const { bundle } = await scan(
    { mode: 'files', files: ['one.ts'] },
    {
      cwd: f.root,
      persist: false,
      config: { storageDir: f.storageDir },
      transport: async request => {
        const text = Object.values(requestTargets(request))
          .map(target => target.text)
          .join('\n');
        const probability = text.includes('first')
          ? 0.8
          : text.includes('second')
            ? 0.7
            : text.includes('third')
              ? 0.6
              : 0.1;
        const confidence = text.includes('third') ? 0.2 : 0.8;
        const response = syntheticResponse(request);
        for (const [id, question] of Object.entries(request.questions)) {
          if (question.type !== 'choice') continue;
          const keys = Object.keys(question.criteria);
          const unknown = keys.find(key => /unknown|insufficient/.test(key))!;
          const outcome = keys.find(key => key !== unknown)!;
          response.answers[id] = {
            type: 'choice',
            choice: probability > 0.5 ? outcome : unknown,
            confidence,
            probabilities: Object.fromEntries(
              keys.map(key => [key, key === outcome ? probability : key === unknown ? 1 - probability : 0]),
            ),
          };
        }
        return response;
      },
    },
  );
  const [sort, definition] = Object.entries(bundle.definitions).find(
    ([, definition]) => definition.primitive === 'choice',
  )!;
  const unknown = Object.keys(definition.criteria).find(key => /unknown|insufficient/.test(key))!;
  const outcome = Object.keys(definition.criteria).find(key => key !== unknown)!;
  return { bundle, sort, outcome, unknown };
}

test('outcome filters retain distributions, bind pagination and permit explicit unknown selection', async t => {
  const { bundle, sort, outcome, unknown } = await filteringFixture(t);
  const query = {
    bundleId: bundle.bundleId,
    view: 'units' as const,
    sort,
    outcome,
    minProbability: 0.5,
    minConfidence: 0.5,
    limit: 1,
  };
  const first = render(bundle, query);
  assert.equal(first.total, 2);
  assert.equal(first.returned, 1);
  assert.ok(first.cursor);
  assert.match(first.text, /first/);
  assert.match(first.text, /probabilities=/);
  assert.match(first.text, /coverage above remains the full scan/);
  const second = render(bundle, { ...query, cursor: first.cursor });
  assert.match(second.text, /second/);
  assert.equal(second.cursor, null);
  assert.throws(() => render(bundle, { ...query, minProbability: 0.6, cursor: first.cursor! }), /Cursor/);
  assert.throws(() => render(bundle, { ...query, minConfidence: 0.4, cursor: first.cursor! }), /Cursor/);
  assert.equal(render(bundle, { ...query, minConfidence: 0 }).total, 3);
  const unknownPage = render(bundle, { ...query, outcome: unknown, minProbability: 0.8 });
  assert.equal(unknownPage.total, 1);
  assert.match(unknownPage.text, /fourth/);
  assert.match(unknownPage.text, new RegExp(unknown));
});

test('probability filters reject ambiguous or invalid queries and exclude unevaluated units', async t => {
  const f = await fixture({ 'one.ts': '// reason\nfunction first() {}' });
  t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  const [sort, definition] = Object.entries(bundle.definitions).find(
    ([, definition]) => definition.primitive === 'choice',
  )!;
  const query = {
    bundleId: bundle.bundleId,
    view: 'units' as const,
    sort,
    outcome: Object.keys(definition.criteria)[0]!,
    minProbability: 0,
  };
  assert.equal(render(bundle, query).total, 0);
  assert.throws(() => render(bundle, { ...query, sort: undefined }), /require/);
  assert.throws(() => render(bundle, { ...query, outcome: undefined }), /require/);
  assert.throws(() => render(bundle, { ...query, outcome: 'made-up' }), /Unknown Choice/);
  assert.throws(() => render(bundle, { ...query, view: 'overview' }), /only available for units/);
  assert.throws(() => render(bundle, { ...query, minProbability: 1.1 }), /Invalid/);
  assert.throws(() => render(bundle, { ...query, minConfidence: -0.1 }), /Invalid/);
});
