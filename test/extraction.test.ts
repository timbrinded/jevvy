import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeParsers } from '../src/ast.ts';
import { extractComments } from '../src/packs/comments/context.ts';
import { hash } from '../src/hash.ts';
import type { Language } from '../src/contracts.ts';

async function extract(language: Language, content: string, maxContextChars = 12000) {
  const source = {
    path: `fixture.${language}`,
    snapshot: 'captured' as const,
    contentHash: hash(content),
    encoding: 'utf-8' as const,
    language,
    content,
  };
  const result = await extractComments('source', source, { maxContextChars });
  for (const unit of result.units) assert.equal(content.slice(unit.range.startUtf16, unit.range.endUtf16), unit.text);
  for (const context of Object.values(result.contexts))
    assert.equal(content.slice(context.range.startUtf16, context.range.endUtf16), context.text);
  return result;
}
test('all grammars initialise repeatedly in one process', () => {
  initializeParsers();
  initializeParsers();
});
test('TypeScript groups adjacent lines and supplies exported arrow context', async () => {
  const r = await extract('typescript', '// why\n// more detail\nexport const run = (x: number) => x + 1;');
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0]!.text, '// why\n// more detail');
  assert.equal(r.units[0]!.context.status, 'complete_local');
  assert.match(Object.values(r.contexts)[0]!.text, /export const run/);
});
test('Unicode and CRLF spans slice exact original source', async () => {
  const r = await extract('typescript', 'const emoji = "🦦é";\r\n/** Returns π. */\r\nfunction π() { return "🦦"; }');
  assert.equal(r.units[0]!.range.startLine, 2);
  assert.equal(r.units[0]!.text, '/** Returns π. */');
  assert.equal(r.units[0]!.structure.documentationStyle, 'jsdoc');
});
test('comment-looking strings and TSX strings are not comments', async () => {
  const r = await extract(
    'tsx',
    'const s = "// not a comment";\n/** Card docs */\nconst Card = () => <div title="/* no */">hello</div>;',
  );
  assert.equal(r.units.length, 1);
  assert.equal(r.errors.length, 0);
});
test('Python recognises real module/class/decorated async docstrings only', async () => {
  const r = await extract(
    'python',
    '"""Module docs."""\nclass C:\n    """Class docs."""\n    @staticmethod\n    async def f():\n        """Function docs."""\n        x = """not docs"""\n        """not first"""\n        return x\n',
  );
  assert.equal(r.units.length, 3);
  assert.ok(r.units.every(u => u.structure.attachment.kind === 'syntactic'));
  assert.ok(Object.values(r.contexts).some(c => c.text.includes('@staticmethod')));
});
test('Python byte literals and formatted strings are not docstrings', async () => {
  assert.equal((await extract('python', 'def f():\n    b"bytes"\ndef g():\n    f"format {1}"\n')).units.length, 0);
});
test('Rust preserves nested block comments and docs with attributes', async () => {
  const r = await extract(
    'rust',
    '//! Module docs\n/// Function docs\n#[inline]\nfn f() { /* outer /* nested */ end */ let x = 1; }',
  );
  assert.equal(r.units.length, 3);
  assert.equal(r.units[0]!.structure.attachment.kind, 'syntactic');
  assert.equal(r.units[1]!.structure.documentationStyle, 'rustdoc');
  assert.equal(r.units[1]!.structure.owner!.kind, 'function_item');
  assert.match(r.units[2]!.text, /nested/);
});
test('Rust literal doc attributes are analysed', async () => {
  const r = await extract('rust', '#[doc = "Returns one."]\nfn f() -> i32 { 1 }');
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0]!.structure.syntax, 'doc_attribute');
});
test('Solidity NatSpec attaches to declarations and preserves tags', async () => {
  const r = await extract(
    'solidity',
    'contract C {\n /// @notice Returns one\n /// @inheritdoc I\n function f() public pure returns(uint) { return 1; }\n}',
  );
  assert.equal(r.errors.length, 0);
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0]!.structure.documentationStyle, 'natspec');
  assert.deepEqual(r.units[0]!.structure.tags, ['notice', 'inheritdoc']);
});
test('licences/directives are inventoried; separable explanations remain', async () => {
  const r = await extract(
    'typescript',
    '// SPDX-License-Identifier: MIT\n// eslint-disable-next-line -- Legacy caller still passes strings.\nfunction f() {}',
  );
  assert.equal(r.excluded.length, 2);
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0]!.text, 'Legacy caller still passes strings.');
});
test('ordinary rationale mentioning copyright is not mistaken for a licence', async () => {
  const r = await extract('typescript', '// Retain attribution because copyright restrictions apply.\nfunction f() {}');
  assert.equal(r.units.length, 1);
  assert.equal(r.excluded.length, 0);
});
test('blank-separated comments have unresolved ownership', async () => {
  for (const language of ['typescript', 'rust'] as const) {
    const r = await extract(
      language,
      language === 'rust' ? '// heading\n\nfn f() {}' : '// heading\n\nfunction f() {}',
    );
    assert.equal(r.units[0]!.structure.attachment.kind, 'unresolved');
    assert.equal(r.units[0]!.context.status, 'partial');
  }
});
test('a separate prose block does not bridge blank-line ownership gaps', async () => {
  const r = await extract('typescript', '// Heading.\n\n// Function documentation.\nfunction f() {}');
  assert.equal(r.units[0]!.structure.attachment.kind, 'unresolved');
  assert.equal(r.units[1]!.structure.owner!.name, 'f');
});
test('trailing comments own their same-line statement', async () => {
  const r = await extract('typescript', 'function f() {\n const value = 1; // intentional\n return value;\n}');
  assert.match(r.units[0]!.structure.attachment.evidence, /Trailing/);
  assert.equal(r.units[0]!.structure.owner!.kind, 'lexical_declaration');
  assert.ok(Object.values(r.contexts).some(c => c.text.includes('function f') && c.text.includes('const value')));
});
test('oversized owners omit code explicitly', async () => {
  const r = await extract(
    'typescript',
    '/** many values */\nfunction f() { return [' + '1,'.repeat(1000) + ']; }',
    256,
  );
  assert.notEqual(r.units[0]!.context.status, 'complete_local');
  assert.ok(r.units[0]!.context.omissions.includes('oversized_owner'));
});
test('parse recovery is recorded and cannot claim complete context', async () => {
  const r = await extract('typescript', '/** broken */\nfunction f() { return ??? }');
  assert.ok(r.errors.length > 0);
  assert.notEqual(r.units[0]!.context.status, 'complete_local');
});
test('TypeScript decorators, methods, class fields and type docs retain their declarations', async () => {
  const r = await extract(
    'typescript',
    '/** A cached service. */\n@sealed\nexport class Service {\n /** Cache key. */\n readonly key: string = "key";\n /** Returns the key. */\n @memo\n getKey(): string { return this.key; }\n}\n/** Identifier type. */\nexport type Id = string;',
  );
  assert.equal(r.units.length, 4);
  assert.equal(r.errors.length, 0);
  assert.ok(r.units.every(u => u.structure.owner !== null));
  assert.ok(Object.values(r.contexts).some(c => c.text.includes('@sealed')));
  assert.ok(Object.values(r.contexts).some(c => c.text.includes('@memo')));
  const method = r.units.find(u => u.text.includes('Returns the key'))!;
  assert.equal(method.structure.owner!.kind, 'method_definition');
  assert.equal(method.structure.owner!.name, 'getKey');
  assert.equal(method.context.status, 'complete_local');
  assert.ok(method.context.refs.some(ref => /@memo[\s\S]*return this.key/.test(r.contexts[ref]!.text)));
});
test('multiple decorators retain the full method and enforce its context budget', async () => {
  const source = 'class C {\n/** Returns zero. */\n@first\n@second\nvalue() { return 99; }\n}';
  for (const language of ['typescript', 'tsx'] as const) {
    const r = await extract(language, source);
    const u = r.units[0]!;
    assert.equal(u.structure.owner!.name, 'value');
    assert.ok(u.context.refs.some(ref => r.contexts[ref]!.text === '@first\n@second\nvalue() { return 99; }'));
    const small = await extract(language, source, 25);
    assert.equal(small.units[0]!.context.status, 'partial');
    assert.ok(small.units[0]!.context.omissions.includes('oversized_owner'));
  }
});
test('comments after exported closing braces retain the completed function', async () => {
  const r = await extract(
    'typescript',
    'export function first() { return 1; } // Returns one.\nexport function next() { return 2; }',
  );
  const u = r.units[0]!;
  assert.equal(u.structure.owner!.name, 'first');
  assert.equal(u.context.status, 'complete_local');
  assert.ok(u.context.refs.some(ref => r.contexts[ref]!.text.includes('return 1;')));
  assert.ok(u.context.refs.every(ref => !r.contexts[ref]!.text.includes('return 2;')));
});
test('module documentation does not borrow a descendant name', async () => {
  const r = await extract('python', '"""Module documentation."""\nclass C:\n def __init__(self):\n  pass\n');
  assert.equal(r.units[0]!.structure.owner!.kind, 'module');
  assert.equal(r.units[0]!.structure.owner!.name, null);
});
test('Rust item/field documentation and raw literal doc attributes are extracted', async () => {
  const r = await extract(
    'rust',
    '/// Coordinates.\npub struct Point {\n /// Horizontal position.\n pub x: i32,\n}\n#[doc = r#"Returns zero."#]\npub fn zero() -> i32 { 0 }',
  );
  assert.equal(r.units.length, 3);
  assert.equal(r.errors.length, 0);
  assert.equal(r.units[1]!.structure.owner!.kind, 'field_declaration');
});
test('Solidity modifier and state-variable documentation are selected', async () => {
  const r = await extract(
    'solidity',
    'contract C {\n /// @notice Contract owner.\n address public owner;\n /// @dev Only the owner may call.\n modifier onlyOwner() { require(msg.sender == owner); _; }\n}',
  );
  assert.equal(r.units.length, 2);
  assert.equal(r.errors.length, 0);
  assert.ok(r.units.every(u => u.context.status === 'complete_local'));
});
