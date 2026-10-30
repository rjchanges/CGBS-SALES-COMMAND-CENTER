import { describe, expect, it } from 'vitest';
import { isE164PhoneNumber, normalizeE164PhoneNumber } from './phoneNumber.js';

describe('E.164 phone validation', () => {
  it('accepts international numbers with a leading plus', () => {
    expect(isE164PhoneNumber('+919876543210')).toBe(true);
    expect(isE164PhoneNumber('+14155552671')).toBe(true);
  });
  it('rejects local, malformed, and overlong numbers', () => {
    for (const value of ['9876543210', '00919876543210', '+0123456789', '+1234567', '+1234567890123456', null]) expect(isE164PhoneNumber(value)).toBe(false);
  });
  it('normalizes conventional display separators before validating a lead number', () => {
    expect(normalizeE164PhoneNumber('+91 98765 43210')).toBe('+919876543210');
    expect(normalizeE164PhoneNumber('9876543210')).toBe(null);
  });
});
