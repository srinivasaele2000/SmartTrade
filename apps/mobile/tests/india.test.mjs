import test from 'node:test';
import assert from 'node:assert/strict';
import { INDIAN_MOBILE, INDIAN_PIN, indianNumber, inr, istDateTime } from '../src/india.ts';

test('India identifiers and display formatting are deterministic', () => {
  assert.equal(INDIAN_MOBILE.test('+919876543210'), true);
  assert.equal(INDIAN_MOBILE.test('+12025550100'), false);
  assert.equal(INDIAN_PIN.test('560001'), true);
  assert.equal(INDIAN_PIN.test('012345'), false);
  assert.equal(indianNumber('1234567.5000', 2), '12,34,567.50');
  assert.equal(inr('1234567.5'), '₹12,34,567.50');
  assert.equal(istDateTime('2026-01-02T00:00:00Z'), '02-01-2026 05:30 IST');
  assert.equal(istDateTime('2026-11-01T19:25:27.485712Z'), '02-11-2026 00:55 IST');
  assert.equal(istDateTime('invalid'), 'Date unavailable');
  assert.equal(istDateTime(undefined), 'Date unavailable');
});
