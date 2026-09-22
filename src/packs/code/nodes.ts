import type { SgNode } from '@ast-grep/napi';
import type { Range } from '../../contracts.ts';
import { rangeFor, rangeOf } from '../../ast.ts';

export interface CodeTarget {
  node: SgNode;
  range: Range;
  syntax: string;
  name: string | null;
  framework: string | null;
  excluded?: string;
  requiredContext?: Range[];
}

export const kind = (node: SgNode): string => String(node.kind());

export function ancestors(node: SgNode): SgNode[] {
  const result: SgNode[] = [];
  for (let parent = node.parent(); parent; parent = parent.parent()) result.push(parent);
  return result;
}

export function literal(node: SgNode | null | undefined): string | undefined {
  if (!node || !['string', 'string_literal', 'template_string'].includes(kind(node))) return;
  if (node.namedChildren().some(child => ['template_substitution', 'interpolation'].includes(kind(child)))) return;
  return node.text().slice(1, -1);
}

export function attributes(node: SgNode): SgNode[] {
  const result: SgNode[] = [];
  for (let sibling = node.prev(); sibling; sibling = sibling.prev()) {
    if (['attribute_item', 'decorator'].includes(kind(sibling))) result.unshift(sibling);
    else if (!['line_comment', 'block_comment', 'comment'].includes(kind(sibling))) break;
  }
  return result;
}

export function wrapped(node: SgNode): SgNode {
  let result = node;
  const parent = result.parent();
  if (parent && ['variable_declarator', 'public_field_definition', 'pair', 'let_declaration'].includes(kind(parent))) {
    result = parent;
    const declaration = result.parent();
    if (
      declaration &&
      ['lexical_declaration', 'variable_declaration'].includes(kind(declaration)) &&
      declaration.namedChildren().length === 1
    )
      result = declaration;
  }
  while (result.parent() && ['export_statement', 'decorated_definition'].includes(kind(result.parent()!)))
    result = result.parent()!;
  return result;
}

export function target(node: SgNode, source: string, framework: string | null = null): CodeTarget {
  const wrapper = wrapped(node);
  const preceding = attributes(wrapper);
  const range = rangeFor(
    source,
    preceding[0] ? rangeOf(preceding[0]).startUtf16 : rangeOf(wrapper).startUtf16,
    rangeOf(wrapper).endUtf16,
  );
  const parent = node.parent();
  const name =
    node.field('name')?.text() ??
    (parent && ['variable_declarator', 'public_field_definition', 'pair', 'let_declaration'].includes(kind(parent))
      ? (parent.field('name') ?? parent.field('key') ?? parent.field('pattern'))?.text()
      : undefined) ??
    null;
  return { node: wrapper, range, syntax: kind(node), name, framework };
}
