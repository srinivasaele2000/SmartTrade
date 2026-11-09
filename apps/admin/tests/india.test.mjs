import test from 'node:test';
import assert from 'node:assert/strict';
import { indianNumber, inr, istDateTime } from '../src/india.ts';

test('admin displays Indian numbers, INR and IST dates', () => {
  assert.equal(indianNumber('1234567.5'), '12,34,567.5');
  assert.match(inr('1234567.5'), /^₹\s?12,34,567\.50$/);
  assert.equal(istDateTime('2026-01-02T00:00:00Z'), '02-01-2026 05:30 IST');
});
