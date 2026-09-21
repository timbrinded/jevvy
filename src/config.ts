import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, type Config } from './contracts.js';
import { checked } from './validate.js';

export function configuration(overrides: Partial<Config> = {}): Config {
  return checked(ConfigSchema, {
    model: 'jev-1.13.0', requestConcurrency: 3, parseConcurrency: 2,
    maxContextChars: 12000, maxRequestBytes: 64000, requestTimeoutMs: 30000,
    runTimeoutMs: 300000, maxRetries: 2, retentionDays: 30,
    storageDir: process.env.JEVVY_STORAGE_DIR ?? join(homedir(), '.cache', 'jevvy'), ...overrides,
  }, 'Configuration');
}
