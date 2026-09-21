import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateBundle } from '../src/validate.ts';
import { scanReport } from '../src/render.ts';

test('synthetic example validates all 28 labels and matches the reviewed report snapshot', async () => {
  const bundle = validateBundle(JSON.parse(await readFile('examples/jevvy-results.example.json', 'utf8')));
  assert.equal(bundle.run.mode, 'example');
  assert.equal(bundle.units.length, 2);
  assert.equal(bundle.coverage.labels.ok, 28);
  assert.equal(Object.keys(bundle.contexts).length, 1);
  assert.deepEqual(bundle.units[0]!.context.refs, bundle.units[1]!.context.refs);
  assert.equal(
    await readFile('examples/jevvy-results.example.md', 'utf8'),
    'All values below are synthetic illustrations, not live measurements.\n\n' + scanReport(bundle).text + '\n',
  );
});
