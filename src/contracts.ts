import { Type, type TSchema, type TProperties } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';

const object = <T extends TProperties>(properties: T) => Type.Object(properties, { additionalProperties: false });
const dictionary = <T extends TSchema>(value: T) => Type.Record(Type.String(), value);
const text = Type.String();
const id = Type.String({ minLength: 1 });
const count = Type.Integer({ minimum: 0 });
const probability = Type.Number({ minimum: 0, maximum: 1 });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
export const PackIdSchema = Type.Enum(['comments', 'functions', 'tests']);
export const LanguageSchema = Type.Enum(['typescript', 'tsx', 'javascript', 'jsx', 'rust', 'python', 'solidity']);
const SourceLanguageSchema = Type.Union([LanguageSchema, Type.Enum(['json', 'text'])]);
export const RangeSchema = object({
  startUtf16: count,
  endUtf16: count,
  startLine: Type.Integer({ minimum: 1 }),
  endLine: Type.Integer({ minimum: 1 }),
});
export const DefinitionSchema = object({
  group: Type.Enum(['purpose', 'quality', 'consistency']),
  primitive: Type.Enum(['noul', 'choice', 'score']),
  question: id,
  criteria: Type.Union([dictionary(text), Type.Array(text, { minItems: 2, maxItems: 10 })]),
  requires: Type.Enum(['text', 'local_context', 'complete_local', 'complete_target']),
  source: Type.Optional(object({ url: id, directives: Type.Array(Type.Integer({ minimum: 1, maximum: 15 })) })),
});
export const QuestionSchema = Type.Union([
  object({ type: Type.Literal('noul'), instructions: id, criteria: object({ true: text, false: text }) }),
  object({ type: Type.Literal('choice'), instructions: id, criteria: dictionary(text) }),
  object({ type: Type.Literal('score'), instructions: id, criteria: Type.Array(text, { minItems: 2, maxItems: 10 }) }),
]);
export const AnswerSchema = Type.Union([
  object({ type: Type.Literal('noul'), noul: probability }),
  object({ type: Type.Literal('choice'), choice: id, probabilities: dictionary(probability), confidence: probability }),
  object({
    type: Type.Literal('score'),
    score: Type.Number({ minimum: 0, maximum: 9 }),
    probabilities: dictionary(probability),
    legend: dictionary(text),
    confidence: probability,
  }),
]);
export const LabelResultSchema = Type.Union([
  object({ status: Type.Literal('ok'), packetId: id, answer: AnswerSchema }),
  object({ status: Type.Enum(['not_applicable', 'not_evaluated', 'error', 'cancelled']), reason: id }),
]);
export const SourceSchema = object({
  path: id,
  snapshot: Type.Enum(['before', 'captured']),
  contentHash: id,
  encoding: Type.Literal('utf-8'),
  language: SourceLanguageSchema,
  content: text,
});
export const ContextSchema = object({
  sourceId: id,
  range: RangeSchema,
  role: Type.Enum(['owner', 'header', 'surroundings', 'supporting_file']),
  text,
});
const OwnerSchema = object({ kind: id, name: nullable(text), range: RangeSchema });
export const CommentStructureSchema = object({
  syntax: Type.Enum(['line', 'block', 'string_literal', 'doc_attribute', 'unknown']),
  documentationStyle: Type.Enum(['jsdoc', 'rustdoc', 'python_docstring', 'natspec', 'none', 'unknown']),
  tags: Type.Array(text),
  owner: nullable(OwnerSchema),
  attachment: object({ kind: Type.Enum(['syntactic', 'adjacency_based', 'unresolved']), evidence: id }),
});
export const CodeStructureSchema = object({
  kind: Type.Enum(['function', 'test']),
  syntax: id,
  name: nullable(text),
  owner: nullable(OwnerSchema),
  framework: nullable(text),
});
export const StructureSchema = Type.Union([CommentStructureSchema, CodeStructureSchema]);
export const UnitSchema = object({
  id,
  sourceId: id,
  range: RangeSchema,
  text,
  structure: StructureSchema,
  change: Type.Enum(['added', 'modified', 'associated_code', 'unchanged']),
  context: object({
    status: Type.Enum(['complete_local', 'partial', 'unavailable']),
    refs: Type.Array(id),
    omissions: Type.Array(id),
  }),
  labels: dictionary(LabelResultSchema),
});
export const InventorySchema = object({ sourceId: id, range: RangeSchema, text, reason: id });
export const LegacyRequestSchema = object({
  model: id,
  state: object({
    instruction: id,
    contexts: dictionary(object({ text, role: text })),
    comments: dictionary(object({ text, structure: CommentStructureSchema, contextRefs: Type.Array(id) })),
  }),
  questions: dictionary(QuestionSchema),
});
export const InferenceTargetSchema = object({
  text,
  language: SourceLanguageSchema,
  structure: Type.Union([
    object({ ...CommentStructureSchema.properties, owner: nullable(object({ kind: id, name: nullable(text) })) }),
    object({ ...CodeStructureSchema.properties, owner: nullable(object({ kind: id, name: nullable(text) })) }),
  ]),
  contextRefs: Type.Array(id),
  contextStatus: UnitSchema.properties.context.properties.status,
  omissions: Type.Array(id),
  occurrences: Type.Array(object({ contextRef: id, range: RangeSchema })),
});
export const CurrentRequestSchema = object({
  model: id,
  state: object({
    formatVersion: Type.Literal('2'),
    instruction: id,
    contexts: dictionary(object({ text, role: text })),
    comments: dictionary(InferenceTargetSchema),
  }),
  questions: dictionary(QuestionSchema),
});
export const CodeRequestSchema = object({
  model: id,
  state: object({
    formatVersion: Type.Literal('3'),
    packId: Type.Enum(['functions', 'tests']),
    instruction: id,
    contexts: dictionary(object({ text, role: text, path: id })),
    targets: dictionary(InferenceTargetSchema),
  }),
  questions: dictionary(QuestionSchema),
});
export const RequestSchema = Type.Union([LegacyRequestSchema, CurrentRequestSchema, CodeRequestSchema]);
export const BindingSchema = object({ unitId: id, labelId: id, targetId: id, contextRefs: Type.Array(id) });
export const UsageSchema = object({ input_tokens: count, output_tokens: count });
export const ExecutionSchema = object({
  requestHash: id,
  request: RequestSchema,
  bindings: dictionary(BindingSchema),
  origin: Type.Enum(['planned', 'provider', 'cache', 'synthetic']),
  status: Type.Enum(['planned', 'ok', 'partial', 'error', 'cancelled']),
  model: nullable(id),
  usage: nullable(UsageSchema),
  cacheSource: nullable(id),
  diagnostics: Type.Array(text),
});
export const FileOutcomeSchema = object({
  path: id,
  status: Type.Enum(['parsed', 'parse_error', 'unsupported', 'unreadable', 'deleted', 'cancelled']),
  reason: text,
});
export const BundleSchema = Type.Object(
  {
    schemaVersion: Type.Enum(['1.0.0', '1.1.0', '2.0.0']),
    kind: Type.Enum(['jevvy.comments.bundle', 'jevvy.functions.bundle', 'jevvy.tests.bundle']),
    bundleId: id,
    producer: object({ name: Type.Literal('jevvy'), version: id }),
    pack: object({ id: PackIdSchema, version: id, definitionHash: id }),
    extraction: object({ version: id, napiVersion: id, grammars: dictionary(id) }),
    run: object({
      mode: Type.Enum(['live', 'dry_run', 'example']),
      status: Type.Enum(['completed', 'partial', 'cancelled', 'failed']),
      scope: object({
        mode: Type.Enum(['files', 'working', 'branch']),
        root: id,
        files: Type.Array(id),
        contextFiles: Type.Optional(Type.Array(id)),
        base: nullable(id),
        head: nullable(id),
        mergeBase: nullable(id),
      }),
      snapshotId: id,
      requestedModel: id,
      resolvedModel: nullable(id),
      startedAt: id,
      finishedAt: id,
    }),
    definitions: dictionary(DefinitionSchema),
    sources: dictionary(SourceSchema),
    contexts: dictionary(ContextSchema),
    units: Type.Array(UnitSchema),
    excluded: Type.Array(InventorySchema),
    removed: Type.Array(InventorySchema),
    executions: dictionary(ExecutionSchema),
    coverage: object({
      files: Type.Array(FileOutcomeSchema),
      units: object({ selected: count, excluded: count, removed: count }),
      labels: object({ ok: count, not_applicable: count, not_evaluated: count, error: count, cancelled: count }),
      cachedPackets: count,
    }),
    diagnostics: Type.Array(text),
  },
  {
    additionalProperties: false,
    $id: 'https://jevvy.dev/schemas/bundle-2.0.0.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
  },
);

// Tool enums are plain JSON Schema enums, compatible with provider tool schemas.
export const PackScanInputSchema = object({
  mode: StringEnum(['files', 'working', 'branch'] as const),
  files: Type.Optional(Type.Array(id, { minItems: 1 })),
  base: Type.Optional(id),
  head: Type.Optional(id),
  dryRun: Type.Optional(Type.Boolean()),
  contextFiles: Type.Optional(Type.Array(id, { minItems: 1 })),
});
export const ScanInputSchema = object({
  ...PackScanInputSchema.properties,
  pack: Type.Optional(StringEnum(['comments', 'functions', 'tests'] as const)),
});
export const ResultsInputSchema = object({
  bundleId: id,
  view: Type.Optional(StringEnum(['overview', 'units', 'context'] as const)),
  cursor: Type.Optional(id),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  ids: Type.Optional(Type.Array(id)),
  sort: Type.Optional(id),
  labels: Type.Optional(Type.Array(id, { minItems: 1 })),
  direction: Type.Optional(StringEnum(['asc', 'desc'] as const)),
  outcome: Type.Optional(id),
  includeContext: Type.Optional(Type.Boolean()),
  includeDefinitions: Type.Optional(Type.Boolean()),
  minProbability: Type.Optional(probability),
  minConfidence: Type.Optional(probability),
});
export const ConfigSchema = object({
  model: id,
  requestConcurrency: Type.Integer({ minimum: 1, maximum: 16 }),
  parseConcurrency: Type.Integer({ minimum: 1, maximum: 16 }),
  maxContextChars: Type.Integer({ minimum: 256 }),
  maxRequestBytes: Type.Integer({ minimum: 2048 }),
  requestTimeoutMs: Type.Integer({ minimum: 100 }),
  runTimeoutMs: Type.Integer({ minimum: 100 }),
  maxRetries: Type.Integer({ minimum: 0, maximum: 5 }),
  retentionDays: Type.Integer({ minimum: 1 }),
  storageDir: id,
});
export type Language = Type.Static<typeof LanguageSchema>;
export type PackId = Type.Static<typeof PackIdSchema>;
export type Range = Type.Static<typeof RangeSchema>;
export type Definition = Type.Static<typeof DefinitionSchema>;
export type Answer = Type.Static<typeof AnswerSchema>;
export type Question = Type.Static<typeof QuestionSchema>;
export type LabelResult = Type.Static<typeof LabelResultSchema>;
export type Source = Type.Static<typeof SourceSchema>;
export type Context = Type.Static<typeof ContextSchema>;
export type Unit = Type.Static<typeof UnitSchema>;
export type Structure = Type.Static<typeof StructureSchema>;
export type CommentStructure = Type.Static<typeof CommentStructureSchema>;
export type CodeStructure = Type.Static<typeof CodeStructureSchema>;
export type CommentUnit = Omit<Unit, 'structure'> & { structure: CommentStructure };
export type CodeUnit = Omit<Unit, 'structure'> & { structure: CodeStructure };
export type Request = Type.Static<typeof RequestSchema>;
export type Execution = Type.Static<typeof ExecutionSchema>;
export type Bundle = Type.Static<typeof BundleSchema>;
export type ScanInput = Type.Static<typeof ScanInputSchema>;
export type ResultsInput = Type.Static<typeof ResultsInputSchema>;
export type Config = Type.Static<typeof ConfigSchema>;

export type CurrentRequest = Type.Static<typeof CurrentRequestSchema>;
export type CodeRequest = Type.Static<typeof CodeRequestSchema>;
export type InferenceTarget = Type.Static<typeof InferenceTargetSchema>;
