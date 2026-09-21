import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ScanInputSchema, ResultsInputSchema, type Config, type ResultsInput } from './contracts.js';
import { configuration } from './config.js';
import { scan } from './engine.js';
import { loadBundle } from './bundle.js';
import { render, scanReport, currentSourceStatus } from './render.js';
import { parseCommand } from './command.js';

export default function extension(pi: ExtensionAPI): void {
  const active = new Set<AbortController>();
  // Configuration is JSON-native and contains no API credentials.
  const config: Config = configuration(process.env.JEVVY_CONFIG ? JSON.parse(process.env.JEVVY_CONFIG) as Partial<Config> : {});
  const results = async (input: ResultsInput, cwd: string) => {
    const bundle = await loadBundle(config.storageDir, input.bundleId);
    const page = render(bundle, input);
    const stale = await currentSourceStatus(bundle, cwd);
    return { content: [{ type: 'text' as const, text: page.text + (stale.length ? '\n\n' + stale.join('\n') : '') }], details: { ...page, text: undefined } };
  };
  pi.registerTool({
    name: 'jevvy_comments', label: 'Analyse comments with Jev',
    description: 'Analyse selected source comments and their local context with fixed Jev questions. Explicit scope is required. dryRun shows planned source and questions without inference. Returns a frozen bundle reference and paginated report.',
    promptSnippet: 'Analyse comments in files, working changes or a branch comparison',
    parameters: ScanInputSchema,
    async execute(_id, input, signal, onUpdate, ctx) {
      const controller = new AbortController(); active.add(controller);
      try {
        const r = await scan(input, { cwd: ctx.cwd, config, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, onProgress: text => onUpdate?.({ content: [{ type: 'text', text }], details: { progress: text } }) });
        const page = scanReport(r.bundle);
        return { content: [{ type: 'text', text: page.text + `\n\nBundle file: ${r.path}` }], details: { bundleId: r.bundle.bundleId, path: r.path, cursor: page.cursor }, isError: r.bundle.run.status === 'failed' };
      } finally { active.delete(controller); }
    },
  });
  pi.registerTool({ name: 'jevvy_results', label: 'Retrieve jevvy results', description: 'Retrieve definitions and coverage (overview), paginated comments with native distributions (units), or exact frozen source (context). Every page reports its total and cursor.', parameters: ResultsInputSchema,
    async execute(_id, input, _signal, _onUpdate, ctx) { return results(input, ctx.cwd); },
  });
  pi.registerCommand('jevvy', {
    description: 'Analyse comments, retrieve frozen results, or cancel active scans',
    handler: async (args, ctx) => {
      try {
        const parsed = parseCommand(args);
        if (parsed.action === 'cancel') { for (const controller of active) controller.abort(); ctx.ui.notify('Cancellation requested', 'info'); return; }
        if (parsed.action === 'results') {
          const result = await results(parsed.input, ctx.cwd);
          pi.sendMessage({ customType: 'jevvy-results', content: result.content, display: true, details: result.details });
          return;
        }
        const controller = new AbortController(); active.add(controller);
        try {
          const r = await scan(parsed.input, { cwd: ctx.cwd, config, signal: controller.signal, onProgress: text => ctx.ui.setStatus('jevvy', text) });
          pi.sendMessage({ customType: 'jevvy-results', content: scanReport(r.bundle).text + `\n\nBundle file: ${r.path}`, display: true, details: { bundleId: r.bundle.bundleId, path: r.path } });
        } finally { active.delete(controller); ctx.ui.setStatus('jevvy', undefined); }
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    },
  });
  pi.on('session_shutdown', async () => { for (const controller of active) controller.abort(); });
}
