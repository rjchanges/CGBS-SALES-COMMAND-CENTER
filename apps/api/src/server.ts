import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { addMinutes } from 'date-fns';
import {
  leadSchema, leadStatuses, safeWebsiteUrl,
  type CGBSState, type FollowUpTask, type Lead, type LeadInput, type LeadStatus, type Opportunity,
} from '../../../packages/shared/dist/index.js';
import { requireDemoSession, type AuthedRequest } from './auth.js';
import { importLeadBatch } from './leadImportService.js';
import { CallServiceError, recordCall, recordVoiceCallOutcome } from './callService.js';
import { FollowUpSalesError, saveLeadSalesDetails, updateFollowUpSalesDetails } from './followUpSalesService.js';
import { readStore, updateStore } from './store.js';
import { calculateMetrics } from './analytics.js';
import { scopeReportRecords } from './reportService.js';
import { canAccessTarget, calculateTargetAchievements, createTarget, setTargetEnabled, TargetServiceError, updateTarget } from './targetService.js';
import { createCalendarEvent, deleteCalendarEvent, getCalendarItems, updateCalendarEvent } from './calendarService.js';
import { deleteReminder, dispatchDueReminders, listReminders, ReminderError, saveReminder, syncReminderEvent } from './reminderService.js';
import { OpportunityServiceError, reopenOpportunity, transitionOpportunityStage } from './opportunityService.js';
import { exotelConfig, connectTwoNumbers, getExotelCallDetails, sendExotelVerificationSms } from './exotelClient.js';
import { isE164PhoneNumber } from './phoneNumber.js';
import { applyVoiceStatus, canViewVoiceCall, callingProfile, prepareVoiceCall, savePendingPhone, statusFromProvider, verifyExotelBasicAuth, verifyPendingPhone, VoiceCallError } from './voiceCallService.js';

const app = express();
const port = Number(process.env.PORT || 4100);
const demoMode = process.env.DEMO_MODE !== 'false';
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/voice-calls', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/calling/verification', rateLimit({ windowMs: 10 * 60_000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false }));

const api = express.Router();
api.post('/auth/demo', (_req, res) => {
  if (!demoMode) return res.status(403).json({ error: 'Local demo access is disabled.' });
  res.json({ accessToken: 'demo-session', user: { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin' }, mode: 'local-demo' });
});
api.get('/auth/config', (_req, res) => res.json({ demoMode, authProvider: demoMode ? 'local-demo' : 'unconfigured', emailConfigured: false }));
api.get('/health', (_req, res) => res.json({ status: 'ok', mode: demoMode ? 'local-demo' : 'production', timestamp: new Date().toISOString() }));

app.post('/api/exotel/callback', async (req, res) => {
  const config = exotelConfig(process.env);
  if (!verifyExotelBasicAuth(req.get('authorization'), config.webhookUsername, config.webhookPassword)) return res.status(401).json({ error: 'Invalid Exotel callback credentials.' });
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const sid = String(body.CallSid || body.call_sid || '');
  const customField = String(body.CustomField || body.custom_field || '');
  const eventType = String(body.EventType || body.event_type || '').toLowerCase();
  const eventId = String(body.EventSid || body.event_sid || `${sid}:${eventType}:${String(body.DateUpdated || body.date_updated || body.Status || body.status || '')}`);
  if (!sid && !customField) return res.status(400).json({ error: 'Callback is missing the Exotel call identifier.' });
  const status = eventType === 'answered' ? 'Connecting to Client' : statusFromProvider(body.Status || body.status, body.Leg1Status, body.Leg2Status, Number(body.ConversationDuration || body.Duration || body.duration || 0) || null);
  if (!status) return res.status(200).json({ accepted: true, ignored: true });
  const { result } = await updateStore((state) => {
    const call = state.voiceCalls.find((item) => (sid && item.providerCallId === sid) || (customField && item.id === customField));
    if (!call) return false;
    const duration = Number(body.ConversationDuration || body.Duration || body.duration || 0) || null;
    applyVoiceStatus(state, call, { status, providerCallId: sid || undefined, eventId, startedAt: providerDate(body.StartTime || body.start_time), endedAt: providerDate(body.EndTime || body.end_time), durationSeconds: duration });
    return true;
  });
  res.status(200).json({ accepted: true, updated: result });
});
api.use(requireDemoSession(demoMode));

function activity(state: CGBSState, leadId: string, type: 'Call' | 'Stage change' | 'Follow-up' | 'Note' | 'Opportunity' | 'Lead update', title: string, detail: string, createdBy = 'Rahul Raj M') {
  state.activities.unshift({ id: randomUUID(), leadId, type, title, detail, createdAt: new Date().toISOString(), createdBy: createdBy });
}
function providerDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
function asLead(input: LeadInput): Lead {
  const now = new Date().toISOString();
  return { ...input, website: safeWebsiteUrl(input.website) ?? '', companyLogo: safeWebsiteUrl(input.companyLogo) ?? '', id: randomUUID(), createdAt: now, updatedAt: now, lastContacted: null, archived: false, stageHistory: [{ status: input.status, at: now, by: 'Rahul Raj M' }], changeHistory: [] };
}
function duplicateMessage(state: CGBSState, input: LeadInput, ignoreId?: string) {
  const email = input.email.toLowerCase();
  const phone = input.phone.replace(/\D/g, '');
  return state.leads.find((lead) => lead.id !== ignoreId && (
    (email && lead.email.toLowerCase() === email) || (phone && phone.length > 6 && lead.phone.replace(/\D/g, '') === phone)
  ));
}

api.get('/bootstrap', async (req: AuthedRequest, res) => {
  const data = await readStore();
  const actor = req.user!;
  const visibleTargets = data.targets.filter((target) => canAccessTarget(target, actor));
  res.json({ user: actor, mode: 'local-demo', ...data, targets: visibleTargets, calendarEvents: [], reminders: listReminders(data, actor), notifications: data.notifications.filter((item) => item.userId === actor.id).slice(0, 100), metrics: calculateMetrics(data), targetPerformance: calculateTargetAchievements({ ...data, targets: visibleTargets }) });
});

api.get('/leads', async (req, res) => {
  const data = await readStore();
  const includeArchived = req.query.archived === 'true';
  const q = String(req.query.q || '').toLowerCase();
  res.json(data.leads.filter((lead) =>
    lead.archived === includeArchived &&
    (!q || [lead.id, lead.name, lead.company, lead.email, lead.phone].some((v) => v.toLowerCase().includes(q)))
  ));
});
api.post('/leads', async (req: AuthedRequest, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid lead data.' });
  const { result } = await updateStore((data) => {
    const duplicate = duplicateMessage(data, parsed.data);
    if (duplicate) return { error: 'A lead with matching contact details already exists: ' + duplicate.name + ' · ' + duplicate.company };
    const created = asLead({ ...parsed.data, assignedTo: req.user?.name || parsed.data.assignedTo });
    data.leads.unshift(created);
    activity(data, created.id, 'Note', 'Lead created', 'Lead added to the workspace.');
    return { lead: created };
  });
  if ('error' in result) return res.status(409).json({ error: result.error });
  res.status(201).json(result.lead);
});
api.patch('/leads/:id', async (req: AuthedRequest, res) => {
  const parsed = leadSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid lead data.' });
  const { result } = await updateStore((data) => {
    const lead = data.leads.find((item) => item.id === req.params.id);
    if (!lead) return { error: 'Lead not found.' };
    const actor = req.user!; const manager = actor.role === 'Admin' || actor.role === 'Manager';
    if (!manager && lead.assignedTo.toLowerCase() !== actor.name.toLowerCase()) return { error: 'You do not have permission to edit this lead.', forbidden: true as const };
    const candidate = { ...lead, ...parsed.data };
    const duplicate = duplicateMessage(data, candidate, lead.id);
    if (duplicate) return { error: 'Contact details match ' + duplicate.name + ' · ' + duplicate.company + '.' };
    const oldStatus = lead.status;
    if (parsed.data.status && parsed.data.status !== oldStatus && ['Won', 'Lost'].includes(parsed.data.status)) return { error: 'Close and reopen sales processes from Opportunities.' };
    if (parsed.data.status && parsed.data.status !== oldStatus && (oldStatus === 'Won' || oldStatus === 'Lost')) return { error: 'Reopen closed sales only from the authorized Opportunities action.', forbidden: true as const };
    const changes = Object.entries(parsed.data).filter(([field, value]) => JSON.stringify(lead[field as keyof Lead]) !== JSON.stringify(value)).map(([field, value]) => ({ field, from: String(lead[field as keyof Lead] ?? ''), to: String(value ?? '') }));
    Object.assign(lead, parsed.data, { website: parsed.data.website === undefined ? lead.website : safeWebsiteUrl(parsed.data.website) ?? '', companyLogo: parsed.data.companyLogo === undefined ? lead.companyLogo : safeWebsiteUrl(parsed.data.companyLogo) ?? '', updatedAt: new Date().toISOString() });
    if (changes.length) { lead.changeHistory ||= []; lead.changeHistory.push({ at: lead.updatedAt, by: actor.name, changes }); activity(data, lead.id, 'Lead update', 'Lead details updated', changes.map((item) => item.field + ': ' + (item.from || '—') + ' → ' + (item.to || '—')).join('; '), actor.name); }
    if (parsed.data.status && parsed.data.status !== oldStatus) {
      lead.stageHistory.push({ status: parsed.data.status, at: lead.updatedAt, by: actor.name });
      activity(data, lead.id, 'Stage change', 'Stage changed to ' + parsed.data.status, 'Moved from ' + oldStatus + ' to ' + parsed.data.status + '.', actor.name);
      if (parsed.data.status === 'Won' || parsed.data.status === 'Lost') {
        const won = parsed.data.status === 'Won'; const reason = won ? 'Lead marked Won' : 'Lead marked Lost' + (lead.notes.trim() ? ': ' + lead.notes.trim().slice(0, 800) : '');
        for (const task of data.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due')) { task.status = 'Cancelled'; task.cancelledReason = reason; activity(data, lead.id, 'Follow-up', 'Follow-up cancelled · lead ' + parsed.data.status, reason, actor.name); }
        for (const opportunity of data.opportunities.filter((item) => item.leadId === lead.id)) { opportunity.stage = won ? 'Closed Won' : 'Closed Lost'; opportunity.updatedAt = lead.updatedAt; opportunity.actualCloseAt = won ? lead.updatedAt : null; opportunity.accomplishedById = won ? actor.id : null; opportunity.accomplishedByName = won ? actor.name : null; }
        lead.nextFollowUp = null;
      }
    }
    return { lead };
  });
  if ('error' in result) return res.status('forbidden' in result ? 403 : result.error === 'Lead not found.' ? 404 : 409).json({ error: result.error });
  res.json(result.lead);
});
api.delete('/leads/:id', async (req, res) => {
  const { result } = await updateStore((data) => {
    const index = data.leads.findIndex((item) => item.id === req.params.id);
    if (index < 0) return false;
    data.leads.splice(index, 1);
    data.tasks = data.tasks.filter((task) => task.leadId !== req.params.id);
    data.opportunities = data.opportunities.filter((opp) => opp.leadId !== req.params.id);
    return true;
  });
  res.status(result ? 204 : 404).end();
});
api.post('/leads/:id/archive', async (req, res) => {
  const { result } = await updateStore((data) => {
    const lead = data.leads.find((item) => item.id === req.params.id);
    if (!lead) return null;
    lead.archived = Boolean(req.body.archived);
    lead.updatedAt = new Date().toISOString();
    activity(data, lead.id, 'Note', lead.archived ? 'Lead archived' : 'Lead restored', '');
    return lead;
  });
  if (!result) return res.status(404).json({ error: 'Lead not found.' });
  res.json(result);
});
api.post('/import', async (req: AuthedRequest, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) return res.status(400).json({ error: 'Import must contain up to 500 previewed rows.' });
  const entries = rows.map((entry: unknown, index: number) => {
    if (entry && typeof entry === 'object' && 'lead' in entry) {
      const item = entry as { rowNumber?: unknown; lead: unknown; warnings?: unknown };
      return { rowNumber: Number(item.rowNumber), lead: item.lead, warnings: Array.isArray(item.warnings) ? item.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [] };
    }
    return { rowNumber: index + 2, lead: entry };
  });
  const { state, result } = await updateStore((data) => importLeadBatch(data, entries, req.user?.name || 'Rahul Raj M'));
  res.json({ ...result, leadCount: state.leads.length });
});
api.get('/calls', async (_req, res) => res.json((await readStore()).calls));
api.post('/calls', async (req: AuthedRequest, res) => {
  try {
    const { result } = await updateStore((data) => recordCall(data, req.body, req.user!));
    res.status(result.duplicate ? 200 : 201).json(result.call);
  } catch (error) {
    if (error instanceof CallServiceError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
api.get('/calling/profile', async (req: AuthedRequest, res) => {
  const state = await readStore(); const actor = req.user!; const profile = callingProfile(state, actor);
  const config = exotelConfig(process.env);
  const missingCall = [!process.env.EXOTEL_API_KEY && 'EXOTEL_API_KEY', !process.env.EXOTEL_API_TOKEN && 'EXOTEL_API_TOKEN', !process.env.EXOTEL_ACCOUNT_SID && 'EXOTEL_ACCOUNT_SID', !process.env.EXOTEL_CALLER_ID && 'EXOTEL_CALLER_ID', !process.env.EXOTEL_WEBHOOK_BASE_URL && 'EXOTEL_WEBHOOK_BASE_URL', !process.env.EXOTEL_WEBHOOK_USERNAME && 'EXOTEL_WEBHOOK_USERNAME', !process.env.EXOTEL_WEBHOOK_PASSWORD && 'EXOTEL_WEBHOOK_PASSWORD'].filter(Boolean);
  const missingSms = [!process.env.EXOTEL_API_KEY && 'EXOTEL_API_KEY', !process.env.EXOTEL_API_TOKEN && 'EXOTEL_API_TOKEN', !process.env.EXOTEL_ACCOUNT_SID && 'EXOTEL_ACCOUNT_SID', !process.env.EXOTEL_SMS_FROM && 'EXOTEL_SMS_FROM', config.region === 'india' && !process.env.EXOTEL_DLT_ENTITY_ID && 'EXOTEL_DLT_ENTITY_ID', config.region === 'india' && !process.env.EXOTEL_DLT_TEMPLATE_ID && 'EXOTEL_DLT_TEMPLATE_ID'].filter(Boolean);
  res.json({ profile: profile ? { phone: profile.phone, verifiedAt: profile.verifiedAt, pendingPhone: profile.pendingPhone } : null, provider: { configured: config.configured, verificationConfigured: config.verificationConfigured, region: config.region, callingMessage: config.configured ? '' : 'Provider calls are disabled. Configure ' + missingCall.join(', ') + ' in the API environment.', verificationMessage: config.verificationConfigured ? '' : 'Phone verification SMS is disabled. Configure ' + missingSms.join(', ') + (config.region === 'india' ? ', with approved India DLT sender and template details.' : '.') } });
});
api.post('/calling/verification', async (req: AuthedRequest, res) => {
  const actor = req.user!; const phone = req.body?.phone;
  if (!isE164PhoneNumber(phone)) return res.status(400).json({ error: 'Enter a valid phone number in international E.164 format, such as +919876543210.' });
  const config = exotelConfig(process.env);
  if (!config.verificationConfigured) return res.status(503).json({ error: 'Phone verification is unavailable. ' + (config.region === 'india' ? 'Exotel SMS and approved DLT settings are required.' : 'Configure Exotel SMS settings.') });
  const code = String(randomInt(100_000, 1_000_000));
  const codeHash = createHmac('sha256', process.env.CALLING_OTP_SECRET || config.apiToken).update(actor.id + ':' + code).digest('hex');
  await updateStore((state) => savePendingPhone(state, actor, phone, codeHash, new Date(Date.now() + 10 * 60_000).toISOString()));
  try { await sendExotelVerificationSms(phone, code, config); }
  catch (error) {
    await updateStore((state) => { const profile = callingProfile(state, actor); if (profile?.pendingPhone === phone && profile.verificationCodeHash === codeHash) { profile.pendingPhone = ''; profile.verificationCodeHash = ''; profile.verificationExpiresAt = null; } });
    return res.status(502).json({ error: error instanceof Error ? 'Could not send verification code: ' + error.message : 'Could not send verification code.' });
  }
  res.status(202).json({ sent: true, message: 'Exotel accepted the verification SMS request. Enter the code if received; it expires in 10 minutes.' });
});
api.post('/calling/verify', async (req: AuthedRequest, res) => {
  const code = String(req.body?.code || '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit verification code.' });
  const actor = req.user!; const config = exotelConfig(process.env);
  const codeHash = createHmac('sha256', process.env.CALLING_OTP_SECRET || config.apiToken).update(actor.id + ':' + code).digest('hex');
  const { result } = await updateStore((state) => { try { return { profile: verifyPendingPhone(state, actor, codeHash) }; } catch (error) { if (error instanceof VoiceCallError) return { error: error.message, status: error.status }; throw error; } });
  if ('error' in result) return res.status(result.status || 400).json({ error: result.error });
  res.json({ phone: result.profile.phone, verifiedAt: result.profile.verifiedAt });
});
api.post('/voice-calls', async (req: AuthedRequest, res) => {
  const key = String(req.body?.idempotencyKey || ''); const leadId = String(req.body?.leadId || '');
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(key)) return res.status(400).json({ error: 'A unique call request key is required.' });
  const config = exotelConfig(process.env);
  if (!config.configured) return res.status(503).json({ error: 'Exotel calling is not configured. Open Settings → Calling to see the required API setup.' });
  const actor = req.user!;
  let prepared: { call: import('../../../packages/shared/dist/index.js').VoiceCall; duplicate: boolean };
  try { const result = await updateStore((state) => prepareVoiceCall(state, leadId, actor, key)); prepared = result.result; }
  catch (error) { if (error instanceof VoiceCallError) return res.status(error.status).json({ error: error.message }); throw error; }
  if (prepared.duplicate) return res.status(prepared.call.providerCallId ? 200 : 202).json(prepared.call);
  try {
    const created = await connectTwoNumbers({ from: prepared.call.fromNumber, to: prepared.call.toNumber, voiceCallId: prepared.call.id }, config);
    const { result } = await updateStore((state) => { const call = state.voiceCalls.find((item) => item.id === prepared.call.id); if (!call) return prepared.call; const providerStatus = statusFromProvider(created.status); const terminal = providerStatus && ['Completed','No Answer','Busy','Failed','Cancelled'].includes(providerStatus); applyVoiceStatus(state, call, { status: terminal ? providerStatus! : 'Calling You', providerCallId: created.providerCallId, startedAt: providerDate(created.startedAt), endedAt: providerDate(created.endedAt), durationSeconds: created.durationSeconds }); return call; });
    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Exotel could not initiate this call.';
    const { result } = await updateStore((state) => { const call = state.voiceCalls.find((item) => item.id === prepared.call.id); if (!call) return prepared.call; applyVoiceStatus(state, call, { status: 'Failed', errorMessage: message }); return call; });
    return res.status(502).json({ error: message, call: result });
  }
});
api.patch('/voice-calls/:id/outcome', async (req: AuthedRequest, res) => {
  try {
    const { result } = await updateStore((state) => { const saved = recordVoiceCallOutcome(state, String(req.params.id), req.body, req.user!); const task = state.tasks.find((item) => item.leadId === saved.voiceCall.leadId && item.status === 'Due' && item.type === (saved.call.outcome === 'Meeting Scheduled' ? 'Meeting' : saved.call.outcome === 'RNR' ? 'RNR callback' : saved.call.outcome === 'Call Back Later' ? 'Call Back Later' : 'Call')); if (task) syncReminderEvent(state, 'task', task.id); return saved; });
    res.json(result);
  } catch (error) { if (error instanceof CallServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.get('/voice-calls', async (req: AuthedRequest, res) => {
  const actor = req.user!; const config = exotelConfig(process.env);
  let calls = (await readStore()).voiceCalls.filter((call) => canViewVoiceCall(call, actor)).slice(0, 20);
  const latestActive = calls.find((call) => !['Completed','No Answer','Busy','Failed','Cancelled'].includes(call.status) && call.providerCallId);
  if (latestActive && config.configured && latestActive.providerCallId) {
    try {
      const payload = await getExotelCallDetails(latestActive.providerCallId, config); const providerCall = payload.Call;
      if (providerCall) {
        const details = providerCall.Details || {}; const duration = Number(details.ConversationDuration ?? providerCall.Duration ?? 0) || null;
        const status = statusFromProvider(providerCall.Status, details.Leg1Status, details.Leg2Status, duration);
        if (status) await updateStore((state) => { const call = state.voiceCalls.find((item) => item.id === latestActive.id); if (!call) return null; return applyVoiceStatus(state, call, { status, providerCallId: providerCall.Sid || latestActive.providerCallId!, startedAt: providerDate(providerCall.StartTime), endedAt: providerDate(providerCall.EndTime), durationSeconds: duration }); });
      }
    } catch { /* Keep the last confirmed provider state; callbacks remain the durable update path. */ }
    calls = (await readStore()).voiceCalls.filter((call) => canViewVoiceCall(call, actor)).slice(0, 20);
  }
  res.json(calls);
});
api.patch('/leads/:id/sales-details', async (req: AuthedRequest, res) => {
  try {
    const { result } = await updateStore((data) => { const saved = saveLeadSalesDetails(data, String(req.params.id), req.body, req.user!); if (saved.task) syncReminderEvent(data, 'task', saved.task.id); return saved; });
    res.json(result);
  } catch (error) {
    if (error instanceof FollowUpSalesError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
api.patch('/tasks/:id/sales-details', async (req: AuthedRequest, res) => {
  try {
    const { result } = await updateStore((data) => { const saved = updateFollowUpSalesDetails(data, String(req.params.id), req.body, req.user!); syncReminderEvent(data, 'task', saved.task.id); return saved; });
    res.json(result);
  } catch (error) {
    if (error instanceof FollowUpSalesError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
api.get('/tasks', async (req, res) => {
  const data = await readStore();
  const status = String(req.query.status || '');
  res.json(data.tasks.filter((task) => !status || task.status === status));
});
api.post('/tasks', async (req: AuthedRequest, res) => {
  const { leadId, type, dueAt, endsAt, priority = 'Medium', notes = '', assignedTo = 'Rahul Raj M' } = req.body;
  if (!leadId || !['Call', 'Email', 'Meeting', 'RNR callback', 'Call Back Later', 'Proposal Follow-up', 'Other'].includes(type) || !dueAt || Number.isNaN(Date.parse(dueAt)) || (endsAt && (Number.isNaN(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(dueAt)))) return res.status(400).json({ error: 'Choose a lead, task type, and valid start and end dates.' });
  const actor = req.user!;
  const manager = actor.role === 'Admin' || actor.role === 'Manager';
  if (!manager && String(assignedTo) !== actor.name) return res.status(403).json({ error: 'Only a manager or admin can assign a follow-up to another employee.' });
  const { result } = await updateStore((data) => {
    const lead = data.leads.find((item) => item.id === leadId && !item.archived);
    if (!lead) return { error: 'Lead not found.' };
    if (lead.status === 'Won' || lead.status === 'Lost') return { error: 'Closed sales processes cannot have new follow-ups.' };
    if (!manager && lead.assignedTo.toLowerCase() !== actor.name.toLowerCase()) return { error: 'You cannot schedule follow-ups for another employee’s lead.' };
    const members = new Set([...data.leads.map((item) => item.assignedTo), ...data.tasks.map((item) => item.assignedTo), ...data.calls.map((item) => item.createdBy)]);
    if (!members.has(String(assignedTo))) return { error: 'Choose an assigned employee from the workspace.' };
    const duplicate = data.tasks.find((task) => task.leadId === leadId && task.type === type && task.status === 'Due' && Math.abs(Date.parse(task.dueAt) - Date.parse(dueAt)) < 15 * 60 * 1000);
    if (duplicate) return { error: 'A similar active follow-up is already scheduled.' };
    const task = { id: randomUUID(), leadId, type, dueAt: new Date(dueAt).toISOString(), priority, notes: String(notes).slice(0, 2000), assignedTo, status: 'Due' as const, createdAt: new Date().toISOString(), completedAt: null, createdBy: actor.name, completionNotes: '', endsAt: endsAt ? new Date(endsAt).toISOString() : addMinutes(new Date(dueAt), 30).toISOString() };
    data.tasks.unshift(task);
    lead.nextFollowUp = task.dueAt;
    activity(data, leadId, 'Follow-up', type + ' scheduled', task.notes, actor.name);
    return { task };
  });
  if ('error' in result) return res.status(409).json({ error: result.error });
  res.status(201).json(result.task);
});
api.patch('/tasks/:id', async (req: AuthedRequest, res) => {
  if (req.body.leadStatus !== undefined && (req.body.status !== 'Completed' || typeof req.body.leadStatus !== 'string' || !leadStatuses.includes(req.body.leadStatus as LeadStatus) || req.body.leadStatus === 'Won' || req.body.leadStatus === 'Lost')) return res.status(400).json({ error: 'Choose an active lead status when completing a follow-up. Won and Lost are managed from Opportunities.' });
  const { result } = await updateStore((data) => {
    const task = data.tasks.find((item) => item.id === req.params.id);
    if (!task) return null;
    const actor = req.user!; const manager = actor.role === 'Admin' || actor.role === 'Manager';
    if (!manager && task.assignedTo.toLowerCase() !== actor.name.toLowerCase()) return { forbidden: true as const };
    if (req.body.assignedTo !== undefined && !manager && String(req.body.assignedTo) !== task.assignedTo) return { forbidden: true as const };
    const lead = data.leads.find((item) => item.id === task.leadId);
    if (req.body.leadStatus !== undefined) {
      if (task.status !== 'Due') return { statusConflict: true as const };
      if (!lead || lead.status === 'Won' || lead.status === 'Lost') return { statusConflict: true as const };
    }
    if (req.body.status && !['Due', 'Completed', 'Cancelled'].includes(req.body.status)) return null;
    if (req.body.dueAt && Number.isNaN(Date.parse(req.body.dueAt))) return null;
    if (req.body.endsAt && (Number.isNaN(Date.parse(req.body.endsAt)) || (req.body.dueAt && Date.parse(req.body.endsAt) <= Date.parse(req.body.dueAt)))) return null;
    if (req.body.type && !['Call', 'Email', 'Meeting', 'RNR callback', 'Call Back Later', 'Proposal Follow-up', 'Other'].includes(req.body.type)) return null;
    if (req.body.priority && !['Low', 'Medium', 'High', 'Critical'].includes(req.body.priority)) return null;

    if (req.body.dueAt && new Date(req.body.dueAt).toISOString() !== task.dueAt) {
      task.scheduleHistory ||= []; task.scheduleHistory.push({ dueAt: task.dueAt, endsAt: task.endsAt, changedAt: new Date().toISOString(), changedBy: actor.name });
      task.dueAt = new Date(req.body.dueAt).toISOString();
    }
    if (req.body.status) task.status = req.body.status;
    if (req.body.endsAt !== undefined) task.endsAt = req.body.endsAt ? new Date(req.body.endsAt).toISOString() : null;
    if (req.body.type) task.type = req.body.type;
    if (req.body.priority) task.priority = req.body.priority;
    if (req.body.assignedTo !== undefined) task.assignedTo = String(req.body.assignedTo).slice(0, 120);
    if (req.body.notes !== undefined) task.notes = String(req.body.notes).slice(0, 2000);
    if (req.body.status === 'Completed') { task.completedAt = new Date().toISOString(); task.completedBy = actor.name; task.completionNotes = String(req.body.completionNotes || '').slice(0, 2000); }
    if (req.body.status === 'Due' && task.status === 'Due') { task.completedAt = null; task.completedBy = undefined; task.completionNotes = ''; }
    if (req.body.status === 'Cancelled') task.cancelledReason = String(req.body.cancelledReason || '').slice(0, 1000);
    if (lead && req.body.leadStatus !== undefined && lead.status !== req.body.leadStatus) {
      const previousStatus = lead.status;
      const changedAt = new Date().toISOString();
      lead.status = req.body.leadStatus as LeadStatus;
      lead.updatedAt = changedAt;
      lead.stageHistory ||= [];
      lead.stageHistory.push({ status: lead.status, at: changedAt, by: actor.name });
      lead.changeHistory ||= [];
      lead.changeHistory.push({ at: changedAt, by: actor.name, changes: [{ field: 'status', from: previousStatus, to: lead.status }] });
      activity(data, lead.id, 'Stage change', 'Lead status updated after follow-up', `Moved from ${previousStatus} to ${lead.status}.`, actor.name);
    }
    if (lead) lead.nextFollowUp = data.tasks.filter((item) => item.leadId === lead.id && item.status === 'Due').sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt))[0]?.dueAt || null;
    syncReminderEvent(data, 'task', task.id);
    activity(data, task.leadId, 'Follow-up', 'Follow-up ' + task.status.toLowerCase(), [task.notes, task.completionNotes].filter(Boolean).join(' · '), actor.name);
    return task;
  });
  if (!result) return res.status(404).json({ error: 'Follow-up not found or has invalid details.' });
  if ('forbidden' in result) return res.status(403).json({ error: 'You do not have permission to edit this follow-up.' });
  if ('conflict' in result) return res.status(409).json({ error: 'Closed sales processes cannot have active or rescheduled follow-ups.' });
  if ('statusConflict' in result) return res.status(409).json({ error: 'This follow-up or lead is no longer active. Refresh and try again.' });
  res.json(result);
});
api.get('/opportunities', async (_req, res) => res.json((await readStore()).opportunities));
api.post('/opportunities', async (req: AuthedRequest, res) => {
  const { name, leadId, amount, currency = 'INR', probability = 10, expectedClose = null, notes = '' } = req.body;
  if (!name?.trim() || !leadId || !Number.isFinite(Number(amount)) || Number(amount) < 0 || !Number.isFinite(Number(probability)) || probability < 0 || probability > 100) return res.status(400).json({ error: 'Enter a name, lead, amount, and probability between 0 and 100.' });
  const { result } = await updateStore((data) => {
    if (!data.leads.some((item) => item.id === leadId)) return null;
    const now = new Date().toISOString();
    const opportunity: Opportunity = { id: randomUUID(), name: name.trim(), leadId, amount: Number(amount), currency, probability: Number(probability), stage: 'Qualification', expectedClose, owner: req.user!.name, notes: String(notes).slice(0, 3000), actualCloseAt: null, accomplishedById: null, accomplishedByName: null, lossReason: '', preCloseStage: null, createdAt: now, updatedAt: now };
    data.opportunities.unshift(opportunity); activity(data, leadId, 'Opportunity', 'Opportunity created', opportunity.name, req.user!.name); return opportunity;
  });
  if (!result) return res.status(404).json({ error: 'Lead not found.' });
  res.status(201).json(result);
});
api.patch('/opportunities/:id', async (req: AuthedRequest, res) => {
  const patchSchema = z.object({ name: z.string().trim().min(1).max(180).optional(), leadId: z.string().min(1).optional(), amount: z.coerce.number().min(0).optional(), currency: z.string().length(3).optional(), probability: z.coerce.number().min(0).max(100).optional(), stage: z.enum(['Qualification','Discovery','Proposal','Negotiation','Closed Won','Closed Lost']).optional(), expectedClose: z.string().nullable().optional(), notes: z.string().max(3000).optional(), lossReason: z.string().max(1000).optional() }).strict();
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid opportunity data.' });
  try {
    const { result } = await updateStore((data) => {
      const opp = data.opportunities.find((item) => item.id === req.params.id); if (!opp) return null;
      if (parsed.data.leadId && !data.leads.some((item) => item.id === parsed.data.leadId)) return null;
      const { stage, lossReason, ...fields } = parsed.data;
      if (Object.keys(fields).length) Object.assign(opp, fields, { updatedAt: new Date().toISOString() });
      return stage ? transitionOpportunityStage(data, opp.id, stage, lossReason || '', req.user!) : opp;
    });
    if (!result) return res.status(404).json({ error: 'Opportunity or associated lead not found.' }); res.json(result);
  } catch (error) { if (error instanceof OpportunityServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.post('/opportunities/:id/reopen', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((data) => reopenOpportunity(data, String(req.params.id), req.user!)); res.json(result); }
  catch (error) { if (error instanceof OpportunityServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});api.get('/activities', async (_req, res) => res.json((await readStore()).activities));
api.get('/templates', async (_req, res) => res.json((await readStore()).templates));
api.put('/templates/:id', async (req, res) => {
  const { name, subject, body } = req.body;
  if (!name?.trim() || !subject?.trim() || !body?.trim()) return res.status(400).json({ error: 'Template name, subject, and body are required.' });
  const { result } = await updateStore((data) => {
    const template = data.templates.find((item) => item.id === req.params.id);
    if (!template) return null;
    Object.assign(template, { name: name.trim(), subject: subject.trim(), body: body.trim(), updatedAt: new Date().toISOString() });
    return template;
  });
  if (!result) return res.status(404).json({ error: 'Template not found.' });
  res.json(result);
});
api.get('/targets', async (req: AuthedRequest, res) => {
  const state = await readStore();
  res.json(state.targets.filter((target) => canAccessTarget(target, req.user!)));
});
api.post('/targets', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => createTarget(state, req.body, req.user!)); res.status(201).json(result); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.put('/targets/:id', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => updateTarget(state, String(req.params.id), req.body, req.user!)); res.json(result); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.patch('/targets/:id', async (req: AuthedRequest, res) => {
  if (typeof req.body?.enabled !== 'boolean' || Object.keys(req.body).some((key) => key !== 'enabled')) return res.status(400).json({ error: 'Only the enabled state can be changed here.' });
  try { const { result } = await updateStore((state) => setTargetEnabled(state, String(req.params.id), req.body.enabled, req.user!)); res.json(result); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.get('/reminders', async (req: AuthedRequest, res) => res.json(listReminders(await readStore(), req.user!)));
api.post('/reminders/:sourceType/:sourceId', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => saveReminder(state, req.params.sourceType, req.params.sourceId, req.body, req.user!)); res.status(201).json(result); }
  catch (error) { if (error instanceof ReminderError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.patch('/reminders/:id', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => { const old = state.reminders.find((item) => item.id === req.params.id); if (!old) throw new ReminderError('Reminder not found.', 404); return saveReminder(state, old.sourceType, old.sourceId, req.body, req.user!, old.id); }); res.json(result); }
  catch (error) { if (error instanceof ReminderError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.delete('/reminders/:id', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => deleteReminder(state, String(req.params.id), req.user!)); res.json(result); }
  catch (error) { if (error instanceof ReminderError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.patch('/notifications/:id', async (req: AuthedRequest, res) => {
  const { result } = await updateStore((state) => { const note = state.notifications.find((item) => item.id === req.params.id && item.userId === req.user!.id); if (!note) return null; note.readAt = new Date().toISOString(); return note; });
  if (!result) return res.status(404).json({ error: 'Notification not found.' }); res.json(result);
});api.get('/calendar', async (req: AuthedRequest, res) => {
  try { res.json(getCalendarItems(await readStore(), String(req.query.start || ''), String(req.query.end || ''), req.user!)); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.post('/calendar/events', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => createCalendarEvent(state, req.body, req.user!)); res.status(201).json(result); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.patch('/calendar/events/:id', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => { const event = updateCalendarEvent(state, String(req.params.id), req.body, req.user!); if (event) syncReminderEvent(state, 'event', event.id); return event; }); res.json(result); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.delete('/calendar/events/:id', async (req: AuthedRequest, res) => {
  try { const { result } = await updateStore((state) => { const deleted = deleteCalendarEvent(state, String(req.params.id), req.user!); syncReminderEvent(state, 'event', String(req.params.id)); return deleted; }); if (!result) return res.status(404).json({ error: 'Calendar event not found.' }); res.status(204).end(); }
  catch (error) { if (error instanceof TargetServiceError) return res.status(error.status).json({ error: error.message }); throw error; }
});
api.get('/settings', async (_req, res) => res.json((await readStore()).settings));
api.put('/settings', async (req, res) => {
  const currency = req.body?.currency;
  const timezone = req.body?.timezone;
  if (currency !== undefined && !['INR','USD','EUR','GBP'].includes(currency)) return res.status(400).json({ error: 'Choose a supported currency.' });
  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || timezone.length > 80 || !timezone.trim()) return res.status(400).json({ error: 'Enter a valid time zone.' });
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date()); }
    catch { return res.status(400).json({ error: 'Enter a valid IANA time zone.' }); }
  }
  const { state } = await updateStore((data) => Object.assign(data.settings, { ...(currency ? { currency } : {}), ...(timezone ? { timezone } : {}) }));
  res.json(state.settings);
});
api.post('/ai/outreach', async (req, res) => {
  const lead = leadSchema.pick({ name: true, company: true, role: true, industry: true, notes: true }).safeParse(req.body);
  if (!lead.success) return res.status(400).json({ error: 'Lead information is incomplete.' });
  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: 'Create concise sales outreach suggestions using only the supplied lead details. Do not invent company facts or claim research. Return plain text with Topic, Opening, Email subject, Draft, Pain point to explore, and Next action labels.', input: JSON.stringify(lead.data), max_output_tokens: 500 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('The AI provider returned an error.');
      const payload = await response.json() as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[] };
      const generatedText = payload.output_text || (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === 'output_text' && item.text).map((item) => item.text).join('\n');
      return res.json({ text: generatedText, generated: true, source: 'AI provider' });
    } catch {
      return res.status(502).json({ error: 'AI suggestions are temporarily unavailable. Use the local fallback below.', fallback: localOutreach(lead.data) });
    }
  }
  res.json({ text: localOutreach(lead.data), generated: false, source: 'Template fallback' });
});
api.get('/reports/data', async (req: AuthedRequest, res) => {
  const actor = req.user!;
  const scoped = scopeReportRecords(await readStore(), actor);
  const targets = scoped.targets.filter((target) => canAccessTarget(target, actor));
  res.json({ user: actor, mode: 'local-demo', ...scoped, metrics: calculateMetrics(scoped), targetPerformance: calculateTargetAchievements({ ...scoped, targets }) });
});
api.get('/reports/summary', async (_req, res) => res.json(calculateMetrics(await readStore())));
app.use('/api', api);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error. Check API logs for details.' });
});
app.listen(port, () => { console.log('CGBS API listening on http://localhost:' + port + ' (' + (demoMode ? 'local demo mode' : 'production auth required') + ')'); void deliverReminders(); setInterval(() => void deliverReminders(), 15_000); });
async function deliverReminders() { try { const state = await readStore(); const due = state.reminders.some((item) => item.enabled && item.status === 'Pending' && Date.parse(item.sendAt) <= Date.now()); if (due) await updateStore((next) => dispatchDueReminders(next)); } catch (error) { console.error('Reminder scheduler error', error); } }

function localOutreach(input: Pick<LeadInput, 'name' | 'company' | 'role' | 'industry' | 'notes'>) {
  const detail = input.notes ? ' I noted: “' + input.notes.slice(0, 180) + '”' : '';
  return 'Topic: Current priorities for ' + input.company + '\nOpening: Hi ' + input.name + ', I’m reaching out to learn what your team is focused on this quarter.' + detail + '\nEmail subject: A quick conversation about ' + input.company + '\nDraft: Hi ' + input.name + ',\n\nI work with teams in ' + input.industry + ' and would value a short conversation about the priorities you’re working through at ' + input.company + '. Would 15 minutes next week suit you?\n\nBest,\nRahul\nPain point to explore: Ask how ' + (input.role || 'the team') + ' currently handles the workflow and what they want to improve.\nNext action: Personalize the opening with a verified detail before sending.';
}





























