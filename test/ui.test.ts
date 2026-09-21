import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth, type Component } from '@earendil-works/pi-tui';
import { initialProgress } from '../src/progress.ts';
import { ProgressDisplay, plain, progressLines, resultComponent, resultDetails } from '../src/ui.ts';
import { ResultInspector } from '../src/inspector.ts';
import { scan } from '../src/engine.ts';
import { scanReport } from '../src/render.ts';
import { parseCommand } from '../src/command.ts';
import { fixture, syntheticResponse } from './helpers.ts';

const theme = {
  fg: (_color: string, s: string) => `\x1b[36m${s}\x1b[0m`,
  bg: (_color: string, s: string) => s,
  bold: (s: string) => s,
} as Theme;
test('progress respects display widths, essential cancellation and unknown totals', () => {
  const p = initialProgress('r', false, 0);
  for (const total of [0, 17]) {
    p.stage = total ? 'analyse' : 'capture';
    p.packets.total = total;
    for (let w = 1; w <= 160; w++) {
      const rows = progressLines(p, '深い/👩🏽‍💻/é/' + 'long '.repeat(100), { width: w, theme, motion: true, now: 1000 });
      assert.ok(rows.length <= 4);
      for (const row of rows) assert.ok(visibleWidth(row) <= w);
      if (w >= 40) assert.match(plain(rows.join('\n')), /\/jevvy cancel/);
      if (!total) assert.doesNotMatch(plain(rows.join('\n')), /%|packets/);
    }
  }
  assert.equal(plain('\x1b[2Jname\x1b]0;title\x07\r\nnext'), 'name\nnext');
});
test('one widget survives one concurrent run finishing and all timers stop after the last', async () => {
  let component: Component | undefined,
    paints = 0,
    mounts = 0;
  const ctx = {
    hasUI: true,
    ui: {
      setWidget(_key: string, factory?: (tui: unknown, theme: Theme) => Component) {
        if (!factory) component = undefined;
        else {
          mounts++;
          component = factory(
            {
              requestRender() {
                paints++;
              },
            },
            theme,
          );
        }
      },
    },
  } as unknown as ExtensionContext;
  const display = new ProgressDisplay(true);
  const a = display.start(ctx, 'a', initialProgress('a', false));
  const b = display.start(ctx, 'b', initialProgress('b', false));
  assert.equal(mounts, 1);
  assert.match(plain(component!.render(80)[0]!), /2 active scans/);
  for (let i = 0; i < 1000; i++) a.update(initialProgress('a', false));
  await delay(60);
  assert.equal(paints, 1, 'a burst schedules one redraw');
  a.finish();
  assert.ok(component);
  b.finish();
  assert.equal(component, undefined);
  const before = paints;
  a.update(initialProgress('a', false));
  await delay(220);
  assert.equal(paints, before);
});
test('static and headless modes do not create an animation clock', async () => {
  let paints = 0;
  const ctx = {
    hasUI: true,
    ui: {
      setWidget(_k: string, f?: (t: unknown, th: Theme) => unknown) {
        f?.(
          {
            requestRender() {
              paints++;
            },
          },
          theme,
        );
      },
    },
  } as unknown as ExtensionContext;
  const display = new ProgressDisplay(false),
    run = display.start(ctx, 'a', initialProgress('a', false));
  await delay(60);
  const once = paints;
  await delay(220);
  assert.equal(paints, once);
  run.finish();
  const quiet = display.start({ hasUI: false } as ExtensionContext, 'a', initialProgress('a', false));
  quiet.update(initialProgress('a', false));
  quiet.finish();
});
test('compact results expose zero-answer failures and warnings; expansion preserves evidence', async t => {
  const f = await fixture({ 'one.ts': '// rationale\nfunction one(){return 1;}' });
  t.after(f.cleanup);
  const { bundle } = await scan(
    { mode: 'files', files: ['one.ts'] },
    {
      cwd: f.root,
      config: { storageDir: f.storageDir },
      persist: false,
      transport: async () => {
        throw new Error('provider failure');
      },
    },
  );
  const page = scanReport(bundle),
    d = resultDetails(bundle, page, undefined, ['Source changed; frozen evidence']);
  const compact = plain(resultComponent(page.text, d, false, theme).render(80).join('\n'));
  assert.match(compact, /No answers/);
  assert.match(compact, /14 errors/);
  assert.match(compact, /Source changed/);
  assert.doesNotMatch(compact, /writing_clarity/);
  for (const width of [20, 40, 80, 120])
    for (const expanded of [false, true])
      for (const row of resultComponent(page.text, d, expanded, theme).render(width))
        assert.ok(visibleWidth(row) <= width);
  assert.match(plain(resultComponent(page.text, d, true, theme).render(80).join('\n')), /writing_clarity/);
});
test('inspector pages comments and frozen source, scrolls distributions, and respects remapped cancel', async t => {
  const f = await fixture({
    'one.ts': '// first\nfunction first(){return 1;}\n// second\nfunction second(){return 2;}',
  });
  t.after(f.cleanup);
  const { bundle } = await scan(
    { mode: 'files', files: ['one.ts'] },
    { cwd: f.root, persist: false, config: { storageDir: f.storageDir }, transport: async r => syntheticResponse(r) },
  );
  let closed = false;
  const inspector = new ResultInspector(bundle, {
    warnings: ['Showing frozen evidence'],
    theme,
    height: () => 20,
    requestRender: () => {},
    close: () => {
      closed = true;
    },
    cancelKey: data => data === 'x',
    cancelLabel: 'x',
  });
  const text = () => plain(inspector.render(100).join('\n'));
  assert.match(text(), /first/);
  inspector.handleInput('\x1b[C');
  assert.match(text(), /second/);
  inspector.handleInput('\x1b[D');
  assert.match(text(), /first/);
  inspector.handleInput('\x1b[F');
  assert.match(text(), /probabilities/);
  inspector.handleInput('\t');
  assert.match(text(), /context/);
  assert.match(text(), /function first/);
  inspector.handleInput('\t');
  assert.match(text(), /overview/);
  inspector.handleInput('\t');
  inspector.handleInput('\x1b[C');
  inspector.handleInput('\t');
  assert.match(text(), /function second/);
  inspector.handleInput('\t');
  inspector.handleInput('\t');
  assert.match(text(), /units · page 2/);
  assert.match(text(), /second/);
  for (let width = 10; width <= 120; width++) {
    const rows = inspector.render(width);
    assert.ok(rows.length <= 20);
    for (const row of rows) assert.ok(visibleWidth(row) <= width);
  }
  inspector.handleInput('x');
  assert.equal(closed, true);
  assert.deepEqual(parseCommand(`inspect ${bundle.bundleId}`), { action: 'inspect', bundleId: bundle.bundleId });
  assert.throws(() => parseCommand('inspect'));
});
