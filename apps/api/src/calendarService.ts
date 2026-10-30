import { randomUUID } from 'node:crypto';
import { addMinutes } from 'date-fns';
import { safeWebsiteUrl, type CalendarEvent, type CalendarEventStatus, type CalendarEventType, type CalendarItem, type CGBSState, type Priority } from '../../../packages/shared/dist/index.js';
import { getTargetMembers, TargetServiceError, type TargetActor } from './targetService.js';

type CalendarDraft = Pick<CalendarEvent, 'title' | 'description' | 'startAt' | 'endAt' | 'allDay' | 'type' | 'status' | 'leadId' | 'opportunityId' | 'assignedTo' | 'priority' | 'location' | 'meetingLink'>;
export type CalendarActor = TargetActor;
const eventTypes: CalendarEventType[] = ['Call', 'Follow-up', 'Meeting', 'Proposal', 'Opportunity', 'Other'];
const statuses: CalendarEventStatus[] = ['Scheduled', 'Completed', 'Cancelled'];
const priorities: Priority[] = ['Low', 'Medium', 'High', 'Critical'];
const time = (value: string) => Date.parse(value);
const durationEnd = (value: string, minutes: number) => addMinutes(new Date(value), minutes).toISOString();

function canManage(actor: CalendarActor): boolean { return actor.role === 'Admin' || actor.role === 'Manager'; }
function canAccessItem(item: CalendarItem, actor: CalendarActor): boolean {
  return canManage(actor) || item.assignedTo.toLowerCase() === actor.name.toLowerCase();
}
function normalizeDraft(value: unknown, state: CGBSState, actor: CalendarActor): CalendarDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TargetServiceError('Enter calendar event details.');
  const input = value as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 180) : '';
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 3000) : '';
  const startAt = typeof input.startAt === 'string' && Number.isFinite(Date.parse(input.startAt)) ? new Date(input.startAt).toISOString() : '';
  const endAt = typeof input.endAt === 'string' && Number.isFinite(Date.parse(input.endAt)) ? new Date(input.endAt).toISOString() : '';
  if (!title || !startAt || !endAt || time(endAt) <= time(startAt)) throw new TargetServiceError('Enter a title and a valid end time after the start time.');
  if (!eventTypes.includes(input.type as CalendarEventType)) throw new TargetServiceError('Choose a valid event type.');
  if (!statuses.includes(input.status as CalendarEventStatus)) throw new TargetServiceError('Choose a valid event status.');
  if (!priorities.includes(input.priority as Priority)) throw new TargetServiceError('Choose a valid priority.');
  const leadId = typeof input.leadId === 'string' && input.leadId ? input.leadId : null;
  const opportunityId = typeof input.opportunityId === 'string' && input.opportunityId ? input.opportunityId : null;
  if (leadId && !state.leads.some((item) => item.id === leadId)) throw new TargetServiceError('The selected lead no longer exists.', 404);
  const opportunity = opportunityId ? state.opportunities.find((item) => item.id === opportunityId) : null;
  if (opportunityId && !opportunity) throw new TargetServiceError('The selected opportunity no longer exists.', 404);
  if (leadId && opportunity && opportunity.leadId !== leadId) throw new TargetServiceError('The opportunity must belong to the selected lead.');
  let assignedTo = typeof input.assignedTo === 'string' ? input.assignedTo.trim() : '';
  if (!canManage(actor)) assignedTo = actor.name;
  if (!assignedTo) assignedTo = actor.name;
  if (canManage(actor) && assignedTo.toLowerCase() !== actor.name.toLowerCase() && !getTargetMembers(state).some((member) => member.toLowerCase() === assignedTo.toLowerCase())) throw new TargetServiceError('Choose an employee from the current workspace.');
  return {
    title, description, startAt, endAt, allDay: input.allDay === true,
    type: input.type as CalendarEventType, status: input.status as CalendarEventStatus,
    leadId: leadId || opportunity?.leadId || null, opportunityId, assignedTo,
    priority: input.priority as Priority,
    location: typeof input.location === 'string' ? input.location.trim().slice(0, 240) : '',
    meetingLink: typeof input.meetingLink === 'string' ? safeWebsiteUrl(input.meetingLink.trim()) || '' : '',
  };
}

export function createCalendarEvent(state: CGBSState, value: unknown, actor: CalendarActor): CalendarEvent {
  const draft = normalizeDraft(value, state, actor);
  const now = new Date().toISOString();
  const event: CalendarEvent = { ...draft, id: randomUUID(), createdBy: actor.name, createdAt: now, updatedAt: now };
  state.calendarEvents.unshift(event);
  return event;
}
export function updateCalendarEvent(state: CGBSState, id: string, value: unknown, actor: CalendarActor): CalendarEvent {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event) throw new TargetServiceError('Calendar event not found.', 404);
  if (!canManage(actor) && event.assignedTo.toLowerCase() !== actor.name.toLowerCase() && event.createdBy.toLowerCase() !== actor.name.toLowerCase()) throw new TargetServiceError('You cannot update this event.', 403);
  const draft = normalizeDraft(value, state, actor);
  Object.assign(event, draft, { updatedAt: new Date().toISOString() });
  return event;
}
export function deleteCalendarEvent(state: CGBSState, id: string, actor: CalendarActor): boolean {
  const index = state.calendarEvents.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const event = state.calendarEvents[index]!;
  if (!canManage(actor) && event.assignedTo.toLowerCase() !== actor.name.toLowerCase() && event.createdBy.toLowerCase() !== actor.name.toLowerCase()) throw new TargetServiceError('You cannot delete this event.', 403);
  state.calendarEvents.splice(index, 1);
  return true;
}

function itemBase(state: CGBSState, base: Omit<CalendarItem, 'leadName' | 'company'>): CalendarItem {
  const lead = base.leadId ? state.leads.find((item) => item.id === base.leadId) : null;
  return { ...base, leadName: lead?.name || '', company: lead?.company || '' };
}
function overlapsRange(startAt: string, endAt: string, start: number, end: number): boolean {
  return time(startAt) <= end && time(endAt) >= start;
}

/** Builds a bounded calendar range from source-of-truth CRM records and standalone event records. */
export function getCalendarItems(state: CGBSState, fromValue: string, toValue: string, actor: CalendarActor): CalendarItem[] {
  const from = Date.parse(fromValue);
  const to = Date.parse(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new TargetServiceError('Choose a valid calendar date range.');
  if (to - from > 63 * 86400000) throw new TargetServiceError('Calendar date ranges are limited to 63 days.');
  const inRange = (startAt: string, endAt: string) => overlapsRange(startAt, endAt, from, to);
  const items: CalendarItem[] = [];
  for (const task of state.tasks) {
    if (task.status === 'Cancelled' && !inRange(task.dueAt, task.endsAt || durationEnd(task.dueAt, 30))) continue;
    const endAt = task.endsAt && Date.parse(task.endsAt) > Date.parse(task.dueAt) ? task.endsAt : durationEnd(task.dueAt, 30);
    if (!inRange(task.dueAt, endAt)) continue;
    const category = task.type === 'Meeting' ? 'Meetings' : task.type === 'Call' ? 'Calls' : 'Follow-ups';
    const type: CalendarEventType = task.type === 'Meeting' ? 'Meeting' : task.type === 'Call' ? 'Call' : 'Follow-up';
    const lead = state.leads.find((item) => item.id === task.leadId);
    items.push(itemBase(state, {
      id: `task:${task.id}`, source: 'task', sourceId: task.id,
      title: `${task.type} · ${lead?.name || 'Lead follow-up'}`, description: [lead?.company, task.notes, task.completionNotes].filter(Boolean).join(' · '),
      startAt: task.dueAt, endAt, allDay: false, type, category,
      status: task.status === 'Completed' ? 'Completed' : task.status === 'Cancelled' ? 'Cancelled' : 'Scheduled',
      leadId: task.leadId, opportunityId: null, assignedTo: task.assignedTo, priority: task.priority,
      location: '', meetingLink: '', sourceType: task.type, sourceNotes: task.notes,
    }));
  }
  for (const call of state.calls) {
    const endAt = durationEnd(call.createdAt, Math.max(15, call.durationMinutes || 0));
    if (!inRange(call.createdAt, endAt)) continue;
    const lead = state.leads.find((item) => item.id === call.leadId);
    items.push(itemBase(state, {
      id: `call:${call.id}`, source: 'call', sourceId: call.id,
      title: `Call · ${lead?.name || 'Lead'} · ${call.outcome}`, description: [lead?.company, call.notes].filter(Boolean).join(' · '),
      startAt: call.createdAt, endAt, allDay: false, type: 'Call', category: 'Calls', status: 'Completed',
      leadId: call.leadId, opportunityId: null, assignedTo: call.createdBy, priority: lead?.priority || 'Medium',
      location: '', meetingLink: '', sourceType: 'Call', sourceNotes: call.notes,
    }));
  }
  for (const activity of state.activities) {
    if (activity.type === 'Call' || activity.type === 'Follow-up' || activity.type === 'Opportunity') continue;
    const endAt = durationEnd(activity.createdAt, 15);
    if (!inRange(activity.createdAt, endAt)) continue;
    const lead = state.leads.find((item) => item.id === activity.leadId);
    items.push(itemBase(state, {
      id: `activity:${activity.id}`, source: 'activity', sourceId: activity.id,
      title: activity.title, description: [lead?.company, activity.detail].filter(Boolean).join(' · '),
      startAt: activity.createdAt, endAt, allDay: false, type: 'Other', category: 'CRM activity', status: 'Completed',
      leadId: activity.leadId, opportunityId: null, assignedTo: activity.createdBy, priority: lead?.priority || 'Medium',
      location: '', meetingLink: '', sourceType: activity.type, sourceNotes: activity.detail,
    }));
  }
  for (const opportunity of state.opportunities) {
    const date = opportunity.stage === 'Closed Won' ? opportunity.actualCloseAt : opportunity.expectedClose;
    if (!date) continue;
    const endAt = durationEnd(date, 30);
    if (!inRange(date, endAt)) continue;
    const lead = state.leads.find((item) => item.id === opportunity.leadId);
    items.push(itemBase(state, {
      id: `opportunity:${opportunity.id}`, source: 'opportunity', sourceId: opportunity.id,
      title: `${opportunity.stage === 'Closed Won' ? 'Closed Won' : 'Expected close'} · ${opportunity.name}`,
      description: [lead?.name, lead?.company, opportunity.notes].filter(Boolean).join(' · '),
      startAt: date, endAt, allDay: true, type: 'Opportunity', category: 'Opportunities',
      status: opportunity.stage === 'Closed Won' ? 'Completed' : 'Scheduled', leadId: opportunity.leadId,
      opportunityId: opportunity.id, assignedTo: opportunity.accomplishedByName || opportunity.owner,
      priority: lead?.priority || 'Medium', location: '', meetingLink: '', sourceType: opportunity.stage, sourceNotes: opportunity.notes,
    }));
  }
  for (const event of state.calendarEvents) {
    const endAt = event.allDay && time(event.endAt) <= time(event.startAt) ? durationEnd(event.startAt, 1440) : event.endAt;
    if (!inRange(event.startAt, endAt)) continue;
    const leadId = event.leadId || state.opportunities.find((item) => item.id === event.opportunityId)?.leadId || null;
    items.push(itemBase(state, {
      id: `event:${event.id}`, source: 'event', sourceId: event.id,
      title: event.title, description: event.description, startAt: event.startAt, endAt, allDay: event.allDay,
      type: event.type, category: 'Events', status: event.status, leadId, opportunityId: event.opportunityId,
      assignedTo: event.assignedTo, priority: event.priority, location: event.location, meetingLink: event.meetingLink, sourceType: event.type, sourceNotes: event.description,
    }));
  }
  return items.filter((item) => canAccessItem(item, actor)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || time(a.startAt) - time(b.startAt)).slice(0, 1500);
}
