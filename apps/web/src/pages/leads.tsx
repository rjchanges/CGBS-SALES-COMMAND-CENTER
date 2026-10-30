import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArrowDownToLine, ArrowUpFromLine, Edit3, Globe2, Mail, Phone, Plus, Search, Trash2, UsersRound, X } from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { Link, useSearchParams } from 'react-router-dom';
import { leadSchema, leadStatuses, priorities, safeWebsiteUrl, escapeCsvCell, type Lead, type LeadInput } from '../../../../packages/shared/src/index';
import { Button, Card, Modal, PageHeading } from '../layout';
import { request } from '../api';
import { formatMoney } from '../formatMoney';
import { autoMapColumns, findImportDuplicates, IMPORT_FIELDS, parseLeadFile, validateImportRows, type ColumnMapping, type ParsedLeadFile, type ValidatedImportRow } from '../leadImport';
import { useApp } from '../context';
import { categorizeLead, connectionCategories, type ConnectionCategory } from '../leadCategories';

const emptyLead: LeadInput = { name: '', company: '', role: '', companyLogo: '', companyNetWorth: 0, aiOutreachTopic: '', aiOpeningMessage: '', aiEmailSubject: '', aiFollowUpApproach: '', email: '', phone: '', website: '', linkedin: '', industry: 'Technology', source: 'Other', status: 'New Lead', priority: 'Medium', revenue: 0, currency: 'INR', progression: 5, probability: 10, assignedTo: 'Rahul Raj M', nextFollowUp: null, expectedClose: null, notes: '', alternativeContactMethod: null, alternativeContactNotes: '' };
const money = (value: number, currency: string) => formatMoney(value, currency);
function dateLabel(value: string | null) { return value ? format(new Date(value), 'd MMM, h:mm a') : '—'; }
function downloadCsv(filename: string, rows: string) {
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
}
function LeadEditor({ lead, onClose, onSaved }: { lead?: Lead; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const form = useForm<z.input<typeof leadSchema>, unknown, LeadInput>({ resolver: zodResolver(leadSchema), defaultValues: lead ? { ...lead, nextFollowUp: lead.nextFollowUp ? format(new Date(lead.nextFollowUp), "yyyy-MM-dd'T'HH:mm") : null, expectedClose: lead.expectedClose ? format(new Date(lead.expectedClose), 'yyyy-MM-dd') : null } : emptyLead });
  const submit = form.handleSubmit(async (values) => {
    try {
      const leadValues = { ...values, nextFollowUp: values.nextFollowUp ? new Date(values.nextFollowUp).toISOString() : null };
      await request<Lead>(lead ? '/leads/' + lead.id : '/leads', { method: lead ? 'PATCH' : 'POST', body: JSON.stringify(leadValues) });
      await onSaved(); toast(lead ? 'Lead updated.' : 'Lead added.'); onClose();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save lead.', 'error'); }
  });
  const errorFor = (field: keyof LeadInput) => form.formState.errors[field]?.message;
  return <Modal title={lead ? 'Edit lead' : 'Add a lead'} sub="Capture the details your next conversation will need." onClose={onClose} wide>
    <form onSubmit={submit} className="lead-form">
      <div className="form-section-title"><span>01</span><div><b>Contact details</b><small>Who are you speaking with?</small></div></div>
      <div className="form-grid">
        <label>Full name *<input {...form.register('name')} placeholder="e.g. Maya Patel" />{errorFor('name') && <em>{errorFor('name')}</em>}</label>
        <label>Company *<input {...form.register('company')} placeholder="Company name" />{errorFor('company') && <em>{errorFor('company')}</em>}</label>
        <label>Role / job title<input {...form.register('role')} placeholder="e.g. Head of Operations" /></label>
        <label>Industry<input {...form.register('industry')} placeholder="Technology" /></label>
        <label>Company logo URL<input {...form.register('companyLogo')} placeholder="https://company.com/logo.png" /></label>
        <label>Company net worth<input type="number" min="0" {...form.register('companyNetWorth')} /></label>
        <label>Email address<input type="email" {...form.register('email')} placeholder="name@company.com" />{errorFor('email') && <em>{errorFor('email')}</em>}</label>
        <label>Priority *<select {...form.register('priority')}>{priorities.map((item) => <option key={item}>{item}</option>)}</select>{errorFor('priority') && <em>{errorFor('priority')}</em>}</label>
        <label>Phone number<input type="tel" {...form.register('phone')} placeholder="+91 98765 43210" /></label>
        <label>Company website<input {...form.register('website')} placeholder="https://company.com" /></label>
        <label>LinkedIn profile<input {...form.register('linkedin')} placeholder="https://linkedin.com/in/..." /></label>
        <label>Alternative contact method<select {...form.register('alternativeContactMethod')}><option value="">Not set</option><option>Email</option><option>LinkedIn</option><option>Other</option></select></label>
        <label>Alternative contact next action<input {...form.register('alternativeContactNotes')} placeholder="e.g. message procurement contact on LinkedIn" /></label>
      </div>
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : lead ? 'Save changes' : 'Add lead'}</Button></div>
    </form>
  </Modal>;
}

function CompanyLogo({ src, company }: { src: string; company: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed
    ? <img className="company-avatar" src={src} alt={`${company} logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="company-avatar" aria-label={`${company} logo unavailable`}>{company.slice(0, 1).toUpperCase()}</span>;
}
function LeadDetails({ lead, onClose, onEdit }: { lead: Lead; onClose: () => void; onEdit: () => void }) {
  const { data } = useApp();
  const [tab, setTab] = useState('Overview');
  const website = safeWebsiteUrl(lead.website);
  const linkedin = safeWebsiteUrl(lead.linkedin);
  const phoneDigits = lead.phone.replace(/\D/g, '');
  const whatsappNumber = lead.phone.trim().startsWith('+') && phoneDigits.length >= 8 && phoneDigits.length <= 15 ? phoneDigits : '';
  const history = data?.activities.filter((item) => item.leadId === lead.id) || [];
  const calls = data?.calls.filter((item) => item.leadId === lead.id) || [];
  const tasks = data?.tasks.filter((item) => item.leadId === lead.id) || [];
  const opps = data?.opportunities.filter((item) => item.leadId === lead.id) || [];
  const tabs = ['Overview', 'Activities', 'Calls', 'Follow-ups', 'Opportunities', 'History'];
  return <Modal title={lead.name} sub={lead.company + (lead.role ? ' · ' + lead.role : '')} onClose={onClose} wide>
    <div className="detail-actions"><div className="quick-links">{lead.phone && <a href={'tel:' + lead.phone}><Phone size={15} /> Call</a>}{whatsappNumber && <a target="_blank" rel="noreferrer" href={'https://wa.me/' + lead.phone.replace(/\D/g, '')}>WhatsApp</a>}{lead.email && <a href={'mailto:' + lead.email}><Mail size={15} /> Email</a>}{linkedin && <a href={linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}{website && <a href={website} target="_blank" rel="noreferrer"><Globe2 size={15} /> Website</a>}</div><div className="detail-actions-buttons"><Button variant="default" onClick={onEdit}><Edit3 size={15} /> Edit</Button></div></div>
    <div className="detail-tabs">{tabs.map((item) => <button key={item} className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Overview' && <div className="detail-grid"><div className="detail-stat"><span>Lead status</span><strong><span className={'status-dot status-' + lead.status.replace(/\s/g,'-').toLowerCase()} />{lead.status}</strong></div><div className="detail-stat"><span>Priority</span><strong><i className={'priority-dot ' + lead.priority.toLowerCase()} />{lead.priority}</strong></div><div className="detail-stat"><span>Estimated deal</span><strong>{money(lead.revenue, lead.currency)}</strong></div><div className="detail-stat"><span>Company net worth</span><strong>{money(lead.companyNetWorth || 0, lead.currency)}</strong></div><div className="detail-stat"><span>Win probability</span><strong>{lead.probability}%</strong></div><div className="detail-stat"><span>Lead source</span><strong>{lead.source}</strong></div><div className="detail-stat"><span>Alternative contact</span><strong>{lead.alternativeContactMethod || 'Not set'}</strong><small>{lead.alternativeContactNotes || ''}</small></div><div className="detail-stat"><span>Expected close</span><strong>{lead.expectedClose ? dateLabel(lead.expectedClose) : 'Not set'}</strong></div><div className="detail-stat"><span>Progression</span><div className="detail-progress"><i style={{ width: lead.progression + '%' }} /></div><b>{lead.progression}%</b></div><div className="detail-stat"><span>Assigned to</span><strong>{lead.assignedTo}</strong></div><div className="detail-stat"><span>Last contacted</span><strong>{dateLabel(lead.lastContacted)}</strong></div><div className="detail-stat"><span>Next follow-up</span><strong>{dateLabel(lead.nextFollowUp)}</strong></div><div className="detail-notes"><span>Notes</span><p>{lead.notes || 'No notes added yet.'}</p></div></div>}
    {tab === 'Activities' && <div className="detail-record-list">{history.map((item) => <div key={item.id}><b>{item.title}</b><p>{item.detail || 'No additional details.'}</p><small>{dateLabel(item.createdAt)}</small></div>)}{!history.length && <p className="empty-inline">No activity yet.</p>}</div>}
    {tab === 'Calls' && <div className="detail-record-list">{calls.map((item) => <div key={item.id}><b>{item.outcome} · {item.contactMethod || 'Phone'}</b><p>{item.notes || 'No call notes.'}</p><small>{dateLabel(item.createdAt)}</small></div>)}{!calls.length && <p className="empty-inline">No calls logged for this lead.</p>}</div>}
    {tab === 'Follow-ups' && <div className="lead-followups-panel"><div className="lead-followups-toolbar"><span>{tasks.length ? `${tasks.length} linked follow-up${tasks.length === 1 ? '' : 's'}` : 'Keep this lead moving with a clear next step.'}</span>{!lead.archived ? <Link className="button button-primary" to={'/follow-ups?new=1&lead=' + encodeURIComponent(lead.id)}><Plus size={14} /> Schedule follow-up</Link> : <span className="neutral-badge">Restore this lead to schedule a follow-up</span>}</div><div className="detail-record-list">{tasks.map((item) => <div key={item.id}><b>{item.type} · {item.status}</b><p>{item.notes || 'No task notes.'}</p><small>{dateLabel(item.dueAt)}</small></div>)}{!tasks.length && <p className="empty-inline">No follow-ups scheduled for this lead yet.</p>}</div></div>}
    {tab === 'Opportunities' && <div className="detail-record-list">{opps.map((item) => <div key={item.id}><b>{item.name} · {money(item.amount, item.currency)}</b><p>{item.stage} · {item.probability}% probability</p><small>Expected close: {item.expectedClose ? dateLabel(item.expectedClose) : 'Not set'}</small></div>)}{!opps.length && <p className="empty-inline">No opportunities linked.</p>}</div>}
    {tab === 'History' && <div className="detail-record-list">{[...(lead.changeHistory || []).map((item) => ({ at: item.at, by: item.by, title: 'Lead details updated', detail: item.changes.map((change) => change.field + ': ' + (change.from || '—') + ' → ' + (change.to || '—')).join(' · ') })), ...lead.stageHistory.map((item) => ({ at: item.at, by: item.by, title: 'Stage changed to ' + item.status, detail: 'Stage updated' }))].sort((a,b) => Date.parse(b.at)-Date.parse(a.at)).map((item, index) => <div key={item.at + index}><b>{item.title}</b><p>{item.detail} · by {item.by}</p><small>{dateLabel(item.at)}</small></div>)}</div>}
  </Modal>;
}

type ImportApiIssue = { rowNumber: number; error: string };
type ImportApiResult = { total: number; added: number; duplicates: number; failed: number; errors: ImportApiIssue[]; duplicateRows: ImportApiIssue[]; warnings: ImportApiIssue[]; leadCount: number };

function formatImportSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LeadImportWizard({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const { data, toast } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [parsedFile, setParsedFile] = useState<ParsedLeadFile | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [previewPage, setPreviewPage] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportApiResult | null>(null);
  const sheet = useMemo(() => parsedFile?.sheets.find((item) => item.name === sheetName) || null, [parsedFile, sheetName]);
  const mappedRows = useMemo(() => sheet ? validateImportRows(sheet, mapping) : [], [sheet, mapping]);
  const duplicates = useMemo(() => findImportDuplicates(mappedRows, data?.leads || []), [mappedRows, data?.leads]);
  const rows = useMemo(() => mappedRows.map((item) => ({ ...item, duplicate: duplicates.get(item.rowNumber) || '' })), [mappedRows, duplicates]);
  const importableRows = rows.filter((item) => item.lead && !item.duplicate);
  const selectedImportRows = importableRows.filter((item) => selectedRows.has(item.rowNumber));
  const warningCount = rows.filter((item) => item.errors.length > 0).length;
  const duplicateCount = rows.filter((item) => Boolean(item.duplicate)).length;
  const pageCount = Math.max(1, Math.ceil(rows.length / 10));
  const currentPageRows = rows.slice(previewPage * 10, previewPage * 10 + 10);
  const mappedIndexes = new Set(Object.values(mapping).filter((index): index is number => index !== undefined));
  const unmappedHeaders = sheet?.headers.filter((_, index) => !mappedIndexes.has(index)) || [];
  const requiredUnmapped = IMPORT_FIELDS.filter((field) => field.required && mapping[field.key] === undefined);

  const loadFile = async (file?: File) => {
    if (!file) return;
    setIsParsing(true); setError(''); setResult(null);
    try {
      const parsed = await parseLeadFile(file);
      const firstSheet = parsed.sheets[0]!;
      setParsedFile(parsed); setSheetName(firstSheet.name); setMapping(autoMapColumns(firstSheet.headers));
      setSelectedRows(new Set(firstSheet.rows.map((row) => row.rowNumber))); setPreviewPage(0); setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this file. Choose a valid CSV or Excel workbook.');
    } finally { setIsParsing(false); }
  };

  const chooseSheet = (name: string) => {
    const nextSheet = parsedFile?.sheets.find((item) => item.name === name);
    if (!nextSheet) return;
    setSheetName(name); setMapping(autoMapColumns(nextSheet.headers)); setSelectedRows(new Set(nextSheet.rows.map((row) => row.rowNumber))); setPreviewPage(0);
  };

  const updateMapping = (field: keyof ColumnMapping, value: string) => {
    setMapping((current) => ({ ...current, [field]: value === '' ? undefined : Number(value) }));
  };

  const toggleRow = (rowNumber: number) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
      return next;
    });
  };

  const toggleAllReady = () => {
    const allSelected = importableRows.length > 0 && importableRows.every((item) => selectedRows.has(item.rowNumber));
    setSelectedRows((current) => {
      const next = new Set(current);
      for (const item of importableRows) {
        if (allSelected) next.delete(item.rowNumber); else next.add(item.rowNumber);
      }
      return next;
    });
  };

  const downloadIssues = () => {
    if (!sheet) return;
    const issueMap = new Map<number, string>();
    for (const row of rows) {
      if (row.errors.length) issueMap.set(row.rowNumber, row.errors.join('; '));
      else if (row.duplicate) issueMap.set(row.rowNumber, row.duplicate);
    }
    for (const issue of [...(result?.errors || []), ...(result?.duplicateRows || []), ...(result?.warnings || [])]) issueMap.set(issue.rowNumber, issue.error);
    const csvRows = [
      ['Original row', 'Reason', ...sheet.headers],
      ...[...issueMap.entries()].sort((a, b) => a[0] - b[0]).map(([rowNumber, reason]) => [String(rowNumber), reason, ...(sheet.rows.find((item) => item.rowNumber === rowNumber)?.values || [])]),
    ];
    downloadCsv('cgbs-lead-import-errors.csv', csvRows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n'));
  };

  const runImport = async () => {
    if (importLock.current || !selectedImportRows.length) return;
    importLock.current = true; setIsImporting(true); setError('');
    try {
      const imported = await request<ImportApiResult>('/import', {
        method: 'POST',
        body: JSON.stringify({ rows: selectedImportRows.flatMap((item) => item.lead ? [{ rowNumber: item.rowNumber, lead: item.lead, warnings: item.errors }] : []) }),
      });
      setResult(imported); setStep(4);
      try {
        await onImported();
        toast(`Imported ${imported.added} leads; skipped ${imported.duplicates + duplicateCount} duplicates; ${imported.warnings.length} with warnings.`);
      } catch {
        toast('Leads were imported, but the list could not refresh. Reopen Leads to reload them.', 'error');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed. Your leads were not confirmed as saved.');
    } finally { importLock.current = false; setIsImporting(false); }
  };

  const valueFor = (row: ValidatedImportRow, field: keyof ColumnMapping) => {
    const index = mapping[field];
    return index === undefined ? '—' : row.values[index] || '—';
  };
  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]);
  };

  const subtitle = step === 1 ? 'Select a CSV or Excel workbook.' : step === 2 ? 'Choose a worksheet and confirm how its columns map to leads.' : step === 3 ? 'Review warnings, duplicates, and the rows to import.' : 'Import results from the selected worksheet.';
  const finalDuplicates = duplicateCount + (result?.duplicates || 0);
  const finalWarnings = result?.warnings?.length ?? warningCount;

  return <Modal title="Bulk Upload Leads" sub={subtitle} onClose={() => { if (!isImporting) onClose(); }} wide>
    <div className="import-wizard">
      <div className="import-steps" aria-label="Bulk upload steps">
        {['Select file', 'Map columns', 'Review', 'Results'].map((label, index) => <div key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''}><b>{index + 1}</b><span>{label}</span></div>)}
      </div>
      {step === 1 && <section className="import-drop-zone" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} data-dragging={dragging}>
        <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" className="import-file-input" aria-label="Select CSV or Excel file" onChange={(event) => { void loadFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        <span className="import-drop-icon"><ArrowUpFromLine size={23} /></span><b>{isParsing ? 'Reading file…' : 'Drag and drop your spreadsheet here'}</b><small>Supports .xlsx, .xls, and .csv files up to 10 MB. Spreadsheet formulas are ignored.</small>
        <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={isParsing}>{isParsing ? 'Reading…' : 'Choose file'}</Button>
        {error && <p className="import-error" role="alert">{error}</p>}
      </section>}

      {step === 2 && parsedFile && sheet && <>
        <div className="import-file-summary"><div><b>{parsedFile.fileName}</b><small>{formatImportSize(parsedFile.fileSize)} · {sheet.rows.length} data rows in “{sheet.name}”</small></div>{parsedFile.sheets.length > 1 && <label>Worksheet<select value={sheetName} onChange={(event) => chooseSheet(event.target.value)}>{parsedFile.sheets.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.rows.length} rows</option>)}</select></label>}<Button variant="ghost" onClick={() => { setStep(1); setParsedFile(null); setError(''); }}>Choose another file</Button></div>
        <div className="import-mapping-section"><div className="card-title-row"><div><h3>Map spreadsheet columns</h3><p>We matched common header names automatically. Choose a column manually when needed.</p></div></div>
          <div className="import-mapping-grid">{IMPORT_FIELDS.map((field) => <label key={field.key}>{field.label}{field.required && <b className="required-mark"> *</b>}<select aria-label={`Map ${field.label}`} value={mapping[field.key] ?? ''} onChange={(event) => updateMapping(field.key, event.target.value)}><option value="">Not mapped</option>{sheet.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>)}</div>
          {requiredUnmapped.length > 0 && <p className="import-error">Required columns not mapped: {requiredUnmapped.map((field) => field.label).join(', ')}. Unmapped fields will remain blank or use safe defaults; the rows can still be imported.</p>}
          {unmappedHeaders.length > 0 && <p className="import-unmapped"><b>Unmapped columns:</b> {unmappedHeaders.join(', ')}</p>}
          <div className="import-networth-note">Company net worth is stored separately from estimated deal value. A net-worth column will never populate deal revenue.</div>
        </div>
        <div className="import-preview-heading"><div><b>Data preview</b><small>First 10 rows are shown at a time; move through the pages to review the full worksheet.</small></div><span>{sheet.rows.length} rows detected</span></div>
        <div className="table-scroll import-table"><table className="data-table"><thead><tr><th>Row</th><th>Full name</th><th>Company</th><th>Role</th><th>Email</th><th>Company net worth</th></tr></thead><tbody>{currentPageRows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{valueFor(row, 'name')}</td><td>{valueFor(row, 'company')}</td><td>{valueFor(row, 'role')}</td><td>{valueFor(row, 'email')}</td><td>{valueFor(row, 'companyNetWorth')}</td></tr>)}</tbody></table></div>
        <div className="import-pagination"><span>Rows {Math.min(previewPage * 10 + 1, rows.length)}–{Math.min(previewPage * 10 + 10, rows.length)} of {rows.length}</span><div><Button variant="ghost" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</Button><Button variant="ghost" onClick={() => setPreviewPage((page) => Math.min(pageCount - 1, page + 1))} disabled={previewPage >= pageCount - 1}>Next</Button></div></div>
        {error && <p className="import-error" role="alert">{error}</p>}
        <div className="modal-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { setStep(3); setPreviewPage(0); }}>Review rows</Button></div>
      </>}

      {step === 3 && sheet && <>
        <div className="import-count-grid"><div><b>{sheet.rows.length}</b><span>Detected</span></div><div><b>{importableRows.length}</b><span>Ready to import</span></div><div><b>{warningCount}</b><span>Warnings · import</span></div><div><b>{duplicateCount}</b><span>Duplicates · skip</span></div></div>
        <div className="import-review-toolbar"><span>Warnings do not block import. Unsafe URLs and invalid numbers use safe defaults, with details saved in Notes. Duplicates are skipped and existing leads are never overwritten.</span><div><Button variant="ghost" onClick={toggleAllReady}>{importableRows.length > 0 && importableRows.every((item) => selectedRows.has(item.rowNumber)) ? 'Clear selection' : 'Select all importable'}</Button>{(warningCount + duplicateCount > 0) && <Button variant="ghost" onClick={downloadIssues}><ArrowDownToLine size={14} /> Download issue report</Button>}</div></div>
        <div className="table-scroll import-table"><table className="data-table import-review-table"><thead><tr><th>Select</th><th>Row</th><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Review</th></tr></thead><tbody>{currentPageRows.map((row) => <tr key={row.rowNumber}><td><input type="checkbox" checked={selectedRows.has(row.rowNumber)} disabled={!row.lead || Boolean(row.duplicate)} onChange={() => toggleRow(row.rowNumber)} aria-label={`Select source row ${row.rowNumber}`} /></td><td>{row.rowNumber}</td><td>{valueFor(row, 'name')}</td><td>{valueFor(row, 'company')}</td><td>{valueFor(row, 'email')}</td><td>{valueFor(row, 'phone')}</td><td>{row.duplicate ? <span className="import-row-duplicate">{row.duplicate}</span> : row.errors.length ? <span className="import-row-warning" title={row.errors.join('; ')}>{selectedRows.has(row.rowNumber) ? 'Warning · will import' : 'Warning · not selected'}</span> : selectedRows.has(row.rowNumber) ? <span className="import-row-ready">Ready</span> : <span className="import-row-skipped">Not selected</span>}</td></tr>)}</tbody></table></div>
        <div className="import-pagination"><span>Rows {Math.min(previewPage * 10 + 1, rows.length)}–{Math.min(previewPage * 10 + 10, rows.length)} of {rows.length}</span><div><Button variant="ghost" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</Button><Button variant="ghost" onClick={() => setPreviewPage((page) => Math.min(pageCount - 1, page + 1))} disabled={previewPage >= pageCount - 1}>Next</Button></div></div>
        {error && <p className="import-error" role="alert">{error}</p>}
        <div className="modal-actions"><Button variant="ghost" onClick={() => setStep(2)} disabled={isImporting}>Back to mapping</Button><Button variant="ghost" onClick={onClose} disabled={isImporting}>Cancel</Button><Button variant="primary" onClick={() => void runImport()} disabled={isImporting || selectedImportRows.length === 0}>{isImporting ? 'Importing…' : `Import ${selectedImportRows.length} selected leads`}</Button></div>
      </>}

      {step === 4 && result && <>
        <div className="import-success" role="status"><b>Import finished</b><span>Import results are ready.</span></div>
        <div className="summary-strip import-result-summary"><div><span>Rows detected</span><b>{sheet?.rows.length || result.total}</b></div><div><span>Successfully imported</span><b>{result.added}</b></div><div><span>Duplicates skipped</span><b>{finalDuplicates}</b></div><div><span>Rows with warnings</span><b>{finalWarnings}</b></div></div>
        <p className="import-result-note">Updated records: 0. Existing leads are not updated. Unselected rows were left unchanged; warnings are saved in imported lead Notes.</p>
        {(finalWarnings + finalDuplicates > 0 || (result?.failed || 0) > 0) && <Button variant="default" onClick={downloadIssues}><ArrowDownToLine size={15} /> Download CSV with row warnings</Button>}
        <div className="modal-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </>}
    </div>
  </Modal>;
}
export function LeadsPage() {
  const { data, refresh, toast } = useApp();
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState('');
  const [industry, setIndustry] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [followup, setFollowup] = useState('');
  const [connectionCategory, setConnectionCategory] = useState<ConnectionCategory>('All Leads');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('createdAt');
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<Lead | 'new' | null>(null);
  const [details, setDetails] = useState<Lead | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    const handler = () => setEditing('new');
    window.addEventListener('cgbs:add-lead', handler);
    return () => window.removeEventListener('cgbs:add-lead', handler);
  }, []);
  useEffect(() => {
    if (searchParams.get('add') === '1') setEditing('new');
    if (searchParams.get('import') === '1') setImportOpen(true);
    const requestedLead = searchParams.get('open');
    if (requestedLead && data) { const lead = data.leads.find((item) => item.id === requestedLead); if (lead) setDetails(lead); }
    if (searchParams.has('add') || searchParams.has('import') || (requestedLead && data)) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, data]);
  const categoryCounts = useMemo(() => { const counts = Object.fromEntries(connectionCategories.map((item) => [item, 0])) as Record<ConnectionCategory, number>; for (const lead of data?.leads || []) if (lead.archived === archived) { counts['All Leads']++; const category = categorizeLead(lead, data?.calls || [], data?.tasks || []); if (category) counts[category]++; } return counts; }, [data, archived]);
  const leads = useMemo(() => (data?.leads || []).filter((lead) =>
    lead.archived === archived &&
    (connectionCategory === 'All Leads' || categorizeLead(lead, data?.calls || [], data?.tasks || []) === connectionCategory) &&
    (!query || [lead.id, lead.name, lead.company, lead.email, lead.phone, lead.priority, lead.status].some((value) => value.toLowerCase().includes(query.toLowerCase()))) &&
    (!stage || lead.status === stage) && (!priority || lead.priority === priority) &&
    (!industry || lead.industry === industry) && (!source || lead.source === source) && (!owner || lead.assignedTo === owner) &&
    (!followup || (followup === 'No date' ? !lead.nextFollowUp : followup === 'Overdue' ? Boolean(lead.nextFollowUp && Date.parse(lead.nextFollowUp) < Date.now()) : followup === 'Today' ? Boolean(lead.nextFollowUp && isSameDay(new Date(lead.nextFollowUp), new Date())) : Boolean(lead.nextFollowUp && Date.parse(lead.nextFollowUp) >= Date.now())))
  ).sort((a, b) => {
    if (sort === 'revenue') return b.revenue - a.revenue;
    if (sort === 'networth') return b.companyNetWorth - a.companyNetWorth;
    if (sort === 'progression') return b.progression - a.progression;
    if (sort === 'company') return a.company.localeCompare(b.company);
    if (sort === 'priority') return ['Critical','High','Medium','Low'].indexOf(a.priority) - ['Critical','High','Medium','Low'].indexOf(b.priority);
    if (sort === 'followup') return Date.parse(a.nextFollowUp || '2999-01-01') - Date.parse(b.nextFollowUp || '2999-01-01');
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }), [data, archived, query, stage, priority, industry, source, owner, followup, sort, connectionCategory]);
  useEffect(() => { setPage(1); }, [query, stage, priority, industry, source, owner, followup, archived, sort, connectionCategory]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(leads.length / pageSize));
  const visibleLeads = leads.slice((page - 1) * pageSize, page * pageSize);
  const toggle = (id: string) => setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  const exportRows = () => {
    const cols = ['id','name','company','companyLogo','companyNetWorth','role','email','phone','industry','source','status','priority','revenue','currency','progression','probability','assignedTo'];
    const lines = [cols.join(','), ...leads.map((lead) => cols.map((col) => escapeCsvCell(lead[col as keyof Lead])).join(','))].join('\r\n');
    downloadCsv('cgbs-leads.csv', lines); toast('Filtered leads exported as CSV.');
  };
  const bulkArchive = async () => {
    try {
      await Promise.all(selected.map((id) => request('/leads/' + id + '/archive', { method: 'POST', body: JSON.stringify({ archived: !archived }) })));
      setSelected([]); await refresh(); toast(selected.length + ' leads ' + (archived ? 'restored.' : 'archived.'));
    } catch (error) { toast(error instanceof Error ? error.message : 'Bulk action failed.', 'error'); }
  };
  const deleteLead = async (lead: Lead) => {
    if (!window.confirm('Permanently delete ' + lead.name + ' and its linked activity?')) return;
    try { await request('/leads/' + lead.id, { method: 'DELETE' }); await refresh(); toast('Lead deleted.'); setDetails(null); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not delete lead.', 'error'); }
  };
  const statusClass = (status: string) => 'status-badge status-' + status.replace(/\s/g, '-').toLowerCase();
  return <div className="page-stack">
    <PageHeading eyebrow="Your pipeline starts here" title="Leads" description="Keep every customer conversation moving forward." action={<><Button onClick={() => setImportOpen(true)}><ArrowUpFromLine size={16} /> Bulk Upload</Button><Button onClick={exportRows}><ArrowDownToLine size={16} /> Export</Button><Button variant="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add lead</Button></>} />
    <div className="lead-category-tabs" role="tablist" aria-label="Lead connection categories">{connectionCategories.map((item) => <button key={item} role="tab" aria-selected={connectionCategory === item} className={connectionCategory === item ? 'selected' : ''} onClick={() => { setConnectionCategory(item); setArchived(false); }}>{item}<b>{categoryCounts[item]}</b></button>)}</div>
    <Card className="table-card">
      <div className="table-toolbar lead-filter-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search lead ID, name, company, email or phone" /><kbd>⌘ K</kbd></div><select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{leadStatuses.map((x) => <option key={x}>{x}</option>)}</select><select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">All priorities</option>{priorities.map((x) => <option key={x}>{x}</option>)}</select><select aria-label="Filter by industry" value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">All industries</option>{[...new Set((data?.leads || []).map((x) => x.industry))].map((x) => <option key={x}>{x}</option>)}</select><select aria-label="Filter by source" value={source} onChange={(e) => setSource(e.target.value)}><option value="">All sources</option>{[...new Set((data?.leads || []).map((x) => x.source))].map((x) => <option key={x}>{x}</option>)}</select><select aria-label="Filter by owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{[...new Set((data?.leads || []).map((x) => x.assignedTo))].map((x) => <option key={x}>{x}</option>)}</select><select aria-label="Filter by follow-up" value={followup} onChange={(e) => setFollowup(e.target.value)}><option value="">All follow-ups</option><option>Overdue</option><option>Today</option><option>Upcoming</option><option>No date</option></select><select aria-label="Sort leads" value={sort} onChange={(e) => setSort(e.target.value)}><option value="createdAt">Newest first</option><option value="company">Company A–Z</option><option value="priority">Priority</option><option value="networth">Net worth: high first</option><option value="revenue">Deal value: high first</option><option value="progression">Progress: high first</option><option value="followup">Next follow-up</option></select><button className="button button-ghost" onClick={() => { setQuery(''); setStage(''); setPriority(''); setIndustry(''); setSource(''); setOwner(''); setFollowup(''); setConnectionCategory('All Leads'); setSort('createdAt'); }}>Clear filters</button></div>
      <div className="table-context"><div className="segmented"><button className={!archived ? 'on' : ''} onClick={() => setArchived(false)}>Active leads <span>{data?.leads.filter((x) => !x.archived).length || 0}</span></button><button className={archived ? 'on' : ''} onClick={() => setArchived(true)}>Archived</button></div>{selected.length > 0 && <div className="bulk-actions"><span>{selected.length} selected</span><Button onClick={() => void bulkArchive()}><Archive size={15} />{archived ? 'Restore' : 'Archive'}</Button><button className="icon-button" onClick={() => setSelected([])} aria-label="Clear selection"><X size={15} /></button></div>}</div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th><input type="checkbox" checked={Boolean(visibleLeads.length && visibleLeads.every((item) => selected.includes(item.id)))} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...visibleLeads.map((x) => x.id)])] : selected.filter((id) => !visibleLeads.some((item) => item.id === id)))} aria-label="Select page leads" /></th><th>Lead</th><th>Company / role</th><th>Stage</th><th>Connection</th><th>Priority</th><th>Progress</th><th>Deal value</th><th>Company net worth</th><th>Next follow-up</th><th></th></tr></thead>
        <tbody>{visibleLeads.map((lead) => <tr key={lead.id} onClick={() => setDetails(lead)} className="lead-row"><td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggle(lead.id)} aria-label={'Select ' + lead.name} /></td><td><div className="lead-name-cell"><CompanyLogo src={lead.companyLogo} company={lead.company} /><div><strong>{lead.name}</strong><small>{lead.email || lead.phone || 'No contact detail'}</small></div></div></td><td><strong>{lead.company}</strong><small>{lead.role || lead.industry}</small></td><td><span className={statusClass(lead.status)}>{lead.status}</span></td><td><span className="neutral-badge">{categorizeLead(lead, data?.calls || [], data?.tasks || []) || 'No attempts'}</span></td><td><span className={'priority-label priority-' + lead.priority.toLowerCase()}><i className={'priority-dot ' + lead.priority.toLowerCase()} />{lead.priority}</span></td><td><div className="table-progress"><span><i style={{ width: lead.progression + '%' }} /></span><b>{lead.progression}%</b></div></td><td className="amount-cell">{money(lead.revenue, lead.currency)}</td><td className="amount-cell">{money(lead.companyNetWorth || 0, lead.currency)}</td><td className="date-cell">{dateLabel(lead.nextFollowUp)}</td><td onClick={(e) => e.stopPropagation()}><div className="row-actions"><button className="icon-button" title="Edit lead" onClick={() => setEditing(lead)}><Edit3 size={15} /></button><button className="icon-button" title={archived ? 'Restore lead' : 'Archive lead'} onClick={() => void request('/leads/' + lead.id + '/archive', { method: 'POST', body: JSON.stringify({ archived: !archived }) }).then(refresh).then(() => toast(archived ? 'Lead restored.' : 'Lead archived.'))}><Archive size={15} /></button><button className="icon-button danger-hover" title="Delete lead" onClick={() => void deleteLead(lead)}><Trash2 size={15} /></button></div></td></tr>)}
        {!leads.length && <tr><td colSpan={11}><div className="empty-table"><span><UsersRound size={24} /></span><b>{query || stage || priority || industry || source || owner || followup ? 'No leads match these filters' : 'Your lead list is ready'}</b><small>Add a lead or import a spreadsheet to get started.</small><Button variant="primary" onClick={() => setEditing('new')}><Plus size={16} /> Add your first lead</Button></div></td></tr>}</tbody></table></div>
      <div className="table-footer"><span>Showing <b>{visibleLeads.length}</b> of {leads.length} matching leads</span><span>Page {page} of {pageCount} <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button><button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>→</button></span></div>
    </Card>
    {editing && <LeadEditor lead={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    {details && <LeadDetails lead={details} onClose={() => setDetails(null)} onEdit={() => { setEditing(details); setDetails(null); }} />}
    {importOpen && <LeadImportWizard onClose={() => setImportOpen(false)} onImported={async () => {
      setArchived(false); setPage(1); setQuery(''); setStage(''); setPriority(''); setIndustry(''); setSource(''); setOwner(''); setFollowup(''); await refresh();
    }} />}
  </div>;
}


















