import type { CGBSState } from '../../../packages/shared/dist/index.js';
import { canAccessTarget, type TargetActor } from './targetService.js';
import { canViewVoiceCall } from './voiceCallService.js';

export function scopeReportRecords(data: CGBSState, actor: TargetActor & { id: string }): CGBSState {
  if (actor.role === 'Admin' || actor.role === 'Manager') return data;
  const leads = data.leads.filter((lead) => lead.assignedTo.toLowerCase() === actor.name.toLowerCase());
  const leadIds = new Set(leads.map((lead) => lead.id));
  return {
    ...data,
    leads,
    calls: data.calls.filter((call) => leadIds.has(call.leadId)),
    voiceCalls: data.voiceCalls.filter((call) => leadIds.has(call.leadId) && canViewVoiceCall(call, actor)),
    tasks: data.tasks.filter((task) => leadIds.has(task.leadId) && task.assignedTo.toLowerCase() === actor.name.toLowerCase()),
    opportunities: data.opportunities.filter((opportunity) => leadIds.has(opportunity.leadId) || opportunity.owner.toLowerCase() === actor.name.toLowerCase()),
    activities: data.activities.filter((activity) => leadIds.has(activity.leadId)),
    targets: data.targets.filter((target) => canAccessTarget(target, actor)),
    calendarEvents: data.calendarEvents.filter((event) => event.leadId ? leadIds.has(event.leadId) : event.assignedTo.toLowerCase() === actor.name.toLowerCase()),
    reminders: data.reminders.filter((reminder) => reminder.ownerId === actor.id),
    notifications: data.notifications.filter((notification) => notification.userId === actor.id),
  };
}
