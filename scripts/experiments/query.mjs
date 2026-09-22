// Direct Jev calls for exploratory fixtures; this does not use the pack engine.
import { TypeSafeClient, APIError } from '@typesafe-ai/sdk';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bounded } from '../../src/queue.ts';

export async function runBatch(cases, outputFile, { repeats = 1, model = 'jev-1.13.0' } = {}) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required for live experiments');
  for (const item of cases) {
    for (const question of Object.values(item.questions)) {
      assert.ok(question.instructions !== undefined, `${item.id}: missing question instructions`);
      if (question.type !== 'noul') assert.ok(question.criteria, `${item.id}: missing question criteria`);
    }
  }
  const client = new TypeSafeClient({
    baseURL: 'https://api.typesafe.ai',
    logLevel: 'off',
    timeout: 30000,
    retry: { maxRetries: 0 },
  });
  const jobs = cases.flatMap(item => Array.from({ length: repeats }, (_, repeat) => ({ item, repeat })));
  const records = Array.from({ length: jobs.length }, () => null);
  await mkdir(dirname(outputFile), { recursive: true });
  // Save expectations before inference; IDs and expected answers never enter state.
  await writeFile(`${outputFile}.cases.json`, JSON.stringify({ model, repeats, cases }, null, 2));
  await bounded(jobs, 2, async ({ item, repeat }, index) => {
    const request = { model, state: item.state, questions: item.questions };
    const started = Date.now();
    const record = { caseId: item.id, repeat, expected: item.expected, request };
    try {
      record.response = await client.systemOne(request);
    } catch (error) {
      record.error = error instanceof APIError ? `Jev HTTP ${error.status}` : 'Jev transport error';
    }
    record.elapsedMs = Date.now() - started;
    records[index] = record;
    // One file per completed request retains results if a later request fails.
    await writeFile(`${outputFile}.${index}.json`, JSON.stringify(record, null, 2));
  });
  await writeFile(outputFile, JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ outputFile, requests: records.length, errors: records.filter(r => r.error).length }));
  return records;
}
