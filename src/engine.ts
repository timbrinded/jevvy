import { randomUUID } from 'node:crypto';
import type { Bundle, Config, Source, Unit, Execution, ScanInput } from './contracts.ts';
import { configuration } from './config.ts';
import { hash, identity } from './hash.ts';
import { extractionMetadata, rangeFor } from './ast.ts';
import { captureScope, affected, type CapturedFile, type Capture } from './scope.ts';
import type { Extracted } from './packs/types.ts';
import { packs } from './packs/index.ts';
import { planRequests } from './plan.ts';
import { bounded } from './queue.ts';
import { validateBundle, validateInput, validateResponse } from './validate.ts';
import { saveBundle, updateCoverage } from './bundle.ts';
import { jevTransport, transportError, isModelAlias, type Transport } from './jev.ts';
import { cached, storeCache } from './cache.ts';
import { initialProgress, type ScanProgress, type ScanStage } from './progress.ts';
export type { ScanProgress } from './progress.ts';

export interface ScanOptions {
  cwd: string;
  config?: Partial<Config>;
  signal?: AbortSignal;
  transport?: Transport;
  persist?: boolean;
  onProgress?: (message: string) => void;
  onEvent?: (progress: ScanProgress) => void;
}
export interface ScanResult {
  bundle: Bundle;
  path?: string;
}
function sourceFor(file: CapturedFile, snapshot: Source['snapshot']): Source {
  const content = (snapshot === 'before' ? file.before : file.content)!;
  return {
    path: snapshot === 'before' ? file.oldPath : file.path,
    snapshot,
    contentHash: hash(content),
    encoding: 'utf-8',
    language: file.language,
    content,
  };
}
function sourceId(source: Source): string {
  return identity('source', { path: source.path, snapshot: source.snapshot, contentHash: source.contentHash });
}
function removedUnits(before: Unit[], current: Unit[], changes: CapturedFile['changes']): Unit[] {
  const unmatched = [...current];
  const removed: Unit[] = [];
  const matched = new Set<string>();
  // Match named owners first so identical prose in two functions cannot
  // consume the surviving function's evidence in source order. Only then
  // allow unchanged prose to follow a moved/renamed owner.
  for (const old of before) {
    const index = unmatched.findIndex(
      u =>
        u.text === old.text &&
        u.structure.owner?.name === old.structure.owner?.name &&
        u.structure.owner?.kind === old.structure.owner?.kind,
    );
    if (index >= 0) {
      unmatched.splice(index, 1);
      matched.add(old.id);
    }
  }
  for (const old of before) {
    if (matched.has(old.id)) continue;
    const index = unmatched.findIndex(u => u.text === old.text);
    if (index >= 0) {
      unmatched.splice(index, 1);
      matched.add(old.id);
    }
  }
  for (const old of before) {
    if (matched.has(old.id)) continue;
    const sameOwner = (u: Unit) =>
      u.structure.owner?.name === old.structure.owner?.name && u.structure.owner?.kind === old.structure.owner?.kind;
    // An old comment replaced in a two-sided hunk is modification history,
    // not an independent removed current comment.
    const replacement = changes.some(
      c =>
        c.oldCount > 0 &&
        c.newCount > 0 &&
        affected(old.range, [c], 'old') &&
        unmatched.some(u => sameOwner(u) && affected(u.range, [c], 'new')),
    );
    if (!replacement) removed.push(old);
  }
  return removed;
}
function changedUnit(
  unit: Unit,
  before: Extracted | undefined,
  changes: CapturedFile['changes'],
  direct: boolean,
): Unit['change'] {
  const unchangedText = before?.units.some(
    old => old.text === unit.text && old.structure.owner?.name === unit.structure.owner?.name,
  );
  if (!direct || unchangedText) return 'associated_code';
  return before?.units.some(
    old => affected(old.range, changes, 'old') && old.structure.owner?.name === unit.structure.owner?.name,
  )
    ? 'modified'
    : 'added';
}
function select(
  bundle: Bundle,
  file: CapturedFile,
  before: Extracted | undefined,
  current: Extracted | undefined,
  beforeId?: string,
): void {
  if (beforeId && before) {
    for (const old of removedUnits(before.units, current?.units ?? [], file.changes))
      bundle.removed.push({
        sourceId: beforeId,
        range: old.range,
        text: old.text,
        reason: 'removed_from_current_source',
      });
  }
  if (!current) return;
  for (const item of current.excluded)
    if (bundle.run.scope.mode === 'files' || file.renamed || affected(item.range, file.changes, 'new'))
      bundle.excluded.push(item);
  for (const unit of current.units) {
    const direct = affected(unit.range, file.changes, 'new');
    const ownerChanged = unit.structure.owner && affected(unit.structure.owner.range, file.changes, 'new');
    const contextChanged = unit.context.refs.some(ref => affected(current.contexts[ref]!.range, file.changes, 'new'));
    if (bundle.run.scope.mode !== 'files' && !direct && !ownerChanged && !contextChanged && !file.renamed) continue;
    unit.change = bundle.run.scope.mode === 'files' ? 'unchanged' : changedUnit(unit, before, file.changes, direct);
    bundle.units.push(unit);
    for (const ref of unit.context.refs) bundle.contexts[ref] = current.contexts[ref]!;
  }
}
interface ScanContext {
  signal: AbortSignal;
  progress: ScanProgress;
  emit: (stage: ScanStage) => void;
  options: ScanOptions;
}
async function extractFiles(
  bundle: Bundle,
  files: CapturedFile[],
  config: Config,
  context: ScanContext,
): Promise<void> {
  const { signal, progress, emit, options } = context;
  const pack = packs[bundle.pack.id];
  type Parsed = {
    file: CapturedFile;
    sources: Source[];
    before?: Extracted;
    current?: Extracted;
    error?: string;
    cancelled?: boolean;
  };
  const parsed: Parsed[] = new Array(files.length);
  progress.files.total = files.length;
  emit('extract');
  await bounded(files, config.parseConcurrency, async (file, index) => {
    const p: Parsed = { file, sources: [] };
    parsed[index] = p;
    if (signal.aborted) {
      p.cancelled = true;
      progress.files.completed++;
      emit('extract');
      return;
    }
    progress.file = file.path;
    options.onProgress?.(`Extracting ${file.path}`);
    try {
      if (file.before !== null) {
        const s = sourceFor(file, 'before');
        p.sources.push(s);
        p.before = await pack.extract(sourceId(s), s, config);
      }
      if (file.content !== null) {
        const s = sourceFor(file, 'captured');
        p.sources.push(s);
        p.current = await pack.extract(sourceId(s), s, config);
      }
    } catch (e) {
      p.error = transportError(e);
    }
    progress.files.completed++;
    emit('extract');
  });
  for (const p of parsed) {
    if (p.cancelled || p.error) {
      bundle.coverage.files.push({
        path: p.file.path,
        status: p.cancelled ? 'cancelled' : 'parse_error',
        reason: p.error ?? 'Extraction cancelled',
      });
      if (p.error) bundle.diagnostics.push(`${p.file.path}: ${p.error}`);
      continue;
    }
    for (const s of p.sources) bundle.sources[sourceId(s)] = s;
    const beforeId = p.sources.find(s => s.snapshot === 'before');
    select(bundle, p.file, p.before, p.current, beforeId && sourceId(beforeId));
    const errors = (p.before?.errors.length ?? 0) + (p.current?.errors.length ?? 0);
    bundle.coverage.files.push({
      path: p.file.path,
      status: p.file.content === null ? 'deleted' : errors ? 'parse_error' : 'parsed',
      reason: errors ? `${errors} parser recovery ranges` : '',
    });
  }
}
function applyResponse(
  e: Execution,
  result: ReturnType<typeof validateResponse>,
  packetId: string,
  units: Map<string, Unit>,
): void {
  e.model = result.model;
  e.usage = result.usage;
  e.status = Object.keys(result.errors).length ? (Object.keys(result.answers).length ? 'partial' : 'error') : 'ok';
  for (const [qid, binding] of Object.entries(e.bindings)) {
    const unit = units.get(binding.unitId)!;
    unit.labels[binding.labelId] = result.errors[qid]
      ? { status: 'error', reason: result.errors[qid]! }
      : { status: 'ok', packetId, answer: result.answers[qid]! };
  }
}
function createBundle(input: ScanInput, config: Config, capture: Capture, bundleId: string, startedAt: string): Bundle {
  const pack = packs[input.pack ?? 'comments'];
  return {
    schemaVersion: '2.0.0',
    kind: `jevvy.${pack.id}.bundle`,
    bundleId,
    producer: { name: 'jevvy', version: '0.1.0' },
    pack: { id: pack.id, version: pack.version, definitionHash: pack.definitionHash },
    extraction: extractionMetadata,
    run: {
      mode: input.dryRun ? 'dry_run' : 'live',
      status: 'completed',
      scope: capture.scope,
      snapshotId: identity('snapshot', {
        files: capture.files.map(f => ({
          path: f.path,
          oldPath: f.oldPath,
          before: f.before === null ? null : hash(f.before),
          content: f.content === null ? null : hash(f.content),
        })),
        supporting: capture.supporting.map(file => ({ path: file.path, contentHash: hash(file.content) })),
      }),
      requestedModel: config.model,
      resolvedModel: null,
      startedAt,
      finishedAt: startedAt,
    },
    definitions: structuredClone(pack.definitions),
    sources: {},
    contexts: {},
    units: [],
    excluded: [],
    removed: [],
    executions: {},
    coverage: {
      files: capture.outcomes,
      units: { selected: 0, excluded: 0, removed: 0 },
      labels: { ok: 0, not_applicable: 0, not_evaluated: 0, error: 0, cancelled: 0 },
      cachedPackets: 0,
    },
    diagnostics: capture.diagnostics,
  };
}

function attachSupportingFiles(bundle: Bundle, capture: Capture, config: Config): void {
  const refs: string[] = [];
  for (const file of capture.supporting) {
    const source: Source = { ...file, snapshot: 'captured', contentHash: hash(file.content), encoding: 'utf-8' };
    const id = sourceId(source);
    bundle.sources[id] = source;
    const range = rangeFor(file.content, 0, file.content.length);
    const ref = identity('context', { sourceId: id, range, role: 'supporting_file' });
    bundle.contexts[ref] = { sourceId: id, range, role: 'supporting_file', text: file.content };
    refs.push(ref);
  }
  for (const unit of bundle.units) {
    let remaining =
      config.maxContextChars - unit.context.refs.reduce((sum, ref) => sum + bundle.contexts[ref]!.text.length, 0);
    for (const ref of refs) {
      const context = bundle.contexts[ref]!;
      if (
        unit.context.refs.some(existing => {
          const bound = bundle.contexts[existing]!;
          return (
            bound.sourceId === context.sourceId &&
            bound.range.startUtf16 <= context.range.startUtf16 &&
            bound.range.endUtf16 >= context.range.endUtf16
          );
        })
      )
        continue;
      if (context.text.length > remaining) {
        unit.context.omissions.push(`supporting_file_too_large:${bundle.sources[context.sourceId]!.path}`);
        if (unit.context.status === 'complete_local') unit.context.status = 'partial';
        continue;
      }
      unit.context.refs.push(ref);
      remaining -= context.text.length;
    }
    for (const path of capture.scope.contextFiles ?? []) {
      if (!capture.supporting.some(file => file.path === path)) {
        unit.context.omissions.push(`supporting_file_unavailable:${path}`);
        if (unit.context.status === 'complete_local') unit.context.status = 'partial';
      }
    }
  }
}
async function analyseRequests(bundle: Bundle, config: Config, context: ScanContext): Promise<void> {
  const { signal, progress, emit, options } = context;
  const units = new Map(bundle.units.map(u => [u.id, u]));
  let transport: Transport | undefined = options.transport;
  let finished = 0;
  await bounded(Object.entries(bundle.executions), config.requestConcurrency, async ([packetId, e]) => {
    const mark = (status: 'error' | 'cancelled', reason: string) => {
      e.status = status;
      e.diagnostics.push(reason);
      for (const binding of Object.values(e.bindings))
        units.get(binding.unitId)!.labels[binding.labelId] = { status, reason };
    };
    if (signal.aborted) {
      mark('cancelled', 'Run cancelled before request');
      progress.packets.cancelled++;
      progress.packets.completed++;
      emit('analyse');
      return;
    }
    progress.packets.active++;
    emit('analyse');
    try {
      const hit = await cached(config, bundle, e);
      if (!hit) transport ??= jevTransport(config);
      e.origin = hit ? 'cache' : 'provider';
      const raw = hit ? hit.response : await transport!(e.request, signal);
      const result = validateResponse(raw, e);
      if (!isModelAlias(config.model) && result.model !== config.model)
        throw new Error('Provider returned a different model than requested');
      e.origin = hit ? 'cache' : 'provider';
      e.cacheSource = hit?.bundleId ?? null;
      applyResponse(e, result, packetId, units);
      if (!hit)
        try {
          await storeCache(config, bundle, e, result);
        } catch {
          e.diagnostics.push('Cache write failed; results retained');
        }
    } catch (error) {
      mark(
        signal.aborted ? 'cancelled' : 'error',
        signal.aborted ? 'Run cancelled during request' : transportError(error),
      );
    }
    progress.packets.active--;
    progress.packets.completed++;
    if (e.status !== 'planned') progress.packets[e.status]++;
    if (e.origin === 'cache') progress.packets.cached++;
    emit('analyse');
    options.onProgress?.(`Processed ${++finished}/${Object.keys(bundle.executions).length} packets`);
  });
}
export async function scan(value: unknown, options: ScanOptions): Promise<ScanResult> {
  const input = validateInput(value),
    config = configuration(options.config);
  const startedAt = new Date().toISOString();
  const progress = initialProgress(
    `bundle_${randomUUID()}`,
    input.dryRun ?? false,
    Date.parse(startedAt),
    input.pack ?? 'comments',
  );
  const emit = (stage: ScanStage) => {
    progress.stage = stage;
    options.onEvent?.(structuredClone(progress));
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Run deadline exceeded')), config.runTimeoutMs);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    emit('capture');
    options.onProgress?.('Capturing source');
    const capture = await captureScope(input, options.cwd, signal);
    const bundle = createBundle(input, config, capture, progress.runId, startedAt);
    await extractFiles(bundle, capture.files, config, { signal, progress, emit, options });
    attachSupportingFiles(bundle, capture, config);
    bundle.units.sort(
      (a, b) =>
        bundle.sources[a.sourceId]!.path.localeCompare(bundle.sources[b.sourceId]!.path, 'en') ||
        a.range.startUtf16 - b.range.startUtf16,
    );
    planRequests(bundle, config);
    delete progress.file;
    progress.comments = bundle.units.length;
    progress.packets.total = Object.keys(bundle.executions).length;
    emit('plan');
    updateCoverage(bundle);
    if (signal.aborted) bundle.run.status = 'cancelled';
    else if (bundle.coverage.files.some(f => ['parse_error', 'unreadable'].includes(f.status)))
      bundle.run.status = bundle.units.length ? 'partial' : 'failed';
    validateBundle(bundle);
    if (!input.dryRun && Object.keys(bundle.executions).length)
      await analyseRequests(bundle, config, { signal, progress, emit, options });
    const models = [...new Set(Object.values(bundle.executions).flatMap(e => (e.model ? [e.model] : [])))];
    bundle.run.resolvedModel = models.length === 1 ? models[0]! : null;
    if (models.length > 1) bundle.diagnostics.push('Multiple resolved models; per-execution models retained');
    updateCoverage(bundle);
    const failedFiles = bundle.coverage.files.some(f => ['parse_error', 'unreadable'].includes(f.status));
    if (signal.aborted) bundle.run.status = 'cancelled';
    else if (bundle.coverage.labels.error || failedFiles)
      bundle.run.status = bundle.coverage.labels.ok || bundle.units.length ? 'partial' : 'failed';
    bundle.run.finishedAt = new Date().toISOString();
    validateBundle(bundle);
    emit('persist');
    const path = options.persist === false ? undefined : await saveBundle(bundle, config);
    emit('complete');
    return { bundle, path };
  } catch (error) {
    emit('failed');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
