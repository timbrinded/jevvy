import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scan } from '../src/engine.js';
import { render, scanReport, currentSourceStatus } from '../src/render.js';
import { parseCommand } from '../src/command.js';
import { fixture } from './helpers.js';

test('pagination discloses totals, preserves source order and binds its cursor', async t => {
  const f = await fixture({ 'one.ts': '// first\nfunction first() {}\n// second\nfunction second() {}' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  const page = render(bundle, { bundleId: bundle.bundleId, view: 'units', limit: 1 });
  assert.equal(page.total, 2); assert.equal(page.returned, 1); assert.ok(page.cursor);
  assert.match(page.text, /not the complete result/); assert.match(page.text, /first/); assert.doesNotMatch(page.text, /\/\/ second/);
  const next = render(bundle, { bundleId: bundle.bundleId, view: 'units', limit: 1, cursor: page.cursor });
  assert.match(next.text, /second/); assert.equal(next.cursor, null);
  assert.throws(() => render(bundle, { bundleId: bundle.bundleId, view: 'context', cursor: page.cursor! }), /Cursor/);
});
test('frozen context survives source changes and reports staleness', async t => {
  const f = await fixture({ 'one.ts': '// reason\nfunction first() { return 1; }' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  await writeFile(join(f.root, 'one.ts'), '// changed\nfunction first() {return 2;}');
  const page = render(bundle, { bundleId: bundle.bundleId, view: 'context' });
  assert.match(page.text, /return 1/); assert.doesNotMatch(page.text, /return 2/);
  assert.match((await currentSourceStatus(bundle, f.root))[0]!, /stale/);
  assert.match(scanReport(bundle).text, /No aggregate verdict/);
});
test('command routes enforce explicit scopes and preserve quoted paths', () => {
  assert.deepEqual(parseCommand('comments --files "my file.ts" other.py --dry-run'), { action: 'comments', input: { mode: 'files', files: ['my file.ts', 'other.py'], dryRun: true } });
  assert.throws(() => parseCommand('comments'), /Invalid/);
  assert.throws(() => parseCommand('comments --working --files one.ts'), /exactly one/);
  assert.throws(() => parseCommand('comments --files "unclosed'), /Unclosed/);
  assert.throws(() => parseCommand('comments --base'), /requires/);
});
