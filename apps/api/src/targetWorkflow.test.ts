import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculateTargetAchievements, createTarget, dateKeyInTimezone, updateTarget } from './targetService.js';

const testDirectory = await mkdtemp(path.join(os.tmpdir(), 'cgbs-target-workflow-'));
process.env.DATA_FILE = path.join(testDirectory, 'existing-crm-store.json');
const { readStore, updateStore } = await import('./store.js');
const admin = { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin' as const };
const addDays = (key: string, amount: number) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};
afterAll(async () => { await rm(testDirectory, { recursive: true, force: true }); });

describe('persisted target workflow', () => {
  it('saves, reloads, edits, and recalculates progress from the stored CRM calls', async () => {
    const initial = await readStore();
    expect(initial.calls.length).toBeGreaterThan(0);
    await updateStore((state) => { state.targets = []; });
    const startDate = dateKeyInTimezone(new Date(), initial.settings.timezone);
    const endDate = addDays(startDate, 6);
    const saved = await updateStore((state) => createTarget(state, {
      metric: 'calls', targetValue: 1000, period: 'weekly', startDate, endDate,
      ownerType: 'self', ownerName: admin.name, enabled: true,
    }, admin));

    const reloaded = await readStore();
    const stored = reloaded.targets.find((target) => target.id === saved.result.id);
    expect(stored?.targetValue).toBe(1000);
    const actualCalls = reloaded.calls.filter((call) => call.createdBy === admin.name && (() => {
      const day = dateKeyInTimezone(call.createdAt, reloaded.settings.timezone);
      return day >= startDate && day <= startDate;
    })()).length;
    const firstProgress = calculateTargetAchievements(reloaded).find((item) => item.target.id === saved.result.id)!;
    expect(firstProgress.actual).toBe(actualCalls);
    expect(firstProgress.remaining).toBe(1000 - actualCalls);

    await updateStore((state) => updateTarget(state, saved.result.id, {
      metric: 'calls', targetValue: 2000, period: 'weekly', startDate, endDate,
      ownerType: 'self', ownerName: admin.name, enabled: true,
    }, admin));
    const reloadedAfterEdit = await readStore();
    const revised = reloadedAfterEdit.targets.find((target) => target.id === saved.result.id)!;
    const updatedProgress = calculateTargetAchievements(reloadedAfterEdit).find((item) => item.target.id === saved.result.id)!;
    expect(revised.targetValue).toBe(2000);
    expect(revised.revisions).toHaveLength(1);
    expect(updatedProgress.actual).toBe(actualCalls);
    expect(updatedProgress.remaining).toBe(2000 - actualCalls);
  });
});
