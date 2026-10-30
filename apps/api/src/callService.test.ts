import { describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { getCalendarItems } from './calendarService.js';
import { CallServiceError, recordCall } from './callService.js';

const admin = { id: 'admin', name: 'Rahul Raj M', role: 'Admin' as const };
const seller = { id: 'seller', name: 'Sales Rep', role: 'Salesperson' as const };
const date = '2026-11-12T11:00:00.000Z';
function setup() { const state = createSeedState(); const lead = state.leads[0]!; return { state, lead }; }
describe('calling outcome workflow', () => {
  it('records RNR history and upserts a single callback with calendar visibility', () => {
    const { state, lead } = setup();
    const first = recordCall(state, { leadId: lead.id, outcome: 'RNR', clientMutationId: 'call-1', nextAction: { dueAt: date, notes: 'Retry after requested time.' } }, admin);
    const retry = recordCall(state, { leadId: lead.id, outcome: 'RNR', clientMutationId: 'call-1', nextAction: { dueAt: date, notes: 'Retry after requested time.' } }, admin);
    expect(first.duplicate).toBe(false); expect(retry.duplicate).toBe(true);
    expect(state.calls.filter((item) => item.leadId === lead.id && item.outcome === 'RNR')).toHaveLength(1);
    expect(state.tasks.filter((item) => item.leadId === lead.id && item.type === 'RNR callback' && item.status === 'Due')).toHaveLength(1);
    expect(state.activities.some((item) => item.leadId === lead.id && item.title.includes('RNR'))).toBe(true);
    const items = getCalendarItems(state, '2026-11-12T00:00:00.000Z', '2026-11-13T00:00:00.000Z', admin);
    expect(items.some((item) => item.source === 'task' && item.startAt === date)).toBe(true);
  });
  it('creates a scheduled meeting separately from its completion and does not lose a lead from Not Interested', () => {
    const { state, lead } = setup();
    recordCall(state, { leadId: lead.id, outcome: 'Meeting Scheduled', clientMutationId: 'meeting-1', nextAction: { dueAt: date } }, admin);
    const meeting = state.tasks.find((item) => item.leadId === lead.id && item.type === 'Meeting' && item.status === 'Due')!;
    expect(lead.status).toBe('Meeting Scheduled'); expect(meeting.completedAt).toBeNull();
    recordCall(state, { leadId: state.leads[1]!.id, outcome: 'Not Interested', clientMutationId: 'not-interested' }, admin);
    expect(state.leads[1]!.status).not.toBe('Lost');
  });
  it('requires next-action time for outcomes needing follow-up and denies another owner’s lead', () => {
    const { state, lead } = setup();
    expect(() => recordCall(state, { leadId: lead.id, outcome: 'Busy' }, admin)).toThrowError(/date and time/);
    expect(() => recordCall(state, { leadId: lead.id, outcome: 'Answered' }, seller)).toThrowError(CallServiceError);
  });
  it('does not schedule an automatic callback for Invalid Number', () => {
    const { state, lead } = setup();
    const before = state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due').length;
    recordCall(state, { leadId: lead.id, outcome: 'Invalid Number', clientMutationId: 'invalid-1' }, admin);
    expect(state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due')).toHaveLength(before);
  });
  it('rejects logging calls against terminal leads', () => {
    const { state, lead } = setup(); lead.status = 'Won';
    expect(() => recordCall(state, { leadId: lead.id, outcome: 'Answered' }, admin)).toThrowError(/lead is closed/);
  });});



