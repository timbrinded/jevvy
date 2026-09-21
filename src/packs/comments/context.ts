import type { SgNode } from '@ast-grep/napi';
import type { Bundle, Config, Context, Language, Range, Source, Structure, Unit } from '../../contracts.ts';
import { EXTRACTION_VERSION, overlaps, parseSource, rangeFor, rangeOf, walk } from '../../ast.ts';
import { identity } from '../../hash.ts';
import { rules } from './languages/index.ts';

type Comment = {
  nodes: SgNode[];
  range: Range;
  syntax: Structure['syntax'];
  style: Structure['documentationStyle'];
  forcedOwner?: SgNode;
  excluded?: string;
};
export interface Extracted {
  units: Unit[];
  contexts: Record<string, Context>;
  excluded: Bundle['excluded'];
  errors: Range[];
}
const kind = (n: SgNode) => String(n.kind());
function ancestors(node: SgNode): SgNode[] {
  const result: SgNode[] = [];
  for (let parent = node.parent(); parent; parent = parent.parent()) result.push(parent);
  return result;
}
function docstringOwner(node: SgNode): SgNode | undefined {
  const expr = node.parent();
  if (!expr || kind(expr) !== 'expression_statement' || expr.namedChildren().length !== 1) return;
  const body = expr.parent();
  if (!body || !['module', 'block'].includes(kind(body))) return;
  const first = body.namedChildren().find(n => kind(n) !== 'comment');
  if (first?.id() !== expr.id()) return;
  const owner = kind(body) === 'module' ? body : body.parent();
  if (!owner || !['module', 'function_definition', 'class_definition'].includes(kind(owner))) return;
  // f-strings and byte literals are expressions, not Python docstrings.
  if (/^[rubf]*[bf][rubf]*["']/i.test(node.text()) || walk(node).some(n => kind(n) === 'interpolation')) return;
  return owner;
}
function form(node: SgNode, language: Language): Pick<Comment, 'syntax' | 'style'> {
  const text = node.text();
  if (language === 'python' && ['string', 'concatenated_string'].includes(kind(node)))
    return { syntax: 'string_literal', style: 'python_docstring' };
  if (kind(node) === 'attribute_item' || kind(node) === 'inner_attribute_item')
    return { syntax: 'doc_attribute', style: 'rustdoc' };
  const syntax = text.startsWith('/*') ? 'block' : 'line';
  if (language === 'rust' && /^(\/\/\/[^/]|\/\/!|\/\*\*[^*]|\/\*!)/s.test(text)) return { syntax, style: 'rustdoc' };
  if (language === 'solidity' && /^(\/\/\/|\/\*\*)/.test(text)) return { syntax, style: 'natspec' };
  if ((language === 'typescript' || language === 'tsx') && text.startsWith('/**')) return { syntax, style: 'jsdoc' };
  return { syntax, style: 'none' };
}
function inventory(root: SgNode, source: Source): Comment[] {
  const language = source.language,
    adapter = rules[language],
    found: Comment[] = [];
  for (const node of walk(root)) {
    if (ancestors(node).some(p => adapter.comments.has(kind(p)))) continue;
    let owner: SgNode | undefined;
    if (!adapter.comments.has(kind(node))) {
      if (language === 'python' && ['string', 'concatenated_string'].includes(kind(node))) owner = docstringOwner(node);
      const docAttribute =
        language === 'rust' &&
        ['attribute_item', 'inner_attribute_item'].includes(kind(node)) &&
        /^#!?\[\s*doc\s*=\s*(?:"|r#*")/.test(node.text());
      if (!owner && !docAttribute) continue;
    }
    const shape = form(node, language);
    let range = rangeOf(node);
    // Rust's line-comment range can include its newline; grouping and source
    // comparisons use the actual visible comment span consistently.
    if (shape.syntax === 'line')
      range = rangeFor(
        source.content,
        range.startUtf16,
        range.endUtf16 - (node.text().match(/[\r\n]+$/)?.[0].length ?? 0),
      );
    const text = source.content.slice(range.startUtf16, range.endUtf16);
    const licence =
      /SPDX-License-Identifier:|@license\b|(?:^|\n)\s*(?:\/\/|#|\/\*+|\*)?\s*Copyright\s+(?:(?:\(c\)|©)\s*)?\d{4}/i.test(
        text,
      );
    const directive =
      /^(?:\/\/|#|\/\*)\s*(?:eslint-|prettier-ignore|@ts-(?:ignore|expect-error|nocheck|check)|type:\s*ignore|noqa\b|ruff:|fmt:|istanbul\s+ignore|c8\s+ignore|sourceMappingURL=|region\b|endregion\b)/i.test(
        text,
      );
    if (licence || directive) {
      const separator = directive ? /\s--\s+/.exec(text) : null;
      if (separator) {
        const proseStart = range.startUtf16 + separator.index + separator[0].length;
        found.push({
          nodes: [node],
          range: rangeFor(source.content, range.startUtf16, proseStart),
          ...shape,
          excluded: 'machine_directive',
        });
        range = rangeFor(source.content, proseStart, range.endUtf16);
      } else {
        found.push({ nodes: [node], range, ...shape, excluded: licence ? 'licence' : 'machine_directive' });
        continue;
      }
    }
    const previous = found.at(-1);
    const gap = previous ? source.content.slice(previous.range.endUtf16, range.startUtf16) : '';
    const sameRustScope =
      language !== 'rust' || previous?.nodes[0]!.text().startsWith('//!') === node.text().startsWith('//!');
    if (
      shape.syntax === 'line' &&
      previous?.syntax === 'line' &&
      previous.style === shape.style &&
      sameRustScope &&
      !previous.excluded &&
      previous.nodes.at(-1)?.parent()?.id() === node.parent()?.id() &&
      /^[\t ]*\r?\n[\t ]*$/.test(gap)
    ) {
      previous.nodes.push(node);
      previous.range = rangeFor(source.content, previous.range.startUtf16, range.endUtf16);
    } else found.push({ nodes: [node], range, ...shape, forcedOwner: owner });
  }
  return found;
}
function ownerFor(comment: Comment, source: Source): { owner?: SgNode; attachment: Structure['attachment'] } {
  const adapter = rules[source.language];
  if (comment.forcedOwner)
    return {
      owner: comment.forcedOwner,
      attachment: { kind: 'syntactic', evidence: 'First string expression in a Python module, class or function body' },
    };
  const first = comment.nodes[0]!,
    last = comment.nodes.at(-1)!;
  // Some grammars include a trailing comment inside the just-closed body.
  const closing = first.prev();
  if (
    closing &&
    kind(closing) === '}' &&
    rangeOf(closing).endLine === comment.range.startLine &&
    /^[\t ]*$/.test(source.content.slice(rangeOf(closing).endUtf16, comment.range.startUtf16))
  ) {
    const body = first.parent(),
      owner = body?.parent();
    if (body && owner && ['statement_block', 'class_body', 'block'].includes(kind(body)))
      return {
        owner,
        attachment: {
          kind: 'adjacency_based',
          evidence: 'Trailing comment after the closing delimiter of its declaration or block',
        },
      };
  }
  if (source.language === 'rust' && /^(\/\/!|\/\*!|#!\[)/.test(first.text())) {
    const owner = ancestors(first).find(
      n => adapter.declarations.has(kind(n)) || adapter.callables.has(kind(n)) || kind(n) === 'source_file',
    );
    return {
      owner,
      attachment: { kind: 'syntactic', evidence: 'Rust inner documentation describes its enclosing item or module' },
    };
  }
  const previous = first.prevAll().find(n => n.isNamed() && !adapter.comments.has(kind(n)));
  if (
    previous &&
    rangeOf(previous).endLine === comment.range.startLine &&
    /^[\t ]*$/.test(source.content.slice(rangeOf(previous).endUtf16, comment.range.startUtf16))
  ) {
    return {
      owner: previous,
      attachment: {
        kind: 'adjacency_based',
        evidence: 'Trailing comment on the same line as the preceding syntax node',
      },
    };
  }
  let next = last.next();
  const wrappers =
    source.language === 'typescript' || source.language === 'tsx'
      ? ['decorator']
      : source.language === 'rust'
        ? ['attribute_item', 'inner_attribute_item']
        : [];
  while (next && (adapter.comments.has(kind(next)) || wrappers.includes(kind(next)))) next = next.next();
  if (
    next?.isNamed() &&
    !['ERROR', 'else_clause', 'elif_clause', 'catch_clause', 'finally_clause'].includes(kind(next))
  ) {
    const between = source.content.slice(rangeOf(last).endUtf16, rangeOf(next).startUtf16);
    const adjacent = /^\s*$/.test(between) && (between.match(/\n/g)?.length ?? 0) <= 1;
    // Attributes/decorators bridge the comment and its declaration; prose alone does not.
    const betweenNodes = last.nextAll().filter(n => rangeOf(n).startUtf16 < rangeOf(next!).startUtf16);
    const attributesOnly =
      betweenNodes.some(n => wrappers.includes(kind(n))) &&
      betweenNodes.every(n => wrappers.includes(kind(n)) || adapter.comments.has(kind(n)));
    if (adjacent || attributesOnly)
      return {
        owner: next,
        attachment: {
          kind: 'adjacency_based',
          evidence: 'Immediately leading comment at the same syntax nesting level',
        },
      };
  }
  return { attachment: { kind: 'unresolved', evidence: 'No unambiguous local syntax or adjacency association' } };
}
export async function extractComments(
  sourceId: string,
  source: Source,
  config: Pick<Config, 'maxContextChars'>,
): Promise<Extracted> {
  const root = await parseSource(source.language, source.content);
  const nodes = walk(root);
  const errors = nodes
    .filter(n => kind(n) === 'ERROR' || (n.range().start.index === n.range().end.index && n.id() !== root.id()))
    .map(rangeOf);
  const contexts: Record<string, Context> = {},
    units: Unit[] = [],
    excluded: Bundle['excluded'] = [];
  for (const comment of inventory(root, source)) {
    const text = source.content.slice(comment.range.startUtf16, comment.range.endUtf16);
    if (comment.excluded) {
      excluded.push({ sourceId, range: comment.range, text, reason: comment.excluded });
      continue;
    }
    const { owner, attachment } = ownerFor(comment, source);
    const ownerRange = owner ? rangeOf(owner) : undefined;
    const refs: string[] = [],
      omissions: string[] = [];
    const add = (range: Range, role: Context['role']) => {
      const contextId = identity('context', { sourceId, range, role });
      contexts[contextId] = { sourceId, range, role, text: source.content.slice(range.startUtf16, range.endUtf16) };
      if (!refs.includes(contextId)) refs.push(contextId);
    };
    let status: Unit['context']['status'] = 'complete_local';
    if (owner && ownerRange) {
      // Small enclosing callables provide the local data/control flow around
      // implementation comments and allow their context to be shared. If that
      // evidence exceeds the budget, do not quietly certify a lone statement.
      const adapter = rules[source.language];
      const callable = adapter.callables.has(kind(owner))
        ? owner
        : ancestors(owner).find(n => adapter.callables.has(kind(n)));
      let wrapped = callable ?? owner;
      while (wrapped.parent() && rules[source.language].wrappers.has(kind(wrapped.parent()!)))
        wrapped = wrapped.parent()!;
      let range = rangeOf(wrapped);
      // Rust attributes and TypeScript method decorators are sibling nodes.
      const siblingWrappers =
        source.language === 'rust'
          ? new Set(['attribute_item'])
          : source.language === 'typescript' || source.language === 'tsx'
            ? new Set(['decorator'])
            : new Set<string>();
      let previous = wrapped.prev();
      while (previous) {
        if (siblingWrappers.has(kind(previous)))
          range = rangeFor(source.content, rangeOf(previous).startUtf16, range.endUtf16);
        else if (!(source.language === 'rust' && adapter.comments.has(kind(previous)))) break;
        previous = previous.prev();
      }
      if (range.endUtf16 - range.startUtf16 <= config.maxContextChars) add(range, 'owner');
      else {
        status = 'partial';
        omissions.push('oversized_owner');
      }
      // Headers preserve enclosing callable/class meaning for statement owners.
      for (const ancestor of ancestors(wrapped)) {
        const adapter = rules[source.language];
        if (!adapter.callables.has(kind(ancestor)) && !adapter.declarations.has(kind(ancestor))) continue;
        const body = ancestor.field('body');
        if (body && rangeOf(body).startUtf16 > rangeOf(ancestor).startUtf16) {
          const header = rangeFor(source.content, rangeOf(ancestor).startUtf16, rangeOf(body).startUtf16);
          if (header.endUtf16 - header.startUtf16 <= 2000) add(header, 'header');
          else {
            status = 'partial';
            omissions.push('oversized_enclosing_header');
          }
        }
      }
      if (
        errors.some(
          e =>
            overlaps(e, range) ||
            (e.startUtf16 === e.endUtf16 && e.startUtf16 >= range.startUtf16 && e.startUtf16 <= range.endUtf16),
        )
      ) {
        status = 'partial';
        omissions.push('parse_error');
      }
    } else {
      status = 'partial';
      omissions.push('ambiguous_attachment');
      // Preserve whole neighbouring lines, and mark this substitute as partial.
      const start = source.content.lastIndexOf('\n', Math.max(0, comment.range.startUtf16 - 300)) + 1;
      const endNewline = source.content.indexOf('\n', comment.range.endUtf16 + 300);
      const end = endNewline < 0 ? source.content.length : endNewline;
      if (end - start <= config.maxContextChars) add(rangeFor(source.content, start, end), 'surroundings');
      else omissions.push('oversized_surroundings');
    }
    if (!refs.length) status = 'unavailable';
    const namingOwner =
      owner &&
      (owner.field('name')
        ? owner
        : ancestors(owner).find(
            n => rules[source.language].callables.has(kind(n)) || rules[source.language].declarations.has(kind(n)),
          ));
    let declaration = owner;
    while (declaration && rules[source.language].wrappers.has(kind(declaration)))
      declaration = declaration.namedChildren().find(n => !['decorator', 'comment'].includes(kind(n)));
    const name =
      namingOwner?.field('name')?.text() ??
      declaration?.field('name')?.text() ??
      (declaration && ['lexical_declaration', 'variable_declaration'].includes(kind(declaration))
        ? declaration
            .namedChildren()
            .find(n => kind(n) === 'variable_declarator')
            ?.field('name')
            ?.text()
        : undefined) ??
      null;
    const structure: Structure = {
      syntax: comment.syntax,
      documentationStyle: comment.style,
      tags: [...new Set([...text.matchAll(/@([a-zA-Z][\w-]*)/g)].map(m => m[1]!))],
      owner: owner && ownerRange ? { kind: kind(owner), name, range: ownerRange } : null,
      attachment,
    };
    units.push({
      id: identity('unit', { sourceId, range: comment.range, extraction: EXTRACTION_VERSION }),
      sourceId,
      range: comment.range,
      text,
      structure,
      change: 'unchanged',
      context: { status, refs, omissions },
      labels: {},
    });
  }
  return { units, contexts, excluded, errors };
}
