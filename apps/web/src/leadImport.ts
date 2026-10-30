import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  leadSchema,
  leadStatuses,
  priorities,
  safeWebsiteUrl,
  type Lead,
  type LeadInput,
} from '../../../packages/shared/src/index';

export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Full name', required: true },
  { key: 'company', label: 'Company', required: true },
  { key: 'role', label: 'Role / job title', required: false },
  { key: 'industry', label: 'Industry', required: false },
  { key: 'companyLogo', label: 'Company logo URL', required: false },
  { key: 'companyNetWorth', label: 'Company net worth', required: false },
  { key: 'email', label: 'Email address', required: false },
  { key: 'phone', label: 'Phone number', required: false },
  { key: 'website', label: 'Company website', required: false },
  { key: 'linkedin', label: 'LinkedIn profile', required: false },
  { key: 'revenue', label: 'Estimated deal value', required: false },
  { key: 'source', label: 'Lead source', required: false },
  { key: 'status', label: 'Lead status', required: false },
  { key: 'priority', label: 'Priority', required: false },
  { key: 'progression', label: 'Progression %', required: false },
  { key: 'probability', label: 'Win probability %', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const satisfies readonly { key: keyof LeadInput; label: string; required: boolean }[];

export type ImportField = typeof IMPORT_FIELDS[number]['key'];
export type ColumnMapping = Partial<Record<ImportField, number>>;
export type ImportSourceRow = { rowNumber: number; values: string[] };
export type ImportSheet = { name: string; headers: string[]; rows: ImportSourceRow[] };
export type ParsedLeadFile = { fileName: string; fileSize: number; sheets: ImportSheet[] };
export type ValidatedImportRow = {
  rowNumber: number;
  values: string[];
  lead: LeadInput | null;
  errors: string[];
};

const aliases: Record<ImportField, string[]> = {
  name: ['name', 'fullname', 'leadname', 'contactname'],
  company: ['company', 'companyname', 'organization', 'organisation'],
  role: ['role', 'rolejobtitle', 'jobtitle', 'title', 'position'],
  industry: ['industry', 'field'],
  companyLogo: ['companylogourl', 'companylogo', 'logourl', 'logo'],
  companyNetWorth: ['companynetworth', 'networth', 'companyvalue'],
  email: ['email', 'emailaddress'],
  phone: ['phone', 'phonenumber', 'mobile'],
  website: ['website', 'companywebsite', 'domain'],
  linkedin: ['linkedin', 'linkedinprofile', 'linkedinurl'],
  revenue: ['revenue', 'dealvalue', 'estimatedrevenue', 'estimateddealrevenue', 'estimatedopportunity'],
  source: ['source', 'leadsource'],
  status: ['status', 'stage'],
  priority: ['priority'],
  progression: ['progression', 'progress'],
  probability: ['probability', 'winprobability'],
  notes: ['notes', 'note'],
};

function normalizedHeader(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emptyValue(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

function parseMatrix(name: string, matrix: unknown[][], rowOffset = 0): ImportSheet | null {
  const headerIndex = matrix.findIndex((row) => row.some((value) => !emptyValue(value)));
  if (headerIndex < 0) return null;
  const rawHeader = matrix[headerIndex] || [];
  const width = Math.max(rawHeader.length, ...matrix.slice(headerIndex + 1).map((row) => row.length));
  const headers = Array.from({ length: width }, (_, index) => {
    const label = String(rawHeader[index] ?? '').trim();
    return label || `Column ${index + 1}`;
  });
  const rows = matrix.slice(headerIndex + 1).flatMap((values, index) => {
    const normalizedValues = Array.from({ length: width }, (_, col) => String(values[col] ?? '').trim());
    return normalizedValues.some((value) => value !== '')
      ? [{ rowNumber: rowOffset + headerIndex + index + 2, values: normalizedValues }]
      : [];
  });
  return rows.length ? { name, headers, rows } : null;
}

function worksheetMatrix(sheet: XLSX.WorkSheet): { rows: unknown[][]; rowOffset: number } | null {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows: unknown[][] = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const values: unknown[] = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      // Formula cells are intentionally blanked; uploaded formulas are never evaluated or imported.
      values.push(cell?.f ? '' : cell?.v ?? '');
    }
    rows.push(values);
  }
  return { rows, rowOffset: range.s.r };
}

export async function parseLeadFile(file: File): Promise<ParsedLeadFile> {
  if (file.size > MAX_IMPORT_FILE_SIZE) throw new Error('File is larger than 10 MB. Choose a smaller CSV or Excel file.');
  if (file.size === 0) throw new Error('The selected file is empty.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  let sheets: ImportSheet[];
  if (extension === 'csv') {
    const parsed = Papa.parse<string[]>(await file.text(), { header: false, skipEmptyLines: false, dynamicTyping: false });
    const quoteError = parsed.errors.find((item) => item.code === 'MissingQuotes' || item.code === 'InvalidQuotes');
    if (quoteError) throw new Error(`CSV row ${(quoteError.row ?? 0) + 1}: ${quoteError.message}`);
    const sheet = parseMatrix('CSV', parsed.data, 0);
    sheets = sheet ? [sheet] : [];
  } else if (extension === 'xlsx' || extension === 'xls') {
    try {
      const buffer = await file.arrayBuffer();
      const signature = new Uint8Array(buffer).slice(0, 8);
      const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
      const isLegacyXls = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => signature[index] === byte);
      if (!isZip && (extension === 'xlsx' || !isLegacyXls)) throw new Error('invalid workbook signature');
      const workbook = XLSX.read(buffer, { type: 'array', cellFormula: true, cellDates: false });
      if (!workbook.SheetNames.length) throw new Error('empty workbook');
      sheets = workbook.SheetNames.flatMap((name) => {
        const sheet = workbook.Sheets[name];
        const matrix = sheet ? worksheetMatrix(sheet) : null;
        const parsed = matrix ? parseMatrix(name, matrix.rows, matrix.rowOffset) : null;
        return parsed ? [parsed] : [];
      });
    } catch {
      throw new Error('Could not read this Excel workbook. It may be corrupt, encrypted, or unsupported.');
    }
  } else {
    throw new Error('Unsupported file type. Choose a .csv, .xls, or .xlsx file.');
  }
  if (!sheets.length) throw new Error('No header row and data records were found in this file.');
  if (sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0) > MAX_IMPORT_ROWS) {
    throw new Error(`This file contains more than ${MAX_IMPORT_ROWS} records. Split it into smaller uploads.`);
  }
  return { fileName: file.name, fileSize: file.size, sheets };
}

export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = headers.findIndex((header) => aliases[field.key].includes(normalizedHeader(header)));
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}

function fieldValue(row: ImportSourceRow, mapping: ColumnMapping, field: ImportField): string {
  const index = mapping[field];
  return index === undefined ? '' : String(row.values[index] ?? '').trim();
}

function numericValue(value: string, label: string, errors: string[], defaultValue: number): number {
  if (!value) return defaultValue;
  const cleaned = value.replace(/(?:₹|\bINR\b)/gi, '').replace(/[\s,]/g, '');
  const result = Number(cleaned);
  if (!Number.isFinite(result)) {
    errors.push(`${label} must be a number; check the source value “${value}”.`);
    return defaultValue;
  }
  return result;
}

function safeUrlValue(value: string, label: string, errors: string[]): string {
  if (!value) return '';
  const safe = safeWebsiteUrl(value);
  if (!safe) errors.push(`${label} “${value}” is not a safe http or https URL.`);
  return safe || '';
}

function enumValue<T extends string>(value: string, options: readonly T[], label: string, errors: string[], fallback: T): T {
  if (!value) return fallback;
  const result = options.find((option) => option.toLowerCase() === value.toLowerCase());
  if (result) return result;
  errors.push(`${label} “${value}” is not supported.`);
  return fallback;
}

export function validateImportRows(sheet: ImportSheet, mapping: ColumnMapping): ValidatedImportRow[] {
  return sheet.rows.map((row) => {
    const errors: string[] = [];
    const email = fieldValue(row, mapping, 'email').toLowerCase();
    const phone = fieldValue(row, mapping, 'phone').replace(/\s+/g, ' ');
    const leadCandidate: LeadInput = {
      name: fieldValue(row, mapping, 'name'),
      company: fieldValue(row, mapping, 'company'),
      role: fieldValue(row, mapping, 'role'),
      industry: fieldValue(row, mapping, 'industry') || 'Other',
      companyLogo: safeUrlValue(fieldValue(row, mapping, 'companyLogo'), 'Company logo URL', errors),
      companyNetWorth: numericValue(fieldValue(row, mapping, 'companyNetWorth'), 'Company net worth', errors, 0),
      email,
      phone,
      website: safeUrlValue(fieldValue(row, mapping, 'website'), 'Company website', errors),
      linkedin: safeUrlValue(fieldValue(row, mapping, 'linkedin'), 'LinkedIn profile', errors),
      revenue: numericValue(fieldValue(row, mapping, 'revenue'), 'Estimated deal value', errors, 0),
      currency: 'INR',
      source: fieldValue(row, mapping, 'source') || 'Other',
      status: enumValue(fieldValue(row, mapping, 'status'), leadStatuses, 'Lead status', errors, 'New Lead'),
      priority: enumValue(fieldValue(row, mapping, 'priority'), priorities, 'Priority', errors, 'Medium'),
      progression: numericValue(fieldValue(row, mapping, 'progression'), 'Progression', errors, 5),
      probability: numericValue(fieldValue(row, mapping, 'probability'), 'Win probability', errors, 10),
      assignedTo: 'Rahul Raj M',
      nextFollowUp: null,
      expectedClose: null,
      notes: fieldValue(row, mapping, 'notes'),
      aiOutreachTopic: '',
      aiOpeningMessage: '',
      aiEmailSubject: '',
      aiFollowUpApproach: '',
    };
    const parsed = leadSchema.safeParse(leadCandidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const message = issue.message;
        if (!errors.includes(message)) errors.push(message);
      }
    }
    return { rowNumber: row.rowNumber, values: row.values, lead: parsed.success ? parsed.data : leadCandidate, errors };
  });
}

function normalizedPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 6 ? digits : '';
}

function identityKeys(lead: Pick<LeadInput, 'name' | 'company' | 'email' | 'phone'>): string[] {
  const keys: string[] = [];
  const email = lead.email.trim().toLowerCase();
  const phone = normalizedPhone(lead.phone);
  const contactCompany = `${lead.name.trim().toLowerCase()}|${lead.company.trim().toLowerCase()}`;
  if (email) keys.push(`email:${email}`);
  if (phone) keys.push(`phone:${phone}`);
  if (lead.name.trim() && lead.company.trim()) keys.push(`contact:${contactCompany}`);
  return keys;
}

export function findImportDuplicates(rows: ValidatedImportRow[], existing: Lead[]): Map<number, string> {
  const keys = new Map<string, string>();
  for (const lead of existing) {
    for (const key of identityKeys(lead)) keys.set(key, `${lead.name} · ${lead.company}`);
  }
  const duplicates = new Map<number, string>();
  for (const row of rows) {
    if (!row.lead) continue;
    const match = identityKeys(row.lead).map((key) => keys.get(key)).find(Boolean);
    if (match) {
      duplicates.set(row.rowNumber, `Matches existing or earlier lead: ${match}.`);
      continue;
    }
    for (const key of identityKeys(row.lead)) keys.set(key, `row ${row.rowNumber}`);
  }
  return duplicates;
}