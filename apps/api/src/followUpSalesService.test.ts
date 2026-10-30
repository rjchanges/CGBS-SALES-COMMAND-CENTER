import { describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { getCalendarItems } from './calendarService.js';
import { FollowUpSalesError, updateFollowUpSalesDetails } from './followUpSalesService.js';

const admin = { id: 'admin', name: 'Workspace Admin', role: 'Admin' as const };
const seller = { id: 'seller', name: 'Assigned Seller', role: 'Salesperson' as const };
function setup() {
  const state = createSeedState(); const task = state.tasks.find((item) => item.status === 'Due')!; const lead = state.leads.find((item) => item.id === task.leadId)!;
  task.assignedTo = seller.name; lead.assignedTo = seller.name;
  state.tasks.forEach((item) => { if (item.leadId === lead.id && item.id !== task.id && item.status === 'Due') item.status = 'Cancelled'; });
  return { state, task, lead };
}
function payload(lead: ReturnType<typeof setup>['lead'], overrides: Record<string, unknown> = {}) {
  return { status: 'Qualified', priority: 'High', revenue: 250000, currency: 'INR', progression: 65, probability: 55, source: 'Referral', assignedTo: lead.assignedTo, expectedClose: '2026-12-01T00:00:00.000Z', notes: 'Budget confirmed.', dueAt: '2026-11-03T10:30:00.000Z', endsAt: '2026-11-03T11:00:00.000Z', taskNotes: 'Review proposal', ...overrides };
}
describe('follow-up sales details and close workflow', () => {
  it('updates the associated lead and same follow-up, with calendar and reopen values reflecting the save', () => {
    const { state, task, lead } = setup();
    const result = updateFollowUpSalesDetails(state, task.id, payload(lead), admin);
    expect(result.lead.id).toBe(task.leadId); expect(result.lead.status).toBe('Qualified'); expect(result.lead.revenue).toBe(250000);
    expect(result.lead.companyNetWorth).not.toBe(250000); expect(result.lead.expectedClose).toBe('2026-12-01T00:00:00.000Z');
    expect(result.task.id).toBe(task.id); expect(result.task.status).toBe('Due'); expect(result.task.dueAt).toBe('2026-11-03T10:30:00.000Z');
    expect(result.task.scheduleHistory).toHaveLength(1); expect(state.tasks.filter((item) => item.id === task.id)).toHaveLength(1);
    expect(state.leads.find((item) => item.id === lead.id)?.nextFollowUp).toBe(task.dueAt);
    const calendar = getCalendarItems(state, '2026-11-03T00:00:00.000Z', '2026-11-04T00:00:00.000Z', admin);
    expect(calendar.some((item) => item.id === `task:${task.id}` && item.startAt === task.dueAt)).toBe(true);
    expect(state.activities.some((item) => item.leadId === lead.id && item.title.includes('rescheduled'))).toBe(true);
  });
  it('denies another employee and reassignment for ordinary users', () => {
    const { state, task, lead } = setup();
    expect(() => updateFollowUpSalesDetails(state, task.id, payload(lead), { id: 'other', name: 'Other Seller', role: 'Salesperson' })).toThrowError(FollowUpSalesError);
    expect(() => updateFollowUpSalesDetails(state, task.id, payload(lead, { assignedTo: 'Different Seller' }), seller)).toThrowError(/manager or admin/);
  });
  it('requires the dedicated Process Outcome action for terminal stages', () => {
    const { state, task, lead } = setup();
    expect(() => updateFollowUpSalesDetails(state, task.id, payload(lead, { status: 'Won' }), admin)).toThrowError(/Opportunities/);
    expect(lead.status).not.toBe('Won'); expect(task.status).toBe('Due');
  });
  it('rejects completed follow-ups without changing their completion state', () => {
    const { state, task, lead } = setup(); task.status = 'Completed'; task.completedAt = new Date().toISOString();
    expect(() => updateFollowUpSalesDetails(state, task.id, payload(lead), admin)).toThrowError(/Only active follow-ups/);
    expect(task.status).toBe('Completed');
  });
});



