import { mkdir, writeFile } from 'node:fs/promises';
import { BundleSchema } from '../src/contracts.js';
await mkdir('schemas', { recursive: true });
await writeFile('schemas/comments-bundle-1.0.0.json', JSON.stringify(BundleSchema, null, 2) + '\n');
