import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import type { CGBSState, Lead } from '../../../packages/shared/dist/index.js';
import { requireDemoSession, type AuthedRequest } from './auth.js';
import { importLeadBatch } from './leadImportService.js';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSeedState } from './seedData.js';
function emptyState(): CGBSState {
  return {
    leads: [], calls: [], tasks: [], opportunities: [], templates: [], activities: [], targets: [], calendarEvents: [], reminders: [], notifications: [],
    settings: { dailyCallTarget: 40, dailyFollowUpTarget: 8, dailyMeetingTarget: 3, monthlyRevenueTarget: 0, currency: 'INR', timezone: 'Asia/Kolkata' },
  };
}

const leadRow = (overrides: Record<string, unknown> = {}) => ({
  name: 'Asha Rao', company: 'Northstar Systems', role: 'CTO', industry: 'Technology',
  companyLogo: 'https://northstar.test/logo.png', companyNetWorth: 12_500_000,
  email: 'asha@northstar.test', phone: '+91 98765 43210', website: 'northstar.test', linkedin: '',
  revenue: 0, currency: 'INR', source: 'Other', status: 'New Lead', priority: 'Medium',
  progression: 5, probability: 10, assignedTo: 'Changed by client', nextFollowUp: null,
  expectedClose: null, notes: '', ...overrides,
});

function authorize(headers: Record<string, string>, demoMode = true) {
  const request = { headers } as AuthedRequest;
  const response = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  let nextCalled = false;
  requireDemoSession(demoMode)(request, response as unknown as Response, () => { nextCalled = true; });
  return { request, response, nextCalled };
}

describe('authenticated atomic lead bulk import', () => {
  it('rejects unauthorized import requests before the route can run', () => {
    const result = authorize({});
    expect(result.response.statusCode).toBe(401);
    expect(result.nextCalled).toBe(false);
  });

  it('refuses imports when production auth is not configured', () => {
    const result = authorize({ authorization: 'Bearer demo-session' }, false);
    expect(result.response.statusCode).toBe(503);
    expect(result.nextCalled).toBe(false);
  });

  it('accepts an authenticated session and assigns the authenticated owner', () => {
    const result = authorize({ authorization: 'Bearer demo-session' });
    expect(result.nextCalled).toBe(true);
    expect(result.request.user?.name).toBe('Rahul Raj M');
  });

  it('keeps company net worth separate from deal revenue and saves CRM metadata', () => {
    const state = emptyState();
    const result = importLeadBatch(state, [{ rowNumber: 2, lead: leadRow() }], 'Rahul Raj M');
    const imported = state.leads[0] as Lead;
    expect(result).toMatchObject({ total: 1, added: 1, duplicates: 0, failed: 0 });
    expect(imported.companyNetWorth).toBe(12_500_000);
    expect(imported.revenue).toBe(0);
    expect(imported.assignedTo).toBe('Rahul Raj M');
    expect(imported.stageHistory[0]?.by).toBe('Rahul Raj M');
    expect(state.activities[0]?.title).toBe('Lead imported');
  });

  it('skips duplicates and repeated imports without overwriting or adding another record', () => {
    const state = emptyState();
    const payload = [{ rowNumber: 2, lead: leadRow() }];
    expect(importLeadBatch(state, payload, 'Rahul Raj M').added).toBe(1);
    const repeated = importLeadBatch(state, payload, 'Rahul Raj M');
    expect(repeated).toMatchObject({ added: 0, duplicates: 1, failed: 0 });
    expect(state.leads).toHaveLength(1);
    expect(state.leads[0]?.name).toBe('Asha Rao');
  });

  it('imports rows with validation warnings and saves the warning details in Notes', () => {
    const state = emptyState();
    const result = importLeadBatch(state, [
      { rowNumber: 2, lead: leadRow({ name: '', email: 'not-an-email', phone: '' }) },
      { rowNumber: 3, lead: leadRow({ name: 'Valid Contact', company: 'New Company', email: 'valid@new.test' }) },
    ], 'Rahul Raj M');
    expect(result.failed).toBe(0);
    expect(result.added).toBe(2);
    expect(result.warnings[0]?.rowNumber).toBe(2);
    expect(state.leads).toHaveLength(2);
    expect(state.leads.find((lead) => lead.name === '')?.email).toBe('not-an-email');
    expect(state.leads.find((lead) => lead.name === '')?.notes).toContain('Import warnings:');
  });

  it('imports structurally incomplete rows without fabricating required values', () => {
    const state = emptyState();
    const result = importLeadBatch(state, [{ rowNumber: 8, lead: null }], 'Rahul Raj M');
    expect(result).toMatchObject({ added: 1, failed: 0 });
    expect(result.warnings[0]?.rowNumber).toBe(8);
    expect(state.leads[0]?.name).toBe('');
    expect(state.leads[0]?.company).toBe('');
    expect(state.leads[0]?.notes).toContain('Name is blank.');
  });


  it('leaves the persisted local store unchanged when an atomic write fails', async () => {
    const testDirectory = path.resolve(process.cwd(), '../../.vitest-tmp/lead-import-store-failure-' + randomUUID());
    const dataFile = path.join(testDirectory, 'state.json');
    const previousDataFile = process.env.DATA_FILE;
    await mkdir(testDirectory, { recursive: true });
    const initial = createSeedState();
    await writeFile(dataFile, JSON.stringify(initial), 'utf8');
    await mkdir(dataFile + '.tmp');
    process.env.DATA_FILE = dataFile;
    try {
      const { updateStore } = await import('./store.js');
      await expect(updateStore((state) => { state.leads.unshift({} as Lead); })).rejects.toThrow();
      expect(JSON.parse(await readFile(dataFile, 'utf8'))).toEqual(initial);
    } finally {
      if (previousDataFile === undefined) delete process.env.DATA_FILE;
      else process.env.DATA_FILE = previousDataFile;
      await rm(testDirectory, { recursive: true, force: true });
    }
  });});
