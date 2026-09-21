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

export default function extension(pi: ExtensionAPI): void {
  const active = new Set<ActiveRun>();
  let commandTask: Promise<void> | undefined;
  let closeInspector: (() => void) | undefined;
  let epoch = 0;
  const display = new ProgressDisplay(process.env.JEVVY_ANIMATION !== '0');
  const config: Config = configuration(
    process.env.JEVVY_CONFIG ? (JSON.parse(process.env.JEVVY_CONFIG) as Partial<Config>) : {},
  );
  const start = (
    input: ScanInput,
    ctx: ExtensionContext,
    signal?: AbortSignal,
    update?: (p: ScanProgress) => void,
  ): ActiveRun => {
    const controller = new AbortController();
    const view = display.start(ctx, scopeText(input), initialProgress('starting', input.dryRun ?? false));
    // A microtask makes ownership visible before the first progress callback.
    const run: ActiveRun = {
      controller,
      retired: false,
      epoch,
      task: Promise.resolve()
        .then(() =>
          scan(input, {
            cwd: ctx.cwd,
            config,
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
            onEvent: p => {
              if (!run.retired && run.epoch === epoch) {
                view.update(p);
                update?.(p);
              }
            },
          }),
        )
        .finally(() => {
          active.delete(run);
          view.finish();
        }),
    };
    active.add(run);
    return run;
  };
  const results = async (input: ResultsInput, cwd: string) => {
    const bundle = await loadBundle(config.storageDir, input.bundleId);
    const page = render(bundle, input);
    const stale = await currentSourceStatus(bundle, cwd);
    return {
      content: [{ type: 'text' as const, text: page.text + (stale.length ? '\n\n' + stale.join('\n') : '') }],
      details: resultDetails(bundle, page, undefined, stale),
    };
  };
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
  pi.registerTool<typeof ScanInputSchema, ToolDetails>({
    name: 'jevvy_comments',
    label: 'Analyse comments with Jev',
    description:
      'Analyse selected source comments and their local context with fixed Jev questions. Explicit scope is required. dryRun shows planned source and questions without inference. Returns a frozen bundle reference and paginated report.',
    promptSnippet: 'Analyse comments in files, working changes or a branch comparison',
    parameters: ScanInputSchema,
    async execute(_id, input, signal, onUpdate, ctx) {
      const run = start(input, ctx, signal, p =>
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
        return { render: width => progressLines(d.progress, d.scope, width, theme, false), invalidate() {} };
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
      return results(input, ctx.cwd);
    },
    renderCall(input, theme) {
      return new Text(theme.fg('toolTitle', theme.bold('jevvy')) + ` · ${plain(input.view ?? 'overview')}`, 0, 0);
    },
    renderResult(result, options, theme) {
      return resultComponent(contentText(result.content), result.details, options.expanded, theme);
    },
  });
  pi.registerCommand('jevvy', {
    description: 'Analyse comments, inspect frozen results, or cancel active scans',
    handler: async (args, ctx) => {
      const generation = epoch;
      try {
        const parsed = parseCommand(args);
        if (parsed.action === 'cancel') {
          for (const run of active) run.controller.abort();
          ctx.ui.notify(active.size ? 'Cancellation requested' : 'No scan is running', 'info');
          return;
        }
        if (parsed.action === 'inspect') {
          if (!ctx.hasUI) {
            const result = await results({ bundleId: parsed.bundleId, view: 'units' }, ctx.cwd);
            if (generation === epoch) pi.sendMessage({ customType: 'jevvy-results', ...result, display: true });
            return;
          }
          const bundle = await loadBundle(config.storageDir, parsed.bundleId);
          const warnings = await currentSourceStatus(bundle, ctx.cwd);
          if (generation === epoch)
            await inspectResults(ctx, bundle, warnings, close => {
              closeInspector = close;
            });
          return;
        }
        if (parsed.action === 'results') {
          const result = await results(parsed.input, ctx.cwd);
          if (generation === epoch) pi.sendMessage({ customType: 'jevvy-results', ...result, display: true });
          return;
        }
        if (commandTask) {
          ctx.ui.notify('A command scan is running. Use /jevvy cancel before starting another.', 'warning');
          return;
        }
        const run = start(parsed.input, ctx);
        // Pi serializes command handlers. Return control so /jevvy cancel can run.
        commandTask = (async () => {
          try {
            const r = await run.task;
            const page = scanReport(r.bundle);
            if (!run.retired && run.epoch === epoch)
              pi.sendMessage({
                customType: 'jevvy-results',
                content: page.text + `\n\nBundle file: ${r.path}`,
                display: true,
                details: resultDetails(r.bundle, page, r.path),
              });
          } catch (error) {
            if (!run.retired && run.epoch === epoch)
              ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
          } finally {
            commandTask = undefined;
          }
        })();
        if (!ctx.hasUI) await commandTask;
      } catch (error) {
        if (generation === epoch) ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });
  const stop = async () => {
    epoch++;
    closeInspector?.();
    closeInspector = undefined;
    const runs = [...active];
    for (const run of runs) {
      run.retired = true;
      run.controller.abort();
    }
    display.clear();
    await Promise.allSettled(runs.map(run => run.task));
    await commandTask;
  };
  pi.on('session_shutdown', stop);
  pi.on('session_before_switch', stop);
}
