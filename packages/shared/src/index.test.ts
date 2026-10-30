import { describe, expect, it } from 'vitest';
import {
  defaultProgression, detectDuplicates, escapeCsvCell, leadSchema,
  safeWebsiteUrl, weightedPipeline, winRate, type Lead,
} from './index.js';

const lead = (id: string, email: string, phone: string): Lead => ({
  ...leadSchema.parse({ name: 'Demo Lead', company: 'Example Co', email, phone }),
  id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  lastContacted: null, archived: false,
  stageHistory: [{ status: 'New Lead', at: new Date().toISOString(), by: 'Demo' }],
});
describe('lead rules and business calculations', () => {
  it('requires name and company while supplying safe defaults', () => {
    expect(leadSchema.safeParse({ name: 'A', company: 'B' }).success).toBe(true);
    expect(leadSchema.safeParse({ name: '', company: 'B' }).success).toBe(false);
    expect(leadSchema.parse({ name: 'A', company: 'B' }).currency).toBe('INR');
  });
  it('keeps progression defaults separate from close probability', () => {
    expect(defaultProgression('Proposal Sent')).toBe(75);
    const record = leadSchema.parse({ name: 'A', company: 'B', progression: 25, probability: 70 });
    expect(record.progression).toBe(25);
    expect(record.probability).toBe(70);
  });
  it('normalizes safe company URLs and rejects dangerous protocols', () => {
    expect(safeWebsiteUrl('example.com')).toBe('https://example.com/');
    expect(safeWebsiteUrl('javascript:alert(1)')).toBeNull();
    expect(safeWebsiteUrl('')).toBeNull();
  });
  it('skips duplicate email and phone without overwriting existing leads', () => {
    const existing = [lead('id-1', 'hello@example.test', '+91 98765 43210')];
    const result = detectDuplicates([
      leadSchema.parse({ name: 'Dup email', company: 'X', email: 'HELLO@example.test' }),
      leadSchema.parse({ name: 'Dup phone', company: 'Y', phone: '919876543210' }),
      leadSchema.parse({ name: 'Unique', company: 'Z', email: 'unique@example.test' }),
    ], existing);
    expect(result.accepted.map((item) => item.name)).toEqual(['Unique']);
    expect(result.duplicates).toHaveLength(2);
    expect(existing[0]?.name).toBe('Demo Lead');
  });
  it('weights only open opportunities and handles empty win-rate denominators', () => {
    const opportunities = [
      { id: '1', name: 'Open', leadId: 'x', amount: 1000, currency: 'INR', probability: 40, stage: 'Proposal' as const, expectedClose: null, owner: 'A', notes: '', createdAt: '', updatedAt: '' },
      { id: '2', name: 'Won', leadId: 'y', amount: 500, currency: 'INR', probability: 100, stage: 'Closed Won' as const, expectedClose: null, owner: 'A', notes: '', createdAt: '', updatedAt: '' },
    ];
    expect(weightedPipeline(opportunities)).toBe(400);
    expect(winRate([])).toBe(0);
    expect(winRate([...opportunities, { ...opportunities[0]!, id: '3', stage: 'Closed Lost' as const }])).toBe(50);
  });
  it('neutralizes CSV formula injection and quotes commas', () => {
    expect(escapeCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(escapeCsvCell('Northstar, Ltd')).toBe('"Northstar, Ltd"');
  });
});
