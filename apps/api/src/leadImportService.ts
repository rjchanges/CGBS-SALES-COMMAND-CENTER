import { randomUUID } from 'node:crypto';
import {
  leadSchema,
  leadStatuses,
  priorities,
  safeWebsiteUrl,
  type CGBSState,
  type Lead,
  type LeadInput,
} from '../../../packages/shared/dist/index.js';

export type LeadImportEntry = { rowNumber: number; lead: unknown; warnings?: string[] };
export type ImportRowIssue = { rowNumber: number; error: string };
export type LeadImportResult = {
  total: number;
  added: number;
  duplicates: number;
  failed: number;
  errors: ImportRowIssue[];
  duplicateRows: ImportRowIssue[];
  warnings: ImportRowIssue[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return value == null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ? '' : String(value).trim();
}

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 6 ? digits : '';
}

function identityKeys(lead: LeadInput): string[] {
  const keys: string[] = [];
  const email = lead.email.trim().toLowerCase();
  const phone = phoneDigits(lead.phone);
  const nameCompany = `${lead.name.trim().toLowerCase()}|${lead.company.trim().toLowerCase()}`;
  if (email) keys.push(`email:${email}`);
  if (phone) keys.push(`phone:${phone}`);
  if (lead.name.trim() && lead.company.trim()) keys.push(`contact:${nameCompany}`);
  return keys;
}

function numberValue(record: Record<string, unknown>, field: string, fallback: number, warnings: string[], allowNegative = false): number {
  const raw = stringValue(record, field);
  if (!raw) return fallback;
  const parsed = Number(raw.replace(/(?:₹|\bINR\b)/gi, '').replace(/[\s,]/g, ''));
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0)) {
    warnings.push(`${field} “${raw}” is invalid; stored as ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function enumValue<T extends string>(value: string, options: readonly T[], fallback: T, field: string, warnings: string[]): T {
  if (!value) return fallback;
  const matched = options.find((option) => option.toLowerCase() === value.toLowerCase());
  if (matched) return matched;
  warnings.push(`${field} “${value}” is unsupported; stored as ${fallback}.`);
  return fallback;
}

function urlValue(value: string, field: string, warnings: string[]): string {
  if (!value) return '';
  const safe = safeWebsiteUrl(value);
  if (!safe) warnings.push(`${field} “${value}” is not a safe HTTP or HTTPS URL; left blank.`);
  return safe || '';
}

function dateValue(value: string, field: string, warnings: string[]): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    warnings.push(`${field} “${value}” is invalid; left blank.`);
    return null;
  }
  return date.toISOString();
}

function normalizeLead(value: unknown, actorName: string, warnings: string[]): LeadInput {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) warnings.push('Row did not contain a lead object; blank fields were retained.');
  const name = stringValue(record, 'name');
  const company = stringValue(record, 'company');
  if (!name) warnings.push('Name is blank.');
  if (!company) warnings.push('Company is blank.');
  const email = stringValue(record, 'email').toLowerCase();
  if (email && !leadSchema.shape.email.safeParse(email).success) warnings.push(`Email “${email}” is not in a standard email format; retained as provided.`);
  const rawCurrency = stringValue(record, 'currency').toUpperCase();
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'INR';
  if (rawCurrency && currency !== rawCurrency) warnings.push(`Currency “${rawCurrency}” is invalid; stored as INR.`);
  const rawProgression = numberValue(record, 'progression', 5, warnings);
  const rawProbability = numberValue(record, 'probability', 10, warnings);
  const progression = rawProgression >= 0 && rawProgression <= 100 ? rawProgression : 5;
  const probability = rawProbability >= 0 && rawProbability <= 100 ? rawProbability : 10;
  if (progression !== rawProgression) warnings.push(`Progression ${rawProgression} is outside 0–100; stored as 5.`);
  if (probability !== rawProbability) warnings.push(`Win probability ${rawProbability} is outside 0–100; stored as 10.`);
  const priority = enumValue(stringValue(record, 'priority'), priorities, 'Medium', 'Priority', warnings);
  const status = enumValue(stringValue(record, 'status'), leadStatuses, 'New Lead', 'Lead status', warnings);
  return {
    name,
    company,
    role: stringValue(record, 'role'),
    companyLogo: urlValue(stringValue(record, 'companyLogo'), 'Company logo URL', warnings),
    companyNetWorth: numberValue(record, 'companyNetWorth', 0, warnings),
    aiOutreachTopic: stringValue(record, 'aiOutreachTopic'),
    aiOpeningMessage: stringValue(record, 'aiOpeningMessage'),
    aiEmailSubject: stringValue(record, 'aiEmailSubject'),
    aiFollowUpApproach: stringValue(record, 'aiFollowUpApproach'),
    email,
    phone: stringValue(record, 'phone').replace(/\s+/g, ' '),
    website: urlValue(stringValue(record, 'website'), 'Company website', warnings),
    linkedin: urlValue(stringValue(record, 'linkedin'), 'LinkedIn profile', warnings),
    industry: stringValue(record, 'industry') || 'Other',
    source: stringValue(record, 'source') || 'Other',
    status,
    priority,
    revenue: numberValue(record, 'revenue', 0, warnings),
    currency,
    progression,
    probability,
    assignedTo: actorName,
    nextFollowUp: dateValue(stringValue(record, 'nextFollowUp'), 'Next follow-up', warnings),
    expectedClose: dateValue(stringValue(record, 'expectedClose'), 'Expected close', warnings),
    notes: stringValue(record, 'notes'),
  };
}

/** Sanitizes every selected row and mutates state once so callers can persist atomically. */
export function importLeadBatch(state: CGBSState, entries: LeadImportEntry[], actorName: string): LeadImportResult {
  const duplicateRows: ImportRowIssue[] = [];
  const warningRows: ImportRowIssue[] = [];
  const identity = new Map<string, string>();
  for (const lead of state.leads) {
    for (const key of identityKeys(lead)) identity.set(key, `${lead.name} · ${lead.company}`);
  }

  const accepted: { rowNumber: number; lead: LeadInput; warnings: string[] }[] = [];
  entries.forEach((entry, index) => {
    const rowNumber = Number.isInteger(entry?.rowNumber) && entry.rowNumber > 0 ? entry.rowNumber : index + 2;
    const warnings = Array.isArray(entry?.warnings) ? entry.warnings.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
    const lead = normalizeLead(entry?.lead, actorName, warnings);
    const distinctWarnings = [...new Set(warnings)];
    const match = identityKeys(lead).map((key) => identity.get(key)).find(Boolean);
    if (match) {
      duplicateRows.push({ rowNumber, error: `Matches existing or earlier lead: ${match}.` });
      return;
    }
    accepted.push({ rowNumber, lead, warnings: distinctWarnings });
    for (const key of identityKeys(lead)) identity.set(key, `row ${rowNumber}`);
  });

  const createdAt = new Date().toISOString();
  const created: Lead[] = accepted.map(({ lead, warnings }) => ({
    ...lead,
    notes: warnings.length ? [lead.notes, 'Import warnings:', ...warnings.map((warning) => `- ${warning}`)].filter(Boolean).join('\n') : lead.notes,
    id: randomUUID(),
    createdAt,
    updatedAt: createdAt,
    lastContacted: null,
    archived: false,
    stageHistory: [{ status: lead.status, at: createdAt, by: actorName }],
    changeHistory: [],
  }));
  if (created.length) {
    state.leads.unshift(...created);
    for (const lead of created) {
      state.activities.unshift({
        id: randomUUID(),
        leadId: lead.id,
        type: 'Note',
        title: 'Lead imported',
        detail: 'Lead added through bulk upload.',
        createdAt,
        createdBy: actorName,
      });
    }
  }

  for (const item of accepted) {
    if (item.warnings.length) warningRows.push({ rowNumber: item.rowNumber, error: [...new Set(item.warnings)].join('; ') });
  }
  return {
    total: entries.length,
    added: created.length,
    duplicates: duplicateRows.length,
    failed: 0,
    errors: [],
    duplicateRows,
    warnings: warningRows,
  };
}