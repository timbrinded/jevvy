import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compile } from 'typebox/compile';
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';
import { parseCommand } from '../src/command.ts';
import { initialProgress, progressText } from '../src/progress.ts';
import { plain, progressLines, resultComponent, resultDetails } from '../src/ui.ts';
import { ResultInspector } from '../src/inspector.ts';
import { scan } from '../src/engine.ts';
import { scanReport } from '../src/render.ts';
import { fixture, syntheticResponse } from './helpers.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;
const code = `import { test } from 'node:test';
import assert from 'node:assert/strict';
// Double the input.
export function twice(value: number) { return value * 2; }
test('doubles', () => { assert.equal(twice(2), 4); });
`;

test('new commands select fixed packs and preserve quoted supporting paths', () => {
  assert.deepEqual(
    parseCommand('functions --files "my file.ts" --context-files support.ts "package file.json" --dry-run'),
    {
      action: 'functions',
      input: {
        pack: 'functions',
        mode: 'files',
        files: ['my file.ts'],
        contextFiles: ['support.ts', 'package file.json'],
        dryRun: true,
      },
    },
  );
  assert.deepEqual(parseCommand('tests --working'), { action: 'tests', input: { pack: 'tests', mode: 'working' } });
  assert.deepEqual(parseCommand('functions --base main --head topic'), {
    action: 'functions',
    input: { pack: 'functions', mode: 'branch', base: 'main', head: 'topic' },
  });
  assert.throws(() => parseCommand('tests --files one.ts --context-files'), /Invalid/);
  assert.throws(() => parseCommand('tests --working --base main'), /exactly one/);
  assert.throws(() => parseCommand('functions --files one.ts --pack tests'), /Unknown/);
  assert.deepEqual(
    parseCommand(
      'results saved --view units --sort assertions --outcome gap --min-probability 0.7 --min-confidence 0.4',
    ),
    {
      action: 'results',
      input: {
        bundleId: 'saved',
        view: 'units',
        sort: 'assertions',
        outcome: 'gap',
        minProbability: 0.7,
        minConfidence: 0.4,
      },
    },
  );
  assert.throws(() => parseCommand('results saved --min-confidence 2'), /Invalid/);
});

test('progress identifies each pack without changing the default comments label', () => {
  for (const pack of ['comments', 'functions', 'tests'] as const) {
    const progress = initialProgress('run', false, 0, pack);
    progress.comments = 3;
    progress.stage = 'extract';
    assert.match(progressText(progress), new RegExp(`Extracting ${pack}`));
    progress.stage = 'plan';
    assert.match(progressText(progress), new RegExp(`3 ${pack}`));
    progress.stage = 'analyse';
    assert.match(
      plain(progressLines(progress, 'source.ts', { width: 100, theme, motion: false }).join('\n')),
      new RegExp(`Analysing ${pack}`),
    );
  }
  const old = initialProgress('run', false, 0);
  old.stage = 'analyse';
  assert.match(progressText(old), /Analysing comments/);
});

test('Pi registers three fixed-pack scan tools and executes their dry-run reports', async t => {
  const f = await fixture({ 'sample.ts': code });
  t.after(f.cleanup);
  const previous = process.env.JEVVY_CONFIG;
  process.env.JEVVY_CONFIG = JSON.stringify({ storageDir: f.storageDir });
  t.after(() => {
    if (previous === undefined) delete process.env.JEVVY_CONFIG;
    else process.env.JEVVY_CONFIG = previous;
  });
  type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
  const tools = new Map<string, RegisteredTool>();
  extension({
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerMessageRenderer() {},
    on() {},
  } as unknown as ExtensionAPI);
  assert.deepEqual([...tools.keys()], ['jevvy_comments', 'jevvy_functions', 'jevvy_tests', 'jevvy_results']);
  const ctx = { cwd: f.root, hasUI: false, ui: { notify() {} } } as unknown as ExtensionContext;
  for (const pack of ['comments', 'functions', 'tests'] as const) {
    const tool = tools.get(`jevvy_${pack}`)!;
    const input = { mode: 'files', files: ['sample.ts'], dryRun: true };
    const validator = Compile(tool.parameters);
    assert.equal(validator.Check(input), true);
    assert.equal(validator.Check({ ...input, pack: 'tests' }), false);
    const result = await tool.execute('call', input, undefined, undefined, ctx);
    assert.ok(result.details && typeof result.details === 'object' && 'pack' in result.details);
    assert.equal(result.details.pack, pack);
    const text = result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    assert.match(text, new RegExp(`full ${pack} and distributions`));
    if (pack !== 'comments') {
      assert.match(text, new RegExp(`Pack: ${pack}@`));
      assert.match(text, /missing evidence remains an explicit outcome/);
      assert.match(text, pack === 'functions' ? /function; name=twice/ : /test; name=doubles/);
    }
  }
});

test('code-pack inspector and compact results retain pack names and native unknown distributions', async t => {
  const f = await fixture({ 'sample.ts': code });
  t.after(f.cleanup);
  for (const pack of ['functions', 'tests'] as const) {
    const { bundle } = await scan(
      { pack, mode: 'files', files: ['sample.ts'] },
      {
        cwd: f.root,
        persist: false,
        config: { storageDir: f.storageDir },
        transport: async request => {
          const response = syntheticResponse(request);
          for (const [id, question] of Object.entries(request.questions)) {
            if (question.type !== 'choice') continue;
            const keys = Object.keys(question.criteria),
              unknown = keys.find(key => /unknown|insufficient/.test(key));
            assert.ok(unknown);
            response.answers[id] = {
              type: 'choice',
              choice: unknown,
              confidence: 1,
              probabilities: Object.fromEntries(keys.map(key => [key, key === unknown ? 1 : 0])),
            };
          }
          return response;
        },
      },
    );
    const page = scanReport(bundle),
      details = resultDetails(bundle, page);
    assert.equal(details.pack, pack);
    assert.match(page.text, /insufficient_evidence; probabilities=/);
    assert.match(page.text, /confidence=1/);
    assert.match(page.text, /No aggregate verdict/);
    assert.match(
      plain(resultComponent(page.text, details, false, theme).render(120).join('\n')),
      new RegExp(`\\d+ ${pack}`),
    );
    const inspector = new ResultInspector(bundle, {
      warnings: [],
      theme,
      height: () => 24,
      requestRender() {},
      close() {},
      cancelKey: key => key === 'x',
    });
    assert.match(plain(inspector.render(120).join('\n')), new RegExp(`jevvy ${pack}`));
    inspector.handleInput('\t');
    assert.match(plain(inspector.render(120).join('\n')), /function twice/);
  }
});
