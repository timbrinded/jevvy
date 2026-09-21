import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { writeFile, rename, unlink, readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { scan } from '../src/engine.ts';
import { loadBundle, saveBundle } from '../src/bundle.ts';
import { configuration } from '../src/config.ts';
import { validateBundle } from '../src/validate.ts';
import { git } from '../src/scope.ts';
import { fixture, repository, syntheticResponse } from './helpers.ts';

test('explicit dry-run plans every label, validates, persists and reloads unchanged', async t => {
  const f = await fixture({ 'one.ts': '/** Returns one. */\nexport function one() { return 1; }' });
  t.after(f.cleanup);
  const r = await scan(
    { mode: 'files', files: ['one.ts'], dryRun: true },
    {
      cwd: f.root,
      config: { storageDir: f.storageDir },
      transport: async () => {
        throw new Error('dry-run called transport');
      },
    },
  );
  assert.equal(r.bundle.units.length, 1);
  assert.equal(r.bundle.coverage.labels.not_evaluated, 14);
  assert.equal(Object.values(r.bundle.executions)[0]!.request.state.comments.comment_0!.text, '/** Returns one. */');
  assert.deepEqual(await loadBundle(f.storageDir, r.bundle.bundleId), r.bundle);
  await assert.rejects(saveBundle(r.bundle, configuration({ storageDir: f.storageDir })), /EEXIST/);
});
test('working mode selects unchanged docs when only implementation changes', async t => {
  const f = await repository({ 'one.ts': '/** Returns one. */\nexport function one() { return 1; }\n' });
  t.after(f.cleanup);
  await writeFile(join(f.root, 'one.ts'), '/** Returns one. */\nexport function one() { return 2; }\n');
  const r = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.units.length, 1);
  assert.equal(r.bundle.units[0]!.change, 'associated_code');
  assert.match(Object.values(r.bundle.contexts)[0]!.text, /return 2/);
});
test('deletion-only code changes select attached documentation', async t => {
  const f = await repository({
    'one.ts': '/** Returns zero for negatives. */\nfunction f(x:number) {\n if (x < 0) return 0;\n return x;\n}\n',
  });
  t.after(f.cleanup);
  await writeFile(
    join(f.root, 'one.ts'),
    '/** Returns zero for negatives. */\nfunction f(x:number) {\n return x;\n}\n',
  );
  const r = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.units.length, 1);
});
test('removed comments are inventoried without labelling', async t => {
  const f = await repository({ 'one.ts': '/** Returns one. */\nfunction one() { return 1; }\n' });
  t.after(f.cleanup);
  await writeFile(join(f.root, 'one.ts'), 'function one() { return 1; }\n');
  const r = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.units.length, 0);
  assert.equal(r.bundle.removed.length, 1);
  assert.equal(r.bundle.coverage.labels.not_evaluated, 0);
});
test('deleted files retain removed comments and file outcome', async t => {
  const f = await repository({ 'one.ts': '// rationale\nfunction one() {}' });
  t.after(f.cleanup);
  await unlink(join(f.root, 'one.ts'));
  const r = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.removed.length, 1);
  assert.equal(r.bundle.coverage.files[0]!.status, 'deleted');
});
test('branch mode uses merge-base and frozen head rather than working content', async t => {
  const f = await repository({ 'one.ts': '// original\nfunction one() {}' });
  t.after(f.cleanup);
  await git(f.root, ['checkout', '-b', 'feat/change']);
  await writeFile(join(f.root, 'one.ts'), '// committed\nfunction one() {}');
  await git(f.root, ['commit', '-am', 'change']);
  await writeFile(join(f.root, 'one.ts'), '// uncommitted\nfunction one() {}');
  const r = await scan({ mode: 'branch', base: 'main', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.units[0]!.text, '// committed');
  assert.ok(r.bundle.run.scope.mergeBase);
});
test('working mode includes nonignored untracked files', async t => {
  const f = await repository({ '.gitignore': 'ignored.ts\n', 'one.ts': 'const one=1;' });
  t.after(f.cleanup);
  await writeFile(join(f.root, 'new.ts'), '// new\nconst x=1;');
  await writeFile(join(f.root, 'ignored.ts'), '// ignored\nconst y=1;');
  const r = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.units.length, 1);
  assert.equal(r.bundle.sources[r.bundle.units[0]!.sourceId]!.path, 'new.ts');
});
test('branch rename preserves source paths', async t => {
  const f = await repository({ 'one.ts': '/** A function. */\nfunction one() {}' });
  t.after(f.cleanup);
  await rename(join(f.root, 'one.ts'), join(f.root, 'two.ts'));
  await git(f.root, ['add', '.']);
  await git(f.root, ['commit', '-m', 'rename']);
  const r = await scan({ mode: 'branch', base: 'HEAD~1', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(r.bundle.units.length, 1);
  assert.equal(r.bundle.sources[r.bundle.units[0]!.sourceId]!.path, 'two.ts');
  assert.equal(r.bundle.removed.length, 0);
});
test('provider execution validates all labels, reuses cache, invalidates on code change', async t => {
  const f = await fixture({ 'one.ts': '/** Returns one. */\nfunction one() { return 1; }' });
  t.after(f.cleanup);
  let calls = 0;
  const options = {
    cwd: f.root,
    config: { storageDir: f.storageDir },
    persist: false,
    transport: async (request: Parameters<typeof syntheticResponse>[0]) => {
      calls++;
      return syntheticResponse(request);
    },
  };
  const first = await scan({ mode: 'files', files: ['one.ts'] }, options);
  assert.equal(first.bundle.coverage.labels.ok, 14);
  const second = await scan({ mode: 'files', files: ['one.ts'] }, options);
  assert.equal(calls, 1);
  assert.equal(second.bundle.coverage.cachedPackets, 1);
  await writeFile(join(f.root, 'one.ts'), '/** Returns one. */\nfunction one() { return 2; }');
  const third = await scan({ mode: 'files', files: ['one.ts'] }, options);
  assert.equal(calls, 2);
  assert.equal(third.bundle.coverage.cachedPackets, 0);
});
test('missing independent answer preserves valid results and is not cached', async t => {
  const f = await fixture({ 'one.ts': '// returns one\nfunction one() {return 1;}' });
  t.after(f.cleanup);
  const r = await scan(
    { mode: 'files', files: ['one.ts'] },
    {
      cwd: f.root,
      config: { storageDir: f.storageDir },
      persist: false,
      transport: async request => {
        const response = syntheticResponse(request);
        delete response.answers.q_0;
        return response;
      },
    },
  );
  assert.equal(r.bundle.run.status, 'partial');
  assert.equal(r.bundle.coverage.labels.ok, 13);
  assert.equal(r.bundle.coverage.labels.error, 1);
});
test('extra question ID invalidates entire packet', async t => {
  const f = await fixture({ 'one.ts': '// returns one\nfunction one() {return 1;}' });
  t.after(f.cleanup);
  const r = await scan(
    { mode: 'files', files: ['one.ts'] },
    {
      cwd: f.root,
      config: { storageDir: f.storageDir },
      persist: false,
      transport: async request => {
        const response = syntheticResponse(request);
        response.answers.unexpected = { type: 'noul', noul: 1 };
        return response;
      },
    },
  );
  assert.equal(r.bundle.coverage.labels.ok, 0);
  assert.equal(r.bundle.coverage.labels.error, 14);
});
test('cancellation retains completed packet and marks remaining work', async t => {
  const f = await fixture({ 'one.ts': '// one\nfunction one(){return 1;}\n// two\nfunction two(){return 2;}' });
  t.after(f.cleanup);
  const controller = new AbortController();
  const r = await scan(
    { mode: 'files', files: ['one.ts'] },
    {
      cwd: f.root,
      signal: controller.signal,
      config: { storageDir: f.storageDir, requestConcurrency: 1 },
      persist: false,
      transport: async request => {
        controller.abort();
        return syntheticResponse(request);
      },
    },
  );
  assert.equal(r.bundle.run.status, 'cancelled');
  assert.equal(r.bundle.coverage.labels.ok, 14);
  assert.equal(r.bundle.coverage.labels.cancelled, 14);
});
test('oversized context skips code-relative labels but runs text labels', async t => {
  const f = await fixture({
    'one.ts': '// describes lots of values\nfunction one(){return [' + '1,'.repeat(500) + '];}',
  });
  t.after(f.cleanup);
  const r = await scan(
    { mode: 'files', files: ['one.ts'], dryRun: true },
    { cwd: f.root, config: { maxContextChars: 256 }, persist: false },
  );
  assert.deepEqual(r.bundle.units[0]!.labels.local_consistency, {
    status: 'not_evaluated',
    reason: 'context_prerequisite:complete_local',
  });
  assert.ok(
    Object.values(r.bundle.executions).some(e => Object.values(e.bindings).some(b => b.labelId === 'writing_clarity')),
  );
});
test('tampering with persisted excerpts or unknown fields is rejected', async t => {
  const f = await fixture({ 'one.ts': '// hi\nfunction one() {}' });
  t.after(f.cleanup);
  const r = await scan(
    { mode: 'files', files: ['one.ts'], dryRun: true },
    { cwd: f.root, config: { storageDir: f.storageDir } },
  );
  const corrupt = JSON.parse(await readFile(r.path!, 'utf8'));
  corrupt.units[0].text = '// invented';
  assert.throws(() => validateBundle(corrupt), /Bundle invariant/);
  assert.throws(() => validateBundle({ ...r.bundle, surprise: true }), /shape/);
});
test('UTF-8 BOM and CRLF are preserved in captured source and excerpts', async t => {
  const text = '\uFEFF// exact 🦦\r\nfunction one() {}\r\n';
  const f = await fixture({ 'one.ts': text });
  t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(Object.values(bundle.sources)[0]!.content, text);
  assert.equal(bundle.units[0]!.range.startUtf16, 1);
});
test('a file edited during capture is rejected instead of mixing snapshots', async t => {
  const f = await fixture({ 'one.ts': '// original\nfunction one() {}' });
  t.after(f.cleanup);
  const original = fs.readFile;
  let mutated = false;
  const mocked = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    const bytes = await original(...args);
    if (String(args[0]).endsWith('/one.ts') && !mutated) {
      mutated = true;
      await writeFile(args[0], '// changed and longer\nfunction one() {}');
    }
    return bytes;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  assert.ok(mutated);
  assert.equal(bundle.units.length, 0);
  assert.equal(bundle.run.status, 'failed');
  assert.match(bundle.coverage.files[0]!.reason, /changed during capture/);
});
test('parse errors retain usable text labels and produce a partial bundle', async t => {
  const f = await fixture({ 'one.ts': '// purpose\nfunction one() { return ??? }' });
  t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.run.status, 'partial');
  assert.ok(bundle.units.length > 0);
  assert.equal(bundle.units[0]!.labels.local_consistency!.status, 'not_evaluated');
});
test('identical comments in different functions retain correct removal provenance', async t => {
  const f = await repository({ 'one.ts': '// same\nfunction first() {}\n// same\nfunction second() {}\n' });
  t.after(f.cleanup);
  await writeFile(join(f.root, 'one.ts'), 'function first() {}\n// same\nfunction second() {}\n');
  const { bundle } = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.removed.length, 1);
  assert.equal(bundle.removed[0]!.range.startLine, 1);
});
test('renaming a function does not invent a removed unchanged comment', async t => {
  const f = await repository({ 'one.ts': '// same\nfunction first() {}\n' });
  t.after(f.cleanup);
  await writeFile(join(f.root, 'one.ts'), '// same\nfunction renamed() {}\n');
  const { bundle } = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.removed.length, 0);
  assert.equal(bundle.units.length, 1);
});
test('unchanged trailing comment on a changed code line is associated_code', async t => {
  const f = await repository({ 'one.ts': 'function f() {\n const n=1; // initial value\n return n;\n}' });
  t.after(f.cleanup);
  await writeFile(join(f.root, 'one.ts'), 'function f() {\n const n=2; // initial value\n return n;\n}');
  const { bundle } = await scan({ mode: 'working', dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.units[0]!.change, 'associated_code');
});
