import { randomUUID } from 'node:crypto';
import type { CGBSState, Reminder } from '../../../packages/shared/dist/index.js';
import type { TargetActor } from './targetService.js';

export class ReminderError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const quickOffsets = [5, 10, 15, 30, 60, 1440];
function canManage(actor: TargetActor) { return actor.role === 'Admin' || actor.role === 'Manager'; }
function eventInfo(state: CGBSState, sourceType: 'task' | 'event', sourceId: string) {
  if (sourceType === 'task') {
    const task = state.tasks.find((item) => item.id === sourceId);
    if (!task) throw new ReminderError('Follow-up not found.', 404);
    if (task.status !== 'Due') throw new ReminderError('Reminders are only available for active follow-ups.', 409);
    return { startAt: task.dueAt, endAt: task.endsAt || task.dueAt, owner: task.assignedTo, title: task.type };
  }
  const event = state.calendarEvents.find((item) => item.id === sourceId);
  if (!event) throw new ReminderError('Calendar event not found.', 404);
  if (event.status !== 'Scheduled') throw new ReminderError('Reminders are only available for scheduled events.', 409);
  return { startAt: event.startAt, endAt: event.endAt, owner: event.assignedTo, title: event.title };
}
function canAccess(owner: string, actor: TargetActor) { return canManage(actor) || owner.toLowerCase() === actor.name.toLowerCase(); }
export function listReminders(state: CGBSState, actor: TargetActor) {
  return state.reminders.filter((item) => canManage(actor) || item.ownerId === actor.id);
}
export function saveReminder(state: CGBSState, sourceType: unknown, sourceId: unknown, value: unknown, actor: TargetActor, reminderId?: string): Reminder {
  if (sourceType !== 'task' && sourceType !== 'event') throw new ReminderError('Choose a follow-up or calendar event.');
  if (typeof sourceId !== 'string' || !sourceId) throw new ReminderError('Choose an event.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReminderError('Enter reminder details.');
  const input = value as Record<string, unknown>;
  const event = eventInfo(state, sourceType, sourceId);
  if (!canAccess(event.owner, actor)) throw new ReminderError('You cannot manage reminders for another employee’s event.', 403);
  const existing = reminderId ? state.reminders.find((item) => item.id === reminderId && item.sourceType === sourceType && item.sourceId === sourceId) : undefined;
  if (reminderId && !existing) throw new ReminderError('Reminder not found.', 404);
  if (existing && !canAccess(event.owner, actor) && existing.ownerId !== actor.id) throw new ReminderError('You cannot edit this reminder.', 403);
  const minutesBefore = input.minutesBefore === null || input.minutesBefore === undefined ? null : Number(input.minutesBefore);
  if (minutesBefore !== null && (!quickOffsets.includes(minutesBefore) || ![5, 10, 15, 30, 60, 1440].includes(minutesBefore))) throw new ReminderError('Choose a supported reminder interval.');
  const sendAt = minutesBefore === null ? String(input.sendAt || '') : new Date(Date.parse(event.startAt) - minutesBefore * 60_000).toISOString();
  if (!Number.isFinite(Date.parse(sendAt))) throw new ReminderError('Choose a valid reminder date and time.');
  if (Date.parse(sendAt) >= Date.parse(event.startAt)) throw new ReminderError('Reminder time must be before the event starts.');
  const channels = Array.isArray(input.channels) ? input.channels.filter((item) => item === 'in-app' || item === 'push') : ['in-app'];
  if (!channels.includes('in-app')) channels.push('in-app');
  if (channels.includes('push')) throw new ReminderError('Browser push delivery is not configured. Use in-app reminders or configure the push service.', 501);
  if (existing) {
    existing.sendAt = sendAt; existing.minutesBefore = minutesBefore; existing.channels = channels as ('in-app'|'push')[]; existing.enabled = input.enabled !== false;
    existing.eventStartAt = event.startAt; existing.updatedAt = new Date().toISOString(); existing.status = existing.enabled ? 'Pending' : 'Cancelled'; existing.lastError = ''; existing.deliveredAt = null;
    return existing;
  }
  const duplicate = state.reminders.find((item) => item.sourceType === sourceType && item.sourceId === sourceId && item.ownerId === actor.id && item.enabled && item.sendAt === sendAt);
  if (duplicate) return duplicate;
  const now = new Date().toISOString();
  const reminder: Reminder = { id: randomUUID(), sourceType, sourceId, ownerId: actor.id, ownerName: actor.name, sendAt, minutesBefore, channels: channels as ('in-app'|'push')[], enabled: input.enabled !== false, status: input.enabled === false ? 'Cancelled' : 'Pending', idempotencyKey: `${sourceType}:${sourceId}:${actor.id}:${sendAt}`, attempts: 0, deliveredAt: null, lastError: '', eventStartAt: event.startAt, createdAt: now, updatedAt: now };
  state.reminders.unshift(reminder);
  return reminder;
}
export function deleteReminder(state: CGBSState, reminderId: string, actor: TargetActor) {
  const reminder = state.reminders.find((item) => item.id === reminderId);
  if (!reminder) throw new ReminderError('Reminder not found.', 404);
  if (!canManage(actor) && reminder.ownerId !== actor.id) throw new ReminderError('You cannot manage this reminder.', 403);
  reminder.enabled = false; reminder.status = 'Cancelled'; reminder.updatedAt = new Date().toISOString();
  return reminder;
}
export function syncReminderEvent(state: CGBSState, sourceType: 'task' | 'event', sourceId: string) {
  const reminders = state.reminders.filter((item) => item.sourceType === sourceType && item.sourceId === sourceId && item.enabled && item.status === 'Pending');
  for (const reminder of reminders) {
    try {
      const event = eventInfo(state, sourceType, sourceId);
      reminder.eventStartAt = event.startAt;
      if (reminder.minutesBefore !== null) {
        reminder.sendAt = new Date(Date.parse(event.startAt) - reminder.minutesBefore * 60_000).toISOString();
        reminder.idempotencyKey = `${sourceType}:${sourceId}:${reminder.ownerId}:${reminder.sendAt}`;
      }
      reminder.updatedAt = new Date().toISOString();
    } catch (error) {
      reminder.enabled = false; reminder.status = 'Cancelled'; reminder.lastError = error instanceof Error ? error.message : 'Event unavailable'; reminder.updatedAt = new Date().toISOString();
    }
  }
}export function dispatchDueReminders(state: CGBSState, now = new Date()): number {
  const stamp = now.toISOString(); let delivered = 0;
  for (const reminder of state.reminders) {
    if (!reminder.enabled || reminder.status !== 'Pending' || Date.parse(reminder.sendAt) > now.getTime()) continue;
    try {
      const event = eventInfo(state, reminder.sourceType, reminder.sourceId);
      reminder.eventStartAt = event.startAt;
      if (Date.parse(reminder.sendAt) >= Date.parse(event.startAt) || now.getTime() > Date.parse(event.endAt)) { reminder.status = 'Cancelled'; reminder.enabled = false; reminder.updatedAt = stamp; continue; }
      if (state.notifications.some((item) => item.reminderId === reminder.id)) { reminder.status = 'Delivered'; reminder.deliveredAt = state.notifications.find((item) => item.reminderId === reminder.id)!.createdAt; continue; }
      state.notifications.unshift({ id: randomUUID(), reminderId: reminder.id, userId: reminder.ownerId, title: `${event.title} reminder`, body: `Starts at ${event.startAt} (${state.settings.timezone}).`, createdAt: stamp, readAt: null });
      reminder.status = 'Delivered'; reminder.deliveredAt = stamp; reminder.attempts += 1; reminder.updatedAt = stamp; delivered += 1;
    } catch (error) {
      reminder.status = 'Cancelled'; reminder.enabled = false; reminder.lastError = error instanceof Error ? error.message : 'Event unavailable'; reminder.updatedAt = stamp;
    }
  }
  return delivered;
}




