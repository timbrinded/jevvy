import { readFile } from 'node:fs/promises';

const check = (target, label, expected) => ({ target, label, expected });
const functions = (id, source, checks, supporting = {}, contextFiles = Object.keys(supporting)) => ({
  id,
  pack: 'functions',
  files: { 'subject.ts': source, ...supporting },
  scanFiles: ['subject.ts'],
  contextFiles,
  checks,
});
const tests = (id, source, checks, supporting = {}, contextFiles = Object.keys(supporting)) => ({
  id,
  pack: 'tests',
  files: { 'subject.test.js': source, ...supporting },
  scanFiles: ['subject.test.js'],
  contextFiles,
  checks,
});
const testImports = "import assert from 'node:assert/strict';\nimport { test, mock } from 'node:test';\n";
const permissionRule = '// Only actors with the publish scope may append to published.\n';
const booleanPolicy = "export async function permitted(actor) { return actor.scopes.includes('publish'); }\n";
const throwingPolicy = "export async function permitted(actor) { if (!actor.scopes.includes('publish')) throw new Error('denied'); }\n";
const nameSource = "export function displayName(user) { return user.name.trim().toUpperCase(); }\n";
const sortingSource = 'export function sortNumbers(values) { return [...values].sort(); }\n';

export const cases = [
  functions('f01', `type User = { name: string };
// Internal value: the application validates User before calling this function.
export function displayName(user: User): string {
  if (user == null) return 'Guest';
  if (typeof user.name !== 'string') return 'Unknown';
  return user.name;
}
`, [check('displayName', 'redundant_internal_checks', 'issue')]),
  functions('f02', `export function decodeUser(raw: string): { name: string } {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string') {
    throw new Error('Invalid user');
  }
  return { name: value.name };
}
`, [check('decodeUser', 'redundant_internal_checks', 'no_issue_shown')]),
  functions('f03', `// Contract: required configuration must parse successfully; invalid JSON must fail the operation.
export function loadConfig(raw: string) {
  try { return { status: 'ready', settings: JSON.parse(raw) }; }
  catch { return { status: 'ready', settings: {} }; }
}
`, [check('loadConfig', 'hidden_required_failure', 'issue')]),
  functions('f04', `// Contract: cached metadata is optional. Invalid cache data yields an empty object.
export function readCache(raw: string) {
  try { return JSON.parse(raw); }
  catch { return {}; }
}
`, [check('readCache', 'hidden_required_failure', 'no_issue_shown')]),
  functions('f05', `import { permitted } from './policy.js';
${permissionRule}export async function publish(actor, document, published) {
  await permitted(actor);
  published.push(document);
}
`, [check('publish', 'denial_path', 'issue')], { 'policy.js': booleanPolicy }),
  functions('f06', `import { permitted } from './policy.js';
${permissionRule}export async function publish(actor, document, published) {
  if (!(await permitted(actor))) throw new Error('denied');
  published.push(document);
}
`, [check('publish', 'denial_path', 'no_issue_shown')], { 'policy.js': booleanPolicy }),
  functions('f07', `import { permitted } from './policy.js';
${permissionRule}export async function publish(actor, document, published) {
  await permitted(actor);
  published.push(document);
}
`, [check('publish', 'denial_path', 'no_issue_shown')], { 'policy.js': throwingPolicy }),
  functions('f08', `import { permitted } from './policy.js';
${permissionRule}export async function publish(actor, document, published) {
  await permitted(actor);
  published.push(document);
}
`, [check('publish', 'denial_path', 'insufficient_evidence')], { 'policy.js': booleanPolicy }, []),
  functions('f09', `export function submit(order, user, inventory) {
  if (user.active) {
    if (order.items.length > 0) {
      if (inventory.available) {
        inventory.reserve(order.items);
        return { status: 'accepted' };
      } else { return { status: 'out_of_stock' }; }
    } else { return { status: 'empty' }; }
  } else { return { status: 'inactive' }; }
}
`, [check('submit', 'avoidable_nesting', 'issue')]),
  functions('f10', `export function submit(order, user, inventory) {
  if (!user.active) return { status: 'inactive' };
  if (order.items.length === 0) return { status: 'empty' };
  if (!inventory.available) return { status: 'out_of_stock' };
  inventory.reserve(order.items);
  return { status: 'accepted' };
}
`, [check('submit', 'avoidable_nesting', 'no_issue_shown')]),
  functions('f11', `// Public library interface: callers may select compact or detailed output.
export function formatName(name: string, detailed = false) {
  return detailed ? 'Account: ' + name : name;
}
`, [check('formatName', 'unused_flexibility', 'no_issue_shown')]),
  functions('f12', `export function formatName(name: string, detailed = false) {
  return detailed ? 'Account: ' + name : name;
}
`, [check('formatName', 'unused_flexibility', 'insufficient_evidence')]),
  functions('f13', `// Private helper; this complete module contains every reference to it.
function addOne(value: number) { return value + 1; }
export function next(value: number) { return addOne(value); }
`, [check('next', 'unnecessary_indirection', 'issue')]),
  functions('f14', `type Account = { credit: number; reserved: number; suspended: boolean };
// Private domain rule, kept separate so eligibility has one explicit name.
function canPurchase(account: Account, amount: number) {
  return !account.suspended && account.credit - account.reserved >= amount;
}
export function decidePurchase(account: Account, amount: number) {
  return canPurchase(account, amount) ? 'approved' : 'declined';
}
`, [check('decidePurchase', 'unnecessary_indirection', 'no_issue_shown')]),
  tests('t01', `${testImports}import { sortNumbers } from './subject.js';
test('sorts values numerically', () => {
  assert.equal(sortNumbers([10, 2]).length, 2);
});
`, [check('sorts values numerically', 'claim_assertion_gap', 'issue')], { 'subject.js': sortingSource }),
  tests('t02', `${testImports}import { sortNumbers } from './subject.js';
test('sorts values numerically', () => {
  assert.deepEqual(sortNumbers([10, 2]), [2, 10]);
});
`, [check('sorts values numerically', 'claim_assertion_gap', 'no_issue_shown')], {
    'subject.js': 'export function sortNumbers(values) { return [...values].sort((a, b) => a - b); }\n',
  }),
  tests('t03', `${testImports}
test('trims and uppercases a display name', () => {
  const displayName = mock.fn(() => 'ADA');
  assert.equal(displayName({ name: '  Ada ' }), 'ADA');
});
`, [check('trims and uppercases a display name', 'mock_bypasses_subject', 'issue')], { 'subject.js': nameSource }),
  tests('t04', `${testImports}import { loadDisplayName } from './subject.js';
test('trims and uppercases the loaded display name', async () => {
  const loadUser = mock.fn(async () => ({ name: '  Ada ' }));
  assert.equal(await loadDisplayName(loadUser, 'u1'), 'ADA');
  assert.deepEqual(loadUser.mock.calls[0].arguments, ['u1']);
});
`, [check('trims and uppercases the loaded display name', 'mock_bypasses_subject', 'no_issue_shown')], {
    'subject.js': 'export async function loadDisplayName(loadUser, id) { const user = await loadUser(id); return user.name.trim().toUpperCase(); }\n',
  }),
  tests('t05', `${testImports}import { calculateFee } from './subject.js';
test('calculates a basis point fee', () => {
  const amount = 2000, basisPoints = 500;
  const expected = Math.round(amount * basisPoints / 1000);
  assert.equal(calculateFee(amount, basisPoints), expected);
});
`, [check('calculates a basis point fee', 'shared_expected_logic', 'issue')], {
    'subject.js': '// Contract: basis points are one ten-thousandth of the amount.\nexport function calculateFee(amount, basisPoints) { return Math.round(amount * basisPoints / 1000); }\n',
  }),
  tests('t06', `${testImports}import { calculateFee } from './subject.js';
test('calculates a five percent fee', () => {
  assert.equal(calculateFee(2000, 500), 100);
});
`, [check('calculates a five percent fee', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function calculateFee(amount, basisPoints) { return Math.round(amount * basisPoints / 10000); }\n',
  }),
  tests('t07', `${testImports}import { calculateFee } from './subject.js';
import { expectedFee } from './reference.js';
test('calculates the expected fee', () => {
  assert.equal(calculateFee(2000, 500), expectedFee(2000, 500));
});
`, [check('calculates the expected fee', 'shared_expected_logic', 'insufficient_evidence')], {
    'subject.js': 'export function calculateFee(amount, basisPoints) { return Math.round(amount * basisPoints / 10000); }\n',
    'reference.js': 'export function expectedFee(amount, rate) { return Math.round(amount * rate / 10000); }\n',
  }, ['subject.js']),
  tests('t08', `${testImports}import { invoiceTitle } from './subject.js';
test('reads the invoice title', () => {
  const invoice = { title: 'September', currency: 'USD', status: 'draft', customer: 'c1', notes: '', due: null,
    items: [], tax: 0, paid: 0, tags: [], archived: false, region: 'us', locale: 'en', created: 1, updated: 2 };
  assert.equal(invoiceTitle(invoice), 'September');
});
`, [check('reads the invoice title', 'irrelevant_fixture_setup', 'issue')], {
    'subject.js': '// Accepts any object with a title field; no schema or constructor is involved.\nexport function invoiceTitle(invoice) { return invoice.title; }\n',
  }),
  tests('t09', `${testImports}import { Invoice } from './subject.js';
test('reads the invoice title', () => {
  const invoice = new Invoice({ id: 'invoice-1', title: 'September' });
  assert.equal(invoice.title, 'September');
});
`, [check('reads the invoice title', 'irrelevant_fixture_setup', 'no_issue_shown')], {
    'subject.js': "export class Invoice { constructor(value) { if (!value.id) throw new Error('id required'); this.id = value.id; this.title = value.title; } }\n",
  }),
  tests('t10', `${testImports}import { makeNameFixture } from './fixture.js';
test('trims and uppercases a display name', () => {
  const displayName = makeNameFixture();
  assert.equal(displayName({ name: '  Ada ' }), 'ADA');
});
`, [check('trims and uppercases a display name', 'mock_bypasses_subject', 'insufficient_evidence')]),
  tests('t11', `${testImports}import { sortNumbers } from './subject.js';
test('smoke: returns an array with one result per input', () => {
  const result = sortNumbers([10, 2]);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
});
`, [check('smoke: returns an array with one result per input', 'claim_assertion_gap', 'no_issue_shown')], {
    'subject.js': sortingSource,
  }),
];

async function upstream(group, names) {
  return Object.fromEntries(await Promise.all(names.map(async name => [
    name, await readFile(new URL(`./upstream/${group}/${name}`, import.meta.url), 'utf8'),
  ])));
}

const dependency = await upstream('dependency-only', ['package.json', 'slugify.test.js']);
cases.push({
  id: 't12', pack: 'tests', files: dependency, scanFiles: ['slugify.test.js'], contextFiles: ['package.json'],
  checks: [check(null, 'owned_behavior', 'issue')],
});
cases.push({
  id: 't13', pack: 'tests', files: dependency, scanFiles: ['slugify.test.js'], contextFiles: [],
  checks: [check(null, 'owned_behavior', 'insufficient_evidence')],
});
const retry = await upstream('owned-retry', ['package.json', 'retry.js', 'retry.test.js']);
cases.push({
  id: 't14', pack: 'tests', files: retry, scanFiles: ['retry.test.js'], contextFiles: ['package.json', 'retry.js'],
  checks: [
    check('uses the product retry policy and reports failed attempts', 'owned_behavior', 'no_issue_shown'),
    check('preserves the error object required by telemetry', 'owned_behavior', 'no_issue_shown'),
  ],
});
cases.push({
  id: 't15', pack: 'tests', files: retry, scanFiles: ['retry.test.js'], contextFiles: ['package.json'],
  checks: [check('uses the product retry policy and reports failed attempts', 'owned_behavior', 'insufficient_evidence')],
});

// Fresh cases written after the initial run. They are not relabeled initial examples.
cases.push(
  functions('f15', `export function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('label must be a string');
  if (typeof value === 'string') return value.trim();
  return '';
}
`, [check('normalizeLabel', 'redundant_internal_checks', 'issue')]),
  functions('f16', `export function readNames(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value;
  throw new Error('unsupported input');
}
`, [check('readNames', 'redundant_internal_checks', 'no_issue_shown')]),
  functions('f17', `// Complete private module: label is never exported or passed as a callback; both references appear below.
function label(name: string, prefix = 'Account') { return prefix + ': ' + name; }
export const names = [label('Ada', 'Account'), label('Lin', 'Account')];
`, [check('label', 'unused_flexibility', 'issue')]),
  functions('f18', `// Public client-library API. The timeout argument and its default are documented compatibility commitments.
export function connect(url: string, timeout = 5000) { return { url, timeout }; }
`, [check('connect', 'unused_flexibility', 'no_issue_shown')]),
  functions('f19', `export function saveDraft(draft, account, storage) {
  if (account.enabled) {
    if (draft.title.length > 0) {
      if (draft.body.length > 0) {
        const record = { title: draft.title.trim(), body: draft.body, author: account.id };
        storage.write(record);
        storage.audit(account.id, 'draft-created');
        storage.incrementCount(account.id);
        return { saved: true, title: record.title };
      } else { return { saved: false, error: 'empty body' }; }
    } else { return { saved: false, error: 'empty title' }; }
  } else { return { saved: false, error: 'disabled account' }; }
}
`, [check('saveDraft', 'avoidable_nesting', 'issue')]),
  functions('f20', `export function saveDraft(draft, account, storage) {
  if (!account.enabled) return { saved: false, error: 'disabled account' };
  if (!draft.title.length) return { saved: false, error: 'empty title' };
  storage.write(draft);
  return { saved: true };
}
`, [check('saveDraft', 'avoidable_nesting', 'no_issue_shown')]),
  functions('f21', `import { permitted } from './policy.js';
${permissionRule}export async function publish(actor, document, published) {
  try { await permitted(actor); } catch { /* audit service failure is ignored */ }
  published.push(document);
}
`, [check('publish', 'denial_path', 'issue')], { 'policy.js': throwingPolicy }),
  tests('t16', `${testImports}import { total } from './subject.js';
test('adds two invoice lines', () => { assert.equal(total([4, 7]), 11); });
`, [check('adds two invoice lines', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function total(lines) { return lines.reduce((sum, value) => sum + value, 0); }\n',
  }),
  tests('t17', `${testImports}import { normalize } from './subject.js';
test('normalization is idempotent', () => {
  const once = normalize('  A B  ');
  assert.equal(normalize(once), once);
});
`, [check('normalization is idempotent', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function normalize(value) { return value.trim().toLowerCase(); }\n',
  }),
  tests('t18', `${testImports}import { articlePath } from './subject.js';
test('builds an application article path', () => {
  assert.equal(articlePath('Hello World'), '/articles/hello-world');
});
`, [check('builds an application article path', 'owned_behavior', 'no_issue_shown')], {
    'package.json': dependency['package.json'],
    'subject.js': "import slugify from 'slugify';\nexport function articlePath(title) { return '/articles/' + slugify(title, { lower: true, strict: true }); }\n",
  }),
  tests('t19', `${testImports}import { publicSlug } from './subject.js';
test('keeps the public URL compatibility format', () => {
  assert.equal(publicSlug('Rock & Roll'), 'rock-and-roll');
});
`, [check('keeps the public URL compatibility format', 'owned_behavior', 'no_issue_shown')], {
    'package.json': dependency['package.json'],
    'subject.js': "import slugify from 'slugify';\n// Application URL contract deliberately exposes slugify 1.x semantics; changing old slugs breaks published links.\nexport function publicSlug(title) { return slugify(title, { lower: true, strict: true }); }\n",
  }),
  tests('t20', `${testImports}import { buildRequest } from './subject.js';
test('uses independent literal request fields', () => {
  const expected = { path: '/orders', method: 'POST', timeout: 5000 };
  assert.deepEqual(buildRequest(), expected);
});
`, [
    check('uses independent literal request fields', 'shared_expected_logic', 'no_issue_shown'),
    check('uses independent literal request fields', 'irrelevant_fixture_setup', 'no_issue_shown'),
  ], {
    'subject.js': "export function buildRequest() { return { path: '/orders', method: 'POST', timeout: 5000 }; }\n",
  }),
  tests('t21', `${testImports}import { add } from './subject.js';
test('addition is commutative', () => {
  assert.equal(add(4, 9), add(9, 4));
});
`, [check('addition is commutative', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function add(left, right) { return left + right; }\n',
  }),
  tests('t22', `${testImports}import { encode, decode } from './subject.js';
test('encoding then decoding restores the input', () => {
  const input = { title: 'draft', count: 3 };
  assert.deepEqual(decode(encode(input)), input);
});
`, [check('encoding then decoding restores the input', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function encode(value) { return JSON.stringify(value); }\nexport function decode(value) { return JSON.parse(value); }\n',
  }),
  tests('t23', `${testImports}import { fee } from './subject.js';
test('calculates the correct fee', () => {
  assert.equal(fee(1250, 250), fee(1250, 250));
});
`, [check('calculates the correct fee', 'shared_expected_logic', 'issue')], {
    'subject.js': 'export function fee(amount, basisPoints) { return Math.round(amount * basisPoints / 10000); }\n',
  }),
  tests('t24', `${testImports}import { shipping } from './subject.js';
test('calculates the shipping price', () => {
  const units = 4;
  const expected = units > 3 ? 8 + (units - 3) * 2 : 8;
  assert.equal(shipping(units), expected);
});
`, [check('calculates the shipping price', 'shared_expected_logic', 'issue')], {
    'subject.js': 'export function shipping(units) { return units > 3 ? 8 + (units - 3) * 2 : 8; }\n',
  }),
  tests('t25', `${testImports}import { sorted } from './subject.js';
test('sorting twice leaves the result unchanged', () => {
  const sortedOnce = sorted([7, 1, 3]);
  assert.deepEqual(sorted(sortedOnce), sortedOnce);
});
`, [check('sorting twice leaves the result unchanged', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function sorted(values) { return [...values].sort((a, b) => a - b); }\n',
  }),
  tests('t26', `${testImports}import { supportedFormats } from './subject.js';
test('publishes the supported format names', () => {
  assert.deepEqual(supportedFormats(), ['json', 'csv']);
});
`, [check('publishes the supported format names', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': "export function supportedFormats() { return ['json', 'csv']; }\n",
  }),
  tests('t27', `${testImports}import { retryOptions } from './subject.js';
test('uses the default retry configuration', () => {
  assert.deepEqual(retryOptions(), { attempts: 3, delays: [100, 200], logging: { enabled: true } });
});
`, [check('uses the default retry configuration', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': 'export function retryOptions() { return { attempts: 3, delays: [100, 200], logging: { enabled: true } }; }\n',
  }),
  tests('t28', `${testImports}import { shippingQuote } from './subject.js';
test('calculates a shipping quote', () => {
  const weight = 5;
  const expected = { fee: weight > 2 ? 4 + (weight - 2) * 3 : 4 };
  assert.deepEqual(shippingQuote(weight), expected);
});
`, [check('calculates a shipping quote', 'shared_expected_logic', 'issue')], {
    'subject.js': 'export function shippingQuote(weight) { return { fee: weight > 2 ? 4 + (weight - 2) * 3 : 4 }; }\n',
  }),
  tests('t29', `${testImports}import { digest } from './subject.js';
test('digest is deterministic for the same input', () => {
  const first = digest('abc');
  assert.equal(digest('abc'), first);
});
`, [check('digest is deterministic for the same input', 'shared_expected_logic', 'no_issue_shown')], {
    'subject.js': "import { createHash } from 'node:crypto';\n// Application contract: the digest must be deterministic for the same input.\nexport function digest(value) { return createHash('sha256').update(value).digest('hex'); }\n",
  }),
);

export const runtimeCases = ['f03', 'f04', 'f05', 'f06', 'f07', 'f21', 't01', 't02', 't03', 't04', 't05', 't06', 't08', 't09', 't11', 't16', 't17', 't20', 't21', 't22', 't23', 't24', 't25', 't26', 't27', 't28', 't29'];
