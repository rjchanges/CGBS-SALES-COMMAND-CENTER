import { randomUUID } from 'node:crypto';
import type {
  CGBSState, SalesTarget, TargetAchievement, TargetHistoryPoint, TargetMetric,
  TargetOwnerType, TargetPeriod, TargetRevision,
} from '../../../packages/shared/dist/index.js';

export const targetMetrics: TargetMetric[] = [
  'calls', 'new_leads', 'followups_completed', 'meetings_scheduled', 'meetings_completed',
  'qualified_leads', 'proposals_sent', 'revenue', 'deals_closed',
];
const periods: TargetPeriod[] = ['daily', 'weekly', 'monthly', 'quarterly', 'custom'];
const ownerTypes: TargetOwnerType[] = ['self', 'team', 'employee'];
export type TargetActor = { id: string; name: string; role: 'Admin' | 'Manager' | 'Salesperson' };
export class TargetServiceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
type TargetDraft = Pick<SalesTarget, 'metric' | 'targetValue' | 'period' | 'startDate' | 'endDate' | 'ownerType' | 'ownerName' | 'enabled'>;

function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year!, month! - 1, day!));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month! - 1 && check.getUTCDate() === day;
}
function asString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function hasManagerAccess(actor: TargetActor): boolean { return actor.role === 'Admin' || actor.role === 'Manager'; }

export function canAccessTarget(target: SalesTarget, actor: TargetActor): boolean {
  if (hasManagerAccess(actor) || target.ownerType === 'team') return true;
  return target.ownerName.toLowerCase() === actor.name.toLowerCase();
}

function canManageTarget(target: SalesTarget, actor: TargetActor): boolean {
  if (hasManagerAccess(actor)) return true;
  return target.ownerType === 'self' && target.ownerName.toLowerCase() === actor.name.toLowerCase();
}

function normalizeDraft(value: unknown, actor: TargetActor, members: string[]): TargetDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TargetServiceError('Enter target details.');
  const input = value as Record<string, unknown>;
  if (!targetMetrics.includes(input.metric as TargetMetric)) throw new TargetServiceError('Choose a supported target metric.');
  if (!periods.includes(input.period as TargetPeriod)) throw new TargetServiceError('Choose a valid target period.');
  if (!ownerTypes.includes(input.ownerType as TargetOwnerType)) throw new TargetServiceError('Choose a valid target owner.');
  const metric = input.metric as TargetMetric;
  const period = input.period as TargetPeriod;
  const ownerType = input.ownerType as TargetOwnerType;
  const targetValue = Number(input.targetValue);
  if (!Number.isFinite(targetValue) || targetValue < 0 || (metric !== 'revenue' && !Number.isInteger(targetValue))) {
    throw new TargetServiceError(metric === 'revenue' ? 'Target value must be a non-negative number.' : 'Activity targets must be whole numbers greater than or equal to zero.');
  }
  const startDate = asString(input.startDate);
  const endDate = asString(input.endDate);
  if (!validDateKey(startDate) || !validDateKey(endDate) || endDate < startDate) throw new TargetServiceError('Choose a valid start date and an end date on or after it.');
  let ownerName = actor.name;
  if (ownerType === 'team') {
    if (!hasManagerAccess(actor)) throw new TargetServiceError('Only a manager or admin can set a team target.', 403);
    ownerName = 'Team';
  }
  if (ownerType === 'employee') {
    if (!hasManagerAccess(actor)) throw new TargetServiceError('Only a manager or admin can set a target for another employee.', 403);
    ownerName = asString(input.ownerName);
    if (!ownerName || !members.some((member) => member.toLowerCase() === ownerName.toLowerCase())) throw new TargetServiceError('Choose an employee from the current workspace.');
  }
  return { metric, targetValue, period, startDate, endDate, ownerType, ownerName, enabled: input.enabled !== false };
}
function overlaps(a: TargetDraft, b: TargetDraft): boolean {
  return a.metric === b.metric && a.period === b.period && a.ownerType === b.ownerType && a.ownerName.toLowerCase() === b.ownerName.toLowerCase() && a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function createTarget(state: CGBSState, value: unknown, actor: TargetActor): SalesTarget {
  const draft = normalizeDraft(value, actor, getTargetMembers(state));
  if (draft.enabled && state.targets.some((target) => target.enabled && overlaps(draft, target))) {
    throw new TargetServiceError('An active target for this metric and owner overlaps those dates. Edit the saved target or choose a different date range.', 409);
  }
  const now = new Date().toISOString();
  const target: SalesTarget = { ...draft, id: randomUUID(), createdAt: now, updatedAt: now, createdBy: actor.name, revisions: [] };
  state.targets.unshift(target);
  return target;
}

export function updateTarget(state: CGBSState, id: string, value: unknown, actor: TargetActor): SalesTarget {
  const target = state.targets.find((item) => item.id === id);
  if (!target) throw new TargetServiceError('Target not found.', 404);
  if (!canManageTarget(target, actor)) throw new TargetServiceError('You cannot update this target.', 403);
  const draft = normalizeDraft(value, actor, getTargetMembers(state));
  if (draft.enabled && state.targets.some((item) => item.id !== id && item.enabled && overlaps(draft, item))) {
    throw new TargetServiceError('Another active target for this metric and owner overlaps those dates.', 409);
  }
  const savedAt = new Date().toISOString();
  const revision: TargetRevision = {
    targetValue: target.targetValue, period: target.period, startDate: target.startDate, endDate: target.endDate,
    ownerType: target.ownerType, ownerName: target.ownerName, enabled: target.enabled, savedAt, savedBy: actor.name,
  };
  Object.assign(target, draft, { updatedAt: savedAt, revisions: [...target.revisions, revision] });
  return target;
}

export function setTargetEnabled(state: CGBSState, id: string, enabled: boolean, actor: TargetActor): SalesTarget {
  const target = state.targets.find((item) => item.id === id);
  if (!target) throw new TargetServiceError('Target not found.', 404);
  if (!canManageTarget(target, actor)) throw new TargetServiceError('You cannot update this target.', 403);
  if (enabled && state.targets.some((item) => item.id !== id && item.enabled && overlaps({ ...target, enabled: true }, item))) {
    throw new TargetServiceError('An active target for this metric and owner overlaps those dates.', 409);
  }
  const savedAt = new Date().toISOString();
  target.revisions.push({ targetValue: target.targetValue, period: target.period, startDate: target.startDate, endDate: target.endDate, ownerType: target.ownerType, ownerName: target.ownerName, enabled: target.enabled, savedAt, savedBy: actor.name });
  target.enabled = enabled;
  target.updatedAt = savedAt;
  return target;
}

export function getTargetMembers(state: CGBSState): string[] {
  return [...new Set([
    ...state.leads.map((item) => item.assignedTo), ...state.calls.map((item) => item.createdBy),
    ...state.tasks.map((item) => item.assignedTo), ...state.opportunities.map((item) => item.owner),
  ].map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function safeTimezone(value: string): string {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); return value; }
  catch { return 'Asia/Kolkata'; }
}
export function dateKeyInTimezone(value: string | Date, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function shiftDateKey(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
function monthStart(key: string): string { return `${key.slice(0, 7)}-01`; }
function monthEnd(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year!, month!, 0)).getUTCDate()).padStart(2, '0')}`;
}
function bucketFor(target: SalesTarget, key: string): [string, string] {
  if (target.period === 'custom') return [target.startDate, target.endDate];
  if (target.period === 'daily') return [key, key];
  if (target.period === 'weekly') {
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return [shiftDateKey(key, mondayOffset), shiftDateKey(key, mondayOffset + 6)];
  }
  if (target.period === 'monthly') return [monthStart(key), monthEnd(key)];
  const month = Number(key.slice(5, 7));
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const start = `${key.slice(0, 4)}-${String(quarterMonth).padStart(2, '0')}-01`;
  const endMonth = quarterMonth + 2;
  const endKey = `${key.slice(0, 4)}-${String(endMonth).padStart(2, '0')}-01`;
  return [start, monthEnd(endKey)];
}
function clippedBucket(target: SalesTarget, bucket: [string, string]): [string, string] {
  return [bucket[0] < target.startDate ? target.startDate : bucket[0], bucket[1] > target.endDate ? target.endDate : bucket[1]];
}
function within(value: string | null | undefined, start: string, end: string, timezone: string): boolean {
  if (!value) return false;
  const key = dateKeyInTimezone(value, timezone);
  return Boolean(key && key >= start && key <= end);
}
function belongsToOwner(target: SalesTarget, owner: string): boolean {
  return target.ownerType === 'team' || owner.toLowerCase() === target.ownerName.toLowerCase();
}
function actualForBucket(data: CGBSState, target: SalesTarget, start: string, end: string, timezone: string): number {
  const member = (name: string) => belongsToOwner(target, name);
  switch (target.metric) {
    case 'calls': return data.calls.filter((item) => member(item.createdBy) && within(item.createdAt, start, end, timezone)).length;
    case 'new_leads': return data.leads.filter((item) => !item.archived && member(item.assignedTo) && within(item.createdAt, start, end, timezone)).length;
    case 'followups_completed': return data.tasks.filter((item) => item.status === 'Completed' && member(item.assignedTo) && within(item.completedAt, start, end, timezone)).length;
    case 'meetings_scheduled': return data.tasks.filter((item) => item.type === 'Meeting' && member(item.assignedTo) && within(item.createdAt, start, end, timezone)).length;
    case 'meetings_completed': return data.tasks.filter((item) => item.type === 'Meeting' && item.status === 'Completed' && member(item.assignedTo) && within(item.completedAt, start, end, timezone)).length;
    case 'qualified_leads': return data.leads.filter((lead) => !lead.archived && member(lead.assignedTo) && lead.stageHistory.some((item) => item.status === 'Qualified' && within(item.at, start, end, timezone))).length;
    case 'proposals_sent': return data.activities.filter((item) => item.type === 'Opportunity' && /^Opportunity moved to Proposal$/i.test(item.title) && within(item.createdAt, start, end, timezone) && (target.ownerType === 'team' || member(data.opportunities.find((opp) => opp.leadId === item.leadId)?.owner || item.createdBy))).length;
    case 'revenue': return data.opportunities.filter((item) => item.stage === 'Closed Won' && member(item.accomplishedByName || item.owner) && within(item.actualCloseAt || null, start, end, timezone)).reduce((sum, item) => sum + item.amount, 0);
    case 'deals_closed': return data.opportunities.filter((item) => item.stage === 'Closed Won' && member(item.accomplishedByName || item.owner) && within(item.actualCloseAt || null, start, end, timezone)).length;
  }
}
function historyBuckets(target: SalesTarget, today: string): [string, string][] {
  const effectiveEnd = target.endDate < today ? target.endDate : today > target.startDate ? today : target.startDate;
  if (target.period === 'custom') return [[target.startDate, target.endDate]];
  const keys: [string, string][] = [];
  let cursor = target.startDate;
  while (cursor <= effectiveEnd && keys.length < 120) {
    const bucket = clippedBucket(target, bucketFor(target, cursor));
    if (!keys.length || keys[keys.length - 1]![0] !== bucket[0]) keys.push(bucket);
    cursor = shiftDateKey(bucket[1], 1);
  }
  return keys.slice(-12);
}

export function calculateTargetAchievements(data: CGBSState, now = new Date()): TargetAchievement[] {
  const timezone = safeTimezone(data.settings.timezone || 'Asia/Kolkata');
  const today = dateKeyInTimezone(now, timezone);
  return data.targets.map((target) => {
    const reference = today < target.startDate ? target.startDate : today > target.endDate ? target.endDate : today;
    const [rawStart, rawEnd] = bucketFor(target, reference);
    const [bucketStart, bucketEnd] = clippedBucket(target, [rawStart, rawEnd]);
    const elapsedEnd = today < bucketStart ? shiftDateKey(bucketStart, -1) : today > bucketEnd ? bucketEnd : today;
    const actual = elapsedEnd < bucketStart ? 0 : actualForBucket(data, target, bucketStart, elapsedEnd, timezone);
    const dayCount = Math.max(1, Math.round((Date.parse(`${bucketEnd}T00:00:00Z`) - Date.parse(`${bucketStart}T00:00:00Z`)) / 86400000) + 1);
    const elapsedDays = Math.max(0, Math.min(dayCount, Math.round((Date.parse(`${elapsedEnd}T00:00:00Z`) - Date.parse(`${bucketStart}T00:00:00Z`)) / 86400000) + 1));
    const expected = target.targetValue * elapsedDays / dayCount;
    const history: TargetHistoryPoint[] = historyBuckets(target, today).map(([periodStart, periodEnd]) => ({
      periodStart, periodEnd,
      actual: actualForBucket(data, target, periodStart, periodEnd < today ? periodEnd : today, timezone),
      target: target.targetValue,
    }));
    const percentage = target.targetValue > 0 ? actual / target.targetValue * 100 : actual > 0 ? 100 : 0;
    return {
      target, actual, remaining: Math.max(0, target.targetValue - actual), percentage,
      expected, status: actual >= target.targetValue ? 'Achieved' : actual >= expected ? 'On Track' : 'Behind Target',
      bucketStart, bucketEnd, history,
    };
  });
}