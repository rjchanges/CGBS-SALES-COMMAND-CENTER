import { describe, expect, it } from 'vitest';
import type { CallRecord, FollowUpTask, Lead } from '../../../packages/shared/src/index';
import { categorizeLead } from './leadCategories';

const lead = (status: Lead['status'] = 'New Lead', extra: Partial<Lead> = {}): Lead => ({
  id: 'lead-1', name: 'Asha', company: 'Acme', role: '', companyLogo: '', companyNetWorth: 0,
  aiOutreachTopic: '', aiOpeningMessage: '', aiEmailSubject: '', aiFollowUpApproach: '', email: '', phone: '', website: '', linkedin: '', industry: 'Other', source: 'Other', status, priority: 'Medium', revenue: 0, currency: 'INR', progression: 5, probability: 10, assignedTo: 'Agent', nextFollowUp: null, expectedClose: null, notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', lastContacted: null, archived: false, stageHistory: [], ...extra,
});
const call = (outcome: string, createdAt = '2026-01-02T00:00:00Z'): CallRecord => ({ id: outcome, leadId: 'lead-1', outcome, notes: '', durationMinutes: 0, createdAt, createdBy: 'Agent' });
const task = (type: FollowUpTask['type'], status: FollowUpTask['status'] = 'Due'): FollowUpTask => ({ id: type, leadId: 'lead-1', type, dueAt: '2026-01-03T00:00:00Z', priority: 'Medium', assignedTo: 'Agent', notes: '', status, createdAt: '2026-01-02T00:00:00Z', completedAt: null });

describe('lead connection categories', () => {
  it('keeps Won and Lost out of active follow-up categories', () => {
    expect(categorizeLead(lead('Won'), [call('Call Back Later')], [task('Call Back Later')])).toBe('Won / Lost');
    expect(categorizeLead(lead('Lost'), [], [])).toBe('Won / Lost');
  });
  it('distinguishes failed attempts, RNR callbacks, connections, and scheduled meetings', () => {
    expect(categorizeLead(lead(), [call('Busy')], [])).toBe('Not Connected');
    expect(categorizeLead(lead(), [call('No Answer', '2026-01-03T00:00:00Z'), call('Busy')], [])).toBe('Not Responded');
    expect(categorizeLead(lead(), [call('RNR')], [task('RNR callback')])).toBe('Need to Connect Again');
    expect(categorizeLead(lead(), [call('Answered')], [])).toBe('Connected');
    expect(categorizeLead(lead(), [], [task('Meeting')])).toBe('Meeting Scheduled');
  });
  it('uses explicit saved sales and alternative-contact states', () => {
    expect(categorizeLead(lead('Interested'), [], [])).toBe('Interested');
    expect(categorizeLead(lead('Qualified'), [], [])).toBe('Qualified');
    expect(categorizeLead(lead('New Lead', { alternativeContactMethod: 'Email' }), [], [])).toBe('Alternative Way to Connect');
  });
});
