import { mkdir, writeFile } from 'node:fs/promises';
import { BundleSchema } from '../src/contracts.ts';
await mkdir('schemas', { recursive: true });
await writeFile('schemas/bundle-2.0.0.json', JSON.stringify(BundleSchema, null, 2) + '\n');
