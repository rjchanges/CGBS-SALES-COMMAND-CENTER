import { describe, expect, it } from 'vitest';
import { calculateMetrics } from './analytics.js';
import type { CGBSState } from '../../../packages/shared/dist/index.js';

const state: CGBSState = {
  leads: [], calls: [], tasks: [],
  opportunities: [
    { id: 'a', name: 'Open', leadId: 'l1', amount: 1000, currency: 'INR', probability: 50, stage: 'Discovery', expectedClose: null, owner: 'A', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'b', name: 'Won', leadId: 'l2', amount: 500, currency: 'INR', probability: 100, stage: 'Closed Won', expectedClose: null, owner: 'A', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  templates: [], activities: [], targets: [], calendarEvents: [],
  settings: { dailyCallTarget: 40, monthlyRevenueTarget: 10000, currency: 'INR', timezone: 'Asia/Kolkata' },
};
describe('dashboard calculations', () => {
  it('separates open, weighted, and closed-won revenue', () => {
    const result = calculateMetrics(state);
    expect(result.openPipeline).toBe(1000);
    expect(result.weightedPipeline).toBe(500);
    expect(result.closedWonRevenue).toBe(500);
    expect(result.winRate).toBe(100);
  });
  it('returns zero rates when there are no leads or closed deals', () => {
    const empty = { ...state, opportunities: [], leads: [] };
    expect(calculateMetrics(empty).winRate).toBe(0);
    expect(calculateMetrics(empty).conversionRate).toBe(0);
  });
});
