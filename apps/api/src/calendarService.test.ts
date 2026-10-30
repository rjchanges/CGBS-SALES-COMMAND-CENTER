import { describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { createCalendarEvent, deleteCalendarEvent, getCalendarItems, TargetServiceError, updateCalendarEvent } from './calendarService.js';

const admin = { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin' as const };
const employee = { id: 'sales-2', name: 'Asha Nair', role: 'Salesperson' as const };
const plusMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60000).toISOString();
function eventDraft(overrides: Record<string, unknown> = {}) {
  const startAt = plusMinutes(new Date(), 30);
  return { title: 'Discovery conversation', description: 'Prepare introduction', startAt, endAt: plusMinutes(new Date(startAt), 45), allDay: false, type: 'Meeting', status: 'Scheduled', leadId: null, opportunityId: null, assignedTo: admin.name, priority: 'Medium', location: '', meetingLink: '', ...overrides };
}

describe('calendar service', () => {
  it('creates, edits, and deletes a standalone event with a related lead', () => {
    const state = createSeedState();
    const event = createCalendarEvent(state, eventDraft({ leadId: state.leads[0]!.id }), admin);
    expect(event.leadId).toBe(state.leads[0]?.id);
    expect(getCalendarItems(state, plusMinutes(new Date(), -60), plusMinutes(new Date(), 180), admin).some((item) => item.id === `event:${event.id}`)).toBe(true);
    expect(updateCalendarEvent(state, event.id, eventDraft({ title: 'Updated discovery' }), admin).title).toBe('Updated discovery');
    expect(deleteCalendarEvent(state, event.id, admin)).toBe(true);
    expect(state.calendarEvents).toHaveLength(0);
  });

  it('bounds requested ranges and only exposes employee events to their assignee', () => {
    const state = createSeedState();
    const event = createCalendarEvent(state, eventDraft({ assignedTo: admin.name }), admin);
    expect(() => getCalendarItems(state, '2025-01-01T00:00:00Z', '2025-04-01T00:00:00Z', admin)).toThrowError(TargetServiceError);
    expect(getCalendarItems(state, plusMinutes(new Date(), -60), plusMinutes(new Date(), 180), employee).some((item) => item.id === `event:${event.id}`)).toBe(false);
  });

  it('assigns salesperson-created events to the current employee and includes source CRM records', () => {
    const state = createSeedState();
    const event = createCalendarEvent(state, eventDraft({ assignedTo: admin.name }), employee);
    expect(event.assignedTo).toBe(employee.name);
    const items = getCalendarItems(state, plusMinutes(new Date(), -8640), plusMinutes(new Date(), 60 * 24 * 50), admin);
    expect(items.some((item) => item.source === 'task')).toBe(true);
    expect(items.some((item) => item.source === 'opportunity')).toBe(true);
  });
});
