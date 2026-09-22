import * as comments from './comments/questions.ts';
import * as functions from './functions/questions.ts';
import * as tests from './tests/questions.ts';
import { extractComments } from './comments/context.ts';
import { extractFunctions, extractTests } from './code/context.ts';
import type { AnalysisPack } from './types.ts';
import type { PackId } from '../contracts.ts';

export const packs: Record<PackId, AnalysisPack> = {
  comments: {
    id: 'comments',
    version: comments.PACK_VERSION,
    definitions: comments.definitions,
    definitionHash: comments.definitionHash,
    extract: extractComments,
  },
  functions: {
    id: 'functions',
    version: functions.PACK_VERSION,
    definitions: functions.definitions,
    definitionHash: functions.definitionHash,
    extract: extractFunctions,
  },
  tests: {
    id: 'tests',
    version: tests.PACK_VERSION,
    definitions: tests.definitions,
    definitionHash: tests.definitionHash,
    extract: extractTests,
  },
};
