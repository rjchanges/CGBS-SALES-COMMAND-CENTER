import type { FollowUpTask } from '../../../packages/shared/src/index';
export type MeetingState = 'Upcoming' | 'Starting Soon' | 'In Progress' | 'Completed' | 'Cancelled' | 'Overdue';
export function meetingState(task: Pick<FollowUpTask, 'status' | 'dueAt' | 'endsAt'>, now: number): MeetingState {
  if (task.status === 'Completed') return 'Completed';
  if (task.status === 'Cancelled') return 'Cancelled';
  const start = Date.parse(task.dueAt); const end = task.endsAt ? Date.parse(task.endsAt) : start + 60 * 60_000;
  if (now >= end) return 'Overdue';
  if (now >= start) return 'In Progress';
  if (start - now <= 15 * 60_000) return 'Starting Soon';
  return 'Upcoming';
}
export function countdownParts(startAt: string, now: number) {
  const delta = Math.max(0, Date.parse(startAt) - now);
  const totalSeconds = Math.floor(delta / 1000);
  return { days: Math.floor(totalSeconds / 86400), hours: Math.floor(totalSeconds % 86400 / 3600), minutes: Math.floor(totalSeconds % 3600 / 60), seconds: totalSeconds % 60 };
}
