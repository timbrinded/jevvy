import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeStructure, Source, Unit } from '../src/contracts.ts';
import { hash } from '../src/hash.ts';
import { extractFunctions, extractTests } from '../src/packs/code/context.ts';

function structure(unit: Unit): CodeStructure {
  assert.ok('kind' in unit.structure);
  return unit.structure;
}

async function extract(
  pack: 'functions' | 'tests',
  content: string,
  options: Partial<Pick<Source, 'language' | 'path'>> & { maxContextChars?: number } = {},
) {
  const source: Source = {
    path: options.path ?? 'src/fixture.ts',
    language: options.language ?? 'typescript',
    snapshot: 'captured',
    contentHash: hash(content),
    encoding: 'utf-8',
    content,
  };
  const fn = pack === 'functions' ? extractFunctions : extractTests;
  const result = await fn('source', source, { maxContextChars: options.maxContextChars ?? 12000 });
  for (const unit of result.units) assert.equal(content.slice(unit.range.startUtf16, unit.range.endUtf16), unit.text);
  for (const context of Object.values(result.contexts))
    assert.equal(content.slice(context.range.startUtf16, context.range.endUtf16), context.text);
  for (const item of result.excluded)
    assert.equal(content.slice(item.range.startUtf16, item.range.endUtf16), item.text);
  return result;
}

test('functions include bodies, arrow bindings, methods and nested callables, but not signatures or strings', async () => {
  const content = `interface API { read(): string }
declare function remote(): void;
const text = "function imaginary() {}";
export const run = (value: number) => value + 1;
class Service { abstractRead?: () => string; get size() { return 1; } save() {} }
function outer() { function inner() {} return inner; }`;
  const result = await extract('functions', content);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['run', 'size', 'save', 'outer', 'inner'],
  );
  assert.equal(result.units[0]!.text, 'export const run = (value: number) => value + 1;');
  assert.ok(result.units.every(unit => unit.context.status === 'complete_local'));
  assert.equal(Object.values(result.contexts).length, 1);
  assert.equal(Object.values(result.contexts)[0]!.text, content);
});

test('Unicode and CRLF preserve source offsets, names and function boundaries', async () => {
  const content = 'const marker = "🦧é";\r\nexport function π() { return "🦦"; }\r\nconst next = () => 2;';
  const result = await extract('functions', content);
  assert.equal(structure(result.units[0]!).name, 'π');
  assert.equal(result.units[0]!.range.startLine, 2);
  assert.equal(result.units[0]!.range.startUtf16, content.indexOf('export'));
  assert.equal(result.units[0]!.text, 'export function π() { return "🦦"; }');
  assert.equal(structure(result.units[1]!).name, 'next');
});

test('JavaScript and JSX use their grammars and extract JSX component functions', async () => {
  for (const language of ['javascript', 'jsx'] as const) {
    const result = await extract('functions', 'export const Card = () => <div>hello</div>;', {
      language,
      path: 'src/Card.jsx',
    });
    assert.equal(result.errors.length, 0);
    assert.equal(structure(result.units[0]!).name, 'Card');
  }
});

test('known imports select aliased tests and preserve helpers, imports and hooks as context', async () => {
  const content = `import { test as verify, beforeEach } from 'node:test';
function helper() { return 7; }
beforeEach(() => reset());
verify('uses helper', () => { assert.equal(helper(), 7); });`;
  const tests = await extract('tests', content);
  assert.deepEqual(
    tests.units.map(unit => structure(unit).name),
    ['uses helper'],
  );
  assert.equal(structure(tests.units[0]!).framework, 'node:test');
  assert.equal(Object.values(tests.contexts)[0]!.text, content);
  const functions = await extract('functions', content);
  assert.deepEqual(
    functions.units.map(unit => structure(unit).name),
    ['helper'],
  );
  assert.equal(functions.excluded.length, 2);
});

test('namespaced imports, CommonJS aliases and parameterized registrations are recognized once', async () => {
  const content = `import * as checks from 'vitest';
const { test: verify } = require('node:test');
checks.test.concurrent.each([1, 2])('row %s', value => expect(value).toBeTruthy());
checks.it.each\`a | b
\${1} | \${2}\`('table', ({a}) => expect(a).toBe(1));
verify('node', () => {});`;
  const result = await extract('tests', content);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['row %s', 'table', 'node'],
  );
  assert.equal(result.excluded.length, 0);
});

test('conventional global tests require a test path and reject local/imported production names', async () => {
  const content = "test('works', () => {}); it('also', () => {});";
  assert.equal((await extract('tests', content)).units.length, 0);
  assert.equal((await extract('tests', content, { path: 'lib/example.spec.ts' })).units.length, 2);
  for (const source of [
    "function test(name, callback) { return callback; } test('not a test', () => {});",
    "import { test } from './production'; test('not a test', () => {});",
    "import { test } from 'node:test'; function example(test) { test('shadowed', () => {}); }",
    "import { test } from 'node:test'; function example({test}) { test('shadowed', () => {}); }",
    "const ordinary = { test(name, callback) { return callback; } }; ordinary.test('not a test', () => {});",
  ])
    assert.equal((await extract('tests', source, { path: 'example.test.ts' })).units.length, 0);
});

test('Node nested subtests are selected, while an unrelated object.test call is not', async () => {
  const result = await extract(
    'tests',
    `import test from 'node:test';
test('outer', async t => { await t.test('inner', () => {}); });
const arbitrary = makeObject(); arbitrary.test('unrelated', () => {});`,
  );
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['outer', 'inner'],
  );
});

test('single arrow and catch bindings do not become runner imports or Node test contexts', async () => {
  const content = `import { test } from 'node:test';
const register = test => test('ordinary function', () => {});
try { operation(); } catch (test) { test('caught function', () => {}); }
test('outer', t => {
  const run = t => t.test('ordinary method', () => {});
  try { operation(); } catch (t) { t.test('caught method', () => {}); }
  { const t = service; t.test('local method', () => {}); }
  t.test('actual subtest', () => {});
});`;
  const result = await extract('tests', content);
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['outer', 'actual subtest'],
  );
});

test('same-name imports and require bindings resolve in their own lexical scopes', async () => {
  const result = await extract(
    'tests',
    `import { test } from 'node:test';
test('outer before', () => {});
function setup() {
  const { test } = require('vitest');
  test('inner vitest', () => {});
}
function alternate() {
  const { test } = require('bun:test');
  test('inner bun', () => {});
}
test('outer after', () => {});`,
  );
  assert.deepEqual(
    result.units.map(unit => [structure(unit).name, structure(unit).framework]),
    [
      ['outer before', 'node:test'],
      ['inner vitest', 'vitest'],
      ['inner bun', 'bun:test'],
      ['outer after', 'node:test'],
    ],
  );
});

test('skipped named suites propagate after discovery and active callback reuse stays active', async () => {
  const result = await extract(
    'tests',
    `import { test, describe } from 'node:test';
function innerBody() { test('never', () => {}); }
function outerBody() { describe('nested suite', innerBody); }
describe.skip('disabled suite', outerBody);
function shared() { test('runs through active suite', () => {}); }
describe.skip('disabled use', shared);
describe('active use', shared);`,
  );
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['runs through active suite'],
  );
  assert.equal(result.excluded.length, 1);
  assert.match(result.excluded[0]!.text, /test\('never'/);
  assert.equal(result.excluded[0]!.reason, 'test_skipped_by_parent');
});

test('named Node callback declarations retain nested subtests regardless of source order', async () => {
  const result = await extract(
    'tests',
    `import test from 'node:test';
function childBody(t) { t.test('grandchild', () => {}); }
function parentBody(t) { t.test('child', childBody); }
test('parent', parentBody);`,
  );
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['grandchild', 'child', 'parent'],
  );
});

test('skipped and todo tests, skipped suites and static skip conditions are inventoried', async () => {
  const result = await extract(
    'tests',
    `import { test, describe } from 'vitest';
test.skip('disabled', () => {});
test.todo('later');
describe.skip('suite', () => { test('inside', () => {}); });
test.skipIf(true)('conditional skip', () => {});
test.skipIf(false)('enabled', () => {});
test('options', { skip: true }, () => {});`,
  );
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['enabled'],
  );
  assert.deepEqual(
    result.excluded.map(item => item.reason),
    ['test_skipped', 'test_todo', 'test_skipped_by_parent', 'test_skipped', 'test_skipped'],
  );
});

test('a named local test implementation is context, and imported unknown implementations are excluded', async () => {
  const content = `import { test } from 'node:test';
import unknownBody from './external';
const localBody = () => assert.equal(1, 1);
test('local', localBody);
test('external', unknownBody);`;
  const tests = await extract('tests', content);
  assert.deepEqual(
    tests.units.map(unit => structure(unit).name),
    ['local'],
  );
  assert.equal(tests.excluded[0]!.reason, 'unresolved_test_body');
  assert.equal((await extract('functions', content)).units.length, 0);
  const shadowed = await extract(
    'tests',
    `import { test } from 'node:test';
function body() { assert.ok(true); }
function register(body) { test('unknown parameter', body); }
function other() { const body = 123; test('not callable', body); }`,
  );
  assert.equal(shadowed.units.length, 0);
  assert.equal(shadowed.excluded.length, 2);
});

test('Python pytest and unittest preserve decorators and exclude skipped/setup functions', async () => {
  const content = `import pytest as p
from unittest import TestCase as Base, skip as ignored
@p.fixture
def account(): return 1
@p.mark.skipif(False, reason='enabled')
def test_enabled(account): assert account == 1
@p.mark.skip(reason='later')
def test_skipped(): pass
class Checks(Base):
    def setUp(self): self.value = 1
    @ignored('later')
    def test_disabled(self): pass
    def testValue(self): self.assertEqual(self.value, 1)
def helper(): return 2
`;
  const options = { language: 'python' as const, path: 'test_account.py' };
  const result = await extract('tests', content, options);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['test_enabled', 'testValue'],
  );
  assert.ok(result.units[0]!.text.startsWith('@p.mark.skipif(False'));
  assert.equal(result.excluded.length, 2);
  assert.deepEqual(
    (await extract('functions', content, options)).units.map(unit => structure(unit).name),
    ['helper'],
  );
});

test('Python does not collect nested or ordinary-class test-shaped helper functions', async () => {
  const result = await extract(
    'tests',
    `def factory():
    def test_nested(): pass
    return test_nested
class Utility:
    def test_value(self): return True
def test_actual(): assert True
`,
    { language: 'python', path: 'test_helpers.py' },
  );
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['test_actual'],
  );
});

test('Rust uses test attributes, excludes ignored tests and retains production closures', async () => {
  const result = await extract(
    'tests',
    `#[test]
#[ignore = "requires service"]
fn unavailable() {}
#[tokio::test(flavor = "current_thread")]
async fn works() {}
fn production() { let convert = |value: i32| value + 1; }
`,
    { language: 'rust', path: 'src/lib.rs' },
  );
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['works'],
  );
  assert.match(result.units[0]!.text, /^#\[tokio::test/);
  assert.equal(result.excluded[0]!.reason, 'test_skipped');
  const functions = await extract('functions', 'fn production() { let convert = |value: i32| value + 1; }', {
    language: 'rust',
  });
  assert.deepEqual(
    functions.units.map(unit => structure(unit).name),
    ['production', 'convert'],
  );
});

test('Solidity Foundry test names require test context and body-bearing functions', async () => {
  const content = 'contract Checks { function testBalance() public {} function helper() public {} }';
  assert.equal((await extract('tests', content, { language: 'solidity', path: 'src/Checks.sol' })).units.length, 0);
  const result = await extract('tests', content, { language: 'solidity', path: 'test/Checks.t.sol' });
  assert.deepEqual(
    result.units.map(unit => structure(unit).name),
    ['testBalance'],
  );
  assert.equal(
    (
      await extract('tests', 'import "forge-std/console.sol"; ' + content, {
        language: 'solidity',
        path: 'src/Checks.sol',
      })
    ).units.length,
    0,
  );
  const imported = await extract(
    'tests',
    'import {Test as Base} from "forge-std/Test.sol"; contract C is Base { function testFoundry() external {} function testHelper() internal {} }',
    { language: 'solidity', path: 'src/Checks.sol' },
  );
  assert.deepEqual(
    imported.units.map(unit => structure(unit).name),
    ['testFoundry'],
  );
  const functions = await extract(
    'functions',
    'interface I { function balance() external returns(uint); } contract C { constructor() {} modifier ready() { _; } fallback() external {} }',
    { language: 'solidity' },
  );
  assert.equal(functions.units.length, 3);
});

test('large files retain the entire target and bounded imports with explicit omissions', async () => {
  const content =
    "import { read } from './io';\n" +
    '// unrelated padding\n'.repeat(80) +
    'export function load() { return read(); }';
  const result = await extract('functions', content, { maxContextChars: 256 });
  const unit = result.units[0]!;
  assert.equal(unit.context.status, 'partial');
  assert.ok(unit.context.omissions.includes('same_file_context_omitted'));
  assert.ok(unit.context.refs.some(ref => result.contexts[ref]!.text === unit.text));
  assert.ok(unit.context.refs.some(ref => result.contexts[ref]!.text.includes('import { read }')));
  assert.ok(unit.context.refs.reduce((size, ref) => size + result.contexts[ref]!.text.length, 0) <= 256);
});

test('an oversized target remains inventoried but cannot be inferred from a truncated body', async () => {
  const result = await extract('functions', 'function giant() { return [' + '1234,'.repeat(100) + ']; }', {
    maxContextChars: 256,
  });
  const unit = result.units[0]!;
  assert.equal(unit.context.status, 'unavailable');
  assert.ok(unit.context.omissions.includes('oversized_target'));
  assert.equal(unit.context.refs.length, 0);
  assert.ok(unit.text.length > 256);
});

test('named test bodies must fit the context budget even when the registration is small', async () => {
  const content =
    "import { test } from 'node:test';\nconst body = () => { assert.deepEqual([" +
    '1,'.repeat(200) +
    "], []); };\ntest('large body', body);";
  const result = await extract('tests', content, { maxContextChars: 256 });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0]!.context.status, 'unavailable');
  assert.ok(result.units[0]!.context.omissions.includes('oversized_target'));
});

test('parse recovery cannot mark any target in that source as available for inference', async () => {
  const result = await extract('functions', 'function valid() { return 1; }\nfunction broken() { return ???; }');
  assert.ok(result.errors.length > 0);
  assert.ok(result.units.length > 0);
  assert.ok(
    result.units.every(unit => unit.context.status === 'unavailable' && unit.context.omissions.includes('parse_error')),
  );
});

test('explicit context data is not parsed or extracted as code', async () => {
  for (const language of ['json', 'text'] as const) {
    const result = await extract('functions', 'function fake() {}', { language });
    assert.deepEqual(result, { units: [], contexts: {}, excluded: [], errors: [] });
  }
});
