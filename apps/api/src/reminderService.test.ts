import { describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { deleteReminder, dispatchDueReminders, ReminderError, saveReminder, syncReminderEvent } from './reminderService.js';
const actor = { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin' as const };
describe('persistent reminders', () => {
  it('supports quick intervals, duplicate prevention, and custom absolute times', () => {
    const state = createSeedState(); const meeting = state.tasks.find((task) => task.type === 'Meeting')!;
    const created = saveReminder(state, 'task', meeting.id, { minutesBefore: 15, channels: ['in-app'] }, actor);
    expect(Date.parse(created.sendAt)).toBe(Date.parse(meeting.dueAt) - 15 * 60_000);
    expect(saveReminder(state, 'task', meeting.id, { minutesBefore: 15, channels: ['in-app'] }, actor).id).toBe(created.id);
    expect(() => saveReminder(state, 'task', meeting.id, { minutesBefore: null, sendAt: meeting.dueAt }, actor)).toThrowError(/before the event/);
    const custom = saveReminder(state, 'task', meeting.id, { minutesBefore: null, sendAt: new Date(Date.parse(meeting.dueAt) - 3_600_000).toISOString(), channels: ['in-app'] }, actor);
    expect(custom.minutesBefore).toBeNull();
  });
  it('reschedules relative reminders with their event and cancels on completion', () => {
    const state = createSeedState(); const meeting = state.tasks.find((task) => task.type === 'Meeting')!;
    const reminder = saveReminder(state, 'task', meeting.id, { minutesBefore: 30 }, actor);
    meeting.dueAt = '2026-12-20T11:00:00.000Z'; syncReminderEvent(state, 'task', meeting.id);
    expect(reminder.sendAt).toBe('2026-12-20T10:30:00.000Z');
    meeting.status = 'Completed'; syncReminderEvent(state, 'task', meeting.id);
    expect(reminder.status).toBe('Cancelled'); expect(reminder.enabled).toBe(false);
  });
  it('persists one inbox notification per reminder and supports deletion', () => {
    const state = createSeedState(); const meeting = state.tasks.find((task) => task.type === 'Meeting')!;
    const reminder = saveReminder(state, 'task', meeting.id, { minutesBefore: 5 }, actor);
    const now = new Date(Date.parse(reminder.sendAt) + 1000);
    expect(dispatchDueReminders(state, now)).toBe(1); expect(dispatchDueReminders(state, now)).toBe(0);
    expect(state.notifications.filter((item) => item.reminderId === reminder.id)).toHaveLength(1);
    expect(reminder.status).toBe('Delivered'); deleteReminder(state, reminder.id, actor); expect(reminder.status).toBe('Cancelled');
  });
  it('rejects other employee reminders and unsupported browser push', () => {
    const state = createSeedState(); const task = state.tasks.find((item) => item.status === 'Due')!; task.assignedTo = 'Other Seller';
    expect(() => saveReminder(state, 'task', task.id, { minutesBefore: 10 }, { id: 'u1', name: 'Rahul Raj M', role: 'Salesperson' })).toThrowError(ReminderError);
    task.assignedTo = actor.name;
    expect(() => saveReminder(state, 'task', task.id, { minutesBefore: 10, channels: ['push'] }, actor)).toThrowError(/push delivery is not configured/);
  });
});
