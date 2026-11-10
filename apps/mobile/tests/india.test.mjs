import test from 'node:test';
import assert from 'node:assert/strict';
import { displayIndianMobile, indianMobileDigits, indianPinDigits, INDIAN_MOBILE, INDIAN_PIN, indianNumber, inr, istDateTime } from '../src/india.ts';

test('Indian input formatting keeps a single country prefix and accepts a six-digit PIN', () => {
  const digits = indianMobileDigits('+91 98765 43210');
  assert.equal(displayIndianMobile(digits), '98765 43210');
  assert.equal(INDIAN_MOBILE.test('+91' + digits), true);
  assert.equal(INDIAN_MOBILE.test('+91' + indianMobileDigits('98765')), false);
  assert.equal(indianMobileDigits('+7 98765 43210'), '');
  assert.equal(indianPinDigits('560 001'), '560001');
  assert.equal(INDIAN_PIN.test(indianPinDigits('560')), false);
});

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
