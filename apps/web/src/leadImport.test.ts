import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { leadSchema, type Lead } from '../../../packages/shared/src/index';
import {
  autoMapColumns,
  findImportDuplicates,
  parseLeadFile,
  validateImportRows,
  type ImportSheet,
} from './leadImport';

const exactHeaders = ['Full name', 'Company', 'Role / job title', 'Industry', 'Company logo URL', 'Company net worth', 'Email address', 'Phone number', 'Company website', 'LinkedIn profile'];
const exactRow = ['Asha Rao', 'Northstar Systems', 'CTO', 'Technology', 'https://northstar.test/logo.png', '12500000', 'asha@northstar.test', '+91 98765 43210', 'northstar.test', 'https://linkedin.com/in/asha'];
const existingLead = (id: string, email: string, phone: string): Lead => ({
  ...leadSchema.parse({ name: 'Existing Contact', company: 'Northstar Systems', email, phone }),
  id, createdAt: '', updatedAt: '', lastContacted: null, archived: false, stageHistory: [],
});

function csvFile(name: string, content: string): File {
  return { name, size: new TextEncoder().encode(content).length, text: async () => content } as File;
}

function xlsxFile(name: string, sheets: Record<string, unknown[][]>): File {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { name, size: output.byteLength, arrayBuffer: async () => output } as File;
}

describe('bulk lead import parsing and mapping', () => {
  it('maps the supplied Excel headers, keeping company net worth separate from deal revenue', () => {
    const mapping = autoMapColumns(exactHeaders);
    const sheet: ImportSheet = { name: 'Leads', headers: exactHeaders, rows: [{ rowNumber: 2, values: exactRow }] };
    const [row] = validateImportRows(sheet, mapping);
    expect(mapping.name).toBe(0);
    expect(mapping.role).toBe(2);
    expect(mapping.companyLogo).toBe(4);
    expect(mapping.companyNetWorth).toBe(5);
    expect(mapping.revenue).toBeUndefined();
    expect(row?.lead?.companyNetWorth).toBe(12_500_000);
    expect(row?.lead?.revenue).toBe(0);
    expect(row?.lead?.companyLogo).toBe('https://northstar.test/logo.png');
  });

  it('matches common aliases regardless of case, spacing, and punctuation', () => {
    const mapping = autoMapColumns(['Lead Name', 'Company Name', 'Job Title', 'Email', 'Phone', 'Website', 'LinkedIn URL']);
    expect(mapping).toMatchObject({ name: 0, company: 1, role: 2, email: 3, phone: 4, website: 5, linkedin: 6 });
  });

  it('parses CSV and recognizes headers with harmless whitespace', async () => {
    const file = csvFile('leads.csv', ' Full name , Company , Email address \nAsha Rao,Northstar Systems,asha@northstar.test\n');
    const parsed = await parseLeadFile(file);
    expect(parsed.sheets[0]?.headers[0]).toBe('Full name');
    expect(parsed.sheets[0]?.rows).toHaveLength(1);
    expect(autoMapColumns(parsed.sheets[0]!.headers)).toMatchObject({ name: 0, company: 1, email: 2 });
  });

  it('parses Excel worksheets and allows selection among multiple sheets', async () => {
    const parsed = await parseLeadFile(xlsxFile('leads.xlsx', {
      Leads: [exactHeaders, exactRow],
      Notes: [['Not a lead sheet'], ['sample']],
    }));
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['Leads', 'Notes']);
    expect(parsed.sheets[0]?.rows).toHaveLength(1);
    expect(parsed.sheets[1]?.headers[0]).toBe('Not a lead sheet');
  });

  it('ignores formula cells instead of importing cached formula values', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([['Full name', 'Company', 'Company logo URL'], ['Asha Rao', 'Northstar', '']]);
    worksheet.C2 = { t: 's', f: 'HYPERLINK("https://bad.test", "logo")', v: 'https://bad.test' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
    const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = await parseLeadFile({ name: 'formula.xlsx', size: output.byteLength, arrayBuffer: async () => output } as File);
    expect(parsed.sheets[0]?.rows[0]?.values[2]).toBe('');
  });

  it('reports empty, malformed, oversized, and unsupported files', async () => {
    await expect(parseLeadFile({ name: 'empty.csv', size: 0, text: async () => '' } as File)).rejects.toThrow(/empty/i);
    await expect(parseLeadFile(csvFile('empty.csv', '  \n,,\n'))).rejects.toThrow(/no header row/i);
    await expect(parseLeadFile(csvFile('broken.csv', 'Name,Company\n"unclosed,Northstar'))).rejects.toThrow(/CSV row/i);
    await expect(parseLeadFile({ name: 'huge.xlsx', size: 11 * 1024 * 1024 } as File)).rejects.toThrow(/10 MB/i);
    await expect(parseLeadFile({ name: 'broken.xlsx', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as File)).rejects.toThrow(/corrupt/i);
    await expect(parseLeadFile({ name: 'leads.pdf', size: 10 } as File)).rejects.toThrow(/unsupported/i);
  });

  it('returns actionable warnings without blocking rows with missing required fields or invalid email', () => {
    const sheet: ImportSheet = { name: 'Leads', headers: ['Name', 'Company', 'Email'], rows: [
      { rowNumber: 2, values: ['', 'Northstar', 'bad-email'] },
    ] };
    const [row] = validateImportRows(sheet, autoMapColumns(sheet.headers));
    expect(row?.lead?.name).toBe('');
    expect(row?.lead?.company).toBe('Northstar');
    expect(row?.lead?.email).toBe('bad-email');
    expect(row?.errors.join(' ')).toMatch(/Name is required/);
    expect(row?.errors.join(' ')).toMatch(/email/i);
  });

  it('detects existing and within-file duplicates by normalized email, phone, or contact/company', () => {
    const sheet: ImportSheet = { name: 'Leads', headers: exactHeaders, rows: [
      { rowNumber: 2, values: exactRow },
      { rowNumber: 3, values: ['Asha Rao', 'Northstar Systems', 'CTO', 'Technology', '', '', 'asha@northstar.test', ' +91   98765 43210 ', '', ''] },
      { rowNumber: 4, values: ['Unique Contact', 'New Co', '', '', '', '', 'unique@new.test', '', '', ''] },
    ] };
    const validated = validateImportRows(sheet, autoMapColumns(sheet.headers));
    const duplicates = findImportDuplicates(validated, [existingLead('existing', 'existing@old.test', '+91 98765 43210')]);
    expect(duplicates.has(2)).toBe(true);
    expect(duplicates.has(3)).toBe(true);
    expect(duplicates.has(4)).toBe(false);
  });
});