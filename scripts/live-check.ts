import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scan } from '../src/engine.ts';
import { scanReport } from '../src/render.ts';

const storageDir = resolve('.artifacts/live');
const result = await scan(
  {
    mode: 'files',
    files: [
      'fixtures/comments.ts',
      'fixtures/comments.py',
      'fixtures/comments.rs',
      'fixtures/comments.sol',
      'fixtures/Card.tsx',
    ],
  },
  { cwd: process.cwd(), config: { storageDir }, onProgress: text => console.log(text) },
);
await mkdir('.artifacts', { recursive: true });
await writeFile('.artifacts/live-report.md', scanReport(result.bundle).text);
await writeFile(
  '.artifacts/latest-live.json',
  JSON.stringify({ bundleId: result.bundle.bundleId, path: result.path }, null, 2),
);
console.log(
  JSON.stringify(
    {
      path: result.path,
      status: result.bundle.run.status,
      coverage: result.bundle.coverage,
      model: result.bundle.run.resolvedModel,
      units: result.bundle.units.map(u => ({
        path: result.bundle.sources[u.sourceId]!.path,
        text: u.text,
        consistency: u.labels.local_consistency,
        value: u.labels.reader_value,
        specificity: u.labels.specificity,
      })),
      diagnostics: result.bundle.diagnostics,
      packets: Object.values(result.bundle.executions).map(e => ({
        status: e.status,
        diagnostics: e.diagnostics,
        usage: e.usage,
      })),
    },
    null,
    2,
  ),
);
if (result.bundle.run.status !== 'completed' || result.bundle.coverage.labels.error > 0) process.exitCode = 1;
