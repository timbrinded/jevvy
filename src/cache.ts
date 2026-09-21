import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AnswerSchema, UsageSchema, type Bundle, type Config, type Execution } from './contracts.ts';
import { isModelAlias } from './jev.ts';
import { hash } from './hash.ts';
import { validateResponse } from './validate.ts';

const CacheSchema = Type.Object(
  {
    key: Type.String(),
    bundleId: Type.String(),
    response: Type.Object(
      { model: Type.String(), usage: UsageSchema, answers: Type.Record(Type.String(), AnswerSchema) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const validator = Compile(CacheSchema);
function cacheKey(bundle: Bundle, execution: Execution): string {
  return hash({ requestHash: execution.requestHash, pack: bundle.pack.definitionHash, extraction: bundle.extraction });
}
export async function cached(
  config: Config,
  bundle: Bundle,
  execution: Execution,
): Promise<Type.Static<typeof CacheSchema> | undefined> {
  // Aliases can change resolution between runs. They never reuse an old cache
  // entry without a current resolution; callers can pin a concrete model.
  if (isModelAlias(execution.request.model)) return;
  const key = cacheKey(bundle, execution);
  try {
    const value: unknown = JSON.parse(await readFile(join(config.storageDir, 'cache', `${key}.json`), 'utf8'));
    if (!validator.Check(value) || value.key !== key || value.response.model !== execution.request.model) return;
    const checked = validateResponse(value.response, execution);
    if (Object.keys(checked.errors).length) return;
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') execution.diagnostics.push('Unusable cache entry ignored');
  }
}
export async function storeCache(
  config: Config,
  bundle: Bundle,
  execution: Execution,
  response: ReturnType<typeof validateResponse>,
): Promise<void> {
  if (execution.status !== 'ok' || isModelAlias(execution.request.model) || execution.request.model !== response.model)
    return;
  const key = cacheKey(bundle, execution);
  await mkdir(join(config.storageDir, 'cache'), { recursive: true, mode: 0o700 });
  const value = {
    key,
    bundleId: bundle.bundleId,
    response: { model: response.model, usage: response.usage, answers: response.answers },
  };
  if (!validator.Check(value)) throw new Error('Invalid cache data');
  try {
    await writeFile(join(config.storageDir, 'cache', `${key}.json`), JSON.stringify(value), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
