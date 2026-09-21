import { TypeSafeClient, APIError } from '@typesafe-ai/sdk';
import type { Question as SDKQuestion } from '@typesafe-ai/sdk';
import type { Config, Request } from './contracts.js';

export const isModelAlias = (model: string): boolean => model === 'jev-latest' || model === 'jev-preview';

export type Transport = (request: Request, signal: AbortSignal) => Promise<unknown>;
export function jevTransport(config: Config): Transport {
  // The endpoint is explicit so an unrelated TYPESAFE_BASE_URL override cannot
  // silently redirect reviewed source. Credential headers are never persisted.
  const client = new TypeSafeClient({ baseURL: 'https://api.typesafe.ai', logLevel: 'off', timeout: config.requestTimeoutMs, retry: { maxRetries: config.maxRetries } });
  return async (request, signal) => client.systemOne({ ...request, questions: request.questions as Record<string, SDKQuestion> }, { signal });
}
export function transportError(error: unknown): string {
  if (error instanceof APIError) return `Jev HTTP ${error.status}`;
  if (error instanceof Error) {
    const key = process.env.TYPESAFE_API_KEY;
    return key ? error.message.replaceAll(key, '[REDACTED]') : error.message;
  }
  return 'Jev request failed';
}
