// A targeted follow-up to the frozen authorization question's false negative.
import { choice } from '@typesafe-ai/sdk';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { functionChallenges } from './challenges.mjs';
import { finalQuestions } from './functions.mjs';
import { runBatch } from './query.mjs';

export const denialQuestion = choice(
  {
    question: 'Can an actor denied by the supplied permission rule reach the protected write in the shown caller?',
    method:
      'Follow how denial is represented and consumed. Awaiting a promise of false does not throw and does not stop execution. Only an enforced branch, return, throw, or rejection stops that path. Conversely, a helper contract that throws on denial needs no boolean test. A thrown identity error on one path does not establish denial handling on other paths. Do not infer enforcement from a helper name.',
    evidence:
      'Use only supplied code and contracts. If the permission helper or its denial behavior is omitted, answer unknown.',
  },
  {
    bypass: 'A path denied by the stated rule reaches the protected write.',
    blocked: 'The stated denied paths stop before the protected write.',
    unknown: 'Missing permission or caller behavior prevents deciding.',
  },
);

const commonContract = 'Only an actor with scopes containing publish may append a document to published.';
export const followups = [
  {
    id: 'a-01',
    expected: 'blocked',
    code: `async function authorize(actor) {
  if (!actor) throw new Error('missing actor');
  return actor.scopes.includes('publish');
}
async function publishDocument(actor, document, published) {
  if (!(await authorize(actor))) throw new Error('forbidden');
  published.push(document);
}`,
  },
  {
    id: 'a-02',
    expected: 'blocked',
    code: `async function authorize(actor) {
  if (!actor || !actor.scopes.includes('publish')) throw new Error('forbidden');
}
async function publishDocument(actor, document, published) {
  await authorize(actor);
  published.push(document);
}`,
  },
  {
    id: 'a-03',
    expected: 'bypass',
    code: `async function permitted(actor) { return actor.scopes.includes('publish'); }
async function publishDocument(actor, document, published) {
  if (await permitted(actor)) throw new Error('forbidden');
  published.push(document);
}`,
  },
  {
    id: 'a-04',
    expected: 'blocked',
    code: `async function check(actor) {
  if (!actor.scopes.includes('publish')) throw new Error('forbidden');
}
async function publishDocument(actor, document, published) {
  try { await check(actor); } catch { return { denied: true }; }
  published.push(document);
}`,
  },
  {
    id: 'a-05',
    expected: 'bypass',
    code: `async function check(actor) {
  if (!actor.scopes.includes('publish')) throw new Error('forbidden');
}
async function publishDocument(actor, document, published) {
  try { await check(actor); } catch { /* optional audit is unavailable */ }
  published.push(document);
}`,
  },
  {
    id: 'a-06',
    expected: 'unknown',
    code: `async function publishDocument(actor, document, published) {
  await policy(actor);
  published.push(document);
}`,
    helperContract: 'The implementation and denial behavior of policy are not supplied.',
  },
];

async function executeFollowups() {
  const records = [];
  for (const item of followups.filter(item => item.expected !== 'unknown')) {
    const code = `${item.code}\nexport { publishDocument };`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const published = [];
    let threw = false;
    try {
      await module.publishDocument({ scopes: [] }, { id: 'doc' }, published);
    } catch {
      threw = true;
    }
    assert.equal(published.length > 0, item.expected === 'bypass');
    records.push({ id: item.id, expected: item.expected, actual: { threw, published }, source: item.code });
  }
  await mkdir('.artifacts/pack-experiments', { recursive: true });
  await writeFile('.artifacts/pack-experiments/denial-execution.json', JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ executed: records.length, matched: records.length }));
}

if (import.meta.main && process.argv.includes('--execute')) {
  await executeFollowups();
} else if (import.meta.main) {
  const original = functionChallenges.find(item => item.id === 'f-03');
  // Identical state to the frozen question challenge; only the question changes.
  await runBatch(
    [
      {
        id: 'f-03-reworded',
        state: {
          language: original.language,
          code: original.source,
          contracts: { target: original.target, requirement: original.contract },
          contract: original.contract,
        },
        questions: { denial: denialQuestion },
        expected: { denial: 'bypass' },
      },
    ],
    '.artifacts/pack-experiments/denial-revision.json',
    { repeats: 2 },
  );
  // Frozen wording meets these six fresh controls/counterexamples for the first time.
  await runBatch(
    followups.map(item => ({
      id: item.id,
      state: {
        language: 'JavaScript',
        code: item.code,
        contracts: { permission: commonContract, helper: item.helperContract ?? 'All helper bodies are shown.' },
      },
      questions: { broad: finalQuestions('authorization').verdict, denial: denialQuestion },
      expected: {
        broad: { bypass: 'issue', blocked: 'absent', unknown: 'unknown' }[item.expected],
        denial: item.expected,
      },
    })),
    '.artifacts/pack-experiments/denial-fresh.json',
    { repeats: 2 },
  );
}
