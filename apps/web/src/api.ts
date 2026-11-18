import type { CGBSState, Lead, TargetAchievement } from '../../../packages/shared/src/index';
import { supabase } from './supabase';

// In development, keep API requests on the Vite origin so the configured
// /api proxy handles them. This avoids browser CORS and host-name mismatches
// caused by a local VITE_API_URL overriding that proxy. Production builds use
// the configured API origin.
const API_ROOT = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiRequestError'; }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const token = sessionResult?.data.session?.access_token;
  let response: Response;
  try {
    response = await fetch(API_ROOT + '/api' + path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error(`Could not connect to the API for ${path}. Check that the API server is running and VITE_API_URL is configured.`);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  let payload: unknown;
  try { payload = body ? JSON.parse(body) : undefined; } catch { /* Non-JSON errors receive a clearer status message below. */ }
  if (!response.ok) {
    if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') throw new ApiRequestError(payload.error, response.status);
    if (import.meta.env.DEV && !API_ROOT && response.status === 500 && !body) throw new ApiRequestError('The local API server is not running. Start both apps with "npm run dev" from the project root.', response.status);
    if (/proxy error|ECONNREFUSED/i.test(body)) throw new ApiRequestError('The local API server is not running. Start both apps with "npm run dev" from the project root.', response.status);
    throw new ApiRequestError(`API request failed (${response.status}) for ${path}. Check that the API service is available and VITE_API_URL is configured.`, response.status);
  }
  if (payload === undefined) throw new Error(`The API returned an invalid response for ${path}. Check that the API service is running.`);
  return payload as T;
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
