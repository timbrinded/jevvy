import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Box, Text } from '@earendil-works/pi-tui';
import { ScanInputSchema, ResultsInputSchema, type Config, type ResultsInput, type ScanInput } from './contracts.ts';
import { configuration } from './config.ts';
import { scan, type ScanResult } from './engine.ts';
import { loadBundle } from './bundle.ts';
import { render, scanReport, currentSourceStatus } from './render.ts';
import { parseCommand } from './command.ts';
import { initialProgress, progressText, type ScanProgress } from './progress.ts';
import {
  ProgressDisplay,
  noAnswers,
  plain,
  progressLines,
  resultComponent,
  resultDetails,
  type ResultDetails,
} from './ui.ts';
import { inspectResults } from './inspector.ts';

type ToolDetails = { progress: ScanProgress; scope: string } | ResultDetails;
interface ActiveRun {
  controller: AbortController;
  task: Promise<ScanResult>;
  retired: boolean;
  epoch: number;
}
const scopeText = (input: ScanInput) =>
  input.mode === 'files'
    ? input.files!.join(', ')
    : input.mode === 'working'
      ? 'Working changes'
      : `${input.base} → ${input.head ?? 'HEAD'}`;
const contentText = (content: readonly { type: string; text?: string }[]) =>
  content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n');

class JevvySession {
  private readonly active = new Set<ActiveRun>();
  private commandTask: Promise<void> | undefined;
  private closeInspector: (() => void) | undefined;
  private epoch = 0;
  private readonly display = new ProgressDisplay(process.env.JEVVY_ANIMATION !== '0');
  private readonly config: Config = configuration(
    process.env.JEVVY_CONFIG ? (JSON.parse(process.env.JEVVY_CONFIG) as Partial<Config>) : {},
  );
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }
  start(input: ScanInput, ctx: ExtensionContext, signal?: AbortSignal, update?: (p: ScanProgress) => void): ActiveRun {
    const controller = new AbortController();
    const view = this.display.start(ctx, scopeText(input), initialProgress('starting', input.dryRun ?? false));
    // A microtask makes ownership visible before the first progress callback.
    const run: ActiveRun = {
      controller,
      retired: false,
      epoch: this.epoch,
      task: Promise.resolve()
        .then(() =>
          scan(input, {
            cwd: ctx.cwd,
            config: this.config,
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
            onEvent: p => {
              if (!run.retired && run.epoch === this.epoch) {
                view.update(p);
                update?.(p);
              }
            },
          }),
        )
        .finally(() => {
          this.active.delete(run);
          view.finish();
        }),
    };
    this.active.add(run);
    return run;
  }
  async results(input: ResultsInput, cwd: string) {
    const bundle = await loadBundle(this.config.storageDir, input.bundleId);
    const page = render(bundle, input);
    const stale = await currentSourceStatus(bundle, cwd);
    return {
      content: [{ type: 'text' as const, text: page.text + (stale.length ? '\n\n' + stale.join('\n') : '') }],
      details: resultDetails(bundle, page, undefined, stale),
    };
  }
  async command(args: string, ctx: ExtensionContext): Promise<void> {
    const generation = this.epoch;
    try {
      const parsed = parseCommand(args);
      if (parsed.action === 'cancel') {
        for (const run of this.active) run.controller.abort();
        ctx.ui.notify(this.active.size ? 'Cancellation requested' : 'No scan is running', 'info');
        return;
      }
      if (parsed.action === 'inspect') {
        if (!ctx.hasUI) {
          const result = await this.results({ bundleId: parsed.bundleId, view: 'units' }, ctx.cwd);
          if (generation === this.epoch) this.pi.sendMessage({ customType: 'jevvy-results', ...result, display: true });
          return;
        }
        const bundle = await loadBundle(this.config.storageDir, parsed.bundleId);
        const warnings = await currentSourceStatus(bundle, ctx.cwd);
        if (generation === this.epoch)
          await inspectResults(ctx, bundle, warnings, close => {
            this.closeInspector = close;
          });
        return;
      }
      if (parsed.action === 'results') {
        const result = await this.results(parsed.input, ctx.cwd);
        if (generation === this.epoch) this.pi.sendMessage({ customType: 'jevvy-results', ...result, display: true });
        return;
      }
      if (this.commandTask) {
        ctx.ui.notify('A command scan is running. Use /jevvy cancel before starting another.', 'warning');
        return;
      }
      const run = this.start(parsed.input, ctx);
      // Pi serializes command handlers. Return control so /jevvy cancel can run.
      this.commandTask = this.completeCommand(run, ctx);
      if (!ctx.hasUI) await this.commandTask;
    } catch (error) {
      if (generation === this.epoch) ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  private async completeCommand(run: ActiveRun, ctx: ExtensionContext): Promise<void> {
    try {
      const r = await run.task;
      const page = scanReport(r.bundle);
      if (!run.retired && run.epoch === this.epoch)
        this.pi.sendMessage({
          customType: 'jevvy-results',
          content: page.text + `\n\nBundle file: ${r.path}`,
          display: true,
          details: resultDetails(r.bundle, page, r.path),
        });
    } catch (error) {
      if (!run.retired && run.epoch === this.epoch)
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.commandTask = undefined;
    }
  }
  async stop(): Promise<void> {
    this.epoch++;
    this.closeInspector?.();
    this.closeInspector = undefined;
    const runs = [...this.active];
    for (const run of runs) {
      run.retired = true;
      run.controller.abort();
    }
    this.display.clear();
    await Promise.allSettled(runs.map(run => run.task));
    await this.commandTask;
  }
}

function registerTools(pi: ExtensionAPI, session: JevvySession): void {
  pi.registerTool<typeof ScanInputSchema, ToolDetails>({
    name: 'jevvy_comments',
    label: 'Analyse comments with Jev',
    description:
      'Analyse selected source comments and their local context with fixed Jev questions. Explicit scope is required. dryRun shows planned source and questions without inference. Returns a frozen bundle reference and paginated report.',
    promptSnippet: 'Analyse comments in files, working changes or a branch comparison',
    parameters: ScanInputSchema,
    async execute(_id, input, signal, onUpdate, ctx) {
      const run = session.start(input, ctx, signal, p =>
        onUpdate?.({
          content: [{ type: 'text', text: progressText(p) }],
          details: { progress: p, scope: scopeText(input) },
        }),
      );
      const r = await run.task;
      const page = scanReport(r.bundle),
        details = resultDetails(r.bundle, page, r.path);
      return {
        content: [{ type: 'text', text: page.text + `\n\nBundle file: ${r.path}` }],
        details,
        isError: r.bundle.run.status === 'failed' || noAnswers(details),
      };
    },
    renderCall(input, theme) {
      return new Text(
        theme.fg('toolTitle', theme.bold('jevvy')) + (input.dryRun ? ' · preview comments' : ' · analyse comments'),
        0,
        0,
      );
    },
    renderResult(result, options, theme) {
      const d = result.details;
      if (d && 'progress' in d)
        return {
          render: width => progressLines(d.progress, d.scope, { width, theme, motion: false }),
          invalidate() {},
        };
      return resultComponent(contentText(result.content), d, options.expanded, theme);
    },
  });
  pi.registerTool<typeof ResultsInputSchema, ResultDetails>({
    name: 'jevvy_results',
    label: 'Retrieve jevvy results',
    description:
      'Retrieve definitions and coverage (overview), paginated comments with native distributions (units), or exact frozen source (context). Select labels by ID; includeContext adds deduplicated frozen source to units, includeDefinitions adds selected rubrics. Sort a label with direction=asc/desc; for Choice supply outcome to sort that probability (otherwise sorts winning probability). Source order is the default. Every page discloses selection, coverage, total and cursor.',
    parameters: ResultsInputSchema,
    async execute(_id, input, _signal, _onUpdate, ctx) {
      return session.results(input, ctx.cwd);
    },
    renderCall(input, theme) {
      return new Text(theme.fg('toolTitle', theme.bold('jevvy')) + ` · ${plain(input.view ?? 'overview')}`, 0, 0);
    },
    renderResult(result, options, theme) {
      return resultComponent(contentText(result.content), result.details, options.expanded, theme);
    },
  });
}

export default function extension(pi: ExtensionAPI): void {
  const session = new JevvySession(pi);
  pi.registerMessageRenderer<ResultDetails>('jevvy-results', (message, options, theme) => {
    const box = new Box(options.outputPad, 1, text => theme.bg('customMessageBg', text));
    box.addChild(
      resultComponent(
        typeof message.content === 'string' ? message.content : contentText(message.content),
        message.details,
        options.expanded,
        theme,
      ),
    );
    return box;
  });
  registerTools(pi, session);
  pi.registerCommand('jevvy', {
    description: 'Analyse comments, inspect frozen results, or cancel active scans',
    handler: (args, ctx) => session.command(args, ctx),
  });
  const stop = () => session.stop();
  pi.on('session_shutdown', stop);
  pi.on('session_before_switch', stop);
}
