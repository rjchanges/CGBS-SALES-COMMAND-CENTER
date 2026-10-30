import { z } from 'zod';

export const leadStatuses = [
  'New Lead', 'Contacted', 'Interested', 'Follow-up Required', 'RNR',
  'Meeting Scheduled', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won', 'Lost',
] as const;
export type LeadStatus = typeof leadStatuses[number];

export const priorities = ['Low', 'Medium', 'High', 'Critical'] as const;
export const contactMethods = ['Phone', 'Email', 'LinkedIn', 'Other'] as const;
export type ContactMethod = typeof contactMethods[number];
export type Priority = typeof priorities[number];

export const leadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  company: z.string().trim().min(1, 'Company is required'),
  role: z.string().trim().default(''),
  companyLogo: z.string().trim().default(''),
  companyNetWorth: z.coerce.number().min(0).default(0),
  aiOutreachTopic: z.string().trim().default(''),
  aiOpeningMessage: z.string().trim().default(''),
  aiEmailSubject: z.string().trim().default(''),
  aiFollowUpApproach: z.string().trim().default(''),
  email: z.string().trim().email().or(z.literal('')).default(''),
  phone: z.string().trim().default(''),
  website: z.string().trim().default(''),
  linkedin: z.string().trim().default(''),
  industry: z.string().trim().default('Other'),
  source: z.string().trim().default('Other'),
  status: z.enum(leadStatuses).default('New Lead'),
  priority: z.enum(priorities).default('Medium'),
  revenue: z.coerce.number().min(0).default(0),
  currency: z.string().trim().length(3).default('INR'),
  progression: z.coerce.number().min(0).max(100).default(10),
  probability: z.coerce.number().min(0).max(100).default(10),
  assignedTo: z.string().trim().default('Rahul Raj M'),
  nextFollowUp: z.string().nullable().default(null),
  expectedClose: z.string().nullable().default(null),
  notes: z.string().trim().default(''),
  alternativeContactMethod: z.enum(contactMethods).nullable().optional(),
  alternativeContactNotes: z.string().trim().optional(),
});
export type LeadInput = z.infer<typeof leadSchema>;

export type Lead = LeadInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  lastContacted: string | null;
  archived: boolean;
  stageHistory: { status: LeadStatus; at: string; by: string }[];
  changeHistory?: { at: string; by: string; changes: { field: string; from: string; to: string }[] }[];
  alternativeContactMethod?: ContactMethod | null; alternativeContactNotes?: string;
  actualCloseAt?: string | null; closedById?: string | null; closedByName?: string | null; lossReason?: string;
  preCloseOpportunityStages?: { opportunityId: string; stage: Opportunity['stage'] }[];
};

export type CallRecord = {
  id: string; leadId: string; outcome: string; notes: string;
  durationMinutes: number; createdAt: string; createdBy: string; clientMutationId?: string;
  contactMethod?: ContactMethod; provider?: 'exotel'; providerCallId?: string; startedAt?: string | null; endedAt?: string | null; durationSeconds?: number | null;
};
export type VoiceCallStatus = 'Request Submitted' | 'Calling You' | 'Connecting to Client' | 'Connected' | 'Completed' | 'No Answer' | 'Busy' | 'Failed' | 'Cancelled';
export type VoiceCall = {
  id: string; leadId: string; userId: string; userName: string; fromNumber: string; toNumber: string;
  provider: 'exotel'; providerCallId: string | null; status: VoiceCallStatus; idempotencyKey: string;
  requestedAt: string; startedAt: string | null; endedAt: string | null; durationSeconds: number | null;
  lastProviderEventId: string | null; errorMessage: string; outcomeRecordedAt: string | null;
};
export type UserCallingProfile = {
  userId: string; userName: string; phone: string; verifiedAt: string | null;
  pendingPhone: string; verificationCodeHash: string; verificationExpiresAt: string | null;
  verificationAttempts: number; updatedAt: string;
};
export type FollowUpTask = {
  id: string; leadId: string; type: 'Call' | 'Email' | 'Meeting' | 'RNR callback' | 'Call Back Later' | 'Proposal Follow-up' | 'Other';
  dueAt: string; priority: Priority; assignedTo: string; notes: string;
  status: 'Due' | 'Completed' | 'Cancelled'; createdAt: string; completedAt: string | null;
  createdBy?: string; completedBy?: string; completionNotes?: string; cancelledReason?: string; endsAt?: string | null; scheduleHistory?: { dueAt: string; endsAt?: string | null; changedAt: string; changedBy: string }[];
};
export type Opportunity = {
  id: string; name: string; leadId: string; amount: number; currency: string;
  probability: number; stage: 'Qualification' | 'Discovery' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';
  expectedClose: string | null; owner: string; notes: string; createdAt: string; updatedAt: string;
  actualCloseAt?: string | null; accomplishedById?: string | null; accomplishedByName?: string | null;
  lossReason?: string; preCloseStage?: Opportunity['stage'] | null;
};
export type Template = { id: string; name: string; subject: string; body: string; updatedAt: string };
export type Activity = {
  id: string; leadId: string; type: 'Call' | 'Stage change' | 'Follow-up' | 'Note' | 'Opportunity' | 'Lead update';
  title: string; detail: string; createdAt: string; createdBy: string;
};
export type TargetMetric = 'calls' | 'new_leads' | 'followups_completed' | 'meetings_scheduled' | 'meetings_completed' | 'qualified_leads' | 'proposals_sent' | 'revenue' | 'deals_closed';
export type TargetPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
export type TargetOwnerType = 'self' | 'team' | 'employee';
export type TargetRevision = {
  targetValue: number; period: TargetPeriod; startDate: string; endDate: string;
  ownerType: TargetOwnerType; ownerName: string; enabled: boolean; savedAt: string; savedBy: string;
};
export type SalesTarget = {
  id: string; metric: TargetMetric; targetValue: number; period: TargetPeriod;
  startDate: string; endDate: string; ownerType: TargetOwnerType; ownerName: string;
  enabled: boolean; createdAt: string; updatedAt: string; createdBy: string;
  revisions: TargetRevision[];
};
export type TargetHistoryPoint = { periodStart: string; periodEnd: string; actual: number; target: number };
export type TargetAchievement = {
  target: SalesTarget; actual: number; remaining: number; percentage: number;
  expected: number; status: 'On Track' | 'Behind Target' | 'Achieved';
  bucketStart: string; bucketEnd: string; history: TargetHistoryPoint[];
};
export type CalendarEventType = 'Call' | 'Follow-up' | 'Meeting' | 'Proposal' | 'Opportunity' | 'Other';
export type CalendarEventStatus = 'Scheduled' | 'Completed' | 'Cancelled';
export type CalendarEvent = {
  id: string; title: string; description: string; startAt: string; endAt: string; allDay: boolean;
  type: CalendarEventType; status: CalendarEventStatus; leadId: string | null; opportunityId: string | null;
  assignedTo: string; priority: Priority; location: string; meetingLink: string; sourceType?: string; sourceNotes?: string;
  createdBy: string; createdAt: string; updatedAt: string;
};
export type CalendarItem = {
  id: string; source: 'task' | 'call' | 'activity' | 'opportunity' | 'event'; sourceId: string;
  title: string; description: string; startAt: string; endAt: string; allDay: boolean;
  type: CalendarEventType; category: 'Calls' | 'Follow-ups' | 'Meetings' | 'CRM activity' | 'Opportunities' | 'Events';
  status: CalendarEventStatus; leadId: string | null; leadName: string; company: string;
  opportunityId: string | null; assignedTo: string; priority: Priority;
  location: string; meetingLink: string; sourceType?: string; sourceNotes?: string;
};
export type ReminderStatus = 'Pending' | 'Delivered' | 'Failed' | 'Cancelled';
export type Reminder = {
  id: string; sourceType: 'task' | 'event'; sourceId: string; ownerId: string; ownerName: string;
  sendAt: string; minutesBefore: number | null; channels: ('in-app' | 'push')[]; enabled: boolean;
  status: ReminderStatus; idempotencyKey: string; attempts: number; deliveredAt: string | null; lastError: string;
  eventStartAt: string; createdAt: string; updatedAt: string;
};
export type InboxNotification = { id: string; reminderId: string; userId: string; title: string; body: string; createdAt: string; readAt: string | null };
export type CGBSState = {
  leads: Lead[]; calls: CallRecord[]; voiceCalls: VoiceCall[]; callingProfiles: UserCallingProfile[]; tasks: FollowUpTask[];
  opportunities: Opportunity[]; templates: Template[]; activities: Activity[];
  targets: SalesTarget[]; calendarEvents: CalendarEvent[]; reminders: Reminder[]; notifications: InboxNotification[];
  settings: { dailyCallTarget: number; monthlyRevenueTarget: number; currency: string; timezone: string; dailyFollowUpTarget?: number; dailyMeetingTarget?: number };
};

const progressionByStage: Record<LeadStatus, number> = {
  'New Lead': 5, Contacted: 15, Interested: 30, 'Follow-up Required': 35,
  RNR: 20, 'Meeting Scheduled': 50, Qualified: 60, 'Proposal Sent': 75,
  Negotiation: 85, Won: 100, Lost: 0,
};

export function defaultProgression(stage: LeadStatus): number {
  return progressionByStage[stage];
}

export function safeWebsiteUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const candidate = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return candidate.protocol === 'https:' || candidate.protocol === 'http:' ? candidate.toString() : null;
  } catch {
    return null;
  }
}

export function weightedPipeline(opportunities: Opportunity[]): number {
  return opportunities.filter((o) => !['Closed Won', 'Closed Lost'].includes(o.stage))
    .reduce((sum, o) => sum + o.amount * o.probability / 100, 0);
}

export function winRate(opportunities: Opportunity[]): number {
  const won = opportunities.filter((o) => o.stage === 'Closed Won').length;
  const lost = opportunities.filter((o) => o.stage === 'Closed Lost').length;
  return won + lost === 0 ? 0 : Math.round(won / (won + lost) * 100);
}

export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[\s\t]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function detectDuplicates(rows: LeadInput[], existing: Lead[]): { accepted: LeadInput[]; duplicates: { row: LeadInput; matchedId: string }[] } {
  const emails = new Map(existing.filter((l) => l.email).map((l) => [l.email.toLowerCase(), l.id]));
  const phones = new Map(existing.filter((l) => l.phone).map((l) => [l.phone.replace(/\D/g, ''), l.id]));
  const accepted: LeadInput[] = [];
  const duplicates: { row: LeadInput; matchedId: string }[] = [];
  for (const row of rows) {
    const id = (row.email && emails.get(row.email.toLowerCase())) ||
      (row.phone && phones.get(row.phone.replace(/\D/g, '')));
    if (id) duplicates.push({ row, matchedId: id });
    else {
      accepted.push(row);
      if (row.email) emails.set(row.email.toLowerCase(), 'incoming');
      if (row.phone) phones.set(row.phone.replace(/\D/g, ''), 'incoming');
    }
  }
  return { accepted, duplicates };
}






