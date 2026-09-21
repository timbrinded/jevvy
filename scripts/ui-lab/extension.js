// Opt-in experiment: pi -e ./scripts/ui-lab/extension.js, then /ui-lab live.
// Fault modes use the real scan engine with an explicitly injected transport.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box, Text } from '@earendil-works/pi-tui';
import { keyText } from '@earendil-works/pi-coding-agent';
import { scan } from '../../dist/engine.js';
import { configuration } from '../../dist/config.js';
import { jevTransport } from '../../dist/jev.js';
import { scanReport } from '../../dist/render.js';
import { clean, panel, summary } from './panel.js';

const log = entry => {
  if (process.env.JEVVY_UI_LOG)
    appendFileSync(process.env.JEVVY_UI_LOG, JSON.stringify({ at: Date.now(), ...entry }) + '\n');
};

function renderResult(message, { expanded, outputPad }, theme) {
  const d = message.details;
  const color = d.status === 'completed' ? 'success' : d.status === 'cancelled' ? 'warning' : 'error';
  const box = new Box(outputPad, 1, text => theme.bg('customMessageBg', text));
  const header = `${theme.fg('accent', theme.bold('jevvy'))}  ${theme.fg(color, d.status)}  ${theme.fg('dim', d.elapsed + ' · UI experiment')}`;
  box.addChild(new Text(header + '\n' + clean(d.summary), 0, 0));
  box.addChild(new Text(theme.fg('dim', clean(d.bundleId)), 0, 0));
  if (expanded) box.addChild(new Text(String(message.content), 0, 0));
  else {
    const key = keyText('app.tools.expand');
    box.addChild(
      new Text(theme.fg('dim', key ? `${key} for full evidence` : 'Expand tool output for full evidence'), 0, 0),
    );
  }
  return box;
}

function mountProgress(run) {
  const { ctx, state } = run;
  let redraw = () => {};
  if (ctx.hasUI)
    ctx.ui.setWidget('jevvy-ui-lab', (tui, theme) => {
      redraw = () => tui.requestRender();
      return { render: width => panel(state, width, theme), invalidate() {} };
    });
  if (ctx.hasUI)
    run.timer = setInterval(() => {
      if (!state.static) {
        redraw();
        log({ event: 'tick' });
      }
    }, 160);
  run.timer?.unref();
  return () => redraw();
}

async function scanRun(pi, run, paths, redraw) {
  const { state, ctx, controller } = run;
  const { mode } = state;
  // Unique storage per run prevents a cached result hiding network progress.
  const config = configuration({
    storageDir: resolve('.artifacts/ui-research/runs', `${state.started}-${mode}`),
    maxRetries: 0,
  });
  const real = jevTransport(config);
  let requests = 0;
  const result = await scan(
    { mode: 'files', files: paths.length ? paths : ['fixtures/comments.ts'] },
    {
      cwd: ctx.cwd,
      config,
      signal: controller.signal,
      transport: async (request, signal) => {
        const sequence = ++requests;
        state.inflight++;
        state.phase = 'Analysing comments';
        redraw();
        log({ event: 'request', sequence, mode });
        try {
          if (mode === 'error' || (mode === 'partial' && sequence > 1))
            throw new Error('Injected provider failure for UI testing');
          if (mode === 'stall')
            return await new Promise((_resolve, reject) => {
              const abort = () => reject(new Error('Injected stalled request cancelled'));
              if (signal.aborted) abort();
              else signal.addEventListener('abort', abort, { once: true });
            });
          return await real(request, signal);
        } finally {
          state.inflight--;
        }
      },
      onProgress: text => {
        const counts = /^Processed (\d+)\/(\d+) packets$/.exec(text);
        if (counts) {
          state.done = Number(counts[1]);
          state.total = Number(counts[2]);
        } else if (!requests) state.phase = text.startsWith('Extracting ') ? 'Extracting comments' : text;
        log({ event: 'progress', text });
        redraw();
      },
    },
  );
  const b = result.bundle;
  log({ event: 'result', status: b.run.status, coverage: b.coverage, bundleId: b.bundleId, path: result.path });
  if (!run.retired)
    pi.sendMessage({
      customType: 'jevvy-ui-lab',
      display: true,
      content: scanReport(b).text + '\n\nBundle file: ' + result.path,
      details: {
        status: b.run.status,
        summary: summary(b),
        bundleId: b.bundleId,
        elapsed: ((Date.now() - state.started) / 1000).toFixed(1) + 's',
      },
    });
}

export default function uiLab(pi) {
  let active;
  pi.registerMessageRenderer('jevvy-ui-lab', renderResult);
  pi.registerCommand('ui-lab', {
    description: 'UI experiment: live, error, partial, stall, cancel, static, status',
    handler: async (args, ctx) => {
      const [mode = 'live', ...paths] = args.trim().split(/\s+/);
      if (mode === 'cancel') {
        active?.controller.abort();
        return;
      }
      if (mode === 'static') {
        if (active) active.state.static = !active.state.static;
        return;
      }
      if (mode === 'status') {
        ctx.ui.notify(active ? active.state.phase : 'UI lab idle; no refresh timer', 'info');
        return;
      }
      if (!['live', 'error', 'partial', 'stall'].includes(mode)) {
        ctx.ui.notify('Use live, error, partial, stall, cancel, static, or status', 'warning');
        return;
      }
      if (active) {
        ctx.ui.notify('A scan is already running. /ui-lab cancel', 'warning');
        return;
      }
      const controller = new AbortController();
      const state = {
        started: Date.now(),
        phase: 'Capturing source',
        path: paths.join(' ') || 'fixtures/comments.ts',
        mode,
        done: 0,
        total: 0,
        inflight: 0,
        static: false,
      };
      const run = { controller, state, ctx, timer: undefined, task: undefined };
      active = run;
      const redraw = mountProgress(run);
      run.task = (async () => {
        try {
          await scanRun(pi, run, paths, redraw);
        } catch (error) {
          log({ event: 'error', message: error.message });
          if (!run.retired) ctx.ui.notify(error.message, 'error');
        } finally {
          clearInterval(run.timer);
          if (!run.retired && ctx.hasUI) ctx.ui.setWidget('jevvy-ui-lab', undefined);
          if (active === run) active = undefined;
          log({ event: 'disposed' });
        }
      })();
      if (!ctx.hasUI) await run.task;
    },
  });
  const stop = async () => {
    const run = active;
    if (run) {
      if (run.ctx.hasUI) run.ctx.ui.setWidget('jevvy-ui-lab', undefined);
      run.retired = true;
      clearInterval(run.timer);
      run.controller.abort();
      await run.task;
    }
  };
  pi.on('session_before_switch', stop);
  pi.on('session_shutdown', stop);
}
