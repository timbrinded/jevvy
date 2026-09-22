import { Compile } from 'typebox/compile';
import { Type, type TSchema } from 'typebox';
import {
  AnswerSchema,
  BundleSchema,
  ConfigSchema,
  ScanInputSchema,
  ResultsInputSchema,
  RequestSchema,
  type Answer,
  type Bundle,
  type Execution,
  type Question,
  type Request,
  type ScanInput,
  type Unit,
  type Context,
} from './contracts.ts';
import { canonical, hash } from './hash.ts';
import { inferenceTarget, requestTargets } from './request.ts';
import { hasRequiredContext, questionFor } from './packs/questions.ts';

export const validators = {
  answer: Compile(AnswerSchema),
  bundle: Compile(BundleSchema),
  config: Compile(ConfigSchema),
  scan: Compile(ScanInputSchema),
  results: Compile(ResultsInputSchema),
  request: Compile(RequestSchema),
};
export function checked<S extends TSchema>(schema: S, value: unknown, name = 'Input'): Type.Static<S> {
  const validator = Compile(schema);
  if (!validator.Check(value)) throw new Error(`${name}: ${JSON.stringify(validator.Errors(value)).slice(0, 2000)}`);
  return value as Type.Static<S>;
}
export function validateInput(value: unknown): ScanInput {
  if (!validators.scan.Check(value)) throw new Error('Invalid scan arguments');
  if (value.mode === 'files' && (!value.files?.length || value.base || value.head))
    throw new Error('File mode requires files and forbids base/head');
  if (value.mode === 'branch' && (!value.base || value.files))
    throw new Error('Branch mode requires base and forbids files');
  if (value.mode === 'working' && (value.files || value.base || value.head))
    throw new Error('Working mode forbids files/base/head');
  return value;
}
function sameKeys(a: object, b: object): boolean {
  return canonical(Object.keys(a).sort()) === canonical(Object.keys(b).sort());
}
const finite = (v: number) => Number.isFinite(v);
// The service exposes values rounded to hundredths. Each returned probability
// and score can differ from its unrounded value by 0.005. Never alter the answer.
const ROUNDING_HALF_UNIT = 0.005;
export function answerError(value: unknown, question: Question): string | undefined {
  if (!validators.answer.Check(value)) return 'Answer shape is invalid';
  const a = value as Answer;
  if (a.type !== question.type) return 'Answer primitive does not match question';
  if (a.type === 'noul') return finite(a.noul) ? undefined : 'Non-finite probability';
  const probabilities = a.probabilities;
  const expected =
    question.type === 'score' ? Object.fromEntries(question.criteria.map((v, i) => [String(i), v])) : question.criteria;
  if (!sameKeys(probabilities, expected)) return 'Probability options do not match question';
  const values = Object.values(probabilities);
  if (!values.every(finite) || !finite(a.confidence)) return 'Non-finite probability/confidence';
  if (Math.abs(values.reduce((s, p) => s + p, 0) - 1) > values.length * ROUNDING_HALF_UNIT + 1e-9)
    return 'Probability sum exceeds rounding tolerance';
  if (a.type === 'choice') {
    if (!Object.hasOwn(probabilities, a.choice) || probabilities[a.choice]! < Math.max(...values) - 1e-9)
      return 'Choice is not a maximum-probability option';
  } else {
    if (!finite(a.score) || a.score > values.length - 1) return 'Score outside rubric range';
    if (canonical(a.legend) !== canonical(expected)) return 'Score legend does not match question';
    const weighted = Object.entries(probabilities).reduce((s, [i, p]) => s + Number(i) * p, 0);
    const tolerance = ROUNDING_HALF_UNIT * (1 + (values.length * (values.length - 1)) / 2);
    if (Math.abs(a.score - weighted) > tolerance + 1e-9) return 'Score inconsistent with probabilities';
  }
}

export function validateResponse(
  value: unknown,
  execution: Execution,
): {
  answers: Record<string, Answer>;
  errors: Record<string, string>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
} {
  if (!value || typeof value !== 'object') throw new Error('Malformed provider envelope');
  const envelope = value as Record<string, unknown>;
  if (
    typeof envelope.model !== 'string' ||
    !envelope.model ||
    !envelope.answers ||
    typeof envelope.answers !== 'object' ||
    Array.isArray(envelope.answers)
  )
    throw new Error('Malformed provider envelope');
  const usage = envelope.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
  if (
    !usage ||
    ![usage.input_tokens, usage.output_tokens].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error('Malformed provider usage');
  const rawAnswers = envelope.answers as Record<string, unknown>;
  if (!sameKeys(execution.bindings, execution.request.questions)) throw new Error('Untrustworthy request manifest');
  if (Object.keys(rawAnswers).some(k => !Object.hasOwn(execution.bindings, k)))
    throw new Error('Unexpected provider question ID; packet mapping cannot be trusted');
  const answers: Record<string, Answer> = {},
    errors: Record<string, string> = {};
  for (const [id, question] of Object.entries(execution.request.questions)) {
    const error = Object.hasOwn(rawAnswers, id) ? answerError(rawAnswers[id], question) : 'Missing answer';
    if (error) errors[id] = error;
    else answers[id] = rawAnswers[id] as Answer;
  }
  return {
    answers,
    errors,
    model: envelope.model,
    usage: { input_tokens: usage.input_tokens as number, output_tokens: usage.output_tokens as number },
  };
}
export function requestHash(request: Request): string {
  return hash(request);
}

function fail(message: string): never {
  throw new Error(`Bundle invariant: ${message}`);
}

function validateExcerpt(b: Bundle, { sourceId, range, text }: Pick<Context, 'sourceId' | 'range' | 'text'>): void {
  const source = b.sources[sourceId];
  if (!source || range.startUtf16 > range.endUtf16 || range.endUtf16 > source.content.length)
    fail('invalid source/range');
  if (source!.content.slice(range.startUtf16, range.endUtf16) !== text) fail('excerpt differs from frozen source');
  if (
    source!.content.slice(0, range.startUtf16).split('\n').length !== range.startLine ||
    source!.content.slice(0, range.endUtf16).split('\n').length !== range.endLine
  )
    fail('display lines differ from range');
}

function validateSources(b: Bundle): Map<string, Unit> {
  for (const s of Object.values(b.sources)) if (hash(s.content) !== s.contentHash) fail('source hash');
  for (const c of Object.values(b.contexts)) validateExcerpt(b, c);
  const units = new Map(b.units.map(u => [u.id, u]));
  if (units.size !== b.units.length) fail('duplicate unit ID');
  for (const u of b.units) {
    if (!b.sources[u.sourceId]) fail('unit source reference');
    if (
      b.pack.id === 'comments'
        ? 'kind' in u.structure
        : !('kind' in u.structure) || u.structure.kind !== (b.pack.id === 'functions' ? 'function' : 'test')
    )
      fail('unit structure differs from pack');
    for (const ref of u.context.refs) {
      const context = b.contexts[ref];
      if (!context) fail('unit context reference');
      if (
        context.sourceId !== u.sourceId &&
        (b.schemaVersion !== '2.0.0' ||
          context.role !== 'supporting_file' ||
          !b.run.scope.contextFiles?.includes(b.sources[context.sourceId]!.path))
      )
        fail('cross-file evidence was not explicitly selected');
      if (b.sources[context.sourceId]!.snapshot !== b.sources[u.sourceId]!.snapshot)
        fail('context snapshot differs from target');
    }
  }
  return units;
}

function validateTarget(b: Bundle, e: Execution, binding: Execution['bindings'][string], unit: Unit): string[] {
  const currentRequest = 'formatVersion' in e.request.state;
  if (canonical(binding.contextRefs) !== canonical(unit.context.refs)) fail('binding context differs from unit');
  const target = requestTargets(e.request)[binding.targetId] ?? fail('missing request target');
  const expectedTarget = currentRequest
    ? inferenceTarget(b, unit, target.contextRefs)
    : { text: unit.text, structure: unit.structure, contextRefs: target.contextRefs };
  if (canonical(target) !== canonical(expectedTarget)) fail('request target differs from unit');
  if (target.contextRefs.length !== binding.contextRefs.length) fail('request context mapping');
  for (let i = 0; i < target.contextRefs.length; i++) {
    const sent = e.request.state.contexts[target.contextRefs[i]!];
    const frozen = b.contexts[binding.contextRefs[i]!];
    if (!sent || !frozen || sent.text !== frozen.text || sent.role !== frozen.role)
      fail('request evidence differs from frozen context');
    if ('targets' in e.request.state && (!('path' in sent) || sent.path !== b.sources[frozen.sourceId]!.path))
      fail('request supporting path differs from frozen source');
  }
  return target.contextRefs;
}

function validateBindings(
  b: Bundle,
  e: Execution,
  packetId: string,
  { units, bound }: { units: Map<string, Unit>; bound: Set<string> },
): void {
  const currentRequest = 'formatVersion' in e.request.state;
  for (const [questionId, binding] of Object.entries(e.bindings)) {
    const unit = units.get(binding.unitId);
    if (!unit || !Object.hasOwn(b.definitions, binding.labelId)) fail('binding references missing unit/label');
    const key = `${binding.unitId}/${binding.labelId}`;
    if (bound.has(key)) fail('duplicate binding');
    bound.add(key);
    const contextRefs = validateTarget(b, e, binding, unit!);
    if (
      canonical(e.request.questions[questionId]) !==
      canonical(
        questionFor(
          b.definitions[binding.labelId]!,
          binding.targetId,
          currentRequest ? contextRefs : undefined,
          'targets' in e.request.state,
        ),
      )
    )
      fail('request question differs from bound label definition');
    const label = unit!.labels[binding.labelId];
    if (label?.status === 'ok') {
      if (label.packetId !== packetId) fail('label routed to wrong packet');
      const error = answerError(label.answer, e.request.questions[questionId]!);
      if (error) fail(error);
      if (!hasRequiredContext(b, unit!, b.definitions[binding.labelId]!))
        fail('evaluated label without required context');
    }
  }
}

function validateExecutions(b: Bundle, units: Map<string, Unit>): Set<string> {
  const bound = new Set<string>();
  for (const [packetId, e] of Object.entries(b.executions)) {
    const format = 'formatVersion' in e.request.state ? e.request.state.formatVersion : '1';
    const expected = b.schemaVersion === '1.0.0' ? '1' : b.pack.id === 'comments' ? '2' : '3';
    if (format !== expected) fail('request format differs from bundle version');
    if ('packId' in e.request.state && e.request.state.packId !== b.pack.id) fail('request pack differs from bundle');
    if (requestHash(e.request) !== e.requestHash || !sameKeys(e.bindings, e.request.questions))
      fail('request hash or manifest mismatch');
    const targets = new Set(Object.values(e.bindings).map(binding => binding.targetId));
    if (canonical([...targets].sort()) !== canonical(Object.keys(requestTargets(e.request)).sort()))
      fail('unbound request target');
    const contextKeys = new Set(Object.values(requestTargets(e.request)).flatMap(target => target.contextRefs));
    if (canonical([...contextKeys].sort()) !== canonical(Object.keys(e.request.state.contexts).sort()))
      fail('unreferenced request context');
    validateBindings(b, e, packetId, { units, bound });
    if (
      e.status === 'ok' &&
      Object.values(e.bindings).some(binding => units.get(binding.unitId)!.labels[binding.labelId]?.status !== 'ok')
    )
      fail('successful execution has missing labels');
    if (
      b.run.mode === 'live' &&
      ['ok', 'partial'].includes(e.status) &&
      (!e.model || !e.usage || e.origin === 'synthetic')
    )
      fail('live execution lacks provider provenance');
  }
  return bound;
}

function validateUnitLabels(b: Bundle, bound: Set<string>): Bundle['coverage']['labels'] {
  const labels = { ok: 0, not_applicable: 0, not_evaluated: 0, error: 0, cancelled: 0 };
  for (const u of b.units) {
    validateExcerpt(b, u);
    if (!sameKeys(u.labels, b.definitions)) fail('unit label completeness');
    if (u.context.status === 'complete_local' && (!u.context.refs.length || u.context.omissions.length))
      fail('incomplete local context');
    for (const [labelId, l] of Object.entries(u.labels)) {
      labels[l.status]++;
      if (l.status === 'ok' && (!b.executions[l.packetId] || !bound.has(`${u.id}/${labelId}`)))
        fail('unbound evaluated label');
      if (l.status === 'not_evaluated' && l.reason === 'planned' && !bound.has(`${u.id}/${labelId}`))
        fail('planned label lacks a request binding');
      if (b.run.mode === 'dry_run' && l.status === 'ok') fail('dry-run has invented answers');
    }
  }
  return labels;
}

function validateCoverage(b: Bundle, labels: Bundle['coverage']['labels']): void {
  if (canonical(labels) !== canonical(b.coverage.labels)) fail('label coverage');
  if (
    b.coverage.units.selected !== b.units.length ||
    b.coverage.units.excluded !== b.excluded.length ||
    b.coverage.units.removed !== b.removed.length
  )
    fail('unit coverage');
  if (b.coverage.cachedPackets !== Object.values(b.executions).filter(e => e.origin === 'cache').length)
    fail('cache coverage');
  const resolved = [...new Set(Object.values(b.executions).flatMap(e => (e.model ? [e.model] : [])))];
  if (b.run.resolvedModel !== (resolved.length === 1 ? resolved[0] : null)) fail('resolved model summary');
  if (
    b.run.status === 'completed' &&
    (labels.error ||
      labels.cancelled ||
      b.coverage.files.some(f => ['parse_error', 'unreadable', 'cancelled'].includes(f.status)))
  )
    fail('completed run has execution failures');
}

export function validateBundle(value: unknown): Bundle {
  if (!validators.bundle.Check(value))
    throw new Error(`Invalid bundle shape: ${JSON.stringify(validators.bundle.Errors(value)).slice(0, 1500)}`);
  const b = value;
  if (b.kind !== `jevvy.${b.pack.id}.bundle`) fail('bundle kind differs from pack');
  if (b.schemaVersion !== '2.0.0' && b.pack.id !== 'comments') fail('legacy bundle cannot contain a code pack');
  if (hash(b.definitions) !== b.pack.definitionHash) fail('definition hash');
  const units = validateSources(b);
  const bound = validateExecutions(b, units);
  const labels = validateUnitLabels(b, bound);
  for (const item of [...b.excluded, ...b.removed]) validateExcerpt(b, item);
  validateCoverage(b, labels);
  return b;
}
