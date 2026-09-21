import type { Bundle, InferenceTarget, Unit } from './contracts.js';
import { rangeFor } from './ast.js';

/** Project frozen evidence into inference data without file-wide coordinates. */
export function inferenceTarget(bundle: Bundle, unit: Unit, contextRefs: string[]): InferenceTarget {
  return {
    text: unit.text, language: bundle.sources[unit.sourceId]!.language,
    structure: { ...unit.structure, owner: unit.structure.owner ? { kind: unit.structure.owner.kind, name: unit.structure.owner.name } : null },
    contextRefs, contextStatus: unit.context.status, omissions: [...unit.context.omissions],
    occurrences: unit.context.refs.flatMap((ref, i) => {
      const context = bundle.contexts[ref]!;
      const start = unit.range.startUtf16 - context.range.startUtf16;
      const end = unit.range.endUtf16 - context.range.startUtf16;
      return start >= 0 && end <= context.text.length
        ? [{ contextRef: contextRefs[i]!, range: rangeFor(context.text, start, end) }] : [];
    }),
  };
}
