import type { Bundle, Config, Context, Definition, PackId, Range, Source, Unit } from '../contracts.ts';

export interface Extracted<T extends Unit = Unit> {
  units: T[];
  contexts: Record<string, Context>;
  excluded: Bundle['excluded'];
  errors: Range[];
}

export interface AnalysisPack {
  id: PackId;
  version: string;
  definitions: Record<string, Definition>;
  definitionHash: string;
  extract(sourceId: string, source: Source, config: Pick<Config, 'maxContextChars'>): Promise<Extracted>;
}
