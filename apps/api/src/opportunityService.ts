import { randomUUID } from 'node:crypto';
import type { CGBSState, LeadStatus, Opportunity } from '../../../packages/shared/dist/index.js';
import type { TargetActor } from './targetService.js';
export class OpportunityServiceError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const isManager = (actor: TargetActor) => actor.role === 'Admin' || actor.role === 'Manager';
function leadStatus(stage: Opportunity['stage']): LeadStatus { return ({ Qualification: 'Qualified', Discovery: 'Meeting Scheduled', Proposal: 'Proposal Sent', Negotiation: 'Negotiation', 'Closed Won': 'Won', 'Closed Lost': 'Lost' } as const)[stage]; }
function activity(state: CGBSState, leadId: string, title: string, detail: string, actor: TargetActor, type: 'Opportunity' | 'Follow-up' | 'Stage change' = 'Opportunity') { state.activities.unshift({ id: randomUUID(), leadId, type, title, detail, createdAt: new Date().toISOString(), createdBy: actor.name }); }
export function transitionOpportunityStage(state: CGBSState, opportunityId: string, stage: Opportunity['stage'], lossReason: string, actor: TargetActor): Opportunity {
  const opp = state.opportunities.find((item) => item.id === opportunityId);
  if (!opp) throw new OpportunityServiceError('Opportunity not found.', 404);
  if (!isManager(actor) && opp.owner.toLowerCase() !== actor.name.toLowerCase()) throw new OpportunityServiceError('You do not have permission to edit this opportunity.', 403);
  if (stage === opp.stage) throw new OpportunityServiceError('This opportunity is already in that stage.', 409);
  if (opp.stage === 'Closed Won' || opp.stage === 'Closed Lost') throw new OpportunityServiceError('Closed opportunities can only be reopened through the authorized reopen action.', 409);
  const closed = stage === 'Closed Won' || stage === 'Closed Lost';
  if (closed && !isManager(actor)) throw new OpportunityServiceError('Only a manager or admin can close an opportunity.', 403);
  if (stage === 'Closed Lost' && lossReason.trim().length < 3) throw new OpportunityServiceError('Enter a loss reason (at least 3 characters).');
  const now = new Date().toISOString(); const previous = opp.stage;
  if (closed) { opp.preCloseStage = previous; opp.actualCloseAt = now; opp.accomplishedById = actor.id; opp.accomplishedByName = actor.name; opp.lossReason = stage === 'Closed Lost' ? lossReason.trim() : ''; }
  opp.stage = stage; opp.updatedAt = now;
  const lead = state.leads.find((item) => item.id === opp.leadId);
  if (lead) {
    const related = state.opportunities.filter((item) => item.leadId === lead.id);
    const open = related.filter((item) => item.stage !== 'Closed Won' && item.stage !== 'Closed Lost');
    const targetStatus: LeadStatus = open.length ? closed ? lead.status : leadStatus(stage) : related.some((item) => item.stage === 'Closed Won') ? 'Won' : 'Lost';
    if (lead.status !== targetStatus && (!['Won','Lost'].includes(lead.status) || !open.length)) {
      const old = lead.status; lead.status = targetStatus; lead.updatedAt = now; lead.stageHistory.push({ status: targetStatus, at: now, by: actor.name });
      activity(state, lead.id, 'Lead stage updated from opportunity', `Moved from ${old} to ${targetStatus} as ${opp.name} moved to ${stage}.`, actor, 'Stage change');
    }
    if (closed && !open.length) {
      lead.actualCloseAt = now; lead.closedById = actor.id; lead.closedByName = actor.name; lead.lossReason = targetStatus === 'Lost' ? lossReason.trim() : ''; lead.nextFollowUp = null;
      for (const task of state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due')) { task.status = 'Cancelled'; task.cancelledReason = `Sales process closed: ${targetStatus}`; activity(state, lead.id, 'Follow-up cancelled · sales process closed', task.cancelledReason, actor, 'Follow-up'); }
    }
  }
  activity(state, opp.leadId, `Opportunity moved to ${stage}`, `${opp.name}${stage === 'Closed Lost' ? ` · Loss reason: ${lossReason.trim()}` : ''}`, actor);
  return opp;
}
export function reopenOpportunity(state: CGBSState, opportunityId: string, actor: TargetActor): Opportunity {
  if (!isManager(actor)) throw new OpportunityServiceError('Only a manager or admin can reopen an opportunity.', 403);
  const opp = state.opportunities.find((item) => item.id === opportunityId);
  if (!opp) throw new OpportunityServiceError('Opportunity not found.', 404);
  if (opp.stage !== 'Closed Won' && opp.stage !== 'Closed Lost') throw new OpportunityServiceError('Opportunity is already open.', 409);
  const previous = opp.stage; const next = opp.preCloseStage || 'Negotiation'; const now = new Date().toISOString();
  opp.stage = next; opp.updatedAt = now; opp.actualCloseAt = null; opp.accomplishedById = null; opp.accomplishedByName = null; opp.lossReason = '';
  const lead = state.leads.find((item) => item.id === opp.leadId);
  if (lead) {
    const from = lead.status; lead.status = leadStatus(next); lead.updatedAt = now; lead.actualCloseAt = null; lead.closedById = null; lead.closedByName = null; lead.lossReason = ''; lead.stageHistory.push({ status: lead.status, at: now, by: actor.name });
    activity(state, lead.id, 'Lead reopened with opportunity', `Reopened from ${from} to ${lead.status}.`, actor, 'Stage change');
  }
  activity(state, opp.leadId, 'Opportunity reopened', `${opp.name} reopened from ${previous} to ${next} by ${actor.name}.`, actor);
  return opp;
}


