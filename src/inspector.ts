import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui';
import type { Bundle, ResultsInput } from './contracts.ts';
import { render, type Page } from './render.ts';
import { plain } from './ui.ts';

interface InspectorOptions {
  warnings: string[];
  theme: Theme;
  height: () => number;
  requestRender: () => void;
  close: () => void;
  cancelKey: (data: string) => boolean;
  cancelLabel?: string;
}

/** Reads the frozen bundle only. Inspecting another page never calls Jev. */
export class ResultInspector implements Component {
  private view: NonNullable<ResultsInput['view']> = 'units';
  private cursors: (string | undefined)[] = [undefined];
  private unitCursors: (string | undefined)[] = [undefined];
  private scroll = 0;
  private maxScroll = 0;
  private contextIds?: string[];
  private page: Page;
  private readonly bundle: Bundle;
  private readonly warnings: string[];
  private readonly theme: Theme;
  private readonly height: () => number;
  private readonly requestRender: () => void;
  private readonly close: () => void;
  private readonly cancelKey: (data: string) => boolean;
  private readonly cancelLabel: string;
  constructor(
    bundle: Bundle,
    { warnings, theme, height, requestRender, close, cancelKey, cancelLabel = 'Esc' }: InspectorOptions,
  ) {
    this.bundle = bundle;
    this.warnings = warnings;
    this.theme = theme;
    this.height = height;
    this.requestRender = requestRender;
    this.close = close;
    this.cancelKey = cancelKey;
    this.cancelLabel = cancelLabel;
    this.page = this.readPage();
  }
  private readPage(): Page {
    return render(
      this.bundle,
      {
        bundleId: this.bundle.bundleId,
        view: this.view,
        limit: 1,
        cursor: this.cursors.at(-1),
        ids: this.view === 'context' ? this.contextIds : undefined,
      },
      { includeHeader: false },
    );
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (this.cancelKey(data)) {
      this.close();
      return;
    }
    if (matchesKey(data, 'tab')) {
      if (this.view === 'units') {
        this.unitCursors = [...this.cursors];
        this.contextIds = this.bundle.units[this.cursors.length - 1]?.context.refs;
      }
      this.view = this.view === 'units' ? 'context' : this.view === 'context' ? 'overview' : 'units';
      this.cursors = this.view === 'units' ? [...this.unitCursors] : [undefined];
      this.scroll = 0;
    } else if (matchesKey(data, 'right') && this.page.cursor) {
      this.cursors.push(this.page.cursor);
      this.scroll = 0;
    } else if (matchesKey(data, 'left') && this.cursors.length > 1) {
      this.cursors.pop();
      this.scroll = 0;
    } else if (matchesKey(data, 'down')) this.scroll++;
    else if (matchesKey(data, 'up')) this.scroll--;
    else if (matchesKey(data, 'pageDown')) this.scroll += Math.max(1, this.height() - 8);
    else if (matchesKey(data, 'pageUp')) this.scroll -= Math.max(1, this.height() - 8);
    else if (matchesKey(data, 'home')) this.scroll = 0;
    else if (matchesKey(data, 'end')) this.scroll = this.maxScroll;
    this.page = this.readPage();
    this.requestRender();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(5, this.height());
    const innerWidth = Math.max(1, width - 4);
    const body = [this.warnings.length ? this.warnings.join('\n') + '\n\n' : '', this.page.text].join('');
    const wrapped = wrapTextWithAnsi(plain(body), innerWidth);
    const bodyHeight = height - 4;
    this.maxScroll = Math.max(0, wrapped.length - bodyHeight);
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    const title =
      this.theme.fg(
        'accent',
        this.theme.bold(`jevvy ${this.bundle.pack.id} · ${this.view} · page ${this.cursors.length}`),
      ) +
      this.theme.fg(
        'dim',
        ` · ${this.bundle.run.mode === 'dry_run' ? 'preview' : this.bundle.run.status} · lines ${this.scroll + 1}–${Math.min(this.scroll + bodyHeight, wrapped.length)}/${wrapped.length}`,
      );
    const hint =
      width < 60
        ? `${this.cancelLabel} close · Tab view · ←→ page · ↑↓ scroll`
        : `${this.cancelLabel} close · Tab: ${this.bundle.pack.id} / source / definitions · ←→ page · ↑↓ / PgUp/PgDn scroll`;
    const border = (s: string) => this.theme.fg('borderMuted', s);
    const row = (s: string) => {
      const clipped = truncateToWidth(s, innerWidth);
      return this.theme.bg(
        'customMessageBg',
        truncateToWidth(
          border('│ ') + clipped + ' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped))) + border(' │'),
          width,
        ),
      );
    };
    const content = wrapped.slice(this.scroll, this.scroll + bodyHeight);
    while (content.length < bodyHeight) content.push('');
    return [
      border('╭' + '─'.repeat(Math.max(0, width - 2)) + '╮'),
      row(title),
      ...content.map(row),
      row(this.theme.fg('dim', hint)),
      border('╰' + '─'.repeat(Math.max(0, width - 2)) + '╯'),
    ].map(s => truncateToWidth(s, width));
  }
}

export async function inspectResults(
  ctx: ExtensionContext,
  bundle: Bundle,
  warnings: string[],
  onClose: (close: (() => void) | undefined) => void,
): Promise<void> {
  try {
    await ctx.ui.custom<void>(
      (tui, theme, keys, done) => {
        let closed = false;
        const close = () => {
          if (!closed) {
            closed = true;
            done();
          }
        };
        onClose(close);
        return new ResultInspector(bundle, {
          warnings,
          theme,
          height: () => Math.max(3, tui.terminal.rows - 6),
          requestRender: () => {
            if (!closed) tui.requestRender();
          },
          close,
          cancelKey: data => keys.matches(data, 'tui.select.cancel'),
          cancelLabel: keys.getKeys('tui.select.cancel').join('/') || 'Cancel',
        });
      },
      { overlay: true, overlayOptions: { width: '100%', maxHeight: '90%', anchor: 'center' } },
    );
  } finally {
    onClose(undefined);
  }
}
