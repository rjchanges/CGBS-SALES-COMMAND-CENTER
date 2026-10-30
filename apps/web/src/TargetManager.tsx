import { useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';
import { Clock3, Edit3, History, Plus, Target, ToggleLeft, ToggleRight } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SalesTarget, TargetAchievement, TargetMetric, TargetOwnerType, TargetPeriod } from '../../../packages/shared/src/index';
import { Button, Modal } from './layout';
import { request } from './api';
import { useApp } from './context';

export const TARGET_METRICS: { key: TargetMetric; label: string; unit: string }[] = [
  { key: 'calls', label: 'Calls', unit: 'calls' },
  { key: 'new_leads', label: 'New leads', unit: 'leads' },
  { key: 'followups_completed', label: 'Follow-ups completed', unit: 'follow-ups' },
  { key: 'meetings_scheduled', label: 'Meetings scheduled', unit: 'meetings' },
  { key: 'meetings_completed', label: 'Meetings completed', unit: 'meetings' },
  { key: 'qualified_leads', label: 'Qualified leads', unit: 'leads' },
  { key: 'proposals_sent', label: 'Proposals sent', unit: 'proposals' },
  { key: 'revenue', label: 'Closed Won revenue', unit: '₹' },
  { key: 'deals_closed', label: 'Deals closed', unit: 'deals' },
];
const periodOptions: { key: TargetPeriod; label: string }[] = [
  { key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' }, { key: 'quarterly', label: 'Quarterly' }, { key: 'custom', label: 'Custom range' },
];
const todayKey = () => format(new Date(), 'yyyy-MM-dd');
const periodLabel = (period: TargetPeriod) => periodOptions.find((item) => item.key === period)?.label || period;
const metricLabel = (metric: TargetMetric) => TARGET_METRICS.find((item) => item.key === metric)?.label || metric;
const money = (value: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0, notation: 'compact', compactDisplay: 'short' }).format(value);
function statusClass(status: TargetAchievement['status']) { return status === 'Achieved' ? 'achieved' : status === 'Behind Target' ? 'behind' : 'on-track'; }
function targetOwner(target: SalesTarget) { return target.ownerType === 'team' ? 'Team' : target.ownerType === 'employee' ? target.ownerName : 'Me'; }

export function TargetManager() {
  const { data, refresh, toast } = useApp();
  const [editing, setEditing] = useState<SalesTarget | 'new' | null>(null);
  const [showDisabled, setShowDisabled] = useState(true);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const targets = data?.targets || [];
  const performance = data?.targetPerformance || [];
  const byId = useMemo(() => new Map(performance.map((item) => [item.target.id, item])), [performance]);
  const members = useMemo(() => [...new Set([
    data?.user.name || '', ...(data?.calls.map((item) => item.createdBy) || []), ...(data?.leads.map((item) => item.assignedTo) || []),
    ...(data?.tasks.map((item) => item.assignedTo) || []), ...(data?.opportunities.map((item) => item.owner) || []),
  ].filter(Boolean))], [data]);
  const visible = targets.filter((target) => showDisabled || target.enabled);
  if (!data) return null;

  const openNew = () => setEditing('new');
  const toggleEnabled = async (target: SalesTarget) => {
    try {
      await request('/targets/' + target.id, { method: 'PATCH', body: JSON.stringify({ enabled: !target.enabled }) });
      await refresh(); toast(target.enabled ? 'Target deactivated; its history is preserved.' : 'Target reactivated.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not update target.', 'error'); }
  };
  return <>
    <div className="target-manager-toolbar"><div><span className="neutral-badge"><Target size={13} /> {targets.filter((item) => item.enabled).length} active targets</span><span className="target-source-note">Progress is calculated from saved CRM records.</span></div><div><label className="target-show-disabled"><input type="checkbox" checked={showDisabled} onChange={(event) => setShowDisabled(event.target.checked)} /> Include inactive</label><Button variant="primary" onClick={openNew}><Plus size={15} /> Set target</Button></div></div>
    <div className="target-list">{visible.map((target) => {
      const achievement = byId.get(target.id);
      const isHistoryOpen = expandedHistory === target.id;
      const value = target.metric === 'revenue' ? money(target.targetValue, data.settings.currency) : target.targetValue.toLocaleString();
      const actual = target.metric === 'revenue' ? money(achievement?.actual || 0, data.settings.currency) : (achievement?.actual || 0).toLocaleString();
      const progress = Math.max(0, Math.min(100, achievement?.percentage || 0));
      return <article className={'target-row ' + (!target.enabled ? 'is-disabled' : '')} key={target.id}>
        <div className="target-row-main"><span className="target-icon"><Target size={17} /></span><div className="target-row-name"><b>{metricLabel(target.metric)}</b><small>{periodLabel(target.period)} · {targetOwner(target)} · {target.startDate} to {target.endDate}</small></div><span className={'target-status ' + statusClass(achievement?.status || 'On Track')}>{target.enabled ? achievement?.status || 'On Track' : 'Inactive'}</span><div className="target-row-value"><b>{actual} <small>/ {value}</small></b><span>{Math.round(achievement?.percentage || 0)}% achieved</span></div><div className="target-row-progress"><i style={{ width: progress + '%' }} /></div><div className="target-row-actions"><button className="icon-button" title="Edit target" onClick={() => setEditing(target)}><Edit3 size={15} /></button><button className="icon-button" title="Review saved target history" onClick={() => setExpandedHistory(isHistoryOpen ? null : target.id)}><History size={15} /></button><button className="icon-button" title={target.enabled ? 'Deactivate target' : 'Reactivate target'} onClick={() => void toggleEnabled(target)}>{target.enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}</button></div>
        </div>
        {achievement && target.enabled && <div className="target-row-foot"><span><Clock3 size={12} /> Current period {achievement.bucketStart} – {achievement.bucketEnd}</span><span>{target.metric === 'revenue' ? money(achievement.remaining, data.settings.currency) : achievement.remaining.toLocaleString()} remaining · expected {Math.round(achievement.expected).toLocaleString()} by now</span></div>}
        {isHistoryOpen && <div className="target-history-panel">{achievement?.history.length ? <div className="target-history-chart"><b>Historical performance</b><ResponsiveContainer width="100%" height={175}><LineChart data={achievement.history} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#e9edf0" /><XAxis dataKey="periodStart" tickFormatter={(value) => format(new Date(String(value) + 'T12:00:00'), 'd MMM')} tick={{ fill: '#86929d', fontSize: 8 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#86929d', fontSize: 8 }} axisLine={false} tickLine={false} width={35} /><Tooltip labelFormatter={(value) => format(new Date(String(value) + 'T12:00:00'), 'd MMM yyyy')} /><Line type="monotone" dataKey="actual" name="Actual" stroke="#2866ac" strokeWidth={2} dot={{ r: 3 }} /><Line type="monotone" dataKey="target" name="Target" stroke="#e1b337" strokeDasharray="4 3" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div> : <small>No historical activity has been recorded yet.</small>}<div className="target-revision-list"><b>Saved revisions</b>{target.revisions.length ? [...target.revisions].reverse().map((revision, index) => <div key={revision.savedAt + index}><span>{format(new Date(revision.savedAt), 'd MMM yyyy, h:mm a')} · {revision.savedBy}</span><small>{periodLabel(revision.period)} {revision.startDate}–{revision.endDate} · {revision.ownerType === 'team' ? 'Team' : revision.ownerName} · target {revision.targetValue} · {revision.enabled ? 'Active' : 'Inactive'}</small></div>) : <small>No earlier changes recorded for this target.</small>}</div></div>}
      </article>;
    })}{!visible.length && <div className="target-empty"><Target size={24} /><b>No targets saved yet</b><span>Set a target to see progress from real activity.</span><Button variant="primary" onClick={openNew}><Plus size={15} /> Set your first target</Button></div>}</div>
    {editing && <TargetEditor target={editing === 'new' ? undefined : editing} members={members} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); setEditing(null); }} />}
  </>;
}

function TargetEditor({ target, members, onClose, onSaved }: { target?: SalesTarget; members: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data, toast } = useApp();
  const [metric, setMetric] = useState<TargetMetric>(target?.metric || 'calls');
  const [value, setValue] = useState(String(target?.targetValue ?? 40));
  const [period, setPeriod] = useState<TargetPeriod>(target?.period || 'daily');
  const [ownerType, setOwnerType] = useState<TargetOwnerType>(target?.ownerType || 'self');
  const [ownerName, setOwnerName] = useState(target?.ownerName || data?.user.name || '');
  const [startDate, setStartDate] = useState(target?.startDate || todayKey());
  const [endDate, setEndDate] = useState(target?.endDate || format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [enabled, setEnabled] = useState(target?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!data) return null;
  const admin = data.user.role === 'Admin' || data.user.role === 'Manager';
  const selectedMetric = TARGET_METRICS.find((item) => item.key === metric)!;
  const submit = async () => {
    setError('');
    const targetValue = Number(value);
    if (!Number.isFinite(targetValue) || targetValue < 0 || (metric !== 'revenue' && !Number.isInteger(targetValue))) { setError(metric === 'revenue' ? 'Enter a non-negative revenue target.' : 'Enter a whole number for this activity target.'); return; }
    if (!startDate || !endDate || endDate < startDate) { setError('Choose an end date on or after the start date.'); return; }
    if (target && !window.confirm('Save a new revision for this target? Its previous value and performance history will remain available.')) return;
    setSaving(true);
    try {
      const payload = { metric, targetValue, period, ownerType, ownerName: ownerType === 'self' ? data.user.name : ownerType === 'team' ? 'Team' : ownerName, startDate, endDate, enabled };
      if (target) await request('/targets/' + target.id, { method: 'PUT', body: JSON.stringify(payload) });
      else await request('/targets', { method: 'POST', body: JSON.stringify(payload) });
      await onSaved(); toast(target ? 'Target revision saved.' : 'Target saved.');
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'Could not save target.'; setError(message); }
    finally { setSaving(false); }
  };
  return <Modal title={target ? 'Edit sales target' : 'Set a sales target'} sub="Choose a metric, period, owner, and active date range." onClose={onClose}>
    <div className="target-editor-form">
      <label>Metric<select value={metric} onChange={(event) => setMetric(event.target.value as TargetMetric)}>{TARGET_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>Target value<div className="target-value-input"><span>{metric === 'revenue' ? data.settings.currency : selectedMetric.unit}</span><input type="number" min="0" step={metric === 'revenue' ? '0.01' : '1'} value={value} onChange={(event) => setValue(event.target.value)} /></div></label>
      <label>Period<select value={period} onChange={(event) => setPeriod(event.target.value as TargetPeriod)}>{periodOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>Target owner<select value={ownerType} onChange={(event) => { const next = event.target.value as TargetOwnerType; setOwnerType(next); if (next === 'self') setOwnerName(data.user.name); if (next === 'team') setOwnerName('Team'); }}>{<><option value="self">My target</option><option value="team" disabled={!admin}>Team</option><option value="employee" disabled={!admin}>Individual employee</option></>}</select></label>
      {ownerType === 'employee' && <label>Employee<select value={ownerName} onChange={(event) => setOwnerName(event.target.value)}>{members.map((member) => <option key={member} value={member}>{member}</option>)}</select></label>}
      <label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label>End date<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <label className="target-enabled-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Target enabled</label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="target-editor-note">Revenue uses Closed Won opportunity amounts by actual close date. Company net worth and estimated pipeline values do not count.</div>
    <div className="modal-actions"><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : target ? 'Save Changes' : 'Save Target'}</Button></div>
  </Modal>;
}