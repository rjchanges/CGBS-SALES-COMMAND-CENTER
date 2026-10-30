import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { createDefaultTargets, createSeedState } from './seedData.js';
import type { CGBSState } from '../../../packages/shared/dist/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
const dataPath = path.resolve(process.cwd(), process.env.DATA_FILE || 'data/local.json');
let writeQueue: Promise<void> = Promise.resolve();

async function ensureStore(): Promise<void> {
  await mkdir(path.dirname(dataPath), { recursive: true });
  try {
    await readFile(dataPath, 'utf8');
  } catch {
    await writeFile(dataPath, JSON.stringify(createSeedState(), null, 2), 'utf8');
  }
}

function normalizeState(value: CGBSState): CGBSState {
  return {
    ...value,
    leads: (value.leads || []).map((lead) => ({
      ...lead,
      priority: lead.priority || 'Medium',
      actualCloseAt: lead.actualCloseAt || null, closedById: lead.closedById || null, closedByName: lead.closedByName || null, lossReason: lead.lossReason || '', preCloseOpportunityStages: lead.preCloseOpportunityStages || [],
      companyLogo: lead.companyLogo || '', companyNetWorth: lead.companyNetWorth || 0,
      aiOutreachTopic: lead.aiOutreachTopic || '', aiOpeningMessage: lead.aiOpeningMessage || '',
      aiEmailSubject: lead.aiEmailSubject || '', aiFollowUpApproach: lead.aiFollowUpApproach || '',
      stageHistory: lead.stageHistory || [], changeHistory: lead.changeHistory || [],
    })),
    calls: value.calls || [],
    voiceCalls: (value.voiceCalls || []).map((call) => ({ ...call, outcomeRecordedAt: call.outcomeRecordedAt || null })),
    callingProfiles: value.callingProfiles || [],
    tasks: (value.tasks || []).map((task) => ({ ...task, createdBy: task.createdBy || 'Rahul Raj M', completionNotes: task.completionNotes || '', cancelledReason: task.cancelledReason || '', scheduleHistory: task.scheduleHistory || [], endsAt: task.endsAt || null })),
    opportunities: (value.opportunities || []).map((opp) => ({
      actualCloseAt: opp.stage === 'Closed Won' ? opp.updatedAt : null,
      accomplishedById: opp.stage === 'Closed Won' ? 'demo-admin' : null,
      accomplishedByName: opp.stage === 'Closed Won' ? opp.owner : null, lossReason: '', preCloseStage: null, ...opp,
    })),
    templates: value.templates || [],
    activities: value.activities || [],
    targets: value.targets ?? createDefaultTargets(value.settings || { dailyCallTarget: 40, dailyFollowUpTarget: 8, dailyMeetingTarget: 3, monthlyRevenueTarget: 5000000, currency: 'INR', timezone: 'Asia/Kolkata' }),
    calendarEvents: value.calendarEvents || [],
    reminders: value.reminders || [],
    notifications: value.notifications || [],
    settings: { ...value.settings, dailyCallTarget: value.settings?.dailyCallTarget || 40, dailyFollowUpTarget: value.settings?.dailyFollowUpTarget ?? 8, dailyMeetingTarget: value.settings?.dailyMeetingTarget ?? 3, monthlyRevenueTarget: value.settings?.monthlyRevenueTarget || 0, currency: value.settings?.currency || 'INR', timezone: value.settings?.timezone || 'Asia/Kolkata' },
  };
}
export async function readStore(): Promise<CGBSState> {
  await ensureStore();
  return normalizeState(JSON.parse(await readFile(dataPath, 'utf8')) as CGBSState);
}

export async function updateStore<T>(change: (state: CGBSState) => T): Promise<{ state: CGBSState; result: T }> {
  let result!: T;
  const operation = writeQueue.then(async () => {
    const state = await readStore();
    result = change(state);
    const tempPath = `${dataPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tempPath, dataPath);
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
  return { state: await readStore(), result };
}

export async function resetStore(): Promise<void> {
  await mkdir(path.dirname(dataPath), { recursive: true });
  await writeFile(dataPath, JSON.stringify(createSeedState(), null, 2), 'utf8');
}

if (process.argv.some((arg) => arg === '--reset')) {
  await resetStore();
  console.log(`Fictional CGBS demo records reset at ${dataPath}`);
}











