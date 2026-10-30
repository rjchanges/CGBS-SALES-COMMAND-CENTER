import { describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { calculateTargetAchievements, canAccessTarget, createTarget, setTargetEnabled, TargetServiceError, updateTarget } from './targetService.js';

const admin = { id: 'admin-1', name: 'Sales Manager', role: 'Admin' as const };
const salesperson = { id: 'sales-2', name: 'Asha Nair', role: 'Salesperson' as const };
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
function draft(overrides: Record<string, unknown> = {}) {
  const today = new Date();
  return { metric: 'calls', targetValue: 12, period: 'weekly', startDate: dateKey(plusDays(today, -7)), endDate: dateKey(plusDays(today, 7)), ownerType: 'self', enabled: true, ...overrides };
}

describe('sales target configuration and permissions', () => {
  it('creates and revises targets while preserving revision history', () => {
    const state = createSeedState(); state.targets = [];
    const target = createTarget(state, draft(), admin);
    expect(state.targets[0]?.id).toBe(target.id);
    const updated = updateTarget(state, target.id, draft({ targetValue: 18 }), admin);
    expect(updated.targetValue).toBe(18);
    expect(updated.revisions).toHaveLength(1);
    expect(updated.revisions[0]?.targetValue).toBe(12);
  });

  it('allows the same metric for separate daily, weekly, monthly, and quarterly periods', () => {
    const state = createSeedState(); state.targets = [];
    const targets = (['daily', 'weekly', 'monthly', 'quarterly'] as const).map((period) => createTarget(state, draft({ period }), admin));
    expect(targets.map((target) => target.period)).toEqual(['daily', 'weekly', 'monthly', 'quarterly']);
  });

  it('rejects duplicate overlapping targets for the same metric, period, and owner', () => {
    const state = createSeedState(); state.targets = [];
    createTarget(state, draft(), admin);
    expect(() => createTarget(state, draft({ startDate: dateKey(plusDays(new Date(), -2)) }), admin)).toThrowError(TargetServiceError);
  });

  it('allows an ordinary user to edit their own target but denies team and other employee changes', () => {
    const state = createSeedState(); state.targets = [];
    const own = createTarget(state, draft(), salesperson);
    expect(updateTarget(state, own.id, draft({ targetValue: 15 }), salesperson).targetValue).toBe(15);
    const team = createTarget(state, draft({ ownerType: 'team' }), admin);
    expect(canAccessTarget(team, salesperson)).toBe(true);
    expect(() => updateTarget(state, team.id, draft({ ownerType: 'self' }), salesperson)).toThrowError(/cannot update/);
    expect(() => setTargetEnabled(state, team.id, false, salesperson)).toThrowError(/cannot update/);
    const otherEmployeeName = state.calls[0]!.createdBy;
    const otherEmployee = createTarget(state, draft({ ownerType: 'employee', ownerName: otherEmployeeName }), admin);
    expect(() => updateTarget(state, otherEmployee.id, draft({ ownerType: 'employee', ownerName: otherEmployeeName }), salesperson)).toThrowError(/cannot update/);
  });

  it('calculates achievement, percentage, and remaining amount from saved CRM calls', () => {
    const state = createSeedState(); state.targets = [];
    const startDate = dateKey(plusDays(new Date(), -3));
    const endDate = dateKey(plusDays(new Date(), 3));
    const target = createTarget(state, draft({ startDate, endDate }), admin);
    const actual = state.calls.filter((call) => call.createdBy === admin.name && dateKey(new Date(call.createdAt)) >= startDate && dateKey(new Date(call.createdAt)) <= endDate).length;
    const achievement = calculateTargetAchievements(state).find((item) => item.target.id === target.id)!;
    expect(achievement.actual).toBe(actual);
    expect(achievement.percentage).toBe(target.targetValue ? actual / target.targetValue * 100 : 0);
    expect(achievement.remaining).toBe(Math.max(0, target.targetValue - actual));
  });
});
