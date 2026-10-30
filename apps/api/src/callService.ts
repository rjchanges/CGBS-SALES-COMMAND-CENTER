import { randomUUID } from 'node:crypto';
import type { CGBSState, FollowUpTask, LeadStatus } from '../../../packages/shared/dist/index.js';
import type { TargetActor } from './targetService.js';

const outcomes = ['Answered', 'No Answer', 'Busy', 'RNR', 'Interested', 'Not Interested', 'Meeting Scheduled', 'Invalid Number', 'Call Back Later'];
const actionTypes = ['Call', 'Email', 'Meeting', 'RNR callback', 'Call Back Later', 'Proposal Follow-up', 'Other'];
export class CallServiceError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
type CallInput = { leadId?: string; outcome?: string; notes?: string; contactMethod?: string; clientMutationId?: string; nextAction?: { type?: string; dueAt?: string; endsAt?: string; notes?: string } };
function activity(state: CGBSState, leadId: string, actor: TargetActor, type: 'Call' | 'Follow-up' | 'Stage change', title: string, detail: string, at: string) {
  state.activities.unshift({ id: randomUUID(), leadId, type, title, detail: detail.slice(0, 3000), createdAt: at, createdBy: actor.name });
}
export function recordCall(state: CGBSState, value: unknown, actor: TargetActor): { call: CGBSState['calls'][number]; duplicate: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CallServiceError('Choose a lead and a valid call outcome.');
  const input = value as CallInput;
  if (!input.leadId || !input.outcome || !outcomes.includes(input.outcome)) throw new CallServiceError('Choose a lead and a valid call outcome.');
  const contactMethod = input.contactMethod || 'Phone';
  if (!['Phone', 'Email', 'LinkedIn', 'Other'].includes(contactMethod)) throw new CallServiceError('Choose a valid contact method.');
  if (input.clientMutationId) {
    const previous = state.calls.find((item) => item.clientMutationId === input.clientMutationId);
    if (previous) {
      const previousLead = state.leads.find((item) => item.id === previous.leadId);
      if (!previousLead || ((actor.role !== 'Admin' && actor.role !== 'Manager') && previousLead.assignedTo.toLowerCase() !== actor.name.toLowerCase())) throw new CallServiceError('You do not have permission to view that call.', 403);
      return { call: previous, duplicate: true };
    }
  }
  const lead = state.leads.find((item) => item.id === input.leadId && !item.archived);
  if (!lead) throw new CallServiceError('Lead not found.', 404);
  if (lead.status === 'Won' || lead.status === 'Lost') throw new CallServiceError('This lead is closed. Reopen its opportunity from Opportunities before logging a call.', 409);
  const isManager = actor.role === 'Admin' || actor.role === 'Manager';
  if (!isManager && lead.assignedTo.toLowerCase() !== actor.name.toLowerCase()) throw new CallServiceError('You do not have permission to call this lead.', 403);
  const needsAction = ['Interested', 'RNR', 'No Answer', 'Busy', 'Meeting Scheduled', 'Call Back Later'].includes(input.outcome);
  const nextAction = input.nextAction || {};
  const dueValue = nextAction.dueAt;
  if (needsAction && (!dueValue || Number.isNaN(Date.parse(dueValue)))) throw new CallServiceError('Choose the date and time for the next action.');
  if (nextAction.endsAt && (!dueValue || Number.isNaN(Date.parse(nextAction.endsAt)) || Date.parse(nextAction.endsAt) <= Date.parse(dueValue))) throw new CallServiceError('Choose an end time after the next action starts.');
  const actionType = input.outcome === 'Meeting Scheduled' ? 'Meeting' : input.outcome === 'RNR' ? 'RNR callback' : input.outcome === 'Call Back Later' ? 'Call Back Later' : nextAction.type || 'Call';
  if (needsAction && !actionTypes.includes(actionType)) throw new CallServiceError('Choose a valid next action.');
  const now = new Date().toISOString();
  const call = { id: randomUUID(), leadId: lead.id, outcome: input.outcome, contactMethod: contactMethod as 'Phone' | 'Email' | 'LinkedIn' | 'Other', notes: String(input.notes || '').slice(0, 3000), durationMinutes: 0, createdAt: now, createdBy: actor.name, ...(input.clientMutationId ? { clientMutationId: input.clientMutationId } : {}) };
  state.calls.unshift(call); lead.lastContacted = now; lead.updatedAt = now;
  const stages: Partial<Record<string, LeadStatus>> = { Interested: 'Interested', RNR: 'RNR', 'Meeting Scheduled': 'Meeting Scheduled', 'No Answer': 'Follow-up Required', Busy: 'Follow-up Required', 'Call Back Later': 'Follow-up Required' };
  const status = stages[input.outcome];
  if (status && status !== lead.status) {
    const previous = lead.status; lead.status = status; lead.stageHistory.push({ status, at: now, by: actor.name });
    activity(state, lead.id, actor, 'Stage change', 'Stage changed to ' + status, `Call outcome: ${input.outcome}; contact method: ${contactMethod}; from ${previous}.`, now);
  }
  activity(state, lead.id, actor, 'Call', 'Call logged · ' + input.outcome, call.notes || 'Call attempt recorded.', now);
  if (needsAction) {
    const dueAt = new Date(dueValue!).toISOString();
    const endsAt = nextAction.endsAt ? new Date(nextAction.endsAt).toISOString() : new Date(Date.parse(dueAt) + (input.outcome === 'Meeting Scheduled' ? 60 : 30) * 60_000).toISOString();
    const notes = String(nextAction.notes ?? input.notes ?? '').slice(0, 2000);
    let task = state.tasks.find((item) => item.leadId === lead.id && item.status === 'Due' && item.type === actionType);
    if (!task) task = state.tasks.find((item) => item.leadId === lead.id && item.status === 'Due' && Math.abs(Date.parse(item.dueAt) - Date.parse(dueAt)) < 15 * 60_000);
    if (task) {
      task.scheduleHistory ||= []; task.scheduleHistory.push({ dueAt: task.dueAt, endsAt: task.endsAt, changedAt: now, changedBy: actor.name });
      task.dueAt = dueAt; task.endsAt = endsAt; task.type = actionType as FollowUpTask['type']; task.priority = lead.priority; task.assignedTo = lead.assignedTo; task.notes = notes;
      activity(state, lead.id, actor, 'Follow-up', input.outcome === 'Meeting Scheduled' ? 'Meeting rescheduled' : 'Follow-up rescheduled', notes, now);
    } else {
      task = { id: randomUUID(), leadId: lead.id, type: actionType as FollowUpTask['type'], dueAt, endsAt, priority: lead.priority, assignedTo: lead.assignedTo, notes, status: 'Due', createdAt: now, completedAt: null, createdBy: actor.name, scheduleHistory: [] };
      state.tasks.unshift(task); activity(state, lead.id, actor, 'Follow-up', actionType + ' scheduled', notes, now);
    }
    lead.nextFollowUp = state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due').sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]?.dueAt || null;
  }
  return { call, duplicate: false };
}

export function recordVoiceCallOutcome(state: CGBSState, voiceCallId: string, value: unknown, actor: TargetActor & { id: string }) {
  const voiceCall = state.voiceCalls.find((item) => item.id === voiceCallId);
  if (!voiceCall) throw new CallServiceError('Voice call not found.', 404);
  if (voiceCall.userId !== actor.id && actor.role !== 'Admin' && actor.role !== 'Manager') throw new CallServiceError('You do not have permission to update this call.', 403);
  if (!['Completed', 'No Answer', 'Busy', 'Failed', 'Cancelled'].includes(voiceCall.status)) throw new CallServiceError('Record the outcome after the provider call has ended.', 409);
  if (voiceCall.outcomeRecordedAt) throw new CallServiceError('An outcome has already been recorded for this call.', 409);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CallServiceError('Choose a valid call outcome.');
  const input = value as CallInput;
  if (!input.outcome || !outcomes.includes(input.outcome)) throw new CallServiceError('Choose a valid call outcome.');
  const contactMethod = input.contactMethod || 'Phone';
  if (!['Phone', 'Email', 'LinkedIn', 'Other'].includes(contactMethod)) throw new CallServiceError('Choose a valid contact method.');
  const lead = state.leads.find((item) => item.id === voiceCall.leadId);
  if (!lead || lead.status === 'Won' || lead.status === 'Lost') throw new CallServiceError('This lead is no longer active.', 409);
  const nextAction = input.nextAction || {};
  const needsAction = ['Interested', 'RNR', 'No Answer', 'Busy', 'Meeting Scheduled', 'Call Back Later'].includes(input.outcome);
  if (needsAction && (!nextAction.dueAt || Number.isNaN(Date.parse(nextAction.dueAt)))) throw new CallServiceError('Choose a date and time for the next action.');
  const actionType = input.outcome === 'Meeting Scheduled' ? 'Meeting' : input.outcome === 'RNR' ? 'RNR callback' : input.outcome === 'Call Back Later' ? 'Call Back Later' : nextAction.type || 'Call';
  if (needsAction && !actionTypes.includes(actionType)) throw new CallServiceError('Choose a valid next action.');
  const now = new Date().toISOString();
  let call = voiceCall.providerCallId ? state.calls.find((item) => item.providerCallId === voiceCall.providerCallId) : undefined;
  if (!call && voiceCall.providerCallId) {
    call = { id: voiceCall.id, leadId: lead.id, outcome: input.outcome, contactMethod: contactMethod as 'Phone' | 'Email' | 'LinkedIn' | 'Other', notes: String(input.notes || '').slice(0, 3000), durationMinutes: Math.ceil((voiceCall.durationSeconds || 0) / 60), durationSeconds: voiceCall.durationSeconds, provider: 'exotel', providerCallId: voiceCall.providerCallId, startedAt: voiceCall.startedAt, endedAt: voiceCall.endedAt, createdAt: voiceCall.startedAt || voiceCall.requestedAt, createdBy: voiceCall.userName, clientMutationId: `exotel:${voiceCall.providerCallId}` };
    state.calls.unshift(call);
  } else if (call) { call.outcome = input.outcome; call.contactMethod = contactMethod as 'Phone' | 'Email' | 'LinkedIn' | 'Other'; call.notes = String(input.notes || '').slice(0, 3000); }
  if (!call) throw new CallServiceError('Provider call ID is unavailable; refresh the call status before recording its outcome.', 409);
  voiceCall.outcomeRecordedAt = now;
  const stages: Partial<Record<string, LeadStatus>> = { Interested: 'Interested', RNR: 'RNR', 'Meeting Scheduled': 'Meeting Scheduled', 'No Answer': 'Follow-up Required', Busy: 'Follow-up Required', 'Call Back Later': 'Follow-up Required' };
  const stage = stages[input.outcome];
  if (stage && stage !== lead.status) { const previous = lead.status; lead.status = stage; lead.stageHistory.push({ status: stage, at: now, by: actor.name }); activity(state, lead.id, actor, 'Stage change', 'Stage changed to ' + stage, `Call outcome: ${input.outcome}; from ${previous}.`, now); }
  if (needsAction) {
    const dueAt = new Date(nextAction.dueAt!).toISOString(); const endsAt = nextAction.endsAt && Date.parse(nextAction.endsAt) > Date.parse(dueAt) ? new Date(nextAction.endsAt).toISOString() : new Date(Date.parse(dueAt) + (actionType === 'Meeting' ? 60 : 30) * 60_000).toISOString();
    const notes = String(nextAction.notes ?? input.notes ?? '').slice(0, 2000);
    let task = state.tasks.find((item) => item.leadId === lead.id && item.status === 'Due' && item.type === actionType);
    if (!task) task = state.tasks.find((item) => item.leadId === lead.id && item.status === 'Due' && Math.abs(Date.parse(item.dueAt) - Date.parse(dueAt)) < 15 * 60_000);
    if (task) { task.scheduleHistory ||= []; task.scheduleHistory.push({ dueAt: task.dueAt, endsAt: task.endsAt, changedAt: now, changedBy: actor.name }); task.dueAt = dueAt; task.endsAt = endsAt; task.type = actionType as FollowUpTask['type']; task.notes = notes; }
    else { task = { id: randomUUID(), leadId: lead.id, type: actionType as FollowUpTask['type'], dueAt, endsAt, priority: lead.priority, assignedTo: lead.assignedTo, notes, status: 'Due', createdAt: now, completedAt: null, createdBy: actor.name, scheduleHistory: [] }; state.tasks.unshift(task); }
    lead.nextFollowUp = state.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due').sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt))[0]?.dueAt || null;
    activity(state, lead.id, actor, 'Follow-up', actionType + ' scheduled from call outcome', notes, now);
  }
  lead.lastContacted = voiceCall.startedAt || voiceCall.requestedAt; lead.updatedAt = now;
  activity(state, lead.id, actor, 'Call', 'Call outcome recorded · ' + input.outcome, String(input.notes || '').slice(0, 3000) || 'Outcome saved from Exotel click-to-call.', now);
  return { call, voiceCall };
}


