import { describe, expect, it } from 'vitest';
import { dateKeyInTimezone, dateTimeInput, formatDateKey, shiftDateKey, startOfWeekKey, zonedDateTimeToIso } from './calendarTime.js';

describe('calendar timezone helpers', () => {
  it('converts an event time through a timezone and back across a DST season', () => {
    const value = zonedDateTimeToIso('2025-01-15', '09:30', 'America/New_York');
    expect(dateKeyInTimezone(value, 'America/New_York')).toBe('2025-01-15');
    expect(dateTimeInput(value, 'America/New_York')).toBe('2025-01-15T09:30');
    expect(dateKeyInTimezone(zonedDateTimeToIso('2025-07-15', '09:30', 'America/New_York'), 'America/New_York')).toBe('2025-07-15');
  });
  it('stores a custom reminder time as an absolute instant in the selected timezone', () => {
    const value = zonedDateTimeToIso('2026-12-15', '09:30', 'Asia/Kolkata');
    expect(value).toBe('2026-12-15T04:00:00.000Z');
    expect(dateTimeInput(value, 'Asia/Kolkata')).toBe('2026-12-15T09:30');
  });  it('handles midnight UTC offsets and leap-day date arithmetic', () => {
    expect(dateKeyInTimezone('2025-01-01T01:00:00Z', 'America/Los_Angeles')).toBe('2024-12-31');
    expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(formatDateKey('2024-02-29', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })).toMatch(/Feb 29/);
  });
  it('starts the week on Monday', () => {
    expect(startOfWeekKey('2026-10-25')).toBe('2026-10-19');
  });
});

