import { describe, expect, it } from 'vitest';
import { countdownParts, meetingState } from './meetingCountdown';
const now = Date.parse('2026-10-26T10:00:00.000Z');
describe('meeting countdown states', () => {
  const task = (dueAt: string, endsAt: string, status: 'Due'|'Completed'|'Cancelled' = 'Due') => ({ status, dueAt, endsAt });
  it('shows day/hour/minute/second countdown and soon state', () => { expect(countdownParts('2026-10-27T11:02:03.000Z', now)).toEqual({ days: 1, hours: 1, minutes: 2, seconds: 3 }); expect(meetingState(task('2026-10-26T10:10:00.000Z', '2026-10-26T11:00:00.000Z'), now)).toBe('Starting Soon'); });
  it('detects upcoming, in progress, overdue, completed and cancelled', () => { expect(meetingState(task('2026-10-26T13:00:00Z','2026-10-26T14:00:00Z'),now)).toBe('Upcoming'); expect(meetingState(task('2026-10-26T09:59:00Z','2026-10-26T11:00:00Z'),now)).toBe('In Progress'); expect(meetingState(task('2026-10-26T08:00:00Z','2026-10-26T09:00:00Z'),now)).toBe('Overdue'); expect(meetingState(task('','', 'Completed'),now)).toBe('Completed'); expect(meetingState(task('','', 'Cancelled'),now)).toBe('Cancelled'); });
});
