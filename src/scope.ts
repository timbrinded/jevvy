import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, realpath, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { languageFor } from './ast.ts';
import type { Bundle, Language, Range, ScanInput, Source } from './contracts.ts';

const exec = promisify(execFile);
export async function git(root: string, args: string[]): Promise<string> {
  return (await exec('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
    .stdout;
}
export interface Change {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}
export interface CapturedFile {
  path: string;
  oldPath: string;
  language: Language;
  before: string | null;
  content: string | null;
  renamed: boolean;
  changes: Change[];
}
export interface Capture {
  scope: Bundle['run']['scope'];
  files: CapturedFile[];
  outcomes: Bundle['coverage']['files'];
  diagnostics: string[];
  supporting: { path: string; language: Source['language']; content: string }[];
}

async function captureText(root: string, path: string): Promise<string | null> {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).includes('.git'))
    throw new Error('Selected path is outside source scope');
  let first;
  try {
    first = await lstat(absolute);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  if (!first.isFile() || first.isSymbolicLink()) throw new Error('Selected path is not a regular file');
  const actual = await realpath(absolute);
  const actualRel = relative(root, actual);
  if (actualRel === '..' || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel))
    throw new Error('Symlinked parent escapes source root');
  const bytes = await readFile(absolute);
  const after = await lstat(absolute);
  if (
    first.ino !== after.ino ||
    first.size !== after.size ||
    first.mtimeMs !== after.mtimeMs ||
    first.ctimeMs !== after.ctimeMs
  )
    throw new Error('File changed during capture; rerun to capture a consistent version');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
async function blob(root: string, revision: string, path: string): Promise<string | null> {
  try {
    const result = await exec('git', ['--no-pager', 'show', `${revision}:${path}`], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout);
  } catch (error) {
    // Distinguish a missing entry from a failed Git operation.
    const exists = await git(root, ['ls-tree', '-z', revision, '--', path]);
    if (!exists) return null;
    throw error;
  }
}
async function diff(before: string, content: string): Promise<Change[]> {
  if (before === content) return [];
  const directory = await mkdtemp(join(tmpdir(), 'jevvy-diff-'));
  try {
    await writeFile(join(directory, 'before'), before);
    await writeFile(join(directory, 'after'), content);
    let patch: string;
    try {
      patch = await git(directory, [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        '--diff-algorithm=myers',
        '--text',
        '--unified=0',
        '--',
        'before',
        'after',
      ]);
    } catch (error) {
      const e = error as Error & { code?: number; stdout?: string };
      if (e.code !== 1 || typeof e.stdout !== 'string') throw error;
      patch = e.stdout;
    }
    return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(m => ({
      oldStart: Number(m[1]),
      oldCount: Number(m[2] ?? 1),
      newStart: Number(m[3]),
      newCount: Number(m[4] ?? 1),
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export function affected(range: Range, changes: Change[], side: 'old' | 'new'): boolean {
  return changes.some(c => {
    const start = side === 'old' ? c.oldStart : c.newStart;
    const count = side === 'old' ? c.oldCount : c.newCount;
    // Empty hunks are positions after a line. Including the adjacent boundary
    // captures deletion-only edits without inventing changed source text.
    return count === 0
      ? start >= range.startLine - 1 && start <= range.endLine
      : start <= range.endLine && start + count - 1 >= range.startLine;
  });
}
type Candidate = { path: string; oldPath: string; renamed: boolean };
async function scopeCandidates(input: ScanInput, { root, head, mergeBase }: Capture['scope']): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  if (input.mode === 'files') {
    for (const path of input.files!)
      candidates.push({
        path: relative(root, resolve(root, path)).split(sep).join('/'),
        oldPath: path,
        renamed: false,
      });
  } else if (input.mode === 'branch') {
    const fields = (
      await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', mergeBase!, head!, '--'])
    ).split('\0');
    for (let i = 0; i < fields.length && fields[i];) {
      const status = fields[i++]!,
        first = fields[i++]!;
      const renamed = status.startsWith('R');
      candidates.push({ path: renamed ? fields[i++]! : first, oldPath: first, renamed });
    }
  } else {
    const paths = new Set(
      (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean),
    );
    for (const path of (await git(root, ['ls-tree', '-r', '--name-only', '-z', head!])).split('\0').filter(Boolean))
      paths.add(path);
    // Git's rename detection provides provenance; comparison still uses the
    // captured contents below, never its live-working-tree patch.
    const fields = (
      await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', head!, '--'])
    ).split('\0');
    const renames = new Map<string, string>();
    for (let i = 0; i < fields.length && fields[i];) {
      const status = fields[i++]!,
        first = fields[i++]!;
      if (status.startsWith('R')) {
        const dest = fields[i++]!;
        renames.set(dest, first);
        paths.delete(first);
      }
    }
    for (const path of paths) candidates.push({ path, oldPath: renames.get(path) ?? path, renamed: renames.has(path) });
  }
  return candidates;
}
async function resolveScope(input: ScanInput, cwd: string): Promise<Capture['scope']> {
  let root = await realpath(cwd);
  if (input.mode !== 'files') root = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  const resolveRef = async (ref: string) =>
    (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  const head =
    input.mode === 'files' ? null : await resolveRef(input.mode === 'branch' ? (input.head ?? 'HEAD') : 'HEAD');
  const base = input.mode === 'branch' ? await resolveRef(input.base!) : head;
  const mergeBase = input.mode === 'branch' ? (await git(root, ['merge-base', base!, head!])).trim() : null;
  return { mode: input.mode, root, files: [], base, head, mergeBase };
}
export async function captureScope(input: ScanInput, cwd: string, signal?: AbortSignal): Promise<Capture> {
  const scope = await resolveScope(input, cwd);
  const { root, head, mergeBase } = scope;
  const candidates = await scopeCandidates(input, scope);
  const result: Capture = { scope, files: [], outcomes: [], diagnostics: [], supporting: [] };
  const unique = new Map(candidates.map(c => [c.path, c]));
  scope.files = [...unique.keys()].sort();
  for (const candidate of [...unique.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
    const { path, oldPath, renamed } = candidate;
    if (signal?.aborted) {
      result.outcomes.push({ path, status: 'cancelled', reason: 'Capture cancelled' });
      continue;
    }
    const language = languageFor(path) ?? languageFor(oldPath);
    if (!language) {
      result.outcomes.push({ path, status: 'unsupported', reason: 'No source adapter for this extension' });
      continue;
    }
    try {
      const before = input.mode === 'files' ? null : await blob(root, mergeBase ?? head!, oldPath);
      const content = input.mode === 'branch' ? await blob(root, head!, path) : await captureText(root, path);
      if (input.mode === 'files' && content === null) throw new Error('Selected file does not exist');
      if (input.mode !== 'files' && before === content && !renamed) continue;
      const changes = await diff(before ?? '', content ?? '');
      result.files.push({ path, oldPath, language, before, content, renamed, changes });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.outcomes.push({ path, status: 'unreadable', reason });
      result.diagnostics.push(`${path}: ${reason}`);
    }
  }
  await captureSupportingFiles(input, result, signal);
  return result;
}

async function captureSupportingFiles(input: ScanInput, result: Capture, signal?: AbortSignal): Promise<void> {
  const { scope } = result;
  const { root, head } = scope;
  if (input.contextFiles?.length) {
    scope.contextFiles = [
      ...new Set(input.contextFiles.map(path => relative(root, resolve(root, path)).split(sep).join('/'))),
    ].sort();
    for (const path of scope.contextFiles) {
      if (signal?.aborted) {
        result.outcomes.push({ path, status: 'cancelled', reason: 'Supporting-file capture cancelled' });
        continue;
      }
      try {
        if (path === '..' || path.startsWith('../') || isAbsolute(path) || path.split('/').includes('.git'))
          throw new Error('Supporting path is outside source scope');
        const selected = result.files.find(file => file.path === path);
        const content = selected
          ? selected.content
          : input.mode === 'branch'
            ? await blob(root, head!, path)
            : await captureText(root, path);
        if (content === null) throw new Error('Supporting file does not exist in selected snapshot');
        result.supporting.push({
          path,
          content,
          language: languageFor(path) ?? (extname(path).toLowerCase() === '.json' ? 'json' : 'text'),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.outcomes.push({ path, status: 'unreadable', reason });
        result.diagnostics.push(`${path}: ${reason}`);
      }
    }
  }
}
