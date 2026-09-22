import type { SgNode } from '@ast-grep/napi';
import type { Source } from '../../contracts.ts';
import { walk } from '../../ast.ts';
import { ancestors, attributes, kind, literal, target, type CodeTarget } from './nodes.ts';
import { javascriptTests } from './javascript.ts';

const javascriptCallables = new Set([
  'function_declaration',
  'function_expression',
  'generator_function_declaration',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const solidityCallables = new Set([
  'function_definition',
  'constructor_definition',
  'modifier_definition',
  'fallback_receive_definition',
]);

function isCallable(node: SgNode, language: Source['language']): boolean {
  if (['typescript', 'tsx', 'javascript', 'jsx'].includes(language))
    return javascriptCallables.has(kind(node)) && Boolean(node.field('body'));
  if (language === 'python') return ['function_definition', 'lambda'].includes(kind(node));
  if (language === 'rust')
    return ['function_item', 'closure_expression'].includes(kind(node)) && Boolean(node.field('body'));
  return (
    language === 'solidity' &&
    solidityCallables.has(kind(node)) &&
    node.namedChildren().some(child => kind(child) === 'function_body')
  );
}

function pythonImports(root: SgNode): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of root.namedChildren()) {
    if (!['import_statement', 'import_from_statement'].includes(kind(statement))) continue;
    const module = statement.field('module_name')?.text();
    for (const child of statement.namedChildren()) {
      if (child.id() === statement.field('module_name')?.id()) continue;
      const original = child.field('name')?.text() ?? child.text();
      const local = child.field('alias')?.text() ?? original;
      imports.set(local, module ? `${module}.${original}` : original);
    }
  }
  return imports;
}

function pythonQualified(expression: SgNode, imports: Map<string, string>): string {
  const raw = (expression.field('function') ?? expression).text();
  const [base, ...parts] = raw.split('.');
  return [imports.get(base!) ?? base, ...parts].join('.');
}

function pythonDecorators(node: SgNode, imports: Map<string, string>): { name: string; expression: SgNode }[] {
  const wrapper = node.parent();
  if (!wrapper || kind(wrapper) !== 'decorated_definition') return [];
  return wrapper
    .namedChildren()
    .filter(child => kind(child) === 'decorator')
    .flatMap(decorator => {
      const expression = decorator.namedChildren()[0];
      return expression ? [{ name: pythonQualified(expression, imports), expression }] : [];
    });
}

function pythonSkipped(node: SgNode, imports: Map<string, string>): string | undefined {
  for (const candidate of [node, ...ancestors(node).filter(parent => kind(parent) === 'class_definition')]) {
    for (const decorator of pythonDecorators(candidate, imports)) {
      if (['unittest.skip', 'pytest.mark.skip'].includes(decorator.name)) return 'test_skipped';
      if (['unittest.skipIf', 'unittest.skipUnless', 'pytest.mark.skipif'].includes(decorator.name)) {
        const condition = decorator.expression.field('arguments')?.namedChildren()[0]?.text();
        const enabled = decorator.name.endsWith('skipUnless') ? condition === 'True' : condition === 'False';
        if (!enabled) return ['True', 'False'].includes(condition ?? '') ? 'test_skipped' : 'conditional_test';
      }
    }
  }
}

function pythonClass(owner: SgNode | undefined, imports: Map<string, string>) {
  const unittest =
    owner
      ?.field('superclasses')
      ?.namedChildren()
      .some(base => pythonQualified(base, imports) === 'unittest.TestCase') ?? false;
  const pytest = !owner || (owner.field('name')?.text().startsWith('Test') ?? false);
  return { unittest, pytest };
}

function pythonTests(root: SgNode, source: Source): { tests: CodeTarget[]; scopes: SgNode[] } {
  const imports = pythonImports(root);
  const testPath = /(?:^|\/)(?:tests?|test_[^/]+)\/|(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(
    source.path.replaceAll('\\', '/'),
  );
  const pytestContext = testPath || [...imports.values()].some(name => name === 'pytest' || name.startsWith('pytest.'));
  const tests: CodeTarget[] = [],
    scopes: SgNode[] = [];
  for (const node of walk(root)) {
    if (kind(node) !== 'function_definition') continue;
    const enclosing = ancestors(node),
      name = node.field('name')?.text() ?? '';
    if (enclosing.some(parent => kind(parent) === 'function_definition')) continue;
    const owner = enclosing.find(parent => kind(parent) === 'class_definition');
    const { unittest, pytest } = pythonClass(owner, imports);
    const isTest = unittest ? name.startsWith('test') : name.startsWith('test_') && pytestContext && pytest;
    const isFixture = pythonDecorators(node, imports).some(decorator => decorator.name === 'pytest.fixture');
    const isSetup = unittest && ['setUp', 'tearDown', 'setUpClass', 'tearDownClass'].includes(name);
    if (isTest)
      tests.push({
        ...target(node, source.content, unittest ? 'unittest' : 'pytest'),
        excluded: pythonSkipped(node, imports),
      });
    if (isTest || isFixture || isSetup) scopes.push(node);
  }
  return { tests, scopes };
}

function rustTests(root: SgNode, source: Source): { tests: CodeTarget[]; scopes: SgNode[] } {
  const tests: CodeTarget[] = [],
    scopes: SgNode[] = [];
  for (const node of walk(root)) {
    if (kind(node) !== 'function_item' || !node.field('body')) continue;
    const attrs = attributes(node).map(attribute => attribute.namedChildren()[0]?.namedChildren()[0]?.text());
    const framework = attrs.find(name => ['test', 'tokio::test', 'async_std::test'].includes(name ?? ''));
    if (!framework) continue;
    tests.push({
      ...target(node, source.content, framework === 'test' ? 'rust-test' : framework),
      excluded: attrs.includes('ignore') ? 'test_skipped' : undefined,
    });
    scopes.push(node);
  }
  return { tests, scopes };
}

function solidityTests(root: SgNode, source: Source): { tests: CodeTarget[]; scopes: SgNode[] } {
  const testPath = /(?:^|\/)tests?\/|\.t\.sol$/.test(source.path.replaceAll('\\', '/'));
  const forgeBases = new Set(
    root
      .namedChildren()
      .filter(
        node =>
          kind(node) === 'import_directive' &&
          node.namedChildren().some(child => literal(child) === 'forge-std/Test.sol'),
      )
      .map(node => node.field('alias')?.text() ?? 'Test'),
  );
  const tests: CodeTarget[] = [],
    scopes: SgNode[] = [];
  for (const node of walk(root)) {
    if (kind(node) !== 'function_definition' || !isCallable(node, 'solidity')) continue;
    if (!node.field('name')?.text().startsWith('test')) continue;
    if (
      !node.namedChildren().some(child => kind(child) === 'visibility' && ['public', 'external'].includes(child.text()))
    )
      continue;
    const owner = ancestors(node).find(parent => kind(parent) === 'contract_declaration');
    const testBase = owner
      ?.namedChildren()
      .some(child => kind(child) === 'inheritance_specifier' && forgeBases.has(child.namedChildren()[0]?.text() ?? ''));
    if (!owner || (!testPath && !testBase)) continue;
    tests.push(target(node, source.content, 'foundry'));
    scopes.push(node);
  }
  return { tests, scopes };
}

export function collectTargets(root: SgNode, source: Source): { functions: CodeTarget[]; tests: CodeTarget[] } {
  const language = source.language;
  const detected =
    language === 'python'
      ? pythonTests(root, source)
      : language === 'rust'
        ? rustTests(root, source)
        : language === 'solidity'
          ? solidityTests(root, source)
          : javascriptTests(root, source);
  const functions = walk(root)
    .filter(node => isCallable(node, language))
    .map(node => ({
      ...target(node, source.content),
      excluded: detected.scopes.some(
        scope => scope.id() === node.id() || ancestors(node).some(parent => parent.id() === scope.id()),
      )
        ? 'test_implementation'
        : undefined,
    }));
  return { functions, tests: detected.tests };
}
