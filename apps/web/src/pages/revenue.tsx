import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Kanban, List, Plus, TrendingUp, Trophy } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import type { Bootstrap } from '../api';
import { CustomReportBuilder } from '../CustomReportBuilder';
import type { Opportunity } from '../../../../packages/shared/src/index';
import { Button, Card, Modal, PageHeading } from '../layout';
import { useApp } from '../context';
import { request } from '../api';
import { formatMoney } from '../formatMoney';

const stages = ['Qualification', 'Discovery', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const;
const opportunitySchema = z.object({ name: z.string().trim().min(1), leadId: z.string().min(1), amount: z.number().min(0), currency: z.string().length(3), probability: z.number().min(0).max(100), stage: z.enum(stages), expectedClose: z.string(), notes: z.string() });
type OpportunityForm = z.infer<typeof opportunitySchema>;
const money = (value: number, currency = 'INR') => formatMoney(value, currency);
function ReportCardTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="card-title-row"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>;
}

function ReportEmpty({ message }: { message: string }) {
  return <div className="empty-chart"><span>◌</span><p>{message}</p></div>;
}


function OpportunityEditor({ opportunity, onClose, onSaved }: { opportunity?: Opportunity; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data, toast } = useApp();
  const form = useForm<OpportunityForm>({ defaultValues: opportunity ? { name: opportunity.name, leadId: opportunity.leadId, amount: opportunity.amount, currency: opportunity.currency, probability: opportunity.probability, stage: opportunity.stage, expectedClose: opportunity.expectedClose || '', notes: opportunity.notes } : { name: '', leadId: data?.leads[0]?.id || '', amount: 0, currency: 'INR', probability: 10, stage: 'Qualification', expectedClose: '', notes: '' }, resolver: zodResolver(opportunitySchema) });
  const [busy, setBusy] = useState(false);
  const submit = async (values: OpportunityForm) => {
    setBusy(true);
    try {
      await request(opportunity ? '/opportunities/' + opportunity.id : '/opportunities', { method: opportunity ? 'PATCH' : 'POST', body: JSON.stringify(values) });
      await onSaved(); toast(opportunity ? 'Opportunity updated.' : 'Opportunity created.'); onClose();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save opportunity.', 'error'); }
    finally { setBusy(false); }
  };
  return <Modal title={opportunity ? 'Edit opportunity' : 'New opportunity'} sub="Keep projected deal value and actual revenue distinct." onClose={onClose}>
    <form className="modal-form" onSubmit={form.handleSubmit(submit)}>
      <label>Opportunity name<input {...form.register('name')} placeholder="e.g. Annual platform rollout" required /></label>
      <label>Associated lead<select {...form.register('leadId')} required>{data?.leads.filter((lead) => !lead.archived).map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.company}</option>)}</select></label>
      <div className="form-grid"><label>Deal amount<input type="number" min="0" {...form.register('amount', { valueAsNumber: true })} /></label><label>Currency<select {...form.register('currency')}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Probability %<input type="number" min="0" max="100" {...form.register('probability', { valueAsNumber: true })} /></label></div>
      <label>Expected close<input type="date" {...form.register('expectedClose')} /></label><label>Notes<textarea rows={3} {...form.register('notes')} /></label>
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : opportunity ? 'Save changes' : 'Create opportunity'}</Button></div>
    </form>
  </Modal>;
}

export function OpportunitiesPage() {
  const { data, refresh, toast } = useApp();
  const [mode, setMode] = useState<'Board' | 'Table'>('Board');
  const [editing, setEditing] = useState<Opportunity | 'new' | null>(null);
  const [owner, setOwner] = useState('');
  const [dealFilter, setDealFilter] = useState<'All' | 'Open' | 'Closed Won' | 'Closed Lost'>('All');
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') === '1') setEditing('new');
    if (searchParams.get('view') === 'won') setDealFilter('Closed Won');
    const requestedOpportunity = searchParams.get('opportunity');
    if (requestedOpportunity && data) { const opportunity = data.opportunities.find((item) => item.id === requestedOpportunity); if (opportunity) setEditing(opportunity); }
    if (searchParams.has('new') || searchParams.has('view') || (requestedOpportunity && data)) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, data]);
  const allOpps = useMemo(() => (data?.opportunities || []).filter((opp) => !owner || opp.owner === owner), [data, owner]);
  const opps = allOpps.filter((opp) => dealFilter === 'All' || (dealFilter === 'Open' ? !['Closed Won', 'Closed Lost'].includes(opp.stage) : opp.stage === dealFilter));
  const openOpps = allOpps.filter((opp) => !['Closed Won', 'Closed Lost'].includes(opp.stage));
  const pipeline = openOpps.reduce((sum, opp) => sum + opp.amount, 0);
  const weighted = openOpps.reduce((sum, opp) => sum + opp.amount * opp.probability / 100, 0);
  const won = allOpps.filter((opp) => opp.stage === 'Closed Won').reduce((sum, opp) => sum + opp.amount, 0);
  const changeStage = async (opp: Opportunity, stage: string) => {
    let lossReason = '';
    if (stage === 'Closed Won' || stage === 'Closed Lost') {
      const label = stage === 'Closed Won' ? 'Closed Won' : 'Closed Lost';
      if (!window.confirm(`Confirm ${label} for ${opp.name}? This updates the linked lead and may cancel its outstanding follow-ups.`)) return;
      if (stage === 'Closed Lost') { lossReason = window.prompt('Enter the loss reason (required):') || ''; if (lossReason.trim().length < 3) { toast('Enter a loss reason (at least 3 characters).', 'error'); return; } }
    }
    try { await request('/opportunities/' + opp.id, { method: 'PATCH', body: JSON.stringify({ stage, lossReason }) }); await refresh(); toast('Opportunity moved to ' + stage + '.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not change stage.', 'error'); }
  };  const reopen = async (opp: Opportunity) => {
    if (!window.confirm(`Reopen ${opp.name}? This restores its previous stage and updates the linked lead.`)) return;
    try { await request('/opportunities/' + opp.id + '/reopen', { method: 'POST', body: JSON.stringify({}) }); await refresh(); toast('Opportunity reopened.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not reopen opportunity.', 'error'); }
  };  if (!data) return null;
  const owners = [...new Set(data.opportunities.map((opp) => opp.owner))];
  return <div className="page-stack">
    <PageHeading eyebrow="Projected and realized revenue" title="Opportunities" description="Track deal movement, weighted pipeline, and closed-won revenue." action={<><select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{owners.map((x) => <option key={x}>{x}</option>)}</select><Button variant="primary" onClick={() => setEditing('new')}><Plus size={17} /> New opportunity</Button></>} />
    <div className="summary-strip opportunity-summary"><div><span>Open pipeline</span><b>{money(pipeline)}</b></div><div><span>Weighted value</span><b>{money(weighted)}</b></div><div><span>Closed-won revenue</span><b>{money(won)}</b></div><div><span>Win rate</span><b>{data.metrics.winRate}%</b></div></div>
    <Card className="opportunity-board-card"><div className="board-toolbar"><div className="segmented"><button className={mode === 'Board' ? 'on' : ''} onClick={() => setMode('Board')}><Kanban size={15} /> Board</button><button className={mode === 'Table' ? 'on' : ''} onClick={() => setMode('Table')}><List size={15} /> Table</button></div><div className="segmented">{(['All','Open','Closed Won','Closed Lost'] as const).map((item) => <button key={item} className={dealFilter === item ? 'on' : ''} onClick={() => setDealFilter(item)}>{item}</button>)}</div><span className="muted-label">{opps.length} deals shown · totals include {openOpps.length} open deals</span></div>
      {mode === 'Board' ? <div className="kanban-scroll"><div className="kanban-board">{stages.map((stage) => {
        const items = opps.filter((opp) => opp.stage === stage);
        return <section className="kanban-column" key={stage}><div className="kanban-head"><b>{stage}</b><span>{items.length}</span></div><small className="kanban-total">{money(items.reduce((sum, opp) => sum + opp.amount, 0))}</small>{items.map((opp) => {
          const lead = data.leads.find((item) => item.id === opp.leadId);
          return <article className="deal-card" key={opp.id}><div className="deal-card-top"><span className="company-avatar">{(lead?.company || 'C').slice(0,1)}</span><button className="icon-button" title="Edit opportunity" onClick={() => setEditing(opp)}>···</button></div><b>{opp.name}</b><span className="deal-company">{lead?.company || 'Lead not found'}</span><div className="deal-amount">{money(opp.amount, opp.currency)}<small>{opp.probability}% likely · weighted {money(opp.amount * opp.probability / 100, opp.currency)}</small></div>{opp.stage === 'Closed Won' && <small className="won-attribution">Accomplished by {opp.accomplishedByName || opp.owner}{opp.actualCloseAt ? ' · ' + format(new Date(opp.actualCloseAt), 'd MMM yyyy') : ''}</small>}{opp.stage === 'Closed Lost' && <small className="won-attribution">Lost · {opp.lossReason || 'Reason not recorded'}</small>}<div className="deal-card-footer"><span>{opp.expectedClose ? 'Close ' + format(new Date(opp.expectedClose), 'd MMM') : 'Close date not set'}</span><select aria-label={'Move ' + opp.name + ' to stage'} value={opp.stage} disabled={opp.stage === 'Closed Won' || opp.stage === 'Closed Lost'} onChange={(e) => void changeStage(opp, e.target.value)}>{stages.map((x) => <option key={x}>{x}</option>)}</select>{(data.user.role === 'Admin' || data.user.role === 'Manager') && (opp.stage === 'Closed Won' || opp.stage === 'Closed Lost') && <button className='task-complete' onClick={() => void reopen(opp)}>Reopen</button>}</div></article>;
        })}{!items.length && <div className="kanban-empty">No deals in this stage</div>}</section>;
      })}</div></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Opportunity</th><th>Lead / company</th><th>Stage</th><th>Amount</th><th>Probability</th><th>Weighted value</th><th>Expected close</th><th>Actual close</th><th>Owner</th><th>Accomplished By</th><th></th></tr></thead><tbody>{opps.map((opp) => {
        const lead = data.leads.find((item) => item.id === opp.leadId);
        return <tr key={opp.id}><td><b>{opp.name}</b><small>Created {format(new Date(opp.createdAt), 'd MMM yyyy')}</small></td><td>{lead?.name}<small>{lead?.company}</small></td><td><select className="inline-select" value={opp.stage} disabled={opp.stage === 'Closed Won' || opp.stage === 'Closed Lost'} onChange={(e) => void changeStage(opp, e.target.value)}>{stages.map((x) => <option key={x}>{x}</option>)}</select></td><td>{money(opp.amount, opp.currency)}</td><td>{opp.probability}%</td><td>{money(opp.amount * opp.probability / 100, opp.currency)}</td><td>{opp.expectedClose ? format(new Date(opp.expectedClose), 'd MMM yyyy') : '—'}</td><td>{opp.actualCloseAt ? format(new Date(opp.actualCloseAt), 'd MMM yyyy') : '—'}</td><td>{opp.owner}</td><td>{opp.stage === 'Closed Won' ? opp.accomplishedByName || opp.owner : '—'}</td><td><button className="icon-button" title="Edit" onClick={() => setEditing(opp)}>Edit</button></td></tr>;
      })}{!opps.length && <tr><td colSpan={12}><div className="empty-table"><span><TrendingUp size={24} /></span><b>No opportunities yet</b><small>Create your first opportunity to track pipeline value.</small></div></td></tr>}</tbody></table></div>}
    </Card>
    <div className="note-panel"><Trophy size={17} /><span>Open amounts are projections. Closed-won revenue only includes deals in the Closed Won stage.</span><ArrowUpRight size={15} /></div>
    {editing && <OpportunityEditor opportunity={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
  </div>;
}

export function ReportsPage() {
  const { data, toast } = useApp();
  const [reportData, setReportData] = useState<Bootstrap | null>(null);
  const [activityRange, setActivityRange] = useState(30);
  useEffect(() => { if (!data) return; let current = true; request<Bootstrap>('/reports/data').then((result) => { if (current) setReportData(result); }).catch((error) => { if (current) toast(error instanceof Error ? error.message : 'Could not load permitted report records.', 'error'); }); return () => { current = false; }; }, [data, toast]);
  if (!data || !reportData) return <div className="loading-screen"><span className="spinner" />Loading authorized report data</div>;
  const m = reportData.metrics;
  const chartColors = ['#2866AC', '#a9d64a', '#f4c13d', '#8e7bd4', '#55a7a0', '#ec8876', '#718096'];
  const statusRows = m.leadStatusCounts.filter((item) => item.value > 0);
  const activityRows = m.activityTrend.slice(-activityRange);
  const sourceRows = m.sourceCounts.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const closerRows = [...m.revenueByCloser].filter((item) => item.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  return <div className="page-stack">
    <PageHeading eyebrow="Measure the work that moves revenue" title="Reports" description="Live business metrics, visual summaries, and detailed reports from your saved sales activity." action={<span className="neutral-badge">Live authorized records</span>} />
    <CustomReportBuilder data={reportData} toast={toast} />
    <div className="summary-strip report-dashboard-stats">
      <div><span>Total leads</span><b>{m.totalLeads}</b><small>{m.newToday} added today</small></div>
      <div><span>Calls today</span><b>{m.callsToday}</b><small>{m.connectedToday} connected · {m.callsRemaining} to target</small></div>
      <div><span>Follow-ups due</span><b>{m.followUpsToday}</b><small>{m.overdueFollowUps} overdue · {m.followUpsCompletedToday} completed</small></div>
      <div><span>Meetings scheduled</span><b>{m.meetingsScheduled}</b><small>{m.meetingsScheduledToday} scheduled today</small></div>
      <div><span>Open pipeline</span><b>{money(m.openPipeline)}</b><small>{money(m.weightedPipeline)} weighted value</small></div>
      <div><span>Closed-won revenue</span><b>{money(m.closedWonRevenue)}</b><small>{m.closedWonDeals} deals · {m.winRate}% win · {m.conversionRate}% conversion</small></div>
    </div>
    <section className="dashboard-chart-grid report-dashboard-charts">
      <Card><ReportCardTitle title="Lead status" subtitle="Current distribution across active leads" />{statusRows.length ? <div className="status-chart-row"><div className="donut-wrap"><ResponsiveContainer width="100%" height={230}><PieChart><Pie data={statusRows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} stroke="none">{statusRows.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value) => [Number(value), 'Leads']} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{m.totalLeads}</strong><small>Leads</small></div></div><div className="legend-list">{statusRows.map((entry, index) => <div key={entry.name}><i style={{ background: chartColors[index % chartColors.length] }} />{entry.name}<b>{entry.value}</b></div>)}</div></div> : <ReportEmpty message="Add leads to see status distribution." />}</Card>
      <Card><div className="card-title-row"><div><h2>Calling activity</h2><p>Attempts and connected calls over time</p></div><select aria-label="Activity chart range" value={activityRange} onChange={(event) => setActivityRange(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></div>{activityRows.some((item) => item.attempted || item.connected) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={240}><BarChart data={activityRows} barGap={5}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#eceeea" /><XAxis dataKey="day" axisLine={false} tickLine={false} interval="preserveStartEnd" tick={{ fill: '#8a8f8c', fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} width={32} tick={{ fill: '#a2a6a2', fontSize: 10 }} /><Tooltip /><Legend /><Bar dataKey="attempted" name="Calls attempted" fill="#2866AC" radius={[4, 4, 0, 0]} /><Bar dataKey="connected" name="Connected" fill="#a9d64a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <ReportEmpty message="Log calls to see activity." />}</Card>
      <Card><ReportCardTitle title="Revenue trend" subtitle="Closed-won revenue and monthly target" />{m.revenueTrend.some((item) => item.revenue || item.target) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={240}><LineChart data={m.revenueTrend}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#eceeea" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#8a8f8c', fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} width={68} tickFormatter={(value) => money(Number(value))} tick={{ fill: '#a2a6a2', fontSize: 9 }} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Line type="monotone" dataKey="revenue" name="Closed-won" stroke="#a9d64a" strokeWidth={3} dot={{ r: 3 }} /><Line type="monotone" dataKey="target" name="Monthly target" stroke="#2866AC" strokeDasharray="5 4" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <ReportEmpty message="Revenue will appear after opportunities are marked Closed Won." />}</Card>
      <Card><ReportCardTitle title="Pipeline by stage" subtitle="Opportunity value by stage" />{m.pipelineStages.some((item) => item.deals) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={240}><BarChart data={m.pipelineStages}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#eceeea" /><XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: '#737975', fontSize: 9 }} /><YAxis axisLine={false} tickLine={false} width={68} tickFormatter={(value) => money(Number(value))} tick={{ fill: '#a2a6a2', fontSize: 9 }} /><Tooltip formatter={(value) => money(Number(value))} /><Bar dataKey="value" name="Deal value" fill="#2866AC" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <ReportEmpty message="Create opportunities to build your pipeline report." />}</Card>
      <Card><ReportCardTitle title="Lead sources" subtitle="Active lead count by source" />{sourceRows.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={240}><BarChart data={sourceRows} layout="vertical" margin={{ left: 8, right: 16 }}><CartesianGrid strokeDasharray="3 4" horizontal={false} stroke="#eceeea" /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#a2a6a2', fontSize: 10 }} /><YAxis type="category" dataKey="name" width={92} axisLine={false} tickLine={false} tick={{ fill: '#737975', fontSize: 10 }} /><Tooltip formatter={(value) => [Number(value), 'Leads']} /><Bar dataKey="value" name="Leads" fill="#f4c13d" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div> : <ReportEmpty message="Lead source data will appear when leads are added." />}</Card>
      <Card><ReportCardTitle title="Revenue by closer" subtitle="Closed-won revenue grouped by salesperson" />{closerRows.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={240}><BarChart data={closerRows} layout="vertical" margin={{ left: 8, right: 20 }}><CartesianGrid strokeDasharray="3 4" horizontal={false} stroke="#eceeea" /><XAxis type="number" axisLine={false} tickLine={false} tickFormatter={(value) => money(Number(value))} tick={{ fill: '#a2a6a2', fontSize: 9 }} /><YAxis type="category" dataKey="closer" width={104} axisLine={false} tickLine={false} tick={{ fill: '#737975', fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value))} /><Bar dataKey="revenue" name="Closed-won revenue" fill="#8e7bd4" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div> : <ReportEmpty message="Closed-won deals will be grouped here by closer." />}</Card>
    </section>

  </div>;
}






