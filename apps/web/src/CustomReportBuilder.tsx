import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Bootstrap } from './api';
import { Button, Card } from './layout';
import { applyReportSelection, buildReportRows, defaultFieldsForReport, reportCsv, reportFields, reportMatrix, reportTypes, selectReportFields, type ReportFilters, type ReportType } from './reportBuilder';
import { connectionCategories } from './leadCategories';

const initialFilters = (): ReportFilters => ({ startDate: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), category: '', priority: '', assignedTo: '', source: '', opportunityStage: '', followUpStatus: '' });
function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export function CustomReportBuilder({ data, toast }: { data: Bootstrap; toast: (message: string, kind?: 'success' | 'error') => void }) {
  const [type, setType] = useState<ReportType>('Leads');
  const [filters, setFilters] = useState<ReportFilters>(initialFilters);
  const [fields, setFields] = useState<string[]>(() => defaultFieldsForReport('Leads'));
  const [exportAll, setExportAll] = useState(true);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const allFields = useMemo(() => reportFields.filter((field) => field.types.includes(type)), [type]);
  const rows = useMemo(() => buildReportRows(data, type, filters), [data, type, filters]);
  const fieldConfig = selectReportFields(type, fields);
  const exportRows = applyReportSelection(rows, selectedRows, exportAll);
  const previewRows = rows.slice(previewPage * 12, previewPage * 12 + 12);
  const previewPageCount = Math.max(1, Math.ceil(rows.length / 12));
  useEffect(() => { setFields(defaultFieldsForReport(type)); setSelectedRows([]); setExportAll(true); setPreviewPage(0); }, [type]);
  useEffect(() => { setSelectedRows([]); setExportAll(true); setPreviewPage(0); }, [filters, data]);
  const filename = `cgbs-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const toggleField = (key: string) => setFields((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const moveField = (index: number, delta: number) => setFields((current) => { const next = [...current]; const target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target]!, next[index]!]; return next; });
  const selectVisibleRows = (select: boolean) => setSelectedRows((current) => { const next = new Set(current); for (const row of previewRows) select ? next.add(row.id) : next.delete(row.id); return [...next]; });
  const fieldsForExport = fieldConfig.map(({ key, label }) => ({ key, label }));
  const canExport = fieldsForExport.length > 0 && exportRows.length > 0;
  const makeTable = () => {
    const title = `CGBS ${type} Report`;
    const period = `${filters.startDate || 'All dates'} to ${filters.endDate || 'Present'}`;
    return <div id="report-print-area" className="report-print-area"><h1>{title}</h1><p>{period} · ${exportRows.length} records</p><table><thead><tr>{fieldsForExport.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{exportRows.map((row) => <tr key={row.id}>{fieldsForExport.map((field) => <td key={field.key}>{String(row.values[field.key] ?? '')}</td>)}</tr>)}</tbody></table><footer>Canopus Global Business Services · Generated {new Date().toLocaleString()}</footer></div>;
  };
  const printReport = () => { if (!canExport) { toast(fields.length ? 'There are no records to print with these filters.' : 'Select at least one report field.', 'error'); return; } window.print(); toast('Print view is ready. Choose a printer or Save as PDF.'); };
  const exportCsv = () => { if (!canExport) { toast(fields.length ? 'There are no records to export with these filters.' : 'Select at least one report field.', 'error'); return; } downloadCsv(filename + '.csv', reportCsv(exportRows, fieldsForExport)); toast(`${exportRows.length} records exported as CSV.`); };
  const exportXlsx = () => {
    if (!canExport) { toast(fields.length ? 'There are no records to export with these filters.' : 'Select at least one report field.', 'error'); return; }
    const matrix = reportMatrix(exportRows, fieldsForExport);
    const sheet = XLSX.utils.aoa_to_sheet(matrix); sheet['!cols'] = fieldsForExport.map((field) => ({ wch: Math.min(34, Math.max(14, field.label.length + 3)) }));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, type.slice(0, 31)); XLSX.writeFile(book, filename + '.xlsx'); toast(`${exportRows.length} records exported as Excel.`);
  };
  const setFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  return <Card className="custom-report-builder">
    <div className="card-title-row"><div><h2>Customize Report / Select What to Export</h2><p>Choose a report, filter the saved records, select the fields, then preview the exact output.</p></div><span className="neutral-badge">{rows.length} matching · {exportRows.length} selected</span></div>
    <div className="report-builder-filters">
      <label>Report type<select value={type} onChange={(event) => setType(event.target.value as ReportType)}>{reportTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>From<input type="date" value={filters.startDate} onChange={(event) => setFilter('startDate', event.target.value)} /></label>
      <label>To<input type="date" value={filters.endDate} onChange={(event) => setFilter('endDate', event.target.value)} /></label>
      <label>Connection category<select value={filters.category} onChange={(event) => setFilter('category', event.target.value as ReportFilters['category'])}><option value="">All categories</option>{connectionCategories.filter((item) => item !== 'All Leads').map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Priority<select value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)}><option value="">All priorities</option>{['Low','Medium','High','Critical'].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Assigned employee / team<select value={filters.assignedTo} onChange={(event) => setFilter('assignedTo', event.target.value)}><option value="">All permitted owners</option>{[...new Set([...data.leads.map((item) => item.assignedTo), ...data.opportunities.map((item) => item.owner)])].sort().map((item) => <option key={item}>{item}</option>)}{type === 'Sales Performance' && <option>Team</option>}</select></label>
      <label>Lead source<select value={filters.source} onChange={(event) => setFilter('source', event.target.value)}><option value="">All sources</option>{[...new Set(data.leads.map((item) => item.source))].sort().map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Opportunity stage<select value={filters.opportunityStage} onChange={(event) => setFilter('opportunityStage', event.target.value)}><option value="">All stages</option>{['Qualification','Discovery','Proposal','Negotiation','Closed Won','Closed Lost'].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Follow-up status<select value={filters.followUpStatus} onChange={(event) => setFilter('followUpStatus', event.target.value)}><option value="">All follow-ups</option>{['Due','Completed','Cancelled'].map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    <div className="report-choice-toolbar"><div><b>Fields to include</b><small>{fieldConfig.length} selected · choose output column order below</small></div><div><Button variant="ghost" onClick={() => setFields(allFields.map((field) => field.key))}>Select all</Button><Button variant="ghost" onClick={() => setFields([])}>Deselect all</Button><Button variant="ghost" onClick={() => setFields(defaultFieldsForReport(type))}>Restore defaults</Button></div></div>
    <div className="report-fields-grid">{allFields.map((field) => <label key={field.key}><input type="checkbox" checked={fields.includes(field.key)} onChange={() => toggleField(field.key)} />{field.label}</label>)}</div>
    {fieldConfig.length > 0 && <div className="report-order-list"><b>Selected column order</b>{fieldConfig.map((field, index) => <div key={field.key}><span>{index + 1}. {field.label}</span><button type="button" title="Move up" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={() => moveField(index, -1)}><ArrowUp size={14} /></button><button type="button" title="Move down" aria-label={`Move ${field.label} down`} disabled={index === fieldConfig.length - 1} onClick={() => moveField(index, 1)}><ArrowDown size={14} /></button></div>)}</div>}
    <div className="report-selection"><label><input type="radio" checked={exportAll} onChange={() => setExportAll(true)} /> Export all {rows.length} matching records</label><label><input type="radio" checked={!exportAll} onChange={() => { setExportAll(false); if (!selectedRows.length) setSelectedRows(rows.slice(0, 100).map((row) => row.id)); }} /> Export selected rows ({selectedRows.length})</label><Button variant="ghost" onClick={() => selectVisibleRows(true)} disabled={!rows.length}>Select this page</Button><Button variant="ghost" onClick={() => selectVisibleRows(false)} disabled={!selectedRows.length}>Deselect this page</Button></div>
    {rows.length === 0 ? <div className="empty-inline">No saved records match the selected report filters.</div> : <div className="table-scroll report-preview-table"><table className="data-table"><thead><tr>{!exportAll && <th>Select</th>}{fieldsForExport.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{previewRows.map((row) => <tr key={row.id}>{!exportAll && <td><input type="checkbox" checked={selectedRows.includes(row.id)} onChange={() => setSelectedRows((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} aria-label={'Select report row ' + row.id} /></td>}{fieldsForExport.map((field) => <td key={field.key}>{String(row.values[field.key] ?? '—')}</td>)}</tr>)}</tbody></table>{rows.length > 12 && <div className="report-preview-pagination"><span>Page {previewPage + 1} of {previewPageCount} · {rows.length} matching records</span><div><Button variant="ghost" disabled={previewPage===0} onClick={()=>setPreviewPage(value=>Math.max(0,value-1))}>Previous</Button><Button variant="ghost" disabled={previewPage>=previewPageCount-1} onClick={()=>setPreviewPage(value=>Math.min(previewPageCount-1,value+1))}>Next</Button></div></div>}</div>}
    <div className="report-export-actions"><span>{fieldsForExport.length} columns · {exportRows.length} records · {filters.startDate || 'Any start'} — {filters.endDate || 'Any end'}</span><div><Button onClick={printReport} disabled={!canExport}><Printer size={15} /> Print / PDF</Button><Button onClick={exportCsv} disabled={!canExport}><Download size={15} /> CSV</Button><Button variant="primary" onClick={exportXlsx} disabled={!canExport}><Download size={15} /> Excel</Button></div></div>
    {makeTable()}
  </Card>;
}
