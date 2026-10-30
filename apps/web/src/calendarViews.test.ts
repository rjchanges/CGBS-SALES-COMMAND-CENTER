import { describe, expect, it } from 'vitest';
import { dateRange, daysBetween, rangeTitle, type CalendarView } from './calendarViews.js';

describe('calendar view ranges', () => {
  it.each([
    ['Day', 1], ['Work Week', 5], ['Week', 7], ['Agenda', 31],
  ] as [CalendarView, number][])('returns the expected number of days for %s view', (view, length) => {
    const range = dateRange(view, '2026-10-21');
    expect(daysBetween(range.start, range.end)).toHaveLength(length);
  });
  it('pads month view to full Monday-to-Sunday weeks, including leap days', () => {
    const range = dateRange('Month', '2024-02-14');
    const days = daysBetween(range.start, range.end);
    expect(days.length % 7).toBe(0);
    expect(days).toContain('2024-02-29');
    expect(rangeTitle('Month', '2024-02-14', range)).toBe('February 2024');
  });
});
