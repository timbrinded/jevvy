import type { SgNode } from '@ast-grep/napi';
import type { CodeUnit, Config, Context, Range, Source } from '../../contracts.ts';
import type { Extracted } from '../types.ts';
import { EXTRACTION_VERSION, parseSource, rangeFor, rangeOf, walk } from '../../ast.ts';
import { identity } from '../../hash.ts';
import { ancestors, kind, type CodeTarget } from './nodes.ts';
import { collectTargets } from './targets.ts';

function supplementalRanges(root: SgNode, selected: CodeTarget, source: Source): Range[] {
  const imports = root
    .namedChildren()
    .filter(node =>
      ['import_statement', 'import_from_statement', 'import_directive', 'use_declaration'].includes(kind(node)),
    );
  const ranges = imports.map(rangeOf);
  for (const owner of ancestors(selected.node)) {
    const body = owner.field('body');
    if (body && rangeOf(body).startUtf16 > rangeOf(owner).startUtf16)
      ranges.push(rangeFor(source.content, rangeOf(owner).startUtf16, rangeOf(body).startUtf16));
  }
  return ranges;
}

function contextFor(
  root: SgNode,
  sourceId: string,
  source: Source,
  selected: CodeTarget,
  limits: { maxContextChars: number; errors: Range[] },
) {
  const { maxContextChars, errors } = limits;
  const contexts: Record<string, Context> = {},
    refs: string[] = [],
    omissions: string[] = [];
  let remaining = maxContextChars;
  const add = (range: Range, role: Context['role']) => {
    const length = range.endUtf16 - range.startUtf16;
    if (length > remaining) return false;
    const id = identity('context', { sourceId, range, role });
    if (contexts[id]) return true;
    contexts[id] = { sourceId, range, role, text: source.content.slice(range.startUtf16, range.endUtf16) };
    refs.push(id);
    remaining -= length;
    return true;
  };
  let status: CodeUnit['context']['status'] = 'complete_local';
  if (source.content.length <= maxContextChars) add(rangeFor(source.content, 0, source.content.length), 'owner');
  else if (add(selected.range, 'owner')) {
    status = 'partial';
    omissions.push('same_file_context_omitted');
    for (const range of selected.requiredContext ?? []) {
      if (!add(range, 'owner')) {
        status = 'unavailable';
        omissions.push('oversized_target');
      }
    }
    for (const range of supplementalRanges(root, selected, source)) add(range, 'header');
  } else {
    status = 'unavailable';
    omissions.push('oversized_target', 'same_file_context_omitted');
  }
  if (errors.length) {
    status = 'unavailable';
    omissions.push('parse_error');
  }
  return { contexts, context: { status, refs, omissions } };
}

async function extractCode(
  pack: 'functions' | 'tests',
  sourceId: string,
  source: Source,
  config: Pick<Config, 'maxContextChars'>,
): Promise<Extracted> {
  if (source.language === 'json' || source.language === 'text')
    return { units: [], contexts: {}, excluded: [], errors: [] };
  const root = await parseSource(source.language, source.content);
  const errors = walk(root)
    .filter(
      node =>
        kind(node) === 'ERROR' || (node.range().start.index === node.range().end.index && node.id() !== root.id()),
    )
    .map(rangeOf);
  const contexts: Record<string, Context> = {},
    units: CodeUnit[] = [],
    excluded: Extracted['excluded'] = [];
  const targets = collectTargets(root, source)[pack];
  for (const selected of targets) {
    const text = source.content.slice(selected.range.startUtf16, selected.range.endUtf16);
    if (selected.excluded) {
      excluded.push({ sourceId, range: selected.range, text, reason: selected.excluded });
      continue;
    }
    const contextual = contextFor(root, sourceId, source, selected, {
      maxContextChars: config.maxContextChars,
      errors,
    });
    Object.assign(contexts, contextual.contexts);
    units.push({
      id: identity('unit', { pack, sourceId, range: selected.range, extraction: EXTRACTION_VERSION }),
      sourceId,
      range: selected.range,
      text,
      structure: {
        kind: pack === 'functions' ? 'function' : 'test',
        syntax: selected.syntax,
        name: selected.name,
        owner: { kind: kind(selected.node), name: selected.name, range: selected.range },
        framework: selected.framework,
      },
      change: 'unchanged',
      context: contextual.context,
      labels: {},
    });
  }
  return { units, contexts, excluded, errors };
}

export function extractFunctions(
  sourceId: string,
  source: Source,
  config: Pick<Config, 'maxContextChars'>,
): Promise<Extracted> {
  return extractCode('functions', sourceId, source, config);
}

export function extractTests(
  sourceId: string,
  source: Source,
  config: Pick<Config, 'maxContextChars'>,
): Promise<Extracted> {
  return extractCode('tests', sourceId, source, config);
}
