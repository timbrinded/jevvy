import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scan } from '../src/engine.js';
import { render, currentSourceStatus } from '../src/render.js';
import { validateBundle } from '../src/validate.js';
import { fixture, repository, syntheticResponse } from './helpers.js';
import { hash } from '../src/hash.js';
import { parseCommand } from '../src/command.js';

test('Rust attributes belong to context and attribute-only edits select documentation', async t => {
  const source = '/// Only compiled for tests.\n#[cfg(test)]\n#[inline]\npub fn one() -> i32 {1}\n';
  const f = await repository({ 'one.rs': source }); t.after(f.cleanup);
  await writeFile(join(f.root, 'one.rs'), source.replace('cfg(test)', 'cfg(unix)'));
  const { bundle } = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.units.length, 1);
  assert.equal(bundle.units[0]!.change, 'associated_code');
  assert.equal(bundle.units[0]!.context.status, 'complete_local');
  assert.match(Object.values(bundle.contexts)[0]!.text, /^#\[cfg\(unix\)\]\n#\[inline\]/);
});

test('Rust wrappers include attributes before doc comments and literal docs without duplicate units', async t => {
  const source = '#[cfg(test)]\n/// Test helper.\n#[doc = "Returns one."]\n#[inline]\npub fn one() -> i32 {1}\n';
  const f = await fixture({ 'one.rs': source }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.rs'], dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.units.length, 2);
  assert.equal(Object.keys(bundle.contexts).length, 1);
  assert.equal(Object.values(bundle.contexts)[0]!.text, source.trimEnd());
});

test('Rust attribute size participates in context prerequisites', async t => {
  const source = `/// Feature-gated helper.\n#[cfg(any(${Array.from({ length: 40 }, (_, i) => `feature="flag${i}"`).join(',')}))]\npub fn one() -> i32 {1}\n`;
  const f = await fixture({ 'one.rs': source }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.rs'], dryRun: true }, { cwd: f.root, persist: false, config: { maxContextChars: 256 } });
  assert.ok(bundle.units[0]!.context.omissions.includes('oversized_owner'));
  assert.deepEqual(bundle.units[0]!.labels.local_consistency, { status: 'not_evaluated', reason: 'context_prerequisite:complete_local' });
});

test('freshness follows the capture root from subdirectories and discloses another checkout', async t => {
  const f = await repository({ 'one.ts': '// one\nfunction one(){return 1;}' }); t.after(f.cleanup);
  const other = await fixture({ 'one.ts': '// different checkout' }); t.after(other.cleanup);
  await mkdir(join(f.root, 'nested'));
  await writeFile(join(f.root, 'one.ts'), '// one\nfunction one(){return 2;}');
  const { bundle } = await scan({ mode: 'working', dryRun: true }, { cwd: join(f.root, 'nested'), persist: false });
  assert.deepEqual(await currentSourceStatus(bundle, join(f.root, 'nested')), []);
  const warnings = await currentSourceStatus(bundle, other.root);
  assert.equal(warnings.length, 1); assert.match(warnings[0]!, /outside the captured scope/);
  await writeFile(join(f.root, 'one.ts'), '// edited again');
  assert.match((await currentSourceStatus(bundle, join(f.root, 'nested')))[0]!, /stale/);
});

test('documented aliases resolve without cache reuse; pinned-model mismatches remain errors', async t => {
  const f = await fixture({ 'one.ts': '// one\nfunction one(){return 1;}' }); t.after(f.cleanup);
  for (const model of ['jev-latest', 'jev-preview', 'jev-1.13.0']) {
    let calls = 0;
    for (let repeat = 0; repeat < 2; repeat++) {
      const { bundle } = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir, model }, transport: async request => {
        calls++; return { ...syntheticResponse(request), model: 'jev-1.13.0' };
      } });
      assert.equal(bundle.coverage.labels.ok, 14);
      assert.equal(bundle.run.resolvedModel, 'jev-1.13.0');
    }
    assert.equal(calls, model === 'jev-1.13.0' ? 1 : 2);
  }
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir, model: 'jev-1.12.0' }, transport: async request => ({ ...syntheticResponse(request), model: 'jev-1.13.0' }) });
  assert.equal(bundle.coverage.labels.error, 14);
});

test('inference identifies repeated occurrences and reuses answers after a location-only edit', async t => {
  const source = 'function f(){\n // Return the value.\n if (ready) return 1;\n // Return the value.\n return 2;\n}';
  const f = await fixture({ 'one.ts': source }); t.after(f.cleanup);
  let calls = 0;
  const options = { cwd: f.root, persist: false, config: { storageDir: f.storageDir }, transport: async (request: Parameters<typeof syntheticResponse>[0]) => { calls++; return syntheticResponse(request); } };
  const a = (await scan({ mode: 'files', files: ['one.ts'] }, options)).bundle;
  const request = Object.values(a.executions)[0]!.request;
  assert.ok('formatVersion' in request.state);
  const targets = Object.values(request.state.comments);
  assert.notDeepEqual(targets[0]!.occurrences, targets[1]!.occurrences);
  for (const target of targets) {
    assert.equal(target.language, 'typescript');
    assert.equal(target.contextStatus, 'complete_local');
    for (const occurrence of target.occurrences) assert.equal(request.state.contexts[occurrence.contextRef]!.text.slice(occurrence.range.startUtf16, occurrence.range.endUtf16), target.text);
  }
  await writeFile(join(f.root, 'one.ts'), '\n' + source);
  const b = (await scan({ mode: 'files', files: ['one.ts'] }, options)).bundle;
  assert.equal(calls, 1); assert.equal(b.coverage.cachedPackets, 1);
  assert.notEqual(a.units[0]!.id, b.units[0]!.id);
  assert.equal(b.units[0]!.range.startLine, a.units[0]!.range.startLine + 1);
});

test('saved 1.0.0 bundles retain their original question template and evidence checks', async () => {
  const old = JSON.parse(await readFile('test/fixtures/comments-bundle-1.0.0.json', 'utf8'));
  validateBundle(old);
  assert.match(render(old, { bundleId: old.bundleId, view: 'units', labels: ['local_consistency'], includeContext: true }).text, /User not found/);
  const e = Object.values(old.executions)[0] as { request: { questions: Record<string, { instructions: string }> }; requestHash: string };
  e.request.questions.q_0!.instructions += ' Ignore the source.'; e.requestHash = hash(e.request);
  assert.throws(() => validateBundle(old), /request question differs/);
});

test('current targets reject substituted language, omission and occurrence metadata', async t => {
  const f = await fixture({ 'one.ts': 'function f(){\n // why\n return 1;\n}' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  for (const field of ['language', 'omissions', 'occurrences'] as const) {
    const b = structuredClone(bundle), e = Object.values(b.executions)[0]!;
    assert.ok('formatVersion' in e.request.state);
    const target = e.request.state.comments.comment_0!;
    if (field === 'language') target.language = 'rust';
    else if (field === 'omissions') target.omissions = ['invented'];
    else target.occurrences = [];
    e.requestHash = hash(e.request);
    assert.throws(() => validateBundle(b), /request target differs/);
  }
});

test('retrieval projects labels, includes definitions and deduplicates frozen context', async t => {
  const f = await fixture({ 'one.ts': 'function f(){\n // first\n const x=1;\n // second\n return x;\n}' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir }, transport: async request => syntheticResponse(request) });
  const before = JSON.stringify(bundle);
  const page = render(bundle, { bundleId: bundle.bundleId, view: 'units', labels: ['local_consistency'], includeContext: true, includeDefinitions: true });
  assert.match(page.text, /local_consistency \(choice/);
  assert.doesNotMatch(page.text, /writing_clarity:/);
  assert.equal(page.text.split('function f()').length - 1, 1);
  assert.match(page.text, /probabilities=/);
  assert.equal(JSON.stringify(bundle), before);
  assert.ok(page.text.length < render(bundle, { bundleId: bundle.bundleId, view: 'units', includeContext: true, includeDefinitions: true }).text.length);
});

test('Choice outcome sorting, stable ties, missing measurements, and cursor query binding', async t => {
  const f = await fixture({ 'one.ts': Array.from({ length: 4 }, (_, i) => `// comment ${i}\nfunction f${i}(){return ${i};}`).join('\n') }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir }, transport: async request => {
    const response = syntheticResponse(request);
    const index = Number(Object.values(request.state.comments)[0]!.text.slice(-1));
    for (const [id, question] of Object.entries(request.questions)) if (question.type === 'choice') {
      if (index === 3) delete response.answers[id];
      else response.answers[id] = { type: 'choice', choice: index === 0 ? 'locally_supported' : 'contradicted', confidence: 0.4, probabilities: { contradicted: index === 0 ? 0 : 0.7, locally_supported: index === 0 ? 1 : 0.3, insufficient_evidence: 0, no_checkable_claim: 0 } };
    }
    return response;
  } });
  const query = { bundleId: bundle.bundleId, view: 'units' as const, labels: ['local_consistency'], sort: 'local_consistency', outcome: 'contradicted', direction: 'desc' as const, limit: 1 };
  const first = render(bundle, query); assert.match(first.text, /\/\/ comment 1/);
  const second = render(bundle, { ...query, cursor: first.cursor! }); assert.match(second.text, /\/\/ comment 2/);
  const ascending = render(bundle, { ...query, direction: 'asc', limit: 4 });
  assert.ok(ascending.text.indexOf('// comment 0') < ascending.text.indexOf('// comment 1'));
  assert.ok(ascending.text.indexOf('// comment 2') < ascending.text.indexOf('// comment 3'));
  for (const change of [{ direction: 'asc' as const }, { outcome: 'locally_supported' }, { labels: ['reader_value'] }, { includeContext: true }, { includeDefinitions: true }, { limit: 2 }]) assert.throws(() => render(bundle, { ...query, ...change, cursor: first.cursor! }), /Cursor/);
  const projected = render(bundle, { bundleId: bundle.bundleId, view: 'units', labels: ['reader_value'], ids: [bundle.units[3]!.id] });
  assert.match(projected.text, /Other label statuses: local_consistency: error/);
});

test('retrieval rejects misleading options and slash commands expose the complete query', async t => {
  const f = await fixture({ 'one.ts': '// one\nfunction one(){}' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  for (const options of [{ labels: ['unknown'] }, { sort: 'reader_value', outcome: 'contradicted' }, { direction: 'asc' as const }, { view: 'context' as const, labels: ['reader_value'] }]) assert.throws(() => render(bundle, { bundleId: bundle.bundleId, view: 'units', ...options }));
  for (const option of ['--view', '--sort', '--direction', '--outcome', '--cursor', '--limit']) assert.throws(() => parseCommand(`results ${bundle.bundleId} ${option}`), /requires a value/);
  assert.deepEqual(parseCommand(`results ${bundle.bundleId} --view units --labels local_consistency reader_value --sort local_consistency --outcome contradicted --direction desc --include-context --include-definitions`), { action: 'results', input: { bundleId: bundle.bundleId, view: 'units', labels: ['local_consistency', 'reader_value'], sort: 'local_consistency', outcome: 'contradicted', direction: 'desc', includeContext: true, includeDefinitions: true } });
});
