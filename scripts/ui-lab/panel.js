// UI research prototype. Uses Pi's public components; no production registration.
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

export const clean = value =>
  String(value)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function panel(state, width, theme, now = Date.now()) {
  if (width < 1) return [];
  const fg = (key, text) => theme.fg(key, text);
  const elapsed = Math.max(0, now - state.started);
  const marker = state.static ? '●' : frames[Math.floor(elapsed / 160) % frames.length];
  const seconds = `${(elapsed / 1000).toFixed(1)}s`;
  const title = `${fg('accent', theme.bold('jevvy'))}  ${fg('accent', marker)} ${clean(state.phase)}`;
  const right = fg('dim', seconds);
  const gap = Math.max(1, width - visibleWidth(title) - visibleWidth(right));
  const heading = width >= 60 ? title + ' '.repeat(gap) + right : title;
  const count = state.total ? `${state.done}/${state.total} packets processed` : `${state.inflight} requests in flight`;
  const barWidth = Math.min(28, Math.max(4, width - 35));
  const filled = state.total ? Math.floor((barWidth * state.done) / state.total) : 0;
  const meter = state.total ? fg('accent', '━'.repeat(filled)) + fg('dim', '─'.repeat(barWidth - filled)) + '  ' : '';
  const detail = state.total ? count : `${count} · waiting for Jev`;
  const lines =
    width < 60
      ? [
          heading,
          meter + fg('muted', detail),
          fg('dim', `${state.mode === 'live' ? '' : 'Injected ' + state.mode + ' · '}/ui-lab cancel`),
        ]
      : [heading, fg('muted', clean(state.path)), meter + fg('muted', detail)];
  if (width >= 60)
    lines.push(fg('dim', `${state.mode === 'live' ? 'Live API' : 'Injected ' + state.mode} · /ui-lab cancel`));
  return lines.map(line => truncateToWidth(line, width));
}

export function summary(bundle) {
  const c = bundle.coverage.labels;
  return `${bundle.units.length} comments · ${c.ok} answers · ${c.error} errors · ${c.cancelled} cancelled · ${bundle.coverage.cachedPackets} cached packets`;
}
