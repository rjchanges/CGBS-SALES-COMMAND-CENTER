import { describe, expect, it } from 'vitest';
import type { CGBSState } from '../../../packages/shared/src/index';
import { scopeReportRecords } from './reportService.js';

const empty = {} as CGBSState;
describe('report authorization scope', () => {
  it('returns the full view to a manager', () => { expect(scopeReportRecords(empty, { id: 'm', name: 'Manager', role: 'Manager' })).toBe(empty); });
  it('limits employee exports to records they are allowed to view', () => {
    const data = { ...empty, leads: [{ id: 'own', assignedTo: 'Rae' }, { id: 'other', assignedTo: 'Kai' }], calls: [{ id: 'c1', leadId: 'own' }, { id: 'c2', leadId: 'other' }], voiceCalls: [], tasks: [{ id: 't1', leadId: 'own', assignedTo: 'Rae' }, { id: 't2', leadId: 'own', assignedTo: 'Kai' }], opportunities: [{ id: 'o1', leadId: 'other', owner: 'Rae' }, { id: 'o2', leadId: 'other', owner: 'Kai' }], activities: [{ id: 'a1', leadId: 'own' }, { id: 'a2', leadId: 'other' }], targets: [], calendarEvents: [], reminders: [], notifications: [] } as unknown as CGBSState;
    const scoped = scopeReportRecords(data, { id: 'rae', name: 'Rae', role: 'Sales' });
    expect(scoped.leads.map((item) => item.id)).toEqual(['own']);
    expect(scoped.calls.map((item) => item.id)).toEqual(['c1']);
    expect(scoped.tasks.map((item) => item.id)).toEqual(['t1']);
    expect(scoped.opportunities.map((item) => item.id)).toEqual(['o1']);
    expect(scoped.activities.map((item) => item.id)).toEqual(['a1']);
  });
});
