import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const cwd = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'jevvy-packs-pi-'));
const packageRoot = resolve(process.env.JEVVY_PACKAGE ?? '.');
const live = process.argv.includes('--live');
const agentDir = process.env.JEVVY_CHECK_AGENT_DIR ?? join(temporary, 'agent');
process.env.JEVVY_STORAGE_DIR = join(temporary, 'results');
const settingsManager = process.env.JEVVY_CHECK_AGENT_DIR
  ? SettingsManager.create(cwd, agentDir)
  : SettingsManager.inMemory({ packages: [packageRoot] });
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
const records = [];
try {
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: ['jevvy_functions', 'jevvy_tests', 'jevvy_results'],
  }));
  const tool = name => {
    const found = session.agent.state.tools.find(candidate => candidate.name === name);
    assert.ok(found, `Missing ${name}`);
    return found;
  };
  for (const pack of ['functions', 'tests']) {
    const label = pack === 'functions' ? 'denial_path' : 'shared_expected_logic';
    const updates = [];
    const input = {
      mode: 'files',
      files: [pack === 'functions' ? 'examples/functions.ts' : 'examples/functions.test.ts'],
      contextFiles: ['examples/functions.ts', 'package.json'],
      dryRun: !live,
    };
    const result = await tool(`jevvy_${pack}`).execute(`scan-${pack}`, input, new AbortController().signal, update =>
      updates.push(update),
    );
    assert.ok(!result.isError, result.content[0].text);
    const bundle = JSON.parse(await readFile(result.details.path, 'utf8'));
    assert.equal(bundle.pack.id, pack);
    assert.equal(bundle.run.status, 'completed');
    assert.equal(bundle.units.length, pack === 'functions' ? 4 : 3);
    assert.equal(bundle.coverage.labels.error, 0);
    const labelCount = bundle.units.length * Object.keys(bundle.definitions).length;
    assert.equal(bundle.coverage.labels[live ? 'ok' : 'not_evaluated'], labelCount);
    assert.equal(updates.at(-1).details.progress.stage, 'complete');
    assert.ok(updates.every(update => update.details.progress.pack === pack));
    const query = {
      bundleId: bundle.bundleId,
      view: 'units',
      labels: [label],
      sort: label,
      outcome: 'issue',
      limit: 1,
      includeContext: true,
      includeDefinitions: true,
    };
    const page = await tool('jevvy_results').execute('page', query, new AbortController().signal);
    assert.match(page.content[0].text, new RegExp(label));
    assert.match(page.content[0].text, /examples\/functions\.ts/);
    assert.ok(page.details.cursor);
    const next = await tool('jevvy_results').execute(
      'next',
      { ...query, cursor: page.details.cursor },
      new AbortController().signal,
    );
    assert.equal(next.details.returned, 1);
    const filtered = await tool('jevvy_results').execute(
      'filtered',
      { ...query, minProbability: 0.8, minConfidence: 0.7 },
      new AbortController().signal,
    );
    assert.ok(filtered.details.total <= bundle.units.length);
    const cached = await tool(`jevvy_${pack}`).execute(`cache-${pack}`, input, new AbortController().signal);
    const cachedBundle = JSON.parse(await readFile(cached.details.path, 'utf8'));
    if (live) assert.equal(cachedBundle.coverage.cachedPackets, Object.keys(cachedBundle.executions).length);
    records.push({
      pack,
      live,
      units: bundle.units.length,
      labels: labelCount,
      filtered: filtered.details.total,
      cachedPackets: cachedBundle.coverage.cachedPackets,
    });
  }
  const previous = tool('jevvy_tests');
  await session.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.notEqual(tool('jevvy_tests'), previous);
  console.log(JSON.stringify({ piPacks: true, live, reload: true, records }));
} finally {
  session?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
