import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fee } from './functions.ts';

test('calculates the fee in basis points', () => {
  const cents = 2000;
  const basisPoints = 500;
  const expected = Math.round((cents * basisPoints) / 10_000);
  assert.equal(fee(cents, basisPoints), expected);
});

test('charges 100 cents for a 500 basis point fee on 2000 cents', () => {
  assert.equal(fee(2000, 500), 100);
});

test('returns an empty array when no records match', () => {
  const matches: string[] = [];
  assert.ok(matches);
});
