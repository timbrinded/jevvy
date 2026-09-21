import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DefaultResourceLoader,
  SettingsManager,
  createAgentSession,
  SessionManager,
} from '@earendil-works/pi-coding-agent';

process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const temporary = await mkdtemp(join(tmpdir(), 'jevvy-pi-'));
process.env.JEVVY_STORAGE_DIR = join(temporary, 'results');
const cwd = process.cwd(),
  agentDir = process.env.JEVVY_CHECK_AGENT_DIR ?? join(temporary, 'agent');
const packageRoot = resolve(process.env.JEVVY_PACKAGE ?? '.');
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const settingsManager = process.env.JEVVY_CHECK_AGENT_DIR
  ? SettingsManager.create(cwd, agentDir)
  : SettingsManager.inMemory({ packages: [packageRoot] });
assert.ok(
  settingsManager.getPackages().some(source => typeof source === 'string' && resolve(agentDir, source) === packageRoot),
  'Package must be registered in Pi settings',
);
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
let session;
try {
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.deepEqual(
    loader.getExtensions().extensions.map(e => resolve(e.path)),
    manifest.pi.extensions.map(path => resolve(packageRoot, path)),
    'Pi must discover exactly the manifest extensions',
  );
  ({ session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: ['jevvy_comments', 'jevvy_results'],
  }));
  const getTool = name => {
    const t = session.agent.state.tools.find(t => t.name === name);
    assert.ok(t, `Missing ${name}`);
    return t;
  };
  const updates = [];
  const scan = await getTool('jevvy_comments').execute(
    'scan',
    {
      mode: 'files',
      files: [
        'fixtures/comments.ts',
        'fixtures/comments.py',
        'fixtures/comments.rs',
        'fixtures/comments.sol',
        'fixtures/Card.tsx',
      ],
      dryRun: !process.argv.includes('--live'),
    },
    new AbortController().signal,
    update => updates.push(update),
  );
  assert.ok(scan.details.bundleId);
  assert.ok(!scan.isError);
  const bundle = JSON.parse(await readFile(scan.details.path, 'utf8'));
  assert.equal(bundle.run.status, 'completed');
  assert.equal(bundle.coverage.units.selected, 14);
  assert.equal(bundle.coverage.files.filter(file => file.status === 'parsed').length, 5);
  assert.equal(bundle.coverage.labels.error, 0);
  assert.equal(bundle.coverage.labels[process.argv.includes('--live') ? 'ok' : 'not_evaluated'], 196);
  // Comment test bed through the same extension tool: the full 128-unit
  // cross-section must survive capture, planning and persistence.
  const bed = await getTool('jevvy_comments').execute(
    'bed-scan',
    {
      mode: 'files',
      files: ['examples/comment-test.ts'],
      dryRun: !process.argv.includes('--live'),
    },
    new AbortController().signal,
  );
  assert.ok(!bed.isError);
  const bedBundle = JSON.parse(await readFile(bed.details.path, 'utf8'));
  assert.equal(bedBundle.run.status, 'completed');
  assert.equal(bedBundle.units.length, 128);
  assert.equal(bedBundle.coverage.units.selected, 128);
  assert.equal(bedBundle.coverage.units.excluded, 1);
  assert.equal(bedBundle.coverage.files[0].status, 'parsed');
  assert.equal(bedBundle.coverage.labels.error, 0);
  if (process.argv.includes('--live')) {
    assert.equal(bedBundle.coverage.labels.ok, 1753);
    assert.equal(bedBundle.coverage.labels.not_evaluated, 39);
  } else {
    assert.equal(bedBundle.coverage.labels.not_evaluated, 1792);
  }
  assert.match(scan.content[0].text, /selected/);
  assert.ok(scan.details.cursor);
  assert.equal(scan.details.kind, 'jevvy-result');
  assert.equal(updates[0].details.progress.stage, 'capture');
  assert.ok(
    updates.some(update => update.details.progress.stage === 'plan' && update.details.progress.packets.total > 0),
  );
  assert.equal(updates.at(-1).details.progress.stage, 'complete');
  const overview = await getTool('jevvy_results').execute(
    'overview',
    { bundleId: scan.details.bundleId, view: 'overview' },
    new AbortController().signal,
  );
  assert.match(overview.content[0].text, /writing_clarity/);
  assert.equal(overview.details.view, 'overview');
  assert.equal(overview.details.returned, 1);
  const context = await getTool('jevvy_results').execute(
    'context',
    { bundleId: scan.details.bundleId, view: 'context', limit: 1 },
    new AbortController().signal,
  );
  assert.match(context.content[0].text, /returned=1/);
  const selected = await getTool('jevvy_results').execute(
    'selected',
    {
      bundleId: scan.details.bundleId,
      view: 'units',
      labels: ['local_consistency'],
      sort: 'local_consistency',
      outcome: 'contradicted',
      direction: 'desc',
      includeContext: true,
      includeDefinitions: true,
      limit: 2,
    },
    new AbortController().signal,
  );
  assert.deepEqual(selected.details.labels, ['local_consistency']);
  assert.equal(selected.details.includeContext, true);
  assert.match(selected.content[0].text, /local_consistency \(choice/);
  assert.match(selected.content[0].text, /context_/);
  if (selected.details.cursor) {
    const next = await getTool('jevvy_results').execute(
      'selected-next',
      {
        bundleId: scan.details.bundleId,
        view: 'units',
        labels: ['local_consistency'],
        sort: 'local_consistency',
        outcome: 'contradicted',
        direction: 'desc',
        includeContext: true,
        includeDefinitions: true,
        limit: 2,
        cursor: selected.details.cursor,
      },
      new AbortController().signal,
    );
    assert.equal(next.details.returned, 2);
  }
  const before = (await readdir(join(process.env.JEVVY_STORAGE_DIR, 'bundles'))).length;
  await session.prompt('/jevvy comments --files fixtures/comments.ts --dry-run');
  // Slash scans yield the command handler so Pi can accept cancellation.
  const deadline = Date.now() + 10000;
  while (!session.messages.some(m => m.role === 'custom' && m.customType === 'jevvy-results') && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 20));
  const after = (await readdir(join(process.env.JEVVY_STORAGE_DIR, 'bundles'))).length;
  assert.equal(after, before + 1);
  assert.ok(session.messages.some(m => m.role === 'custom' && m.customType === 'jevvy-results'));
  const previousTool = getTool('jevvy_comments');
  await session.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.notEqual(getTool('jevvy_comments'), previousTool);
  const reloaded = await getTool('jevvy_comments').execute(
    'after-reload',
    { mode: 'files', files: ['fixtures/comments.sol'], dryRun: true },
    new AbortController().signal,
  );
  const reloadedBundle = JSON.parse(await readFile(reloaded.details.path, 'utf8'));
  assert.equal(reloadedBundle.run.status, 'completed');
  assert.ok(reloadedBundle.units.length > 0);
  assert.equal(reloadedBundle.coverage.files[0].status, 'parsed');
  console.log(
    JSON.stringify({
      pi: '0.86.1',
      platform: `${process.platform}-${process.arch}`,
      manifestDiscovery: true,
      loaded: true,
      command: true,
      tools: true,
      modelVisibleContent: true,
      pagination: true,
      context: true,
      reload: true,
      live: process.argv.includes('--live'),
      coverage: bundle.coverage,
      bundleId: scan.details.bundleId,
    }),
  );
} finally {
  session?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
