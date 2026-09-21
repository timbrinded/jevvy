import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { scan } from '../src/engine.js';
import { fixture, syntheticResponse } from './helpers.js';
import type { Question } from '@typesafe-ai/sdk';

test('conflicting process-wide grammar registration fails explicitly', () => {
  const script = `import {registerDynamicLanguage} from '@ast-grep/napi'; import python from '@ast-grep/lang-python'; import {initializeParsers} from './src/ast.ts'; registerDynamicLanguage({python}); try { initializeParsers(); process.exitCode=1; } catch(e) { console.log(e.message); }`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.match(result.stdout, /not supported|conflict|unavailable/);
});
test('SDK retries once under its own policy, engine does not multiply retries', async t => {
  const f = await fixture({ 'one.ts': '// hello\nfunction f() {}' }); t.after(f.cleanup);
  let attempts = 0;
  const client = new TypeSafeClient({ apiKey: 'test-only', logLevel: 'off', retry: { maxRetries: 1, backoffInitialMs: 1, backoffJitter: 0 }, fetch: async (_url, init) => {
    if (++attempts === 1) return new Response('{}', { status: 429 });
    const request = JSON.parse(init!.body as string);
    return new Response(JSON.stringify(syntheticResponse(request)), { headers: { 'content-type': 'application/json' } });
  } });
  const r = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir }, transport: (request, signal) => client.systemOne({ ...request, questions: request.questions as Record<string, Question> }, { signal }) });
  assert.equal(attempts, 2); assert.equal(r.bundle.coverage.labels.ok, 14);
});
test('overall deadline interrupts an in-flight request and keeps a valid cancelled bundle', async t => {
  const f = await fixture({ 'one.ts': '// hello\nfunction f() {}' }); t.after(f.cleanup);
  const r = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir, runTimeoutMs: 100 }, transport: async (_request, signal) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did not cancel')), 2000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  }) });
  assert.equal(r.bundle.run.status, 'cancelled');
  assert.equal(r.bundle.coverage.labels.cancelled, 14);
});
test('request concurrency is bounded across unrelated functions', async t => {
  const f = await fixture({ 'one.ts': Array.from({ length: 6 }, (_, i) => `// ${i}\nfunction f${i}() {return ${i};}`).join('\n') }); t.after(f.cleanup);
  let active = 0, maximum = 0;
  const r = await scan({ mode: 'files', files: ['one.ts'] }, { cwd: f.root, persist: false, config: { storageDir: f.storageDir, requestConcurrency: 2 }, transport: async request => {
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return syntheticResponse(request);
  } });
  assert.equal(maximum, 2); assert.equal(r.bundle.coverage.labels.ok, 84);
});
test('multiple implementation comments share one callable context and packet', async t => {
  const f = await fixture({ 'one.ts': 'function f(x:number){\n // Keep the lower bound.\n const y=Math.max(0,x);\n // Return the clamped value.\n return y;\n}' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false });
  assert.equal(bundle.units.length, 2); assert.equal(Object.keys(bundle.contexts).length, 1);
  assert.deepEqual(bundle.units[0]!.context.refs, bundle.units[1]!.context.refs);
  assert.equal(Object.keys(bundle.executions).length, 1);
  assert.equal(Object.keys(Object.values(bundle.executions)[0]!.bindings).length, 28);
});
test('small request budgets split packets without losing or duplicating labels', async t => {
  const f = await fixture({ 'one.ts': '// purpose\nfunction f() {return 1;}' }); t.after(f.cleanup);
  const { bundle } = await scan({ mode: 'files', files: ['one.ts'], dryRun: true }, { cwd: f.root, persist: false, config: { maxRequestBytes: 3000 } });
  assert.ok(Object.keys(bundle.executions).length > 1);
  const bindings = Object.values(bundle.executions).flatMap(e => Object.values(e.bindings));
  assert.equal(bindings.length, 14);
  assert.equal(new Set(bindings.map(b => b.labelId)).size, 14);
  assert.ok(Object.values(bundle.executions).every(e => Buffer.byteLength(JSON.stringify(e.request)) <= 3000));
});
