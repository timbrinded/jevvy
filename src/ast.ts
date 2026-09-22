import { parseAsync, parse, registerDynamicLanguage, type SgNode } from '@ast-grep/napi';
import python from '@ast-grep/lang-python';
import rust from '@ast-grep/lang-rust';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import type { Language, Range } from './contracts.ts';

export const EXTRACTION_VERSION = '2.0.0';
export const extractionMetadata = {
  version: EXTRACTION_VERSION,
  napiVersion: '0.45.3',
  grammars: {
    typescript: '@ast-grep/napi@0.45.3',
    tsx: '@ast-grep/napi@0.45.3',
    javascript: '@ast-grep/napi@0.45.3',
    jsx: '@ast-grep/napi@0.45.3',
    python: '@ast-grep/lang-python@0.0.6',
    rust: '@ast-grep/lang-rust@0.0.7',
    solidity: 'tree-sitter-solidity@1.2.13',
  },
};
const grammarNames: Record<Language, string> = {
  typescript: 'TypeScript',
  tsx: 'Tsx',
  javascript: 'JavaScript',
  jsx: 'JavaScript',
  python: 'python',
  rust: 'rust',
  solidity: 'solidity',
};
const registryKey = Symbol.for('jevvy.parsers.0.45.3.2');
const globalRegistry = globalThis as typeof globalThis & { [registryKey]?: WeakSet<typeof parse> };

export function initializeParsers(): void {
  const initialized = (globalRegistry[registryKey] ??= new WeakSet<typeof parse>());
  if (initialized.has(parse)) return;
  const platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform))
    throw new Error(`Unsupported native parser platform: ${platform}`);
  registerDynamicLanguage({
    python,
    rust,
    solidity: {
      libraryPath: fileURLToPath(new URL(`../native/solidity/${platform}/tree-sitter-solidity.node`, import.meta.url)),
      extensions: ['sol'],
      languageSymbol: 'tree_sitter_solidity',
    },
  });
  // Another extension may have consumed the process-wide one-shot registry.
  for (const [lang, example] of [
    ['python', '# probe\nx = 1'],
    ['rust', '// probe\nfn f() {}'],
    ['solidity', '// probe\ncontract C {}'],
  ] as const) {
    const root = parse(lang, example).root();
    if (root.findAll({ rule: { kind: 'ERROR' } }).length || !walk(root).some(n => String(n.kind()).includes('comment')))
      throw new Error(`Native ${lang} grammar registration unavailable or conflicting`);
  }
  initialized.add(parse);
}
export function languageFor(path: string): Language | undefined {
  return (
    {
      '.ts': 'typescript',
      '.mts': 'typescript',
      '.cts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.jsx': 'jsx',
      '.rs': 'rust',
      '.py': 'python',
      '.sol': 'solidity',
    } as Record<string, Language>
  )[extname(path).toLowerCase()];
}
export async function parseSource(language: Language, content: string): Promise<SgNode> {
  initializeParsers();
  return (await parseAsync(grammarNames[language], content)).root();
}
export function walk(root: SgNode): SgNode[] {
  const result: SgNode[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node);
    pending.push(...node.children().reverse());
  }
  return result;
}
export function rangeOf(node: SgNode): Range {
  const r = node.range();
  return { startUtf16: r.start.index, endUtf16: r.end.index, startLine: r.start.line + 1, endLine: r.end.line + 1 };
}
export function rangeFor(content: string, start: number, end: number): Range {
  return {
    startUtf16: start,
    endUtf16: end,
    startLine: content.slice(0, start).split('\n').length,
    endLine: content.slice(0, end).split('\n').length,
  };
}
export function overlaps(a: Range, b: Range): boolean {
  return a.startUtf16 < b.endUtf16 && b.startUtf16 < a.endUtf16;
}
