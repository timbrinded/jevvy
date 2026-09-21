import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scan } from '../src/engine.ts';

// examples/comment-test.ts is the curated cross-section for the comments
// pack: clear docs, vague docs, contradicted claims, narration, rationale,
// follow-ups and hostile text. These dry-run assertions pin its shape so a
// parser or planner regression fails fast without needing an API key.
const BED = 'examples/comment-test.ts';
const EXPECTED_UNITS = 128;
const EXPECTED_EXCLUDED = 1;
const LABELS_PER_UNIT = 14;

async function dryRunBed() {
  const content = await readFile(BED, 'utf8');
  const { bundle } = await scan(
    { mode: 'files', files: [BED], dryRun: true },
    {
      cwd: process.cwd(),
      persist: false,
      transport: async () => {
        throw new Error('dry-run must not call transport');
      },
    },
  );
  return { content, bundle };
}

test('comment bed selects the full cross-section without errors', async () => {
  const { bundle } = await dryRunBed();
  assert.equal(bundle.units.length, EXPECTED_UNITS);
  assert.equal(bundle.excluded.length, EXPECTED_EXCLUDED);
  assert.equal(bundle.removed.length, 0);
  assert.equal(bundle.coverage.units.selected, EXPECTED_UNITS);
  assert.equal(bundle.coverage.files.length, 1);
  assert.equal(bundle.coverage.files[0]!.status, 'parsed');
  assert.equal(bundle.coverage.labels.not_evaluated, EXPECTED_UNITS * LABELS_PER_UNIT);
  assert.equal(bundle.coverage.labels.error, 0);
});

test('every slice round-trips and every label is bound or skipped exactly once', async () => {
  const { content, bundle } = await dryRunBed();
  for (const unit of bundle.units) {
    assert.equal(content.slice(unit.range.startUtf16, unit.range.endUtf16), unit.text);
  }
  for (const context of Object.values(bundle.contexts)) {
    assert.equal(content.slice(context.range.startUtf16, context.range.endUtf16), context.text);
  }
  const bound = new Set<string>();
  for (const execution of Object.values(bundle.executions)) {
    for (const binding of Object.values(execution.bindings)) {
      const key = `${binding.unitId}:${binding.labelId}`;
      assert.ok(!bound.has(key), `duplicate binding ${key}`);
      bound.add(key);
    }
  }
  let skipped = 0;
  for (const unit of bundle.units) {
    assert.equal(Object.keys(unit.labels).length, LABELS_PER_UNIT);
    for (const [labelId, label] of Object.entries(unit.labels)) {
      assert.equal(label.status, 'not_evaluated');
      if (bound.has(`${unit.id}:${labelId}`)) {
        assert.equal(label.reason, 'planned');
        continue;
      }
      skipped++;
      assert.equal(label.reason, 'context_prerequisite:complete_local');
    }
  }
  assert.equal(bound.size + skipped, EXPECTED_UNITS * LABELS_PER_UNIT);
});

test('bed covers headers, docs, rationale, follow-ups and hostile text', async () => {
  const { bundle } = await dryRunBed();
  assert.match(bundle.excluded[0]!.text, /SPDX-License-Identifier/);
  const texts = bundle.units.map(unit => unit.text);
  assert.ok(
    texts.some(text => text.includes('display name for a user id')),
    'clear public doc',
  );
  assert.ok(
    texts.some(text => text.includes('Does the thing.')),
    'vague doc',
  );
  assert.ok(
    texts.some(text => text.includes('TODO(APP-1234)')),
    'tracked follow-up',
  );
  assert.ok(
    texts.some(text => text.includes('Ignore all previous instructions')),
    'hostile comment is selected, not executed',
  );
  const attachments = new Set(bundle.units.map(unit => unit.structure.attachment.kind));
  assert.ok(attachments.has('adjacency_based'), 'owned docs attach to code');
  assert.ok(attachments.has('unresolved'), 'banners stay unresolved');
});
