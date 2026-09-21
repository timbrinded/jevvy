import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../src/scope.ts';
import type { Request } from '../src/contracts.ts';

export async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'jevvy-test-'));
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text);
  return { root, storageDir: join(root, '.jevvy-store'), cleanup: () => rm(root, { recursive: true, force: true }) };
}
export async function repository(files: Record<string, string>) {
  const f = await fixture(files);
  await git(f.root, ['init', '-b', 'main']);
  await git(f.root, ['config', 'user.email', 'fixture@example.invalid']);
  await git(f.root, ['config', 'user.name', 'Fixture']);
  await git(f.root, ['config', 'commit.gpgsign', 'false']);
  await git(f.root, ['config', 'core.hooksPath', '/dev/null']);
  await git(f.root, ['add', '.']);
  await git(f.root, ['commit', '-m', 'fixture']);
  return f;
}
export function syntheticResponse(request: Request) {
  return {
    model: request.model,
    usage: { input_tokens: 10, output_tokens: 20 },
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        if (q.type === 'noul') return [id, { type: 'noul', noul: 0.75 }];
        if (q.type === 'choice') {
          const keys = Object.keys(q.criteria);
          return [
            id,
            {
              type: 'choice',
              choice: keys[0],
              confidence: 1,
              probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])),
            },
          ];
        }
        return [
          id,
          {
            type: 'score',
            score: 2,
            confidence: 1,
            probabilities: Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 2 ? 1 : 0])),
            legend: Object.fromEntries(q.criteria.map((level, i) => [String(i), level])),
          },
        ];
      }),
    ),
  };
}
