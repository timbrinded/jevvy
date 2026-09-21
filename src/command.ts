import type { ScanInput, ResultsInput } from './contracts.js';
import { validators, validateInput } from './validate.js';

function tokens(text: string): string[] {
  const result: string[] = [];
  let value = '', quote = '', active = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\\' && quote !== "'") { if (++i >= text.length) throw new Error('Incomplete escape'); value += text[i]; active = true; }
    else if (quote) { if (char === quote) quote = ''; else value += char; }
    else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/.test(char)) { if (active) result.push(value); value = ''; active = false; }
    else { value += char; active = true; }
  }
  if (quote) throw new Error('Unclosed quote');
  if (active) result.push(value);
  return result;
}
export function parseCommand(text: string): { action: 'comments'; input: ScanInput } | { action: 'results'; input: ResultsInput } | { action: 'cancel' } {
  const args = tokens(text), action = args.shift();
  if (action === 'cancel' && !args.length) return { action: 'cancel' };
  if (action === 'results') {
    const input: ResultsInput = { bundleId: args.shift() ?? '' };
    while (args.length) {
      const flag = args.shift();
      if (flag === '--view') input.view = args.shift() as ResultsInput['view'];
      else if (flag === '--limit') input.limit = Number(args.shift());
      else if (flag === '--cursor') input.cursor = args.shift();
      else if (flag === '--sort') input.sort = args.shift();
      else if (flag === '--ids') { input.ids = []; while (args.length && !args[0]!.startsWith('--')) input.ids.push(args.shift()!); }
      else throw new Error(`Unknown results option ${flag}`);
    }
    if (!validators.results.Check(input)) throw new Error('Invalid results arguments');
    return { action: 'results', input };
  }
  if (action !== 'comments') throw new Error('Usage: /jevvy comments --files <paths> | --working | --base <ref> [--head <ref>] [--dry-run]; /jevvy results <bundle-id>; /jevvy cancel');
  const input: Partial<ScanInput> = {};
  const mode = (value: ScanInput['mode']) => { if (input.mode && input.mode !== value) throw new Error('Select exactly one scope mode'); input.mode = value; };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--working') mode('working');
    else if (flag === '--dry-run') input.dryRun = true;
    else if (flag === '--base') { mode('branch'); input.base = args.shift(); }
    else if (flag === '--head') input.head = args.shift();
    else if (flag === '--files') { mode('files'); input.files = []; while (args.length && !args[0]!.startsWith('--')) input.files.push(args.shift()!); }
    else throw new Error(`Unknown comments option ${flag}`);
  }
  return { action: 'comments', input: validateInput(input) };
}
