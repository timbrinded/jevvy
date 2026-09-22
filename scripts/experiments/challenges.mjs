import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export const functionChallenges = [
  {
    id: 'f-01',
    kind: 'functions',
    language: 'javascript',
    target: 'stageProfile',
    contract: "If stageProfile throws, the caller's profile must remain unchanged for either value of detached.",
    source: `export function stageProfile(profile, label, detached) {
  const draft = detached ? structuredClone(profile) : { ...profile };
  draft.settings.tags.push(label);
  if (label.length > 12) throw new Error("label too long");
  return draft;
}
`,
  },
  {
    id: 'f-02',
    kind: 'functions',
    language: 'javascript',
    target: 'settleBatch',
    contract:
      'settleBatch is atomic: if any order cannot be shipped, state.charged and state.shipped must both be unchanged from entry.',
    source: `async function chargeOrder(order, state) {
  state.charged.push(order.id);
}

async function shipOrder(order, state) {
  if (!order.inStock) throw new Error("unavailable");
  state.shipped.push(order.id);
}

export async function settleBatch(orders, state) {
  for (const order of orders) {
    await chargeOrder(order, state);
    await shipOrder(order, state);
  }
  return orders.length;
}
`,
  },
  {
    id: 'f-03',
    kind: 'functions',
    language: 'javascript',
    target: 'publishDocument',
    contract:
      'A document may be appended to published only when the actor has the publish scope. An actor without the scope must leave published unchanged.',
    source: `async function authorize(actor) {
  if (!actor) throw new Error("missing actor");
  return actor.scopes.includes("publish");
}

export async function publishDocument(actor, document, published) {
  await authorize(actor);
  published.push(document);
  return document.id;
}
`,
  },
  {
    id: 'f-04',
    kind: 'functions',
    language: 'javascript',
    target: 'useSession',
    contract:
      'When supplied is null or undefined, useSession must close a successfully opened session exactly once after work resolves or rejects. It must not close a supplied session. If open rejects, work must not run.',
    source: `export async function useSession(supplied, open, work) {
  const owned = supplied === null || supplied === undefined;
  const session = owned ? await open() : supplied;
  try {
    return await work(session);
  } finally {
    if (owned) await session.close();
  }
}
`,
  },
];

export const testChallenges = [
  {
    id: 't-01',
    kind: 'tests',
    language: 'javascript',
    target: 'checkUnique',
    contract:
      'checkUnique must exercise unique and detect when unique fails to remove duplicate numbers while retaining first-occurrence order.',
    source: `import assert from "node:assert/strict";

export function unique(items) {
  return [...items];
}

export const cases = [
  { input: [], expected: [], enabled: false },
  { input: [3, 3, 2], expected: [3, 2], enabled: false },
].filter((entry) => entry.enabled);

export function checkUnique() {
  for (const entry of cases) {
    assert.deepEqual(unique(entry.input), entry.expected);
  }
}
`,
  },
  {
    id: 't-02',
    kind: 'tests',
    language: 'javascript',
    target: 'checkSearch',
    contract:
      'checkSearch must detect if search returns any result for a query with no matching item. search must return an empty array for that query.',
    source: `import assert from "node:assert/strict";

export function search(items, query) {
  const matches = items.filter((item) => item.includes(query));
  return matches.length ? matches : ["missing"];
}

export function checkSearch() {
  const result = search(["alpha", "beta"], "zeta");
  assert.ok(result);
}
`,
  },
  {
    id: 't-03',
    kind: 'tests',
    language: 'javascript',
    target: 'checkFee',
    contract:
      'checkFee must verify calculateFee returns the nearest whole-cent fee when rate is in basis points, where 10000 basis points is 100 percent.',
    source: `import assert from "node:assert/strict";

export function calculateFee(amountCents, rate) {
  return Math.round((amountCents * rate) / 1000);
}

export function checkFee() {
  for (const rate of [125, 500, 1250]) {
    const amountCents = 1999;
    const expected = Math.round((amountCents * rate) / 1000);
    assert.equal(calculateFee(amountCents, rate), expected);
  }
}
`,
  },
  {
    id: 't-04',
    kind: 'tests',
    language: 'javascript',
    target: 'checkBadge',
    contract:
      'checkBadge must detect a change where badge labels an active user as inactive. Active users must have text equal to active and inactive users text equal to inactive.',
    source: `import assert from "node:assert/strict";

export function badge(user) {
  return {
    text: user.active ? "active" : "inactive",
    palette: "neutral",
    userId: user.id,
  };
}

export function checkBadge() {
  const result = badge({ id: "u1", active: true });
  assert.equal(result.palette, "neutral");
  assert.equal(result.userId, "u1");
  assert.equal(typeof result.text, "string");
}
`,
  },
];

export const challenges = [...functionChallenges, ...testChallenges];

async function loadSource(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const observers = {
  'f-01': async module => {
    const shallow = { settings: { tags: ['existing'] } };
    const detached = structuredClone(shallow);
    const label = 'over-twelve-characters';
    assert.throws(() => module.stageProfile(shallow, label, false), /label too long/);
    assert.throws(() => module.stageProfile(detached, label, true), /label too long/);
    assert.deepEqual(shallow.settings.tags, ['existing', label]);
    assert.deepEqual(detached.settings.tags, ['existing']);
    return {
      expectedResult: 'contract_violated',
      observations: { shallowAfterRejection: shallow, detachedAfterRejection: detached },
      explanation: 'The shallow copy shares settings.tags; the detached copy does not.',
    };
  },
  'f-02': async module => {
    const state = { charged: [], shipped: [] };
    const orders = [
      { id: 'a', inStock: true },
      { id: 'b', inStock: false },
    ];
    await assert.rejects(module.settleBatch(orders, state), /unavailable/);
    assert.deepEqual(state, { charged: ['a', 'b'], shipped: ['a'] });
    return {
      expectedResult: 'contract_violated',
      observations: { rejected: true, state },
      explanation: 'A later rejection preserves both charges and the first shipment.',
    };
  },
  'f-03': async module => {
    const published = [];
    const document = { id: 'd1' };
    const returned = await module.publishDocument({ scopes: [] }, document, published);
    assert.equal(returned, 'd1');
    assert.deepEqual(published, [document]);
    const withoutActor = [];
    await assert.rejects(module.publishDocument(null, document, withoutActor), /missing actor/);
    assert.deepEqual(withoutActor, []);
    return {
      expectedResult: 'contract_violated',
      observations: { noScope: { returned, published }, missingActor: { published: withoutActor } },
      explanation: 'False authorization is ignored; only a thrown authorization error stops writing.',
    };
  },
  'f-04': async module => {
    const paths = [];
    for (const supply of ['undefined', 'null', 'borrowed']) {
      for (const outcome of ['resolve', 'reject']) {
        let opened = 0;
        let closed = 0;
        let worked = 0;
        const session = {
          async close() {
            closed += 1;
          },
        };
        const supplied = supply === 'borrowed' ? session : supply === 'null' ? null : undefined;
        const result = module.useSession(
          supplied,
          async () => {
            opened += 1;
            return session;
          },
          async received => {
            worked += 1;
            assert.equal(received, session);
            if (outcome === 'reject') throw new Error('work failed');
            return 'done';
          },
        );
        if (outcome === 'reject') await assert.rejects(result, /work failed/);
        else assert.equal(await result, 'done');
        assert.equal(opened, supply === 'borrowed' ? 0 : 1);
        assert.equal(closed, supply === 'borrowed' ? 0 : 1);
        assert.equal(worked, 1);
        paths.push({ supply, outcome, opened, closed, worked });
      }
    }
    let workedAfterOpenFailure = 0;
    await assert.rejects(
      module.useSession(
        undefined,
        async () => {
          throw new Error('open failed');
        },
        async () => {
          workedAfterOpenFailure += 1;
        },
      ),
      /open failed/,
    );
    assert.equal(workedAfterOpenFailure, 0);
    return {
      expectedResult: 'contract_satisfied',
      observations: { paths, workedAfterOpenFailure },
      explanation: 'All six acquired/borrowed completion paths preserve ownership; failed open never runs work.',
    };
  },
  't-01': async module => {
    assert.doesNotThrow(() => module.checkUnique());
    assert.equal(module.cases.length, 0);
    const input = [3, 3, 2];
    const actual = module.unique(input);
    assert.deepEqual(actual, [3, 3, 2]);
    assert.notDeepEqual(actual, [3, 2]);
    return {
      expectedResult: 'test_does_not_establish_contract',
      observations: { testPassed: true, executedCases: module.cases.length, input, actual, required: [3, 2] },
      explanation: 'The filtered case list is empty, so the loop executes no assertion or subject call.',
    };
  },
  't-02': async module => {
    assert.doesNotThrow(() => module.checkSearch());
    const actual = module.search(['alpha', 'beta'], 'zeta');
    assert.deepEqual(actual, ['missing']);
    assert.notDeepEqual(actual, []);
    return {
      expectedResult: 'test_does_not_establish_contract',
      observations: { testPassed: true, actual, required: [], truthy: Boolean(actual) },
      explanation: 'The nonempty incorrect result is truthy and passes assert.ok.',
    };
  },
  't-03': async module => {
    assert.doesNotThrow(() => module.checkFee());
    const actual = module.calculateFee(1999, 500);
    const required = Math.round((1999 * 500) / 10000);
    assert.equal(actual, 1000);
    assert.equal(required, 100);
    assert.notEqual(actual, required);
    return {
      expectedResult: 'test_does_not_establish_contract',
      observations: { testPassed: true, amountCents: 1999, basisPoints: 500, actual, required },
      explanation: "The test repeats the implementation's incorrect denominator.",
    };
  },
  't-04': async (module, challenge) => {
    assert.doesNotThrow(() => module.checkBadge());
    const original = module.badge({ id: 'u1', active: true });
    assert.equal(original.text, 'active');
    const changedSource = challenge.source.replace('text: user.active ? "active" : "inactive",', 'text: "inactive",');
    assert.notEqual(changedSource, challenge.source);
    const changed = await loadSource(changedSource);
    assert.doesNotThrow(() => changed.checkBadge());
    const changedResult = changed.badge({ id: 'u1', active: true });
    assert.equal(changedResult.text, 'inactive');
    assert.notEqual(changedResult.text, 'active');
    return {
      expectedResult: 'test_does_not_establish_contract',
      observations: { originalTestPassed: true, changedTestPassed: true, original, changedResult },
      changedSource,
      explanation:
        "Changing the active user's text breaks the contract while all three unrelated assertions still pass.",
    };
  },
};

async function observe(challenge, module) {
  const observer = observers[challenge.id];
  if (!observer) throw new Error(`Unknown challenge ${challenge.id}`);
  return observer(module, challenge);
}

export async function runChallenges() {
  const directory = new URL('../../.artifacts/pack-experiments/challenges/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const cases = {};
  for (const challenge of challenges) {
    const module = await loadSource(challenge.source);
    const observation = await observe(challenge, module);
    cases[challenge.id] = { ...observation, source: challenge.source, contract: challenge.contract };
    await writeFile(new URL(`${challenge.id}.mjs`, directory), challenge.source);
  }
  await writeFile(new URL('fixtures.json', directory), `${JSON.stringify(challenges, null, 2)}\n`);
  const report = { node: process.version, executedAt: new Date().toISOString(), cases };
  await writeFile(new URL('oracles.json', directory), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (import.meta.main) {
  const report = await runChallenges();
  for (const [id, result] of Object.entries(report.cases)) {
    console.log(`${id}: ${result.expectedResult}`);
  }
}
