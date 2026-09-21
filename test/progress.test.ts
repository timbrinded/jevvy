import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { scan } from '../src/engine.ts';
import type { ScanProgress } from '../src/progress.ts';
import { fixture, syntheticResponse } from './helpers.ts';

const source =
  '// first\nfunction first(){return 1;}\n// second\nfunction second(){return 2;}\n// third\nfunction third(){return 3;}';
test('plan totals precede requests, progress is immutable, and cached work is counted', async t => {
  const f = await fixture({ 'one.ts': source });
  t.after(f.cleanup);
  const events: ScanProgress[] = [];
  const options = {
    cwd: f.root,
    config: { storageDir: f.storageDir },
    onEvent: (p: ScanProgress) => events.push(p),
    transport: async (r: Parameters<typeof syntheticResponse>[0]) => {
      assert.ok(events.some(p => p.stage === 'plan' && p.packets.total === 3));
      return syntheticResponse(r);
    },
  };
  const first = await scan({ mode: 'files', files: ['one.ts'] }, options);
  assert.equal(events[0]!.stage, 'capture');
  assert.equal(events[0]!.packets.total, 0);
  assert.equal(events.at(-1)!.runId, first.bundle.bundleId);
  assert.deepEqual(events.at(-1)!.packets, {
    total: 3,
    completed: 3,
    active: 0,
    ok: 3,
    partial: 0,
    error: 0,
    cancelled: 0,
    cached: 0,
  });
  assert.ok(events.findIndex(e => e.stage === 'persist') < events.findIndex(e => e.stage === 'complete'));
  for (const p of events) {
    assert.equal(p.packets.completed, p.packets.ok + p.packets.partial + p.packets.error + p.packets.cancelled);
    assert.ok(p.packets.active + p.packets.completed <= p.packets.total);
  }
  const second = await scan({ mode: 'files', files: ['one.ts'] }, options);
  assert.equal(events.at(-1)!.packets.cached, 3);
  assert.equal(second.bundle.coverage.cachedPackets, 3);
});
test('cancelled queued packets reach the final total without being counted as active requests', async t => {
  const f = await fixture({ 'one.ts': source });
  t.after(f.cleanup);
  const controller = new AbortController(),
    events: ScanProgress[] = [];
  await scan(
    { mode: 'files', files: ['one.ts'] },
    {
      cwd: f.root,
      persist: false,
      config: { storageDir: f.storageDir, requestConcurrency: 1 },
      signal: controller.signal,
      onEvent: e => events.push(e),
      transport: async r => {
        controller.abort();
        return syntheticResponse(r);
      },
    },
  );
  assert.deepEqual(events.at(-1)!.packets, {
    total: 3,
    completed: 3,
    active: 0,
    ok: 1,
    partial: 0,
    error: 0,
    cancelled: 2,
    cached: 0,
  });
});
test('dry-run plans packets but never claims they were executed', async t => {
  const f = await fixture({ 'one.ts': source });
  t.after(f.cleanup);
  const events: ScanProgress[] = [];
  await scan(
    { mode: 'files', files: ['one.ts'], dryRun: true },
    { cwd: f.root, persist: false, onEvent: e => events.push(e) },
  );
  assert.equal(events.at(-1)!.packets.total, 3);
  assert.equal(events.at(-1)!.packets.completed, 0);
  assert.ok(!events.some(e => e.stage === 'analyse'));
});
test('failure to save ends with failed progress, never a saved result', async t => {
  const f = await fixture({ 'one.ts': source });
  t.after(f.cleanup);
  await writeFile(f.storageDir, 'not a directory');
  const events: ScanProgress[] = [];
  await assert.rejects(
    scan(
      { mode: 'files', files: ['one.ts'], dryRun: true },
      { cwd: f.root, config: { storageDir: f.storageDir }, onEvent: e => events.push(e) },
    ),
  );
  assert.equal(events.at(-1)!.stage, 'failed');
  assert.ok(!events.some(e => e.stage === 'complete'));
});
