import { describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { calculateMetrics } from './analytics.js';
import { OpportunityServiceError, reopenOpportunity, transitionOpportunityStage } from './opportunityService.js';
const admin = { id: 'admin', name: 'Workspace Admin', role: 'Admin' as const };
const seller = { id: 'seller', name: 'Rahul Raj M', role: 'Salesperson' as const };
function setup() { const state = createSeedState(); const opp = state.opportunities.find((item) => item.stage === 'Proposal')!; const lead = state.leads.find((item) => item.id === opp.leadId)!; return { state, opp, lead }; }
describe('opportunity stage workflow', () => {
  it('syncs open stage changes to lead history and audits changes', () => { const { state, opp, lead } = setup(); transitionOpportunityStage(state, opp.id, 'Negotiation', '', seller); expect(opp.stage).toBe('Negotiation'); expect(lead.status).toBe('Negotiation'); expect(state.activities.some((item) => item.title.includes('Opportunity moved to Negotiation'))).toBe(true); });
  it('closes won deals with attribution and realized revenue, then rejects duplicate closure', () => { const { state, opp, lead } = setup(); const previousRevenue = calculateMetrics(state).closedWonRevenue; transitionOpportunityStage(state, opp.id, 'Closed Won', '', admin); expect(opp.actualCloseAt).toBeTruthy(); expect(opp.accomplishedById).toBe(admin.id); expect(lead.status).toBe('Won'); expect(calculateMetrics(state).closedWonRevenue).toBe(previousRevenue + opp.amount); expect(() => transitionOpportunityStage(state, opp.id, 'Closed Won', '', admin)).toThrowError(/already in that stage/); });
  it('requires loss reason, excludes lost deals from revenue, and retains task history', () => { const { state, opp, lead } = setup(); const previousRevenue = calculateMetrics(state).closedWonRevenue; const task = state.tasks.find((item) => item.leadId === lead.id && item.status === 'Due'); expect(() => transitionOpportunityStage(state, opp.id, 'Closed Lost', '', admin)).toThrowError(/loss reason/); transitionOpportunityStage(state, opp.id, 'Closed Lost', 'Budget declined', admin); expect(opp.lossReason).toBe('Budget declined'); expect(opp.actualCloseAt).toBeTruthy(); expect(lead.actualCloseAt).toBeTruthy(); expect(lead.status).toBe('Lost'); expect(task?.status).toBe('Cancelled'); expect(state.tasks.some((item) => item.id === task?.id)).toBe(true); expect(calculateMetrics(state).closedWonRevenue).toBe(previousRevenue); });
  it('requires authorized closure and reopens with a recorded audit event', () => { const { state, opp, lead } = setup(); expect(() => transitionOpportunityStage(state, opp.id, 'Closed Won', '', seller)).toThrowError(OpportunityServiceError); transitionOpportunityStage(state, opp.id, 'Closed Won', '', admin); expect(() => reopenOpportunity(state, opp.id, seller)).toThrowError(/manager or admin/); reopenOpportunity(state, opp.id, admin); expect(opp.stage).toBe('Proposal'); expect(lead.status).toBe('Proposal Sent'); expect(state.activities.some((item) => item.title === 'Opportunity reopened')).toBe(true); });
  it('reopens the lead when one opportunity is reopened even if another remains closed', () => {
    const { state, opp, lead } = setup();
    const other = { ...opp, id: 'other-closed', name: 'Other closed deal', stage: 'Closed Lost' as const, lossReason: 'Prior loss', preCloseStage: 'Discovery' as const, actualCloseAt: new Date().toISOString() };
    state.opportunities.push(other);
    transitionOpportunityStage(state, opp.id, 'Closed Won', '', admin);
    expect(lead.status).toBe('Won');
    reopenOpportunity(state, opp.id, admin);
    expect(lead.status).toBe('Proposal Sent'); expect(opp.stage).toBe('Proposal'); expect(other.stage).toBe('Closed Lost');
  });});


