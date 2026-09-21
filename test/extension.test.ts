import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';
import { fixture } from './helpers.ts';

test('slash handler yields, cancellation aborts transport, and shutdown retains the cancelled bundle', async t => {
  const f = await fixture({ 'one.ts': '/** Returns one. */\nfunction first() { return 1; }' });
  t.after(f.cleanup);
  const previousConfig = process.env.JEVVY_CONFIG,
    previousKey = process.env.TYPESAFE_API_KEY;
  process.env.JEVVY_CONFIG = JSON.stringify({ storageDir: f.storageDir });
  process.env.TYPESAFE_API_KEY = 'test-only';
  t.after(() => {
    if (previousConfig === undefined) delete process.env.JEVVY_CONFIG;
    else process.env.JEVVY_CONFIG = previousConfig;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  });
  let began!: () => void;
  const started = new Promise<void>(resolve => {
    began = resolve;
  });
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    began();
    return new Promise((_resolve, reject) => {
      const abort = () => {
        aborted = true;
        reject(new Error('aborted'));
      };
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener('abort', abort, { once: true });
    });
  });
  let command!: Parameters<ExtensionAPI['registerCommand']>[1];
  const events = new Map<string, () => Promise<void>>();
  const messages: unknown[] = [],
    notices: string[] = [];
  extension({
    registerTool() {},
    registerMessageRenderer() {},
    registerCommand(_name: string, value: typeof command) {
      command = value;
    },
    on(name: string, handler: () => Promise<void>) {
      events.set(name, handler);
    },
    sendMessage(message: unknown) {
      messages.push(message);
    },
  } as unknown as ExtensionAPI);
  const ctx = {
    cwd: f.root,
    hasUI: true,
    ui: {
      notify(message: string) {
        notices.push(message);
      },
      setWidget() {},
    },
  } as unknown as Parameters<typeof command.handler>[1];
  const timeout = new Promise<never>((_resolve, reject) => {
    const id = setTimeout(() => reject(new Error('command did not yield or transport did not start')), 5000);
    t.after(() => clearTimeout(id));
  });
  await Promise.race([command.handler('comments --files one.ts', ctx), timeout]);
  await Promise.race([started, timeout]);
  await command.handler('comments --files one.ts', ctx);
  assert.ok(notices.some(n => n.includes('A command scan is running')));
  await command.handler('cancel', ctx);
  await Promise.race([events.get('session_shutdown')!(), timeout]);
  assert.ok(aborted);
  assert.equal(messages.length, 0, 'retiring a session suppresses late result messages');
  const { readdir, readFile } = await import('node:fs/promises');
  const names = await readdir(`${f.storageDir}/bundles`);
  const bundle = JSON.parse(await readFile(`${f.storageDir}/bundles/${names[0]}`, 'utf8'));
  assert.equal(bundle.run.status, 'cancelled');
  assert.equal(bundle.coverage.labels.cancelled, 14);
  await command.handler('cancel', ctx);
  assert.equal(notices.at(-1), 'No scan is running');
  await command.handler('comments --files one.ts --dry-run', { ...ctx, hasUI: false });
  assert.equal(messages.length, 1, 'headless command returns only after delivering results');
  assert.match(JSON.stringify(messages[0]), /completed/);
});
