import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Bundle, Config } from './contracts.js';
import { validateBundle } from './validate.js';

export function updateCoverage(bundle: Bundle): void {
  const labels = { ok: 0, not_applicable: 0, not_evaluated: 0, error: 0, cancelled: 0 };
  for (const unit of bundle.units) for (const label of Object.values(unit.labels)) labels[label.status]++;
  bundle.coverage.units = { selected: bundle.units.length, excluded: bundle.excluded.length, removed: bundle.removed.length };
  bundle.coverage.labels = labels;
  bundle.coverage.cachedPackets = Object.values(bundle.executions).filter(e => e.origin === 'cache').length;
}
export function bundlePath(storageDir: string, bundleId: string): string {
  if (!/^bundle_[a-f0-9-]+$/.test(bundleId)) throw new Error('Invalid bundle ID');
  return join(resolve(storageDir), 'bundles', `${bundleId}.json`);
}
export async function saveBundle(bundle: Bundle, config: Config): Promise<string> {
  validateBundle(bundle);
  const directory = join(config.storageDir, 'bundles');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = bundlePath(config.storageDir, bundle.bundleId);
  await writeFile(path, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await prune(config);
  return path;
}
export async function loadBundle(storageDir: string, bundleId: string): Promise<Bundle> {
  const value: unknown = JSON.parse(await readFile(bundlePath(storageDir, bundleId), 'utf8'));
  return validateBundle(value);
}
async function prune(config: Config): Promise<void> {
  const cutoff = Date.now() - config.retentionDays * 86400000;
  for (const directory of ['bundles', 'cache']) {
    let names: string[];
    try { names = await readdir(join(config.storageDir, directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names) {
      if (!(directory === 'bundles' ? /^bundle_[a-f0-9-]+\.json$/ : /^[a-f0-9]{64}\.json$/).test(name)) continue;
      const path = join(config.storageDir, directory, name);
      try { if ((await stat(path)).mtimeMs < cutoff) await unlink(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
}
