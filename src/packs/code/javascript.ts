import type { SgNode } from '@ast-grep/napi';
import type { Source } from '../../contracts.ts';
import { rangeOf, walk } from '../../ast.ts';
import { ancestors, kind, literal, target, type CodeTarget } from './nodes.ts';

type RegistrationKind = 'test' | 'suite' | 'hook';
interface Binding {
  node: SgNode;
  framework: string;
  category: RegistrationKind | 'namespace';
}
type Bindings = Map<string, Binding[]>;
interface Callee {
  base: string;
  parts: string[];
  conditions: SgNode[];
}
interface Registration {
  call: SgNode;
  callback?: SgNode;
  category: RegistrationKind;
  framework: string;
  excluded?: string;
}
const frameworks = new Set(['node:test', 'vitest', '@jest/globals', 'bun:test']);
const testNames = new Set(['test', 'it']);
const suiteNames = new Set(['describe', 'suite']);
const hookNames = new Set(['before', 'after', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const callableKinds = new Set(['function_declaration', 'function_expression', 'arrow_function', 'generator_function']);
const modifiers = new Set(['only', 'skip', 'todo', 'each', 'concurrent', 'sequential', 'fails', 'skipIf', 'runIf']);

function category(name: string): RegistrationKind | undefined {
  if (testNames.has(name)) return 'test';
  if (suiteNames.has(name)) return 'suite';
  if (hookNames.has(name)) return 'hook';
}

function callee(node: SgNode | null | undefined): Callee | undefined {
  if (!node) return;
  if (kind(node) === 'identifier') return { base: node.text(), parts: [], conditions: [] };
  if (kind(node) === 'member_expression') {
    const prefix = callee(node.field('object'));
    const property = node.field('property');
    if (prefix && property) return { ...prefix, parts: [...prefix.parts, property.text()] };
  }
  if (kind(node) === 'call_expression') {
    const prefix = callee(node.field('function'));
    if (!prefix) return;
    const modifier = prefix.parts.at(-1);
    if (!['each', 'skipIf', 'runIf'].includes(modifier ?? '')) return;
    const condition = node.field('arguments')?.namedChildren()[0];
    return { ...prefix, conditions: [...prefix.conditions, ...(condition && modifier !== 'each' ? [condition] : [])] };
  }
}

function addBinding(bindings: Bindings, name: string, binding: Binding): void {
  const existing = bindings.get(name) ?? [];
  existing.push(binding);
  bindings.set(name, existing);
}

function addImported(bindings: Bindings, name: string, original: string, node: SgNode, framework: string) {
  const importedCategory = category(original);
  if (importedCategory) addBinding(bindings, name, { node, framework, category: importedCategory });
}

function importBindings(root: SgNode): Bindings {
  const bindings: Bindings = new Map();
  for (const statement of root.namedChildren()) {
    if (kind(statement) !== 'import_statement') continue;
    const framework = literal(statement.field('source'));
    if (!framework || !frameworks.has(framework)) continue;
    const clause = statement.namedChildren().find(child => kind(child) === 'import_clause');
    if (!clause) continue;
    for (const node of walk(clause)) {
      if (kind(node) === 'import_specifier') {
        const original = node.field('name')?.text();
        if (original) addImported(bindings, node.field('alias')?.text() ?? original, original, node, framework);
      } else if (kind(node) === 'namespace_import') {
        const name = node.namedChildren()[0]?.text();
        if (name) addBinding(bindings, name, { node, framework, category: 'namespace' });
      } else if (kind(node) === 'identifier' && node.parent()?.id() === clause.id() && framework === 'node:test') {
        addBinding(bindings, node.text(), { node, framework, category: 'test' });
      }
    }
  }
  return bindings;
}

function requireBindings(root: SgNode, bindings: Bindings): void {
  for (const node of walk(root)) {
    if (kind(node) !== 'variable_declarator') continue;
    const value = node.field('value');
    if (kind(value ?? node) !== 'call_expression' || value?.field('function')?.text() !== 'require') continue;
    const framework = literal(value.field('arguments')?.namedChildren()[0]);
    const name = node.field('name');
    if (!framework || !frameworks.has(framework) || !name) continue;
    if (kind(name) === 'identifier')
      addBinding(bindings, name.text(), {
        node,
        framework,
        category: framework === 'node:test' ? 'test' : 'namespace',
      });
    else
      for (const binding of name.namedChildren()) {
        if (kind(binding) === 'pair_pattern') {
          const original = binding.field('key')?.text(),
            alias = binding.field('value')?.text();
          if (original && alias) addImported(bindings, alias, original, node, framework);
        } else addImported(bindings, binding.text(), binding.text(), node, framework);
      }
  }
}

function declaredNames(node: SgNode): string[] {
  const name = node.field('name');
  if (name && ['variable_declarator', 'function_declaration', 'class_declaration'].includes(kind(node))) {
    if (kind(name) === 'identifier') return [name.text()];
    return walk(name)
      .filter(child => ['identifier', 'shorthand_property_identifier_pattern'].includes(kind(child)))
      .map(child => child.text());
  }
  if (kind(node) === 'import_statement') {
    const clause = node.namedChildren().find(child => kind(child) === 'import_clause');
    return clause
      ? walk(clause)
          .filter(child => kind(child) === 'identifier' && kind(child.parent()!) !== 'import_specifier')
          .map(child => child.text())
          .concat(
            walk(clause)
              .filter(child => kind(child) === 'import_specifier')
              .map(child => (child.field('alias') ?? child.field('name'))!.text()),
          )
      : [];
  }
  return [];
}

function shadowed(name: string, call: SgNode, binding: Binding | undefined): boolean {
  const enclosing = ancestors(call);
  for (const scope of enclosing) {
    const parameters = scope.field('parameters') ?? scope.field('parameter');
    if (
      parameters &&
      walk(parameters).some(
        node => ['identifier', 'shorthand_property_identifier_pattern'].includes(kind(node)) && node.text() === name,
      )
    )
      return !binding || !walk(parameters).some(node => node.id() === binding.node.id());
    if (!['program', 'statement_block'].includes(kind(scope))) continue;
    for (const statement of scope.namedChildren()) {
      const declarations = ['lexical_declaration', 'variable_declaration', 'export_statement'].includes(kind(statement))
        ? statement.namedChildren()
        : [statement];
      for (const declaration of declarations) {
        if (!declaredNames(declaration).includes(name)) continue;
        if (
          binding &&
          (declaration.id() === binding.node.id() ||
            ancestors(binding.node).some(parent => parent.id() === declaration.id()))
        )
          return false;
        return true;
      }
    }
  }
  return false;
}

function localCallable(name: string, call: SgNode, nodes: SgNode[]): SgNode | undefined {
  const candidates = nodes.filter(
    node => ['function_declaration', 'variable_declarator'].includes(kind(node)) && node.field('name')?.text() === name,
  );
  for (const scope of ancestors(call)) {
    const parameters = scope.field('parameters') ?? scope.field('parameter');
    if (
      parameters &&
      walk(parameters).some(
        node => ['identifier', 'shorthand_property_identifier_pattern'].includes(kind(node)) && node.text() === name,
      )
    )
      return;
    if (!['statement_block', 'program'].includes(kind(scope))) continue;
    const declared = candidates.find(
      node =>
        ancestors(node)
          .find(parent => ['statement_block', 'program'].includes(kind(parent)))
          ?.id() === scope.id(),
    );
    if (!declared) continue;
    const value = kind(declared) === 'variable_declarator' ? declared.field('value') : declared;
    return value && callableKinds.has(kind(value)) ? value : undefined;
  }
}

function callbackFor(call: SgNode, nodes: SgNode[]): SgNode | undefined {
  const last = call.field('arguments')?.namedChildren().at(-1);
  if (!last) return;
  if (callableKinds.has(kind(last))) return last;
  return kind(last) === 'identifier' ? localCallable(last.text(), call, nodes) : undefined;
}

function disabledOptions(call: SgNode): string | undefined {
  const options = call
    .field('arguments')
    ?.namedChildren()
    .find(node => kind(node) === 'object');
  for (const pair of options?.namedChildren() ?? []) {
    const key = literal(pair.field('key')) ?? pair.field('key')?.text(),
      value = pair.field('value')?.text();
    if ((key === 'skip' || key === 'todo') && value !== 'false') return key === 'todo' ? 'test_todo' : 'test_skipped';
  }
}

function disabled(call: SgNode, parsed: Callee): string | undefined {
  if (parsed.parts.includes('todo')) return 'test_todo';
  if (parsed.parts.includes('skip')) return 'test_skipped';
  if (parsed.parts.includes('skipIf') || parsed.parts.includes('runIf')) {
    const condition = parsed.conditions[0]?.text();
    const enabled = parsed.parts.includes('skipIf') ? condition === 'false' : condition === 'true';
    if (!enabled) return condition === 'true' || condition === 'false' ? 'test_skipped' : 'conditional_test';
  }
  return disabledOptions(call);
}

function resolveRegistration(parsed: Callee, binding: Binding | undefined, conventionalPath: boolean) {
  const parts = [...parsed.parts];
  let registrationCategory = binding?.category;
  if (registrationCategory === 'namespace' || (registrationCategory === 'test' && parts[0] && category(parts[0])))
    registrationCategory = category(parts.shift() ?? '');
  if (
    !registrationCategory &&
    conventionalPath &&
    ['test', 'it', 'describe', 'suite', ...hookNames].includes(parsed.base)
  )
    registrationCategory = category(parsed.base);
  if (!registrationCategory || parts.some(part => !modifiers.has(part))) return;
  return { category: registrationCategory, framework: binding?.framework ?? 'jest/vitest' };
}

function subtestBinding(call: SgNode, parsed: Callee, registrations: Registration[]): Binding | undefined {
  if (parsed.parts[0] !== 'test') return;
  for (const owner of ancestors(call)) {
    const registration = registrations.find(
      candidate => candidate.framework === 'node:test' && candidate.callback?.id() === owner.id(),
    );
    if (!registration) {
      const parameters = owner.field('parameters') ?? owner.field('parameter');
      if (parameters && walk(parameters).some(node => kind(node) === 'identifier' && node.text() === parsed.base))
        return;
      continue;
    }
    const parameter = owner.field('parameter') ?? owner.field('parameters')?.namedChildren()[0];
    const name = parameter && walk(parameter).find(node => kind(node) === 'identifier');
    if (name?.text() === parsed.base) return { node: name, framework: 'node:test', category: 'namespace' };
    return;
  }
}

function nearestBinding(name: string, call: SgNode, bindings: Bindings): Binding | undefined {
  const candidates = bindings.get(name) ?? [];
  for (const scope of ancestors(call)) {
    if (!['program', 'statement_block'].includes(kind(scope))) continue;
    const binding = candidates.find(
      candidate =>
        ancestors(candidate.node)
          .find(node => ['program', 'statement_block'].includes(kind(node)))
          ?.id() === scope.id(),
    );
    if (binding) return binding;
  }
}

function skippedParents(registrations: Registration[]): Set<Registration> {
  const excluded = new Set<Registration>();
  const inactive = (registration: Registration, visiting: Set<Registration>): boolean => {
    if (registration.excluded) return true;
    if (visiting.has(registration)) return false;
    const next = new Set(visiting).add(registration);
    for (const owner of ancestors(registration.call)) {
      const parents = registrations.filter(parent => parent.callback?.id() === owner.id());
      if (parents.length) return parents.every(parent => inactive(parent, next));
    }
    return false;
  };
  for (const registration of registrations) {
    if (!registration.excluded && inactive(registration, new Set())) excluded.add(registration);
  }
  return excluded;
}

function discoverRegistrations(nodes: SgNode[], bindings: Bindings, conventionalPath: boolean): Registration[] {
  const registrations: Registration[] = [];
  const selected = new Set<number>();
  let previousSize = -1;
  // A named Node callback can appear before the registration that gives its
  // parameter TestContext meaning. Resolve that relationship before selecting
  // nested calls, regardless of declaration order.
  while (registrations.length !== previousSize) {
    previousSize = registrations.length;
    for (const call of nodes) {
      if (kind(call) !== 'call_expression' || selected.has(call.id())) continue;
      const parsed = callee(call.field('function'));
      if (!parsed) continue;
      const subtest = subtestBinding(call, parsed, registrations);
      const binding = subtest ?? nearestBinding(parsed.base, call, bindings);
      if (shadowed(parsed.base, call, binding)) continue;
      const resolved = resolveRegistration(parsed, binding, conventionalPath);
      if (!resolved) continue;
      const callback = callbackFor(call, nodes);
      if (!callback && ['each', 'skipIf', 'runIf'].includes(parsed.parts.at(-1) ?? '')) continue;
      registrations.push({ call, callback, ...resolved, excluded: disabled(call, parsed) });
      selected.add(call.id());
    }
  }
  return registrations.sort((left, right) => rangeOf(left.call).startUtf16 - rangeOf(right.call).startUtf16);
}

export function javascriptTests(root: SgNode, source: Source): { tests: CodeTarget[]; scopes: SgNode[] } {
  const nodes = walk(root),
    bindings = importBindings(root);
  requireBindings(root, bindings);
  const conventionalPath = /(?:^|\/)__tests__\/|(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
    source.path.replaceAll('\\', '/'),
  );
  const registrations = discoverRegistrations(nodes, bindings, conventionalPath);
  const inheritedSkip = skippedParents(registrations);
  const tests = registrations
    .filter(registration => registration.category === 'test')
    .map(registration => ({
      node: registration.call,
      range: rangeOf(registration.call),
      syntax: 'test_registration',
      name: literal(registration.call.field('arguments')?.namedChildren()[0]) ?? null,
      framework: registration.framework,
      excluded:
        registration.excluded ??
        (inheritedSkip.has(registration) ? 'test_skipped_by_parent' : undefined) ??
        (!registration.callback ? 'unresolved_test_body' : undefined),
      requiredContext:
        registration.callback &&
        !ancestors(registration.callback).some(parent => parent.id() === registration.call.id())
          ? [target(registration.callback, source.content).range]
          : [],
    }));
  return {
    tests,
    scopes: registrations.flatMap(registration => (registration.callback ? [registration.callback] : [])),
  };
}
