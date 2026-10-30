import type { CGBSState, Lead, TargetAchievement } from '../../../packages/shared/src/index';

const API_ROOT = import.meta.env.VITE_API_URL || '';
export function getSession(): string | null {
  return localStorage.getItem('cgbs_access_token');
}
export function setSession(token: string | null) {
  if (token) localStorage.setItem('cgbs_access_token', token);
  else localStorage.removeItem('cgbs_access_token');
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSession();
  const response = await fetch(API_ROOT + '/api' + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload as T;
}
export async function startDemoSession() {
  const data = await request<{ accessToken: string }>('/auth/demo', { method: 'POST' });
  setSession(data.accessToken);
}
export type Bootstrap = CGBSState & { user: { id: string; name: string; role: string }; mode: string; metrics: DashboardMetrics; targetPerformance: TargetAchievement[] };
export type DashboardMetrics = {
  totalLeads: number; newToday: number; contacted: number; highPriority: number; callsToday: number;
  connectedToday: number; callsRemaining: number; callsScheduledToday: number; rnrPending: number; rnrDueToday: number; followUpsToday: number; followUpsCompletedToday: number; followUpTarget: number; overdueFollowUps: number; meetingsScheduled: number; meetingsScheduledToday: number; meetingTarget: number; highPriorityAwaitingContact: number;
  openOpportunities: number; openPipeline: number; weightedPipeline: number; closedWonRevenue: number; closedWonDeals: number; closedWonDealsThisMonth: number; revenueThisMonth: number; remainingRevenueTarget: number; revenueAchievement: number; averageDealValue: number;
  conversionRate: number; callTarget: number; revenueTarget: number; winRate: number;
  leadStatusCounts: { name: string; value: number }[];
  sourceCounts: { name: string; value: number }[];
  pipelineStages: { stage: string; deals: number; value: number }[];
  weeklyActivity: { day: string; attempted: number; connected: number; scheduled: number; completed: number; followUpsCompleted: number; meetingsScheduled: number }[];
  activityTrend: { day: string; attempted: number; connected: number; scheduled: number; completed: number; followUpsCompleted: number; meetingsScheduled: number }[];
  revenueTrend: { month: string; revenue: number; target: number }[];
  revenueByOwner: { owner: string; revenue: number }[]; revenueByCloser: { closer: string; revenue: number }[];
};
export type FullLead = Lead & { companyLogo?: string };

