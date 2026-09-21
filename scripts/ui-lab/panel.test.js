import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { visibleWidth, Text } from '@earendil-works/pi-tui';
import { panel, clean } from './panel.js';
import extension from './extension.js';

const theme = { fg: (_key, s) => '\x1b[36m' + s + '\x1b[0m', bold: s => s, bg: (_key, s) => s };
const state = { phase: 'Analysing comments', path: '深い/👩🏽‍💻/é/' + 'long path '.repeat(80), started: 0, mode: 'live', total: 31, done: 9, inflight: 3 };

test('live panel fits widths 1 through 160 with ANSI, emoji, combining marks and long paths', () => {
  for (let width = 1; width <= 160; width++) for (const total of [0, 31]) {
    const lines = panel({ ...state, total }, width, theme, 3200);
    assert.ok(lines.length <= 4);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `overflow at ${width}`);
  }
});
test('unknown totals never become fabricated percentages, and static mode stops the spinner', () => {
  const a = panel({ ...state, total: 0, static: true }, 80, theme, 1600).map(clean).join('\n');
  const b = panel({ ...state, total: 0, static: true }, 80, theme, 1760).map(clean).join('\n');
  assert.match(a, /3 requests in flight/); assert.doesNotMatch(a, /%|31/);
  assert.equal(a.split('\n')[0].split('  ')[0], b.split('\n')[0].split('  ')[0]);
  assert.match(a, /●/);
});
test('source paths cannot inject terminal controls into the live panel', () => {
  assert.equal(clean('\x1b[2Jevil\r\nname\x1b]0;title\x07'), 'evil  name');
});

function harness(hasUI = true) {
  const commands = new Map(), events = new Map(), renderers = new Map(), messages = [], widgets = new Map();
  let paints = 0;
  const ctx = { cwd: process.cwd(), hasUI, ui: {
    setWidget(key, factory) { if (!factory) widgets.delete(key); else widgets.set(key, factory({ requestRender() { paints++; } }, theme)); },
    notify() {},
  } };
  extension({ registerCommand(n, c) { commands.set(n, c); }, registerMessageRenderer(n, r) { renderers.set(n, r); }, on(n, cb) { events.set(n, cb); }, sendMessage(m) { messages.push(m); } });
  return { command: args => commands.get('ui-lab').handler(args, ctx), events, renderers, messages, widgets, paints: () => paints };
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'condition timed out'); await delay(20); }
}
test('cancel yields input, persists a cancelled result, removes widget and stops redraws', async () => {
  const h = harness();
  try {
    await h.command('stall');
    await until(() => h.widgets.get('jevvy-ui-lab')?.render(80).some(s => s.includes('3 requests')));
    await h.command('cancel');
    await until(() => h.messages.length === 1);
    assert.equal(h.messages[0].details.status, 'cancelled');
    assert.match(h.messages[0].details.summary, /112 cancelled/);
    assert.equal(h.widgets.size, 0);
    const paints = h.paints(); await delay(350); assert.equal(h.paints(), paints);
  } finally { await h.events.get('session_shutdown')(); }
});
test('session switch retires widget and prevents late completion messages', async () => {
  const h = harness();
  await h.command('stall');
  await until(() => h.widgets.get('jevvy-ui-lab')?.render(80).some(s => s.includes('3 requests')));
  await h.events.get('session_before_switch')();
  assert.equal(h.widgets.size, 0); assert.equal(h.messages.length, 0);
  const paints = h.paints(); await delay(350); assert.equal(h.paints(), paints);
});
test('headless error path retains model evidence and compact/expanded results remain distinct', async () => {
  const h = harness(false);
  await h.command('error');
  assert.equal(h.messages.length, 1); assert.equal(h.widgets.size, 0); assert.equal(h.paints(), 0);
  const m = h.messages[0]; assert.match(m.details.summary, /112 errors/);
  const renderer = h.renderers.get('jevvy-ui-lab');
  const compact = renderer(m, { expanded: false, outputPad: 1 }, theme).render(80).map(clean).join('\n');
  assert.match(compact, /full evidence/);
  assert.doesNotMatch(compact, /Injected provider failure/);
  for (const width of [20, 40, 80, 120]) {
    const component = renderer(m, { expanded: true, outputPad: 1 }, theme);
    for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
  }
  assert.match(m.content, /Injected provider failure/);
  assert.ok(new Text(m.details.summary, 0, 0).render(80).length < new Text(m.content, 0, 0).render(80).length);
});
