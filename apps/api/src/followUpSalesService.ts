import { randomUUID } from 'node:crypto';
import { leadSchema, type CGBSState, type FollowUpTask, type Lead, type LeadInput } from '../../../packages/shared/dist/index.js';
import type { TargetActor } from './targetService.js';

export class FollowUpSalesError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const salesSchema = leadSchema.pick({ status: true, priority: true, revenue: true, currency: true, progression: true, probability: true, source: true, assignedTo: true, expectedClose: true, notes: true });
const canManage = (actor: TargetActor) => actor.role === 'Admin' || actor.role === 'Manager';
type SalesValues = Pick<LeadInput, 'status' | 'priority' | 'revenue' | 'currency' | 'progression' | 'probability' | 'source' | 'assignedTo' | 'expectedClose' | 'notes'>;
function activity(state: CGBSState, lead: Lead, actor: TargetActor, title: string, detail: string, type: 'Follow-up' | 'Lead update' | 'Stage change' = 'Follow-up', at = new Date().toISOString()) {
  state.activities.unshift({ id: randomUUID(), leadId: lead.id, type, title, detail: detail.slice(0, 3000), createdAt: at, createdBy: actor.name });
}
function recordLeadUpdate(state: CGBSState, lead: Lead, before: SalesValues, after: SalesValues, actor: TargetActor, at: string) {
  const changes = Object.entries(after).filter(([field, value]) => JSON.stringify(before[field as keyof SalesValues]) !== JSON.stringify(value)).map(([field, value]) => ({ field, from: String(before[field as keyof SalesValues] ?? ''), to: String(value ?? '') }));
  if (changes.length) {
    lead.changeHistory ||= []; lead.changeHistory.push({ at, by: actor.name, changes });
    activity(state, lead, actor, 'Lead sales details updated', changes.map((item) => `${item.field}: ${item.from || '—'} → ${item.to || '—'}`).join('; '), 'Lead update', at);
  }
  if (before.status !== after.status) {
    lead.stageHistory.push({ status: after.status, at, by: actor.name });
    activity(state, lead, actor, `Stage changed to ${after.status}`, `Moved from ${before.status} to ${after.status}.`, 'Stage change', at);
  }
}
function closeLeadRecords(state: CGBSState, lead: Lead, actor: TargetActor, now: string) {
  if (lead.status !== 'Won' && lead.status !== 'Lost') return;
  const won = lead.status === 'Won';
  const reason = won ? 'Lead marked Won' : (lead.notes.trim() ? 'Lead marked Lost: ' + lead.notes.trim().slice(0, 800) : 'Lead marked Lost');
  for (const task of state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due')) {
    task.status = 'Cancelled'; task.cancelledReason = reason;
    activity(state, lead, actor, `Follow-up cancelled · lead ${lead.status}`, reason, 'Follow-up', now);
  }
  for (const opportunity of state.opportunities.filter((item) => item.leadId === lead.id)) {
    opportunity.stage = won ? 'Closed Won' : 'Closed Lost'; opportunity.updatedAt = now;
    opportunity.actualCloseAt = won ? now : null;
    opportunity.accomplishedById = won ? actor.id : null;
    opportunity.accomplishedByName = won ? actor.name : null;
  }
  lead.nextFollowUp = null;
}
function validateSales(state: CGBSState, lead: Lead, input: Record<string, unknown>, actor: TargetActor): SalesValues {
  const parsed = salesSchema.safeParse(input);
  if (!parsed.success) throw new FollowUpSalesError(parsed.error.issues[0]?.message || 'Enter valid sales details.');
  if (lead.status === 'Won' || lead.status === 'Lost') throw new FollowUpSalesError('Closed sales processes can only be reopened from Opportunities.', 409);
  if (!canManage(actor) && lead.assignedTo.toLowerCase() !== actor.name.toLowerCase()) throw new FollowUpSalesError('You do not have permission to edit this lead.', 403);
  if (!canManage(actor) && parsed.data.assignedTo !== lead.assignedTo) throw new FollowUpSalesError('Only a manager or admin can reassign a lead.', 403);
  if (parsed.data.status === 'Won' || parsed.data.status === 'Lost') throw new FollowUpSalesError('Close sales processes from Opportunities.', 409);
  return parsed.data;
}
function validateSchedule(input: Record<string, unknown>, required: boolean): { dueAt: string | null; endsAt: string | null; notes: string } {
  if (input.dueAt === null || input.dueAt === undefined || input.dueAt === '') {
    if (required) throw new FollowUpSalesError('Choose a date and time for this follow-up.');
    return { dueAt: null, endsAt: null, notes: typeof input.taskNotes === 'string' ? input.taskNotes.slice(0, 2000) : '' };
  }
  if (typeof input.dueAt !== 'string' || Number.isNaN(Date.parse(input.dueAt))) throw new FollowUpSalesError('Choose a valid follow-up date and time.');
  const dueAt = new Date(input.dueAt).toISOString();
  if (typeof input.endsAt !== 'string' || Number.isNaN(Date.parse(input.endsAt)) || Date.parse(input.endsAt) <= Date.parse(dueAt)) throw new FollowUpSalesError('Choose a valid end time after the follow-up start time.');
  if (typeof input.taskNotes !== 'string' || input.taskNotes.length > 2000) throw new FollowUpSalesError('Follow-up notes must be 2,000 characters or fewer.');
  return { dueAt, endsAt: new Date(input.endsAt).toISOString(), notes: input.taskNotes };
}
function assertNoDuplicate(state: CGBSState, task: FollowUpTask, dueAt: string) {
  if (state.tasks.some((other) => other.id !== task.id && other.leadId === task.leadId && other.type === task.type && other.status === 'Due' && Math.abs(Date.parse(other.dueAt) - Date.parse(dueAt)) < 15 * 60_000)) throw new FollowUpSalesError('A similar active follow-up is already scheduled for this time.', 409);
}
function syncNextFollowUp(state: CGBSState, lead: Lead) {
  lead.nextFollowUp = state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due').sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]?.dueAt || null;
}

export function updateFollowUpSalesDetails(state: CGBSState, taskId: string, value: unknown, actor: TargetActor): { lead: Lead; task: FollowUpTask } {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new FollowUpSalesError('Follow-up not found.', 404);
  const lead = state.leads.find((item) => item.id === task.leadId);
  if (!lead) throw new FollowUpSalesError('The lead linked to this follow-up was not found.', 404);
  if (!canManage(actor) && (task.assignedTo.toLowerCase() !== actor.name.toLowerCase() || lead.assignedTo.toLowerCase() !== actor.name.toLowerCase())) throw new FollowUpSalesError('You do not have permission to edit this lead and follow-up.', 403);
  if (task.status !== 'Due') throw new FollowUpSalesError('Only active follow-ups can be rescheduled from sales details.', 409);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FollowUpSalesError('Enter sales details and a valid follow-up time.');
  const input = value as Record<string, unknown>;
  const after = validateSales(state, lead, input, actor);
  const schedule = validateSchedule(input, true);
  const before = { ...lead };
  const now = new Date().toISOString();
  assertNoDuplicate(state, task, schedule.dueAt!);
  if (task.dueAt !== schedule.dueAt) { task.scheduleHistory ||= []; task.scheduleHistory.push({ dueAt: task.dueAt, endsAt: task.endsAt, changedAt: now, changedBy: actor.name }); }
  Object.assign(lead, after, { updatedAt: now });
  task.dueAt = schedule.dueAt!; task.endsAt = schedule.endsAt; task.priority = after.priority; task.assignedTo = after.assignedTo; task.notes = schedule.notes;
  recordLeadUpdate(state, lead, before as SalesValues, after, actor, now);
  closeLeadRecords(state, lead, actor, now);
  if (lead.status !== 'Won' && lead.status !== 'Lost') {
    syncNextFollowUp(state, lead);
    activity(state, lead, actor, 'Follow-up rescheduled from sales details', `${task.type} · ${task.dueAt} · ${task.notes}`, 'Follow-up', now);
  }
  return { lead, task };
}

export function saveLeadSalesDetails(state: CGBSState, leadId: string, value: unknown, actor: TargetActor): { lead: Lead; task: FollowUpTask | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FollowUpSalesError('Enter valid sales details.');
  const input = value as Record<string, unknown>;
  const explicitTask = typeof input.taskId === 'string' ? state.tasks.find((item) => item.id === input.taskId && item.leadId === leadId) : undefined;
  if (input.taskId && !explicitTask) throw new FollowUpSalesError('The selected follow-up does not belong to this lead.', 404);
  if (explicitTask) return updateFollowUpSalesDetails(state, explicitTask.id, input, actor);
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) throw new FollowUpSalesError('Lead not found.', 404);
  const after = validateSales(state, lead, input, actor);
  const schedule = validateSchedule(input, false);
  const typeOptions = ['Call', 'Email', 'Meeting', 'RNR callback', 'Call Back Later', 'Proposal Follow-up', 'Other'];
  const actionType = typeOptions.includes(String(input.actionType)) ? input.actionType as FollowUpTask['type'] : 'Call';
  const matchingTask = schedule.dueAt ? state.tasks.find((item) => item.leadId === lead.id && item.status === 'Due' && item.type === actionType) : undefined;
  if (matchingTask) return updateFollowUpSalesDetails(state, matchingTask.id, { ...input, taskId: matchingTask.id, ...after, dueAt: schedule.dueAt, endsAt: schedule.endsAt, taskNotes: schedule.notes }, actor);
  const before = { ...lead };
  const now = new Date().toISOString();
  Object.assign(lead, after, { updatedAt: now });
  let task: FollowUpTask | null = null;
  if (schedule.dueAt) {
    task = { id: randomUUID(), leadId: lead.id, type: actionType, dueAt: schedule.dueAt, endsAt: schedule.endsAt, priority: after.priority, assignedTo: after.assignedTo, notes: schedule.notes, status: 'Due', createdAt: now, completedAt: null, createdBy: actor.name, scheduleHistory: [] };
    state.tasks.unshift(task);
    activity(state, lead, actor, actionType + ' scheduled from Calling workspace', task.notes, 'Follow-up', now);
  }
  recordLeadUpdate(state, lead, before as SalesValues, after, actor, now);
  closeLeadRecords(state, lead, actor, now);
  if (lead.status !== 'Won' && lead.status !== 'Lost') syncNextFollowUp(state, lead);
  return { lead, task };
}





