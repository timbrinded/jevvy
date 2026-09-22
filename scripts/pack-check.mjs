import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { scan } from '../src/engine.ts';
import { hash } from '../src/hash.ts';
import { bounded } from '../src/queue.ts';
import { cases, runtimeCases } from '../fixtures/pack-evaluation/cases.mjs';

const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    execute: { type: 'boolean', default: false },
    cases: { type: 'string' },
    run: { type: 'string', default: new Date().toISOString().replaceAll(/[:.]/g, '-') },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log('node scripts/pack-check.mjs [--live | --execute] [--cases f01,t01] [--run unique-name]');
  console.log('Default: capture/plan only. --live uses real scan requests. --execute runs exact local fixtures only.');
  process.exit(0);
}
assert.match(values.run, /^[a-zA-Z0-9_-]+$/);
assert.ok(!(values.live && values.execute), 'Choose --live or --execute');
if (values.live) assert.ok(process.env.TYPESAFE_API_KEY, 'TYPESAFE_API_KEY is required for live evaluation');
const wanted = values.cases?.split(',');
const selected = wanted ? cases.filter(item => wanted.includes(item.id)) : cases;
assert.ok(selected.length > 0, 'No cases selected');
if (wanted) assert.equal(selected.length, new Set(wanted).size, 'Unknown case ID');
const projectRoot = resolve(import.meta.dirname, '..');
const output = join(projectRoot, '.artifacts', 'pack-build', values.run);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const temporary = join(output, 'tmp');
await mkdir(temporary);
process.env.TMPDIR = temporary;

async function save(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function prepare(item) {
  const cwd = join(output, 'workspaces', item.id);
  await mkdir(cwd, { recursive: true });
  const files = { 'package.json': '{"type":"module"}\n', ...item.files };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
  return cwd;
}

// Gold labels remain in this parent artifact, outside every captured source root.
await save(join(output, 'cases.json'), selected);
await save(join(output, 'run.json'), {
  mode: values.live ? 'live' : values.execute ? 'execute' : 'dry_run',
  model: 'jev-1.13.0',
  casesHash: hash(selected),
  createdAt: new Date().toISOString(),
  node: process.version,
  maxConcurrentScans: 2,
  maxRequestConcurrency: 1,
  maxRetries: 0,
});
const roots = new Map();
for (const item of selected) roots.set(item.id, await prepare(item));

function options(item) {
  return {
    cwd: roots.get(item.id),
    config: {
      model: 'jev-1.13.0',
      requestConcurrency: 1,
      parseConcurrency: 1,
      maxRetries: 0,
      requestTimeoutMs: 60000,
      runTimeoutMs: 120000,
      storageDir: join(output, 'storage', item.id),
    },
  };
}

function scanInput(item, dryRun = false) {
  return {
    pack: item.pack,
    mode: 'files',
    files: item.scanFiles,
    ...(item.contextFiles.length ? { contextFiles: item.contextFiles } : {}),
    dryRun,
  };
}

function inspectChecks(item, bundle, live) {
  return item.checks.map(check => {
    const matching = bundle.units.filter(unit => unit.structure.name === check.target);
    assert.equal(
      matching.length,
      1,
      `${item.id}: expected one extracted target ${check.target}; got ${bundle.units.map(unit => unit.structure.name)}`,
    );
    const unit = matching[0];
    const result = unit.labels[check.label];
    assert.ok(result, `${item.id}: missing label ${check.label}`);
    if (!live) assert.deepEqual(result, { status: 'not_evaluated', reason: 'planned' });
    const answer = result.status === 'ok' && result.answer.type === 'choice' ? result.answer : null;
    return {
      ...check,
      unitId: unit.id,
      processingStatus: result.status,
      actual: answer?.choice ?? null,
      confidence: answer?.confidence ?? null,
      probabilities: answer?.probabilities ?? null,
      matches: live ? answer?.choice === check.expected : null,
    };
  });
}

async function executeFixtures() {
  const records = [];
  for (const item of selected.filter(candidate => runtimeCases.includes(candidate.id))) {
    const cwd = roots.get(item.id);
    if (item.pack === 'tests') {
      const result = await exec(process.execPath, ['--test', ...item.scanFiles], { cwd, timeout: 15000 });
      const record = { caseId: item.id, testsPassed: true, stdout: result.stdout, stderr: result.stderr };
      if (item.id === 't01') {
        const { sortNumbers } = await import(pathToFileURL(join(cwd, 'subject.js')).href);
        record.observedResult = sortNumbers([10, 2]);
        assert.deepEqual(record.observedResult, [10, 2]);
        record.observation = 'The numeric-sort test passed while the result was not numerically sorted.';
      }
      if (item.id === 't05') {
        const { calculateFee } = await import(pathToFileURL(join(cwd, 'subject.js')).href);
        record.observedResult = calculateFee(2000, 500);
        assert.equal(record.observedResult, 1000);
        record.requiredResult = 100;
        record.observation = 'The test passed with the same incorrect divisor in production and expected calculation.';
      }
      records.push(record);
    } else {
      const module = await import(pathToFileURL(join(cwd, 'subject.ts')).href);
      if (item.id === 'f03') {
        const result = module.loadConfig('{broken');
        assert.deepEqual(result, { status: 'ready', settings: {} });
        records.push({
          caseId: item.id,
          observed: result,
          observation: 'Invalid required configuration produced ordinary success.',
        });
      } else if (item.id === 'f04') {
        const result = module.readCache('{broken');
        assert.deepEqual(result, {});
        records.push({
          caseId: item.id,
          observed: result,
          observation: 'Invalid optional cache followed its specified fallback.',
        });
      } else {
        const published = [];
        let rejected = false;
        try {
          await module.publish({ scopes: [] }, { id: 'doc' }, published);
        } catch {
          rejected = true;
        }
        const bypass = item.id === 'f05' || item.id === 'f21';
        assert.equal(published.length, bypass ? 1 : 0);
        assert.equal(rejected, !bypass);
        records.push({ caseId: item.id, published, rejected });
      }
    }
  }
  await save(join(output, 'execution.json'), records);
  console.log(`Executed ${records.length} exact fixture cases; saved ${join(output, 'execution.json')}`);
}

async function evaluate() {
  // Validate all extraction and context prerequisites before the first paid call.
  for (const item of selected) {
    const result = await scan(scanInput(item, true), options(item));
    inspectChecks(item, result.bundle, false);
    await save(join(output, `${item.id}.dry-run.json`), result.bundle);
  }
  if (!values.live) {
    console.log(`Captured and planned ${selected.length} cases without inference: ${output}`);
    return;
  }
  const records = Array.from({ length: selected.length });
  await bounded(selected, 2, async (item, index) => {
    const { bundle } = await scan(scanInput(item), options(item));
    await save(join(output, `${item.id}.bundle.json`), bundle);
    const checks = inspectChecks(item, bundle, true);
    const executions = Object.values(bundle.executions);
    records[index] = {
      caseId: item.id,
      pack: item.pack,
      version: bundle.pack.version,
      definitionHash: bundle.pack.definitionHash,
      checks,
      coverage: bundle.coverage,
      diagnostics: bundle.diagnostics,
      requests: executions.length,
      providerRequests: executions.filter(execution => execution.origin === 'provider').length,
      usage: executions.map(execution => execution.usage),
    };
    await save(join(output, `${item.id}.result.json`), records[index]);
    console.log(
      `${item.id}: ${checks.filter(check => check.matches).length}/${checks.length} expected verdicts; ${bundle.coverage.labels.ok} answers, ${bundle.coverage.labels.error} errors`,
    );
  });
  const checks = records.flatMap(record => record.checks);
  const summary = {
    cases: records.length,
    expectedChecks: checks.length,
    matchedChecks: checks.filter(check => check.matches).length,
    requests: records.reduce((sum, record) => sum + record.requests, 0),
    providerRequests: records.reduce((sum, record) => sum + record.providerRequests, 0),
    answers: records.reduce((sum, record) => sum + record.coverage.labels.ok, 0),
    errors: records.reduce((sum, record) => sum + record.coverage.labels.error, 0),
    records,
  };
  await save(join(output, 'summary.json'), summary);
  console.log(`Saved ${output}/summary.json`);
  if (summary.errors) process.exitCode = 1;
}

if (values.execute) await executeFixtures();
else await evaluate();
