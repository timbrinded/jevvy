import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scan } from '../src/engine.ts';
import { loadBundle } from '../src/bundle.ts';
import { validateBundle } from '../src/validate.ts';
import { hash } from '../src/hash.ts';
import { git } from '../src/scope.ts';
import { fixture, repository, syntheticResponse } from './helpers.ts';
import type { CodeRequest, Request } from '../src/contracts.ts';

const subject = 'export function double(value: number) { return value * 2; }\n';
const testSource = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { double } from './subject.ts';
test('doubles its argument', () => { assert.equal(double(3), 6); });
`;
const files = { 'subject.ts': subject, 'subject.test.ts': testSource, 'package.json': '{"type":"module"}\n' };

test('both code packs bind exact targets and explicit supporting files, persist and reload', async t => {
  const f = await fixture(files);
  t.after(f.cleanup);
  for (const pack of ['functions', 'tests'] as const) {
    const input = {
      pack,
      mode: 'files' as const,
      files: [pack === 'functions' ? 'subject.ts' : 'subject.test.ts'],
      contextFiles: ['subject.ts', 'package.json'],
      dryRun: true,
    };
    const result = await scan(input, {
      cwd: f.root,
      config: { storageDir: f.storageDir },
      transport: async () => {
        throw new Error('Dry run attempted inference');
      },
    });
    assert.equal(result.bundle.kind, `jevvy.${pack}.bundle`);
    assert.equal(result.bundle.pack.id, pack);
    assert.equal(result.bundle.schemaVersion, '2.0.0');
    assert.equal(result.bundle.units.length, 1);
    assert.ok(result.bundle.coverage.labels.not_evaluated > 0);
    const unit = result.bundle.units[0]!;
    assert.ok('kind' in unit.structure);
    assert.equal(unit.structure.kind, pack === 'functions' ? 'function' : 'test');
    for (const execution of Object.values(result.bundle.executions)) {
      const state = execution.request.state;
      assert.ok('targets' in state);
      assert.equal(state.packId, pack);
      const target = state.targets.target_0!;
      assert.equal(target.text, unit.text);
      assert.ok(
        Object.values(state.contexts).some(
          context => context.path === 'package.json' && context.text === files['package.json'],
        ),
      );
      for (const occurrence of target.occurrences) {
        const context: CodeRequest['state']['contexts'][string] = state.contexts[occurrence.contextRef]!;
        assert.equal(context.path, pack === 'functions' ? 'subject.ts' : 'subject.test.ts');
        assert.equal(context.text.slice(occurrence.range.startUtf16, occurrence.range.endUtf16), unit.text);
      }
      assert.ok(
        Object.values(execution.request.questions).every(question => question.instructions.includes('state.targets[')),
      );
    }
    assert.deepEqual(await loadBundle(f.storageDir, result.bundle.bundleId), result.bundle);
  }
});

test('supporting source changes invalidate cached answers and remain frozen in earlier results', async t => {
  const f = await fixture(files);
  t.after(f.cleanup);
  let calls = 0;
  const options = {
    cwd: f.root,
    persist: false,
    config: { storageDir: f.storageDir },
    transport: async (request: Request) => {
      calls++;
      return syntheticResponse(request);
    },
  };
  const input = {
    pack: 'tests' as const,
    mode: 'files' as const,
    files: ['subject.test.ts'],
    contextFiles: ['subject.ts', 'package.json'],
  };
  const first = (await scan(input, options)).bundle;
  const second = (await scan(input, options)).bundle;
  assert.equal(calls, 1);
  assert.equal(second.coverage.cachedPackets, 1);
  await writeFile(join(f.root, 'subject.ts'), subject.replace('* 2', '* 3'));
  const third = (await scan(input, options)).bundle;
  assert.equal(calls, 2);
  assert.equal(third.coverage.cachedPackets, 0);
  assert.notEqual(first.run.snapshotId, third.run.snapshotId);
  assert.equal(Object.values(first.sources).find(source => source.path === 'subject.ts')!.content, subject);
  assert.notEqual(Object.values(third.sources).find(source => source.path === 'subject.ts')!.content, subject);
});

test('branch supporting evidence comes from selected head, not the live working tree', async t => {
  const f = await repository(files);
  t.after(f.cleanup);
  const base = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(f.root, 'subject.test.ts'), testSource.replace('double(3), 6', 'double(4), 8'));
  const committed = subject.replace('* 2', '* 3');
  await writeFile(join(f.root, 'subject.ts'), committed);
  await git(f.root, ['add', '.']);
  await git(f.root, ['commit', '-m', 'change fixture']);
  await writeFile(join(f.root, 'subject.ts'), subject.replace('* 2', '* 99'));
  const { bundle } = await scan(
    { pack: 'tests', mode: 'branch', base, contextFiles: ['subject.ts', 'package.json'], dryRun: true },
    { cwd: f.root, persist: false },
  );
  assert.equal(bundle.units.length, 1);
  const contexts = bundle.units[0]!.context.refs.map(ref => bundle.contexts[ref]!);
  assert.ok(contexts.some(context => context.text === committed));
  assert.ok(contexts.every(context => !context.text.includes('* 99')));
});

test('missing and oversized supporting evidence remains visible and never becomes complete context', async t => {
  const f = await fixture({ ...files, 'large.txt': 'x'.repeat(1000) });
  t.after(f.cleanup);
  const { bundle } = await scan(
    {
      pack: 'tests',
      mode: 'files',
      files: ['subject.test.ts'],
      contextFiles: ['absent.ts', 'large.txt'],
      dryRun: true,
    },
    { cwd: f.root, persist: false, config: { maxContextChars: 512 } },
  );
  assert.equal(bundle.run.status, 'partial');
  assert.equal(bundle.units[0]!.context.status, 'partial');
  assert.ok(bundle.units[0]!.context.omissions.includes('supporting_file_unavailable:absent.ts'));
  assert.ok(bundle.units[0]!.context.omissions.includes('supporting_file_too_large:large.txt'));
  assert.ok(Object.values(bundle.executions).every(execution => 'targets' in execution.request.state));
});

test('supporting paths cannot escape selected scope', async t => {
  const f = await fixture(files);
  t.after(f.cleanup);
  const { bundle } = await scan(
    {
      pack: 'tests',
      mode: 'files',
      files: ['subject.test.ts'],
      contextFiles: ['../outside.txt', '.git/config'],
      dryRun: true,
    },
    { cwd: f.root, persist: false },
  );
  assert.equal(bundle.coverage.files.filter(file => file.status === 'unreadable').length, 2);
  assert.ok(
    Object.values(bundle.sources).every(source => !source.path.startsWith('../') && !source.path.startsWith('.git/')),
  );
});

test('code bundle validation rejects pack substitution and cross-file request substitution', async t => {
  const f = await fixture(files);
  t.after(f.cleanup);
  const { bundle } = await scan(
    { pack: 'tests', mode: 'files', files: ['subject.test.ts'], contextFiles: ['subject.ts'], dryRun: true },
    { cwd: f.root, persist: false },
  );
  const wrongPack = structuredClone(bundle);
  wrongPack.pack.id = 'functions';
  assert.throws(() => validateBundle(wrongPack), /kind differs from pack/);
  const wrongPath = structuredClone(bundle);
  const execution = Object.values(wrongPath.executions)[0]!;
  assert.ok('targets' in execution.request.state);
  Object.values(execution.request.state.contexts).find(context => context.path === 'subject.ts')!.path = 'invented.ts';
  execution.requestHash = hash(execution.request);
  assert.throws(() => validateBundle(wrongPath), /path differs from frozen source/);
  const unselected = structuredClone(bundle);
  unselected.run.scope.contextFiles = [];
  assert.throws(() => validateBundle(unselected), /not explicitly selected/);
});

test('previous comment bundle formats remain readable without rewriting their requests', async () => {
  for (const path of ['test/fixtures/comments-bundle-1.0.0.json', 'test/fixtures/comments-bundle-1.1.0.json']) {
    const original: unknown = JSON.parse(await readFile(path, 'utf8'));
    const before = JSON.stringify(original);
    const bundle = validateBundle(original);
    assert.equal(bundle.pack.id, 'comments');
    assert.equal(JSON.stringify(original), before);
  }
});
