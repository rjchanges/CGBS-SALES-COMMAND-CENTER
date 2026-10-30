import { randomUUID } from 'node:crypto';
import { addDays, addHours, addMinutes, format, formatISO } from 'date-fns';
import type { CGBSState, Lead, LeadInput, SalesTarget } from '../../../packages/shared/dist/index.js';

const now = new Date();
const at = (hours: number) => formatISO(addHours(now, hours));
const dueToday = (hour: number) => {
  const date = new Date(now);
  date.setHours(hour, 0, 0, 0);
  return formatISO(date);
};
const lead = (data: Partial<LeadInput> & Pick<LeadInput, 'name' | 'company'>, followupHours: number | null): Lead => ({
  id: randomUUID(), name: data.name, company: data.company, role: data.role ?? '',
  companyLogo: data.companyLogo ?? '', companyNetWorth: data.companyNetWorth ?? 0,
  aiOutreachTopic: data.aiOutreachTopic ?? '', aiOpeningMessage: data.aiOpeningMessage ?? '', aiEmailSubject: data.aiEmailSubject ?? '', aiFollowUpApproach: data.aiFollowUpApproach ?? '',
  email: data.email ?? '', phone: data.phone ?? '', website: data.website ?? '', linkedin: data.linkedin ?? '',
  industry: data.industry ?? 'Technology', source: data.source ?? 'Referral',
  status: data.status ?? 'New Lead', priority: data.priority ?? 'Medium',
  revenue: data.revenue ?? 0, currency: data.currency ?? 'INR',
  progression: data.progression ?? 5, probability: data.probability ?? 10,
  assignedTo: data.assignedTo ?? 'Rahul Raj M',
  nextFollowUp: followupHours === null ? null : at(followupHours),
  expectedClose: formatISO(addDays(now, 30)),
  notes: data.notes ?? '', createdAt: at(-48), updatedAt: at(-2), lastContacted: at(-25),
  archived: false, stageHistory: [{ status: data.status ?? 'New Lead', at: at(-48), by: 'Rahul Raj M' }],
});

export function createDefaultTargets(settings: CGBSState['settings']): SalesTarget[] {
  const now = new Date();
  const startDate = format(now, 'yyyy-MM-dd');
  const endDate = format(addDays(now, 365), 'yyyy-MM-dd');
  const metrics: [SalesTarget['metric'], number, SalesTarget['period']][] = [
    ['calls', settings.dailyCallTarget, 'daily'],
    ['followups_completed', settings.dailyFollowUpTarget ?? 8, 'daily'],
    ['meetings_scheduled', settings.dailyMeetingTarget ?? 3, 'daily'],
    ['revenue', settings.monthlyRevenueTarget, 'monthly'],
  ];
  return metrics.map(([metric, targetValue, period], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    metric, targetValue, period, startDate, endDate, ownerType: 'self', ownerName: 'Rahul Raj M', enabled: targetValue > 0,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: 'Rahul Raj M', revisions: [],
  }));
}
export function createSeedState(): CGBSState {
  const leads: Lead[] = [
    lead({ name: 'Amit Sharma', company: 'Northstar Technologies', role: 'VP of Sales', email: 'amit.sharma@example.test', phone: '+91 98765 43210', website: 'https://northstar.example', industry: 'Technology', source: 'Referral', status: 'Follow-up Required', priority: 'High', revenue: 1800000, progression: 35, probability: 32, notes: 'Asked for a short product walkthrough after the quarterly review.' }, 2),
    lead({ name: 'Priya Nair', company: 'Brightpath Learning', role: 'Operations Director', email: 'priya.nair@example.test', phone: '+91 98765 43211', website: 'https://brightpath.example', industry: 'Education', source: 'Website', status: 'Interested', priority: 'Critical', revenue: 2450000, progression: 30, probability: 40, notes: 'Interested in a multi-team rollout.' }, 26),
    lead({ name: 'Arjun Mehta', company: 'Evergreen Retail', role: 'Chief Operating Officer', email: 'arjun.mehta@example.test', phone: '+91 98765 43212', website: '', industry: 'Retail', source: 'LinkedIn', status: 'RNR', priority: 'Medium', revenue: 1250000, progression: 20, probability: 18, notes: 'Requested a call back in the afternoon.' }, 0.5),
    lead({ name: 'Sara Thomas', company: 'Monarch Health', role: 'Procurement Lead', email: 'sara.thomas@example.test', phone: '+91 98765 43213', website: 'https://monarch.example', industry: 'Healthcare', source: 'Campaign', status: 'Meeting Scheduled', priority: 'High', revenue: 3200000, progression: 50, probability: 55, notes: 'Discovery call scheduled. Bring implementation timeline.' }, 30),
    lead({ name: 'Dev Kapoor', company: 'Kiteworks Studio', role: 'Founder', email: 'dev.kapoor@example.test', phone: '+91 98765 43214', website: '', industry: 'Professional Services', source: 'Cold Calling', status: 'Contacted', priority: 'Low', revenue: 760000, progression: 15, probability: 12, notes: '' }, 48),
    lead({ name: 'Ananya Rao', company: 'Summit Logistics', role: 'Regional Director', email: 'ananya.rao@example.test', phone: '+91 98765 43215', website: 'https://summit.example', industry: 'Logistics', source: 'Other', status: 'Qualified', priority: 'Medium', revenue: 2980000, progression: 60, probability: 62, notes: 'Needs a proposal before month end.' }, null),
  ];
  const calls = Array.from({ length: 24 }, (_, i) => ({
    id: randomUUID(), leadId: leads[i % leads.length]!.id,
    outcome: ['Answered', 'No Answer', 'Busy', 'Interested', 'Call Back Later'][i % 5]!,
    notes: i % 4 === 0 ? 'Discussed next steps.' : '',
    durationMinutes: i % 4 === 0 ? 5 + (i % 7) : 0,
    createdAt: i < 11 ? dueToday(9 + (i % 8)) : at(-(i + 2)),
    createdBy: 'Rahul Raj M',
  }));
  const tasks = [
    { id: randomUUID(), leadId: leads[0]!.id, type: 'Call' as const, dueAt: dueToday(15), priority: 'High' as const, assignedTo: 'Rahul Raj M', notes: 'Share product walkthrough options.', status: 'Due' as const, createdAt: at(-20), completedAt: null, createdBy: 'Rahul Raj M', endsAt: formatISO(addHours(now, 1)) },
    { id: randomUUID(), leadId: leads[2]!.id, type: 'RNR callback' as const, dueAt: at(0.5), priority: 'Medium' as const, assignedTo: 'Rahul Raj M', notes: 'Afternoon callback requested.', status: 'Due' as const, createdAt: at(-1), completedAt: null, createdBy: 'Rahul Raj M' },
    { id: randomUUID(), leadId: leads[3]!.id, type: 'Meeting' as const, dueAt: at(27), priority: 'High' as const, assignedTo: 'Rahul Raj M', notes: 'Discovery call.', status: 'Due' as const, createdAt: at(-8), completedAt: null, createdBy: 'Rahul Raj M', endsAt: at(28) },
  ];
  const opportunities = [
    { id: randomUUID(), name: 'Northstar rollout', leadId: leads[0]!.id, amount: 1800000, currency: 'INR', probability: 35, stage: 'Proposal' as const, expectedClose: formatISO(addDays(now, 28)), owner: 'Rahul Raj M', notes: 'Two-region rollout proposal.', createdAt: at(-40), updatedAt: at(-1) },
    { id: randomUUID(), name: 'Brightpath annual plan', leadId: leads[1]!.id, amount: 2450000, currency: 'INR', probability: 45, stage: 'Discovery' as const, expectedClose: formatISO(addDays(now, 42)), owner: 'Rahul Raj M', notes: '', createdAt: at(-25), updatedAt: at(-3) },
    { id: randomUUID(), name: 'Monarch onboarding', leadId: leads[3]!.id, amount: 3200000, currency: 'INR', probability: 60, stage: 'Negotiation' as const, expectedClose: formatISO(addDays(now, 15)), owner: 'Rahul Raj M', notes: '', createdAt: at(-65), updatedAt: at(-2) },
    { id: randomUUID(), name: 'Kiteworks starter', leadId: leads[4]!.id, amount: 760000, currency: 'INR', probability: 100, stage: 'Closed Won' as const, expectedClose: formatISO(addDays(now, -5)), owner: 'Rahul Raj M', notes: 'Fictional demo deal.', actualCloseAt: at(-4), accomplishedById: 'demo-admin', accomplishedByName: 'Rahul Raj M', createdAt: at(-75), updatedAt: at(-4) },
  ];
  const templates = [
    { id: randomUUID(), name: 'Initial outreach', subject: 'A quick idea for {{company_name}}', body: 'Hi {{lead_name}},\n\nI work with teams in {{industry}} and thought it could be useful to compare notes on your current process. Would a brief conversation next week work?\n\nBest,\n{{salesperson_name}}', updatedAt: at(-3) },
    { id: randomUUID(), name: 'Post-call follow-up', subject: 'Thanks for your time, {{lead_name}}', body: 'Hi {{lead_name}},\n\nThanks for speaking today. I have captured the next steps we discussed and will follow up with the details shortly.\n\nBest,\n{{salesperson_name}}', updatedAt: at(-2) },
    { id: randomUUID(), name: 'Meeting confirmation', subject: 'Confirmed: our conversation', body: 'Hi {{lead_name}},\n\nLooking forward to speaking on {{meeting_date}} about {{company_name}}.\n\nBest,\n{{salesperson_name}}', updatedAt: at(-1) },
  ];
templates.push(
    { id: randomUUID(), name: 'No-answer follow-up', subject: 'Tried to reach you, {{lead_name}}', body: 'Hi {{lead_name}},\\n\\nI tried to reach you earlier and wanted to follow up with a brief note. Let me know if there is a better time to connect.\\n\\nBest,\\n{{salesperson_name}}', updatedAt: at(-1) },
    { id: randomUUID(), name: 'RNR callback', subject: 'Following up as requested', body: 'Hi {{lead_name}},\\n\\nI am following up at the time we discussed. Is now still convenient for a quick conversation?\\n\\nBest,\\n{{salesperson_name}}', updatedAt: at(-1) },
    { id: randomUUID(), name: 'Proposal follow-up', subject: 'Next steps for {{company_name}}', body: 'Hi {{lead_name}},\\n\\nI wanted to check whether you had a chance to review the proposal. I am happy to walk through the details and answer questions.\\n\\nBest,\\n{{salesperson_name}}', updatedAt: at(-1) },
    { id: randomUUID(), name: 'Re-engagement', subject: 'Should we reconnect, {{lead_name}}?', body: 'Hi {{lead_name}},\\n\\nIt has been a little while since we last spoke. If this is still a priority for {{company_name}}, I would be glad to reconnect.\\n\\nBest,\\n{{salesperson_name}}', updatedAt: at(-1) },
    { id: randomUUID(), name: 'Custom email', subject: 'A note for {{company_name}}', body: 'Hi {{lead_name}},\\n\\nI am reaching out with a quick update.\\n\\nBest,\\n{{salesperson_name}}', updatedAt: at(-1) },
  );
  const activities = calls.slice(0, 8).map((call) => ({
    id: randomUUID(), leadId: call.leadId, type: 'Call' as const,
    title: `Call logged · ${call.outcome}`, detail: call.notes || 'Call attempt recorded in the demo workspace.',
    createdAt: call.createdAt, createdBy: call.createdBy,
  }));
  const settings = { dailyCallTarget: 40, dailyFollowUpTarget: 8, dailyMeetingTarget: 3, monthlyRevenueTarget: 5000000, currency: 'INR', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' };
  return { leads, calls, voiceCalls: [], callingProfiles: [], tasks, opportunities, templates, activities, targets: createDefaultTargets(settings), calendarEvents: [], reminders: [], notifications: [], settings };}





