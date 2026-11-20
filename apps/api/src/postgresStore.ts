import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CGBSState, Lead, SalesTarget } from '../../../packages/shared/dist/index.js';
import { currentDatabaseActor } from './databaseContext.js';

type Row = Record<string, any>;
type SnapshotMeta = { companies: Row[]; profiles: Row[]; companyIdByLeadId: Map<string, string> };
type DatabaseTlsOptions = { rejectUnauthorized: true; ca?: string };
export type DatabaseHealth = { configured: boolean; connected: boolean; storage: 'postgresql'; error?: string };
let pool: Pool | undefined;

export function setPoolForTests(value: Pool | undefined): void { pool = value; }

function databaseConnectionString(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('PostgreSQL storage is not configured. Set DATABASE_URL on the API server.');
  if (/[<>]|your-|example\.test/i.test(value)) throw new Error('Replace the DATABASE_URL placeholder with the PostgreSQL URI from Supabase Connect.');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL is invalid. Use the Supabase Connect PostgreSQL URI.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL must use the postgres:// or postgresql:// scheme.');
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') throw new Error('DATABASE_URL must include the PostgreSQL host and database name.');
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('DATABASE_URL requests a non-TLS connection. PostgreSQL connections must use TLS.');
  }
  // TLS is enforced by the Pool's ssl option below. Remove sslmode and
  // libpq SSL options from the URI because node-postgres may let these
  // override the explicit TLS settings passed to Pool.
  for (const key of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey']) parsed.searchParams.delete(key);
  return parsed.toString();
}

export function databaseConfiguration(): { configured: boolean; error?: string } {
  try { databaseConnectionString(); return { configured: true }; }
  catch (error) {
    return { configured: false, error: error instanceof Error ? error.message : 'DATABASE_URL is invalid.' };
  }
}

export function databaseTlsOptions(): DatabaseTlsOptions {
  const inlineCa = process.env.DATABASE_SSL_CA?.trim();
  const caFile = process.env.DATABASE_SSL_CA_FILE?.trim();
  if (inlineCa && caFile) throw Object.assign(new Error('Set only one of DATABASE_SSL_CA or DATABASE_SSL_CA_FILE.'), { code: 'DATABASE_TLS_CA_INVALID' });
  if (!inlineCa && !caFile) return { rejectUnauthorized: true };

  let pem = inlineCa;
  if (caFile) {
    try { pem = readFileSync(caFile, 'utf8').trim(); }
    catch { throw Object.assign(new Error('Could not read DATABASE_SSL_CA_FILE. Mount the Supabase CA certificate as a server-only secret file and check its path.'), { code: 'DATABASE_TLS_CA_INVALID' }); }
  }
  const certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const certificates = pem?.match(certificatePattern) || [];
  const remainder = (pem || '').replace(certificatePattern, '').trim();
  if (!certificates.length || remainder) throw Object.assign(new Error('DATABASE_SSL_CA must contain only PEM-encoded CA certificate(s) from Supabase Database Settings.'), { code: 'DATABASE_TLS_CA_INVALID' });
  try {
    if (certificates.some((certificate) => !new X509Certificate(certificate).ca)) throw new Error('Not a CA certificate.');
  } catch {
    throw Object.assign(new Error('DATABASE_SSL_CA is not a valid CA certificate chain. Download the PostgreSQL CA certificate from Supabase Database Settings.'), { code: 'DATABASE_TLS_CA_INVALID' });
  }
  return { rejectUnauthorized: true, ca: certificates.join('\n') };
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseConnectionString(),
      ssl: databaseTlsOptions(),
      max: (() => { const max = Number(process.env.DATABASE_POOL_MAX || 5); return Number.isInteger(max) && max > 0 ? Math.min(20, max) : 5; })(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      allowExitOnIdle: process.env.NODE_ENV === 'test',
    });
    pool.on('error', (error) => {
      const code = String((error as { code?: unknown }).code || 'unknown');
      console.error('PostgreSQL idle client error:', databaseConnectionErrorMessage(code) || `Database pool error (${code}).`);
    });
  }
  return pool;
}

export function databaseConfigured(): boolean {
  return databaseConfiguration().configured;
}

export function databaseConnectionErrorMessage(code: string): string | undefined {
  if (code === 'DATABASE_TLS_CA_INVALID') return 'The configured PostgreSQL CA is missing, unreadable, or invalid. Set DATABASE_SSL_CA or DATABASE_SSL_CA_FILE to the CA certificate downloaded from Supabase Database Settings.';
  if (code === '28P01' || code === '28000') return 'PostgreSQL rejected the configured username or password. Check DATABASE_URL in the API service settings.';
  if (code === '3D000') return 'PostgreSQL could not find the configured database. Check the database name in DATABASE_URL.';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'The PostgreSQL host in DATABASE_URL could not be resolved. Check the host and the Supabase connection mode.';
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) return 'The PostgreSQL host rejected or timed out the connection. Check network access and the Supabase connection mode.';
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) return 'The PostgreSQL endpoint certificate is not trusted by this Node runtime. Add the project CA downloaded from Supabase Database Settings as DATABASE_SSL_CA or DATABASE_SSL_CA_FILE; certificate verification remains enabled.';
  if (['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) return 'The PostgreSQL TLS certificate is expired or does not match the configured host. Confirm the exact endpoint copied from Supabase Connect and the current project CA.';
  return undefined;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const configuration = databaseConfiguration();
  if (!configuration.configured) return { configured: false, connected: false, storage: 'postgresql', error: configuration.error };
  try {
    const client = await getPool().connect();
    try {
      const result = await client.query<{ missing: string[] }>(`select array_remove(array[
        case when to_regclass('public.profiles') is null then 'profiles' end,
        case when to_regclass('public.companies') is null then 'companies' end,
        case when to_regclass('public.leads') is null then 'leads' end,
        case when to_regclass('public.lead_stage_history') is null then 'lead_stage_history' end,
        case when to_regclass('public.calls') is null then 'calls' end,
        case when to_regclass('public.follow_up_tasks') is null then 'follow_up_tasks' end,
        case when to_regclass('public.opportunities') is null then 'opportunities' end,
        case when to_regclass('public.activities') is null then 'activities' end,
        case when to_regclass('public.email_templates') is null then 'email_templates' end,
        case when to_regclass('public.sales_targets') is null then 'sales_targets' end,
        case when to_regclass('public.calendar_events') is null then 'calendar_events' end,
        case when to_regclass('public.notifications') is null then 'notifications' end,
        case when to_regclass('public.user_preferences') is null then 'user_preferences' end,
        case when to_regclass('public.reminders') is null then 'reminders' end,
        case when to_regclass('public.voice_calls') is null then 'voice_calls' end,
        case when to_regclass('public.calling_profiles') is null then 'calling_profiles' end
      ], null) as missing`);
      const columns = await client.query<{ missing: string[] }>(`select array_remove(array[
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='alternative_contact_method') then 'leads.alternative_contact_method' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='actual_close_at') then 'leads.actual_close_at' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='calls' and column_name='client_mutation_id') then 'calls.client_mutation_id' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='follow_up_tasks' and column_name='schedule_history') then 'follow_up_tasks.schedule_history' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='opportunities' and column_name='loss_reason') then 'opportunities.loss_reason' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='calendar_events' and column_name='source_type') then 'calendar_events.source_type' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='user_preferences' and column_name='daily_call_target') then 'user_preferences.daily_call_target' end,
        case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='reminder_id') then 'notifications.reminder_id' end
      ], null) as missing`);
      const missing = [...(result.rows[0]?.missing || []), ...(columns.rows[0]?.missing || [])];
      return missing.length
        ? { configured: true, connected: false, storage: 'postgresql', error: `Database connected, but required CRM schema is missing: ${missing.join(', ')}. Apply the reviewed storage migration.` }
        : { configured: true, connected: true, storage: 'postgresql' };
    } finally { client.release(); }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
    const connectionError = databaseConnectionErrorMessage(code);
    if (connectionError) return { configured: true, connected: false, storage: 'postgresql', error: connectionError };
    return { configured: true, connected: false, storage: 'postgresql', error: 'Could not connect to PostgreSQL. Check the API logs for the error code and verify the Supabase connection settings.' };
  }
}

async function withActorTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const actor = currentDatabaseActor();
  if (!actor) throw new Error('Database access requires an authenticated CRM user.');
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    const claims = JSON.stringify({ sub: actor.id, role: 'authenticated', aud: 'authenticated' });
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)",
      [actor.id, claims],
    );
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try { await client.query('rollback'); } catch { /* keep the original database error */ }
    throw error;
  } finally { client.release(); }
}

async function rows(client: PoolClient, table: string): Promise<Row[]> {
  // `table` values are literals at each call site, never request input.
  const result = await client.query<QueryResultRow>(`select * from public.${table}`);
  return result.rows as Row[];
}

const asIso = (value: unknown): string | null => value == null ? null : new Date(String(value)).toISOString();
const numeric = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nameById = (profiles: Row[]) => new Map(profiles.map((p) => [p.id, p.full_name]));
function actorIdForName(name: string | undefined, profiles: Row[], actorId: string): string | null {
  if (!name) return actorId;
  const found = profiles.find((p) => String(p.full_name).toLowerCase() === name.toLowerCase());
  return found?.id || null;
}

async function loadState(client: PoolClient): Promise<{ state: CGBSState; meta: SnapshotMeta }> {
  const [profiles, companies, leadRows, stageRows, callRows, voiceRows, callingRows, taskRows, opportunityRows, activityRows, templateRows, targetRows, eventRows, reminderRows, notificationRows, preferenceRows] = await Promise.all([
    rows(client, 'profiles'), rows(client, 'companies'), rows(client, 'leads'), rows(client, 'lead_stage_history'),
    rows(client, 'calls'), rows(client, 'voice_calls'), rows(client, 'calling_profiles'), rows(client, 'follow_up_tasks'),
    rows(client, 'opportunities'), rows(client, 'activities'), rows(client, 'email_templates'), rows(client, 'sales_targets'),
    rows(client, 'calendar_events'), rows(client, 'reminders'), rows(client, 'notifications'), rows(client, 'user_preferences'),
  ]);
  const names = nameById(profiles);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const companyIdByLeadId = new Map(leadRows.map((r) => [r.id, r.company_id]).filter((x): x is [string, string] => Boolean(x[1])));
  const stagesByLead = new Map<string, Row[]>();
  for (const stage of stageRows.sort((a, b) => Date.parse(a.entered_at) - Date.parse(b.entered_at))) {
    const list = stagesByLead.get(stage.lead_id) || []; list.push(stage); stagesByLead.set(stage.lead_id, list);
  }
  const leads: Lead[] = leadRows.map((r) => {
    const company = companyById.get(r.company_id) || {};
    const stageHistory = (stagesByLead.get(r.id) || []).map((x) => ({ status: x.to_stage, at: asIso(x.entered_at) || r.created_at, by: names.get(x.changed_by) || 'System' })) as Lead['stageHistory'];
    if (!stageHistory.length) stageHistory.push({ status: r.status, at: asIso(r.created_at) || new Date().toISOString(), by: names.get(r.created_by) || 'System' });
    return {
      id: r.id, name: r.full_name, company: company.name || '', role: r.role_title || '', companyLogo: company.logo_url || '', companyNetWorth: numeric(company.net_worth),
      aiOutreachTopic: r.ai_outreach_topic || '', aiOpeningMessage: r.ai_opening_message || '', aiEmailSubject: r.ai_email_subject || '', aiFollowUpApproach: r.ai_follow_up_approach || '',
      email: r.email || '', phone: r.phone || '', website: company.website || '', linkedin: r.linkedin_url || '', industry: company.industry || 'Other', source: r.source || 'Other', status: r.status,
      priority: r.priority || 'Medium', revenue: numeric(r.estimated_revenue), currency: String(r.currency || 'INR').trim(), progression: numeric(r.progression), probability: numeric(r.win_probability),
      assignedTo: names.get(r.assigned_to) || '', nextFollowUp: asIso(r.next_follow_up_at), expectedClose: asIso(r.expected_close_at), notes: r.notes || '',
      alternativeContactMethod: r.alternative_contact_method || null, alternativeContactNotes: r.alternative_contact_notes || '', createdAt: asIso(r.created_at) || new Date().toISOString(), updatedAt: asIso(r.updated_at) || new Date().toISOString(),
      lastContacted: asIso(r.last_contacted_at), archived: Boolean(r.archived), stageHistory, changeHistory: r.change_history || [], actualCloseAt: asIso(r.actual_close_at),
      closedById: r.closed_by || null, closedByName: names.get(r.closed_by) || null, lossReason: r.loss_reason || '', preCloseOpportunityStages: r.pre_close_opportunity_stages || [], isShared: Boolean(r.is_shared),
    };
  });
  const calls = callRows.map((r) => ({ id: r.id, leadId: r.lead_id, outcome: r.outcome, notes: r.notes || '', durationMinutes: numeric(r.duration_seconds) / 60, durationSeconds: r.duration_seconds == null ? null : numeric(r.duration_seconds), createdAt: asIso(r.created_at) || '', createdBy: names.get(r.created_by) || '', clientMutationId: r.client_mutation_id || undefined, contactMethod: r.contact_method || undefined, provider: r.provider || undefined, providerCallId: r.provider_call_id || undefined, startedAt: asIso(r.started_at), endedAt: asIso(r.ended_at) }));
  const voiceCalls = voiceRows.map((r) => ({ id: r.id, leadId: r.lead_id, userId: r.user_id, userName: r.user_name, fromNumber: r.from_number, toNumber: r.to_number, provider: r.provider, providerCallId: r.provider_call_id, status: r.status, idempotencyKey: r.idempotency_key, requestedAt: asIso(r.requested_at) || '', startedAt: asIso(r.started_at), endedAt: asIso(r.ended_at), durationSeconds: r.duration_seconds == null ? null : numeric(r.duration_seconds), lastProviderEventId: r.last_provider_event_id, errorMessage: r.error_message || '', outcomeRecordedAt: asIso(r.outcome_recorded_at) }));
  const callingProfiles = callingRows.map((r) => ({ userId: r.user_id, userName: names.get(r.user_id) || '', phone: r.phone || '', verifiedAt: asIso(r.verified_at), pendingPhone: r.pending_phone || '', verificationCodeHash: r.verification_code_hash || '', verificationExpiresAt: asIso(r.verification_expires_at), verificationAttempts: numeric(r.verification_attempts), updatedAt: asIso(r.updated_at) || '' }));
  const tasks = taskRows.map((r) => ({ id: r.id, leadId: r.lead_id, type: r.task_type, dueAt: asIso(r.due_at) || '', priority: r.priority, assignedTo: names.get(r.assigned_to) || '', notes: r.notes || '', status: r.status, createdAt: asIso(r.created_at) || '', completedAt: asIso(r.completed_at), createdBy: names.get(r.created_by) || '', completedBy: names.get(r.completed_by), completionNotes: r.completion_notes || '', cancelledReason: r.cancelled_reason || '', endsAt: asIso(r.ends_at), scheduleHistory: r.schedule_history || [] }));
  const opportunities = opportunityRows.map((r) => ({ id: r.id, name: r.name, leadId: r.lead_id, amount: numeric(r.amount), currency: String(r.currency || 'INR').trim(), probability: numeric(r.probability), stage: r.stage, expectedClose: asIso(r.expected_close_at), owner: names.get(r.assigned_to) || '', notes: r.notes || '', createdAt: asIso(r.created_at) || '', updatedAt: asIso(r.updated_at) || '', actualCloseAt: asIso(r.actual_close_at), accomplishedById: r.accomplished_by || null, accomplishedByName: r.accomplished_by_name || names.get(r.accomplished_by) || null, lossReason: r.loss_reason || '', preCloseStage: r.pre_close_stage || null }));
  const activities = activityRows.map((r) => ({ id: r.id, leadId: r.lead_id, type: r.activity_type === 'Email' || r.activity_type === 'Meeting' ? 'Note' : r.activity_type, title: r.title, detail: r.detail || '', createdAt: asIso(r.created_at) || '', createdBy: names.get(r.created_by) || '' }));
  const templates = templateRows.map((r) => ({ id: r.id, name: r.name, subject: r.subject, body: r.body, updatedAt: asIso(r.updated_at) || '' }));
  const targets: SalesTarget[] = targetRows.map((r) => ({ id: r.id, metric: r.metric, targetValue: numeric(r.target_value), period: r.period, startDate: String(r.starts_on).slice(0, 10), endDate: String(r.ends_on).slice(0, 10), ownerType: r.owner_scope, ownerName: r.owner_label, enabled: Boolean(r.enabled), createdAt: asIso(r.created_at) || '', updatedAt: asIso(r.updated_at) || '', createdBy: names.get(r.created_by) || '', revisions: r.revision_history || [] }));
  const calendarEvents = eventRows.map((r) => ({ id: r.id, title: r.title, description: r.description || '', startAt: asIso(r.starts_at) || '', endAt: asIso(r.ends_at) || '', allDay: Boolean(r.all_day), type: r.event_type, status: r.status, leadId: r.lead_id, opportunityId: r.opportunity_id, assignedTo: names.get(r.assigned_to) || '', priority: r.priority, location: r.location || '', meetingLink: r.meeting_link || '', sourceType: r.source_type || undefined, sourceNotes: r.source_notes || '', createdBy: names.get(r.created_by) || '', createdAt: asIso(r.created_at) || '', updatedAt: asIso(r.updated_at) || '' }));
  const reminders = reminderRows.map((r) => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, ownerId: r.owner_id, ownerName: r.owner_name, sendAt: asIso(r.send_at) || '', minutesBefore: r.minutes_before == null ? null : numeric(r.minutes_before), channels: r.channels || ['in-app'], enabled: Boolean(r.enabled), status: r.status, idempotencyKey: r.idempotency_key, attempts: numeric(r.attempts), deliveredAt: asIso(r.delivered_at), lastError: r.last_error || '', eventStartAt: asIso(r.event_start_at) || '', createdAt: asIso(r.created_at) || '', updatedAt: asIso(r.updated_at) || '' }));
  const notifications = notificationRows.map((r) => ({ id: r.id, reminderId: r.reminder_id || '', userId: r.user_id, title: r.title, body: r.body || '', createdAt: asIso(r.created_at) || '', readAt: asIso(r.read_at) }));
  const actor = currentDatabaseActor()!;
  const preference = preferenceRows.find((r) => r.user_id === actor.id) || {};
  const state: CGBSState = {
    leads, calls, voiceCalls, callingProfiles, tasks, opportunities, templates, activities, targets, calendarEvents, reminders, notifications,
    settings: { dailyCallTarget: numeric(preference.daily_call_target, 40), dailyFollowUpTarget: numeric(preference.daily_followup_target, 8), dailyMeetingTarget: numeric(preference.daily_meeting_target, 3), monthlyRevenueTarget: numeric(preference.monthly_revenue_target), currency: preference.currency || 'INR', timezone: preference.timezone || 'Asia/Kolkata' },
  };
  return { state, meta: { companies, profiles, companyIdByLeadId } };
}

export async function readPostgresStore(): Promise<CGBSState> {
  return withActorTransaction(async (client) => (await loadState(client)).state);
}

function profileId(name: string | undefined, meta: SnapshotMeta, actorId: string): string | null {
  return actorIdForName(name, meta.profiles, actorId);
}

function rowObject(entries: [string, unknown][]): Row { return Object.fromEntries(entries.filter(([, v]) => v !== undefined)); }
function changed(a: unknown, b: unknown): boolean { return JSON.stringify(a) !== JSON.stringify(b); }

async function writeOne(client: PoolClient, table: string, id: string, row: Row, isNew: boolean, idColumn = 'id'): Promise<void> {
  const columns = Object.keys(row);
  if (!columns.length) return;
  if (isNew) {
    const insertRow = { [idColumn]: id, ...row };
    const insertColumns = Object.keys(insertRow);
    const values = insertColumns.map((key) => insertRow[key]);
    const slots = insertColumns.map((_, index) => `$${index + 1}`).join(',');
    await client.query(`insert into public.${table} (${insertColumns.join(',')}) values (${slots})`, values);
  } else {
    const values = columns.map((key) => row[key]);
    const set = columns.map((key, index) => `${key} = $${index + 1}`).join(',');
    const result = await client.query(`update public.${table} set ${set} where ${idColumn} = $${columns.length + 1}`, [...values, id]);
    if (!result.rowCount) throw new Error(`The database did not authorize updating ${table} record ${id}, or the record no longer exists.`);
  }
}

async function deleteOne(client: PoolClient, table: string, id: string, idColumn = 'id'): Promise<void> {
  const result = await client.query(`delete from public.${table} where ${idColumn} = $1`, [id]);
  if (!result.rowCount) throw new Error(`The database did not authorize deleting ${table} record ${id}, or the record no longer exists.`);
}

async function deleteRemovedRows<T extends { id: string }>(client: PoolClient, table: string, before: T[], after: T[], idColumn = 'id'): Promise<void> {
  const afterIds = new Set(after.map((x) => x.id));
  for (const oldValue of before) if (!afterIds.has(oldValue.id)) await deleteOne(client, table, oldValue.id, idColumn);
}

async function syncRows<T extends { id: string }>(client: PoolClient, table: string, before: T[], after: T[], map: (value: T, isNew: boolean) => Row, updates = true, idColumn = 'id', deleteMissing = true): Promise<void> {
  const beforeById = new Map(before.map((value) => [value.id, value]));
  if (deleteMissing) await deleteRemovedRows(client, table, before, after, idColumn);
  for (const value of after) {
    const old = beforeById.get(value.id);
    if (!old) await writeOne(client, table, value.id, map(value, true), true);
    else if (updates && changed(old, value)) await writeOne(client, table, value.id, map(value, false), false, idColumn);
  }
}

function companyFields(lead: Lead) { return { name: lead.company, website: lead.website || null, logo_url: lead.companyLogo || null, industry: lead.industry || null, net_worth: lead.companyNetWorth || 0 }; }
async function ensureCompanies(client: PoolClient, leads: Lead[], meta: SnapshotMeta): Promise<Map<string, string>> {
  const idByName = new Map(meta.companies.map((c) => [String(c.name).toLowerCase(), c.id]));
  const desired = new Map<string, Lead>();
  for (const lead of leads) if (!desired.has(lead.company.toLowerCase())) desired.set(lead.company.toLowerCase(), lead);
  for (const [key, lead] of desired) {
    if (!idByName.has(key)) {
      const fields = companyFields(lead);
      const result = await client.query<{ id: string }>(`insert into public.companies (name,website,logo_url,industry,net_worth) values ($1,$2,$3,$4,$5) on conflict (name) do nothing returning id`, [fields.name, fields.website, fields.logo_url, fields.industry, fields.net_worth]);
      if (result.rows[0]) idByName.set(key, result.rows[0].id);
      else {
        const existing = await client.query<{ id: string }>('select id from public.companies where lower(name) = lower($1)', [fields.name]);
        if (!existing.rows[0]) throw new Error('Could not create or locate the company record for this lead.');
        idByName.set(key, existing.rows[0].id);
      }
    }
  }
  return idByName;
}

function leadRow(lead: Lead, companyId: string | undefined, meta: SnapshotMeta, actorId: string, isNew: boolean): Row {
  return rowObject([
    ['company_id', companyId || null], ['full_name', lead.name], ['role_title', lead.role], ['email', lead.email || null], ['phone', lead.phone || null], ['linkedin_url', lead.linkedin || null],
    ['source', lead.source], ['status', lead.status], ['priority', lead.priority], ['estimated_revenue', lead.revenue], ['currency', lead.currency], ['progression', lead.progression], ['win_probability', lead.probability],
    ['assigned_to', profileId(lead.assignedTo, meta, actorId)], ['is_shared', Boolean(lead.isShared)], ['next_follow_up_at', lead.nextFollowUp], ['last_contacted_at', lead.lastContacted], ['expected_close_at', lead.expectedClose],
    ['ai_outreach_topic', lead.aiOutreachTopic], ['ai_opening_message', lead.aiOpeningMessage], ['ai_email_subject', lead.aiEmailSubject], ['ai_follow_up_approach', lead.aiFollowUpApproach], ['notes', lead.notes], ['archived', lead.archived],
    ['updated_by', actorId], ['alternative_contact_method', lead.alternativeContactMethod || null], ['alternative_contact_notes', lead.alternativeContactNotes || ''], ['actual_close_at', lead.actualCloseAt || null],
    ['closed_by', lead.closedById || null], ['loss_reason', lead.lossReason || ''], ['pre_close_opportunity_stages', JSON.stringify(lead.preCloseOpportunityStages || [])], ['change_history', JSON.stringify(lead.changeHistory || [])],
    ['created_by', isNew ? actorId : undefined], ['created_at', isNew ? lead.createdAt : undefined], ['updated_at', lead.updatedAt],
  ]);
}

async function syncStageHistory(client: PoolClient, before: Lead[], after: Lead[], meta: SnapshotMeta, actorId: string): Promise<void> {
  for (const lead of after) {
    const old = before.find((item) => item.id === lead.id);
    const oldKeys = new Set((old?.stageHistory || []).map((x) => `${x.status}:${x.at}`));
    for (let i = 0; i < lead.stageHistory.length; i++) {
      const item = lead.stageHistory[i]!;
      if (oldKeys.has(`${item.status}:${item.at}`)) continue;
      const prior = lead.stageHistory[i - 1];
      await client.query('insert into public.lead_stage_history (lead_id,from_stage,to_stage,entered_at,changed_by) values ($1,$2,$3,$4,$5)', [lead.id, prior?.status || null, item.status, item.at, profileId(item.by, meta, actorId) || actorId]);
    }
  }
}

async function persistState(client: PoolClient, before: CGBSState, after: CGBSState, meta: SnapshotMeta): Promise<void> {
  const actor = currentDatabaseActor()!;
  const companyIds = await ensureCompanies(client, after.leads, meta);
  const companyBefore = new Map(meta.companies.map((c) => [c.id, c]));

  // Insert/update parents before related rows. Deletes run in reverse dependency order.
  await syncRows(client, 'leads', before.leads, after.leads, (x, isNew) => leadRow(x, companyIds.get(x.company.toLowerCase()), meta, actor.id, isNew), true, 'id', false);
  for (const lead of after.leads) {
    const id = companyIds.get(lead.company.toLowerCase()); if (!id) continue;
    const oldCompany = companyBefore.get(id); if (!oldCompany) continue;
    const fields = companyFields(lead);
    if (oldCompany.website !== fields.website || oldCompany.logo_url !== fields.logo_url || oldCompany.industry !== fields.industry || Number(oldCompany.net_worth) !== Number(fields.net_worth)) {
      const updated = await client.query('update public.companies set website=$1,logo_url=$2,industry=$3,net_worth=$4 where id=$5', [fields.website, fields.logo_url, fields.industry, fields.net_worth, id]);
      if (!updated.rowCount) throw new Error(`The database did not authorize updating company ${id}.`);
    }
  }
  await syncStageHistory(client, before.leads, after.leads, meta, actor.id);

  await syncRows(client, 'opportunities', before.opportunities, after.opportunities, (x, isNew) => rowObject([
    ['name', x.name], ['lead_id', x.leadId], ['amount', x.amount], ['currency', x.currency], ['probability', x.probability], ['stage', x.stage], ['expected_close_at', x.expectedClose], ['assigned_to', profileId(x.owner, meta, actor.id)], ['notes', x.notes],
    ['actual_close_at', x.actualCloseAt || null], ['accomplished_by', x.accomplishedById || null], ['accomplished_by_name', x.accomplishedByName || null], ['loss_reason', x.lossReason || ''], ['pre_close_stage', x.preCloseStage || null],
    ['created_by', isNew ? actor.id : undefined], ['created_at', isNew ? x.createdAt : undefined],
  ]));
  await syncRows(client, 'follow_up_tasks', before.tasks, after.tasks, (x, isNew) => rowObject([
    ['lead_id', x.leadId], ['task_type', x.type], ['due_at', x.dueAt], ['priority', x.priority], ['assigned_to', profileId(x.assignedTo, meta, actor.id)], ['notes', x.notes], ['status', x.status], ['cancelled_reason', x.cancelledReason || null],
    ['completed_at', x.completedAt], ['completed_by', profileId(x.completedBy, meta, actor.id)], ['completion_notes', x.completionNotes || ''], ['ends_at', x.endsAt || null], ['schedule_history', JSON.stringify(x.scheduleHistory || [])],
    ['created_by', isNew ? actor.id : undefined], ['created_at', isNew ? x.createdAt : undefined],
  ]));
  await syncRows(client, 'calls', before.calls, after.calls, (x) => rowObject([
    ['lead_id', x.leadId], ['outcome', x.outcome], ['notes', x.notes], ['duration_seconds', x.durationSeconds ?? Math.round((x.durationMinutes || 0) * 60)], ['created_by', actorIdForName(x.createdBy, meta.profiles, actor.id)],
    ['client_mutation_id', x.clientMutationId || null], ['contact_method', x.contactMethod || null], ['provider', x.provider || null], ['provider_call_id', x.providerCallId || null], ['started_at', x.startedAt || null], ['ended_at', x.endedAt || null],
  ]));
  await syncRows(client, 'voice_calls', before.voiceCalls, after.voiceCalls, (x) => rowObject([
    ['lead_id', x.leadId], ['user_id', x.userId], ['user_name', x.userName], ['from_number', x.fromNumber], ['to_number', x.toNumber], ['provider', x.provider], ['provider_call_id', x.providerCallId], ['status', x.status], ['idempotency_key', x.idempotencyKey],
    ['requested_at', x.requestedAt], ['started_at', x.startedAt], ['ended_at', x.endedAt], ['duration_seconds', x.durationSeconds], ['last_provider_event_id', x.lastProviderEventId], ['error_message', x.errorMessage], ['outcome_recorded_at', x.outcomeRecordedAt],
  ]));
  await syncRows(client, 'calling_profiles', before.callingProfiles.map((x) => ({ ...x, id: x.userId })), after.callingProfiles.map((x) => ({ ...x, id: x.userId })), (x) => rowObject([
    ['user_id', x.userId], ['phone', x.phone], ['verified_at', x.verifiedAt], ['pending_phone', x.pendingPhone], ['verification_code_hash', x.verificationCodeHash], ['verification_expires_at', x.verificationExpiresAt], ['verification_attempts', x.verificationAttempts], ['updated_at', x.updatedAt],
  ]), true, 'user_id');
  await syncRows(client, 'activities', before.activities, after.activities, (x, isNew) => rowObject([
    ['lead_id', x.leadId], ['activity_type', x.type], ['title', x.title], ['detail', x.detail], ['created_by', isNew ? actor.id : profileId(x.createdBy, meta, actor.id)], ['created_at', isNew ? x.createdAt : undefined],
  ]), false);
  await syncRows(client, 'email_templates', before.templates, after.templates, (x, isNew) => rowObject([['name', x.name], ['subject', x.subject], ['body', x.body], ['updated_by', actor.id], ['created_by', isNew ? actor.id : undefined]]));
  await syncRows(client, 'sales_targets', before.targets, after.targets, (x, isNew) => rowObject([
    ['metric', x.metric], ['target_value', x.targetValue], ['period', x.period], ['starts_on', x.startDate], ['ends_on', x.endDate], ['owner_scope', x.ownerType],
    ['owner_user_id', x.ownerType === 'team' ? null : profileId(x.ownerName, meta, actor.id)], ['owner_label', x.ownerName], ['enabled', x.enabled], ['revision_history', JSON.stringify(x.revisions || [])], ['updated_by', actor.id], ['created_by', isNew ? actor.id : undefined], ['created_at', isNew ? x.createdAt : undefined],
  ]));
  await syncRows(client, 'calendar_events', before.calendarEvents, after.calendarEvents, (x, isNew) => rowObject([
    ['title', x.title], ['description', x.description], ['event_type', x.type], ['status', x.status], ['starts_at', x.startAt], ['ends_at', x.endAt], ['all_day', x.allDay], ['lead_id', x.leadId], ['opportunity_id', x.opportunityId],
    ['assigned_to', profileId(x.assignedTo, meta, actor.id)], ['priority', x.priority], ['location', x.location], ['meeting_link', x.meetingLink], ['source_type', x.sourceType || null], ['source_notes', x.sourceNotes || ''], ['created_by', isNew ? actor.id : undefined], ['created_at', isNew ? x.createdAt : undefined],
  ]));
  await syncRows(client, 'reminders', before.reminders, after.reminders, (x) => rowObject([
    ['source_type', x.sourceType], ['source_id', x.sourceId], ['owner_id', x.ownerId], ['owner_name', x.ownerName], ['send_at', x.sendAt], ['minutes_before', x.minutesBefore], ['channels', JSON.stringify(x.channels)], ['enabled', x.enabled],
    ['status', x.status], ['idempotency_key', x.idempotencyKey], ['attempts', x.attempts], ['delivered_at', x.deliveredAt], ['last_error', x.lastError], ['event_start_at', x.eventStartAt],
  ]));
  await syncRows(client, 'notifications', before.notifications, after.notifications, (x) => rowObject([['reminder_id', x.reminderId || null], ['user_id', x.userId], ['title', x.title], ['body', x.body], ['created_at', x.createdAt], ['read_at', x.readAt]]));
  await deleteRemovedRows(client, 'leads', before.leads, after.leads);

  const oldPref = before.settings; const newPref = after.settings;
  if (changed(oldPref, newPref)) {
    await client.query(`insert into public.user_preferences (user_id,timezone,currency,daily_call_target,daily_followup_target,daily_meeting_target,monthly_revenue_target)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict (user_id) do update set timezone=excluded.timezone,currency=excluded.currency,daily_call_target=excluded.daily_call_target,daily_followup_target=excluded.daily_followup_target,daily_meeting_target=excluded.daily_meeting_target,monthly_revenue_target=excluded.monthly_revenue_target`,
      [actor.id, newPref.timezone, newPref.currency, newPref.dailyCallTarget, newPref.dailyFollowUpTarget || 8, newPref.dailyMeetingTarget || 3, newPref.monthlyRevenueTarget]);
  }
}

export async function updatePostgresStore<T>(change: (state: CGBSState) => T): Promise<{ state: CGBSState; result: T }> {
  return withActorTransaction(async (client) => {
    const { state, meta } = await loadState(client);
    const before = structuredClone(state);
    const result = change(state);
    await persistState(client, before, state, meta);
    return { state, result };
  });
}

export async function applyVoiceWebhook(input: { providerCallId: string; customCallId: string; eventId: string; status: string; startedAt: string | null; endedAt: string | null; durationSeconds: number | null }): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query('begin'); await client.query('set local role service_role');
    const found = await client.query<Row>(`select * from public.voice_calls where ($1 <> '' and provider_call_id=$1) or ($2 <> '' and id::text=$2) limit 1 for update`, [input.providerCallId, input.customCallId]);
    const call = found.rows[0];
    if (!call || call.last_provider_event_id === input.eventId) { await client.query('commit'); return Boolean(call); }
    await client.query(`update public.voice_calls set status=$1,provider_call_id=coalesce(nullif($2,''),provider_call_id),
      started_at=coalesce($3,started_at),ended_at=coalesce($4,ended_at),duration_seconds=coalesce($5,duration_seconds),last_provider_event_id=$6 where id=$7`,
      [input.status, input.providerCallId, input.startedAt, input.endedAt, input.durationSeconds, input.eventId, call.id]);
    await client.query('commit'); return true;
  } catch (error) { try { await client.query('rollback'); } catch { /* ignored */ } throw error; }
  finally { client.release(); }
}

export async function dispatchDueRemindersDatabase(): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query('begin'); await client.query('set local role service_role');
    const due = await client.query<Row>(`select r.* from public.reminders r
      where r.enabled and r.status='Pending' and r.send_at <= now()
      order by r.send_at for update skip locked limit 100`);
    let delivered = 0;
    for (const reminder of due.rows) {
      const sourceTable = reminder.source_type === 'task' ? 'follow_up_tasks' : 'calendar_events';
      const source = await client.query<Row>(`select status, ${reminder.source_type === 'task' ? 'due_at' : 'starts_at'} as starts_at from public.${sourceTable} where id=$1`, [reminder.source_id]);
      if (!source.rows[0] || (source.rows[0].status && !['Due','Scheduled'].includes(source.rows[0].status))) {
        await client.query("update public.reminders set enabled=false,status='Cancelled',last_error='Source task or event is no longer active.' where id=$1", [reminder.id]);
        continue;
      }
      await client.query("update public.reminders set status='Delivered',delivered_at=now(),attempts=attempts+1,last_error='' where id=$1", [reminder.id]);
      if (Array.isArray(reminder.channels) && reminder.channels.includes('in-app')) {
        await client.query(`insert into public.notifications (reminder_id,user_id,lead_id,task_id,title,body,channel,scheduled_for,delivered_at)
          values ($1,$2,case when $3='task' then (select lead_id from public.follow_up_tasks where id=$4) else null end,
          case when $3='task' then $4::uuid else null end,'Reminder', 'An event is coming up.', 'in_app', $5, now()) on conflict (reminder_id) where reminder_id is not null do nothing`,
        [reminder.id, reminder.owner_id, reminder.source_type, reminder.source_id, reminder.send_at]);
      }
      delivered++;
    }
    await client.query('commit'); return delivered;
  } catch (error) { try { await client.query('rollback'); } catch { /* ignored */ } throw error; }
  finally { client.release(); }
}

export async function closeDatabasePool(): Promise<void> { if (pool) { await pool.end(); pool = undefined; } }
