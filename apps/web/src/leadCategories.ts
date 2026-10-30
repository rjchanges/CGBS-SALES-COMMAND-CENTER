import type { CallRecord, FollowUpTask, Lead, LeadStatus } from '../../../packages/shared/src/index';

export const connectionCategories = [
  'All Leads', 'Connected', 'Not Connected', 'Not Responded', 'Interested',
  'Need to Connect Again', 'Alternative Way to Connect', 'Qualified',
  'Meeting Scheduled', 'Won / Lost',
] as const;
export type ConnectionCategory = typeof connectionCategories[number];

const terminalStatuses: LeadStatus[] = ['Won', 'Lost'];
const qualifiedStatuses: LeadStatus[] = ['Qualified', 'Proposal Sent', 'Negotiation'];
const answeredOutcomes = new Set(['Answered', 'Interested', 'Not Interested', 'Meeting Scheduled']);
const notConnectedOutcomes = new Set(['No Answer', 'Busy', 'Failed', 'Invalid Number']);

export function categorizeLead(lead: Lead, calls: CallRecord[], tasks: FollowUpTask[]): Exclude<ConnectionCategory, 'All Leads'> | null {
  if (terminalStatuses.includes(lead.status)) return 'Won / Lost';
  const leadCalls = calls.filter((call) => call.leadId === lead.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const leadTasks = tasks.filter((task) => task.leadId === lead.id);
  const activeTasks = leadTasks.filter((task) => task.status === 'Due');
  const latestOutcome = leadCalls[0]?.outcome;
  if (lead.status === 'Meeting Scheduled' || activeTasks.some((task) => task.type === 'Meeting')) return 'Meeting Scheduled';
  if (qualifiedStatuses.includes(lead.status)) return 'Qualified';
  if (lead.alternativeContactMethod) return 'Alternative Way to Connect';
  if (lead.status === 'Interested' || latestOutcome === 'Interested') return 'Interested';
  if (['RNR', 'Call Back Later'].includes(latestOutcome || '') || lead.status === 'RNR' || lead.status === 'Follow-up Required' || activeTasks.some((task) => ['Call', 'RNR callback', 'Call Back Later'].includes(task.type))) return 'Need to Connect Again';
  if (latestOutcome && notConnectedOutcomes.has(latestOutcome)) {
    const hasAnyResponse = leadCalls.some((call) => answeredOutcomes.has(call.outcome) || call.outcome === 'Not Interested');
    const failedAttempts = leadCalls.filter((call) => notConnectedOutcomes.has(call.outcome)).length;
    return !hasAnyResponse && failedAttempts >= 2 ? 'Not Responded' : 'Not Connected';
  }
  if (leadCalls.some((call) => notConnectedOutcomes.has(call.outcome))) return 'Not Connected';
  if (leadCalls.some((call) => answeredOutcomes.has(call.outcome)) || lead.status === 'Contacted') return 'Connected';
  return null;
}
