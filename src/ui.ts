import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui';
import type { Bundle } from './contracts.ts';
import type { Page } from './render.ts';
import { progressText, type ScanProgress } from './progress.ts';

// Source-controlled strings are data, never terminal commands. Preserve newlines in evidence.
export function plain(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
const lineText = (text: string) => plain(text).replace(/[\n\r\t]/g, ' ');
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function progressLines(
  p: ScanProgress,
  scope: string,
  { width, theme, motion, now = Date.now() }: { width: number; theme: Theme; motion: boolean; now?: number },
): string[] {
  if (width < 1) return [];
  const elapsed = Math.max(0, now - p.startedAt);
  const spinner = motion ? frames[Math.floor(elapsed / 160) % frames.length]! : '●';
  const phase = {
    capture: 'Capturing source',
    extract: `Extracting ${p.pack ?? 'comments'}`,
    plan: 'Planning requests',
    analyse: `Analysing ${p.pack ?? 'comments'}`,
    persist: 'Saving results',
    complete: 'Finished',
    failed: 'Failed',
  }[p.stage];
  const left = theme.fg('accent', theme.bold(`jevvy ${spinner}`)) + '  ' + phase;
  const time = `${(elapsed / 1000).toFixed(1)}s`;
  const heading =
    width >= 60
      ? left + ' '.repeat(Math.max(1, width - visibleWidth(left) - time.length)) + theme.fg('dim', time)
      : left;
  const n = p.packets;
  let detail = progressText(p);
  if (p.stage === 'analyse' && n.total) {
    const size = Math.min(24, Math.max(4, width - 34));
    const filled = Math.floor(size * Math.min(n.completed / n.total, 1));
    detail =
      theme.fg('accent', '━'.repeat(filled)) +
      theme.fg('dim', '─'.repeat(size - filled)) +
      `  ${n.completed}/${n.total} packets · ${n.active} active`;
  }
  const exceptions = [
    n.error + n.partial ? `${n.error + n.partial} with errors` : '',
    n.cancelled ? `${n.cancelled} cancelled` : '',
    n.cached ? `${n.cached} cached` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const hint = '/jevvy cancel' + (exceptions ? ` · ${exceptions}` : p.dryRun ? ' · preview; no requests' : '');
  const lines = [
    heading,
    ...(width >= 60 ? [theme.fg('muted', lineText(p.file ?? scope))] : []),
    detail,
    theme.fg(exceptions ? 'warning' : 'dim', hint),
  ];
  return lines.map(line => truncateToWidth(line, width));
}

export interface ResultDetails extends Omit<Page, 'text'> {
  kind: 'jevvy-result';
  bundleId: string;
  path?: string;
  cursor: string | null;
  status: Bundle['run']['status'];
  dryRun: boolean;
  scope: string;
  elapsed: number;
  coverage: Bundle['coverage'];
  warnings: string[];
  pack?: Bundle['pack']['id'];
}
export function resultDetails(bundle: Bundle, page: Page, path?: string, warnings: string[] = []): ResultDetails {
  return {
    kind: 'jevvy-result',
    bundleId: bundle.bundleId,
    pack: bundle.pack.id,
    path,
    cursor: page.cursor,
    status: bundle.run.status,
    dryRun: bundle.run.mode === 'dry_run',
    scope: bundle.run.scope.mode === 'files' ? bundle.run.scope.files.join(', ') : bundle.run.scope.mode,
    elapsed: Date.parse(bundle.run.finishedAt) - Date.parse(bundle.run.startedAt),
    coverage: bundle.coverage,
    warnings: [
      ...warnings,
      ...bundle.diagnostics,
      ...bundle.coverage.files
        .filter(f => !['parsed', 'deleted'].includes(f.status))
        .map(f => `${f.path}: ${f.status} ${f.reason}`),
    ],
    labels: page.labels,
    includeContext: page.includeContext,
    includeDefinitions: page.includeDefinitions,
    minProbability: page.minProbability,
    minConfidence: page.minConfidence,
    view: page.view,
    order: page.order,
    selection: page.selection,
    returned: page.returned,
    total: page.total,
  };
}
export function noAnswers(d: ResultDetails): boolean {
  return !d.dryRun && d.coverage.labels.ok === 0 && d.coverage.labels.error > 0;
}

function filterSummary(d: ResultDetails): string[] {
  if (d.minProbability === undefined && d.minConfidence === undefined) return [];
  return [`Filter: ${d.order} · P(outcome) ≥ ${d.minProbability ?? 0} · confidence ≥ ${d.minConfidence ?? 0}`];
}
export function resultComponent(
  text: string,
  d: ResultDetails | undefined,
  expanded: boolean,
  theme: Theme,
): Component {
  if (!d || d.kind !== 'jevvy-result') return new Text(plain(text), 0, 0);
  const c = d.coverage;
  const status = noAnswers(d) ? 'No answers · requests failed' : d.dryRun ? `Preview · ${d.status}` : d.status;
  const color = noAnswers(d) || d.status === 'failed' ? 'error' : d.status === 'completed' ? 'success' : 'warning';
  const counts = [
    `${c.units.selected} ${d.pack ?? 'comments'}`,
    `${c.labels.ok} answers`,
    `${c.labels.error} errors`,
    `${c.labels.cancelled} cancelled`,
  ];
  if (c.labels.not_evaluated) counts.push(`${c.labels.not_evaluated} not evaluated`);
  if (c.labels.not_applicable) counts.push(`${c.labels.not_applicable} not applicable`);
  if (c.cachedPackets) counts.push(`${c.cachedPackets} cached packets`);
  const rows = [
    theme.fg('accent', theme.bold('jevvy')) +
      '  ' +
      theme.fg(color, status) +
      theme.fg('dim', ` · ${(Math.max(0, d.elapsed) / 1000).toFixed(1)}s`),
    counts.join(' · '),
    theme.fg('muted', lineText(d.scope)),
  ];
  if (c.units.excluded || c.units.removed)
    rows.push(theme.fg('dim', `${c.units.excluded} excluded · ${c.units.removed} removed`));
  for (const warning of d.warnings.slice(0, 2)) rows.push(theme.fg('warning', lineText(warning)));
  if (d.warnings.length > 2) rows.push(theme.fg('warning', `${d.warnings.length - 2} more warnings in evidence`));
  rows.push(theme.fg('dim', `${d.view}: ${d.returned}/${d.total} shown${d.cursor ? ' · more pages available' : ''}`));
  rows.push(...filterSummary(d).map(text => theme.fg('dim', text)));
  rows.push(theme.fg('dim', `/jevvy inspect ${d.bundleId}`));
  if (expanded) rows.push('', plain(text));
  else rows.push(theme.fg('dim', 'Expand tool output for this page’s evidence'));
  return new Text(rows.join('\n'), 0, 0);
}

/** One editor widget for all concurrent scans. Only the component factory starts clocks. */
export class ProgressDisplay {
  private runs = new Map<symbol, { scope: string; progress: ScanProgress }>();
  private ctx?: ExtensionContext;
  private redraw?: () => void;
  private clock?: ReturnType<typeof setInterval>;
  private pending?: ReturnType<typeof setTimeout>;
  private readonly motion: boolean;
  constructor(motion: boolean) {
    this.motion = motion;
  }
  start(
    ctx: ExtensionContext,
    scope: string,
    progress: ScanProgress,
  ): { update(p: ScanProgress): void; finish(): void } {
    const key = Symbol();
    if (!ctx.hasUI) return { update() {}, finish() {} };
    this.runs.set(key, { scope, progress });
    if (!this.ctx) {
      this.ctx = ctx;
      ctx.ui.setWidget('jevvy', (tui, theme) => {
        this.redraw = () => tui.requestRender();
        if (this.motion) {
          this.clock = setInterval(() => this.schedule(), 160);
          this.clock.unref();
        }
        return {
          render: width => {
            const latest = [...this.runs.values()].at(-1);
            if (!latest) return [];
            const lines = progressLines(latest.progress, latest.scope, { width, theme, motion: this.motion });
            if (this.runs.size > 1)
              lines[0] = truncateToWidth(
                theme.fg('accent', `jevvy · ${this.runs.size} active scans`) + ' · ' + progressText(latest.progress),
                width,
              );
            return lines;
          },
          invalidate() {},
          dispose: () => this.clearTimers(),
        };
      });
    }
    this.schedule();
    return {
      update: p => {
        if (this.runs.has(key)) {
          this.runs.set(key, { scope, progress: p });
          this.schedule();
        }
      },
      finish: () => {
        if (!this.runs.delete(key)) return;
        if (!this.runs.size) this.clear();
        else this.schedule();
      },
    };
  }
  private schedule(): void {
    if (!this.redraw || this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.redraw?.();
    }, 32);
    this.pending.unref();
  }
  private clearTimers(): void {
    clearInterval(this.clock);
    clearTimeout(this.pending);
    this.clock = undefined;
    this.pending = undefined;
    this.redraw = undefined;
  }
  clear(): void {
    this.runs.clear();
    this.clearTimers();
    const ctx = this.ctx;
    this.ctx = undefined;
    ctx?.ui.setWidget('jevvy', undefined);
  }
}
