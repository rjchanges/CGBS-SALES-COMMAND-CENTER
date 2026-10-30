import { useState, type ElementType, type ReactNode } from 'react';
import { ArrowUpRight, CalendarClock, PhoneCall, UsersRound, WalletCards, Check, Target as TargetIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { format, isSameDay } from 'date-fns';
import { Card } from '../layout';
import { useApp } from '../context';
import { request } from '../api';
import { formatMoney } from '../formatMoney';
import { TARGET_METRICS } from '../TargetManager';

const colors = ['#d8fb63', '#b4d447', '#8dbd31', '#689e31', '#344d31', '#e5e8e2'];
const money = (value: number) => formatMoney(value);
function MetricCard({ label, value, note, icon: Icon, lime }: { label: string; value: string; note: string; icon: ElementType; lime?: boolean }) {
  return <article className={'metric-card ' + (lime ? 'metric-lime' : '')}><div className="metric-top"><span>{label}</span><i><Icon size={19} /></i></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>;
}
function CardTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="card-title-row"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
function Empty({ message }: { message: string }) { return <div className="empty-chart"><span>◌</span><p>{message}</p></div>; }

export function DashboardPage() {
  const { data, refresh, toast } = useApp();
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem('cgbs_home_guide_dismissed') !== 'true');
  const [range, setRange] = useState(7);
  if (!data) return null;
  const m = data.metrics;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const due = data.tasks.filter((task) => task.status === 'Due' && isSameDay(new Date(task.dueAt), now)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).slice(0, 6);
  const enabledTargets = data.targetPerformance.filter((item) => item.target.enabled);
  const targetChart = enabledTargets.map((item) => ({ name: TARGET_METRICS.find((metric) => metric.key === item.target.metric)?.label || item.target.metric, actual: Math.round(item.percentage), expected: item.target.targetValue ? Math.round(item.expected / item.target.targetValue * 100) : 0 }));
  const weekly = m.activityTrend.slice(-range);
  const completeTask = async (id: string) => {
    try {
      await request('/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'Completed', completionNotes: 'Completed from Home Page.' }) });
      await refresh(); toast('Follow-up marked complete.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not complete follow-up.', 'error'); }
  };
  return <div className="dashboard-page">
    <section className="welcome-row"><div><span className="eyebrow">Your sales activity at a glance</span><h1>{greeting}, Rahul <span className="sparkle">✳</span></h1><p>Here’s today’s work and the next steps for your pipeline.</p></div><div className="welcome-actions"><span className="welcome-date">{format(now, 'EEEE, d MMMM')}</span><Link className="button button-dark" to="/leads?add=1">＋ Add lead</Link></div></section>
    <section className="metric-grid">
      <MetricCard label="Total leads" value={String(m.totalLeads)} note={m.newToday + ' added today'} icon={UsersRound} lime />
      <MetricCard label="Calls logged" value={String(m.callsToday)} note={m.callTarget ? m.callsRemaining + ' left to reach target of ' + m.callTarget : 'No active daily call target'} icon={PhoneCall} />
      <MetricCard label="Follow-ups due" value={String(m.followUpsToday).padStart(2, '0')} note={m.overdueFollowUps + ' overdue · ' + m.followUpsCompletedToday + ' completed today'} icon={CalendarClock} />
      <MetricCard label="Open pipeline" value={money(m.openPipeline)} note={'Weighted ' + money(m.weightedPipeline)} icon={WalletCards} />
    </section>
    {showGuide && <Card className="workflow-guide"><div className="workflow-guide-copy"><span className="eyebrow">Sales workflow</span><h2>Keep every lead moving</h2><p>Bring contacts in, work the calling list, schedule a next step, then track opportunities through close.</p></div><div className="workflow-links"><Link to="/leads?import=1">Import leads <ArrowUpRight size={14} /></Link><Link to="/leads?add=1">Add a lead <ArrowUpRight size={14} /></Link><Link to="/calling">Start calling <ArrowUpRight size={14} /></Link><Link to="/follow-ups?new=1">Schedule follow-up <ArrowUpRight size={14} /></Link><Link to="/calendar">Open calendar <ArrowUpRight size={14} /></Link><Link to="/opportunities?new=1">Create opportunity <ArrowUpRight size={14} /></Link><button className="guide-dismiss" onClick={() => { localStorage.setItem('cgbs_home_guide_dismissed', 'true'); setShowGuide(false); }}>Dismiss</button></div></Card>}
    <section className="custom-target-section"><Card><CardTitle title="Sales targets" subtitle="Progress from saved CRM activity" action={<Link to="/settings#targets" className="button button-primary"><TargetIcon size={15} /> Set Targets</Link>} />{enabledTargets.length ? <div className="custom-target-grid">{enabledTargets.map((item) => {
      const metadata = TARGET_METRICS.find((metric) => metric.key === item.target.metric);
      const actual = item.target.metric === 'revenue' ? money(item.actual) : Math.round(item.actual).toLocaleString();
      const goal = item.target.metric === 'revenue' ? money(item.target.targetValue) : item.target.targetValue.toLocaleString();
      const remaining = item.target.metric === 'revenue' ? money(item.remaining) : Math.round(item.remaining).toLocaleString();
      const progress = Math.min(100, Math.max(0, item.percentage));
      return <article className="custom-target-card" key={item.target.id}><div className="custom-target-title"><span><TargetIcon size={15} />{metadata?.label || item.target.metric}</span><b className={'target-status ' + item.status.toLowerCase().replaceAll(' ', '-')}>{item.status}</b></div><div className="custom-target-number">{actual}<small> / {goal}</small></div><div className="custom-target-progress"><i style={{ width: progress + '%' }} /></div><div className="custom-target-caption"><span>{Math.round(item.percentage)}% complete · {remaining} remaining</span><span>{item.target.period} · {item.target.ownerType === 'team' ? 'Team' : item.target.ownerType === 'employee' ? item.target.ownerName : 'Me'}</span></div></article>;
    })}</div> : <div className="target-empty"><TargetIcon size={24} /><b>No active targets</b><span>Set a target to track calls, leads, follow-ups, meetings, or revenue.</span><Link className="button button-primary" to="/settings#targets">Set Targets</Link></div>}</Card>{enabledTargets.length > 0 && <Card className="target-chart-card"><CardTitle title="Achievement pace" subtitle="Actual progress compared with expected by now" /><div className="target-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={targetChart} layout="vertical" margin={{ left: 2, right: 18, top: 3, bottom: 3 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 'dataMax + 10']} unit="%" tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => [`${value}%`, '']} /><Bar dataKey="expected" name="Expected" fill="#dbe4ef" radius={[0, 5, 5, 0]} /><Bar dataKey="actual" name="Actual" fill="#2866ac" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div><small className="target-chart-legend"><i className="expected" />Expected progress <i className="actual" />Actual progress</small></Card>}</section>
    <section className="dashboard-main-grid">
      <Card className="activity-card"><CardTitle title="Today’s activity" subtitle="A quick look at your progress" action={<Link to="/reports" className="text-link">View report <ArrowUpRight size={14} /></Link>} />
        <div className="activity-list"><div className="activity-line"><span className="activity-icon"><PhoneCall size={19} /></span><div><strong>Calls logged</strong><small>{m.connectedToday} connected · {m.callsScheduledToday} scheduled</small></div><strong className="progress-pill">{m.callsToday}</strong></div>
          <div className="activity-line"><span className="activity-icon blue-icon"><CalendarClock size={19} /></span><div><strong>Follow-ups completed</strong><small>{m.overdueFollowUps} overdue · {m.followUpsToday} due today</small></div><strong className="progress-pill purple-pill">{m.followUpsCompletedToday}</strong></div>
          <div className="activity-line"><span className="activity-icon green-icon"><WalletCards size={19} /></span><div><strong>Closed-won this month</strong><small>Realized revenue</small></div><strong className="progress-pill">{money(m.revenueThisMonth)}</strong></div>
        </div>
      </Card>
      <Card className="follow-center"><CardTitle title="Today’s schedule" subtitle="Calls, callbacks, and meetings coming up" action={<Link to="/calendar" className="today-pill">Calendar <ArrowUpRight size={12} /></Link>} />
        {due.length ? <div className="follow-list">{due.map((task) => {
          const lead = data.leads.find((item) => item.id === task.leadId);
          return <div className="follow-row" key={task.id}><span className="activity-icon"><CalendarClock size={18} /></span><div><strong>{lead?.name || 'Unknown lead'}</strong><small>{format(new Date(task.dueAt), 'hh:mm a')} · {lead?.company || 'No company'} · {task.assignedTo}</small></div><span className="soft-badge">{task.type}</span><button className="icon-button" title="Mark complete" aria-label="Mark complete" onClick={() => void completeTask(task.id)}><Check size={15} /></button></div>;
        })}</div> : <Empty message="Nothing due today. Your follow-up queue is clear." />}
      </Card>
    </section>
    <section className="dashboard-chart-grid">
      <Card><div className="card-title-row"><div><h2>Calling activity</h2><p>Attempts and connected calls</p></div><select aria-label="Calling chart range" value={range} onChange={(event) => setRange(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></div>{weekly.some((item) => item.attempted) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={225}><BarChart data={weekly} barGap={7}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#eceeea" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#8a8f8c', fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#a2a6a2', fontSize: 11 }} width={26} /><Tooltip cursor={{ fill: '#f7f8f5' }} /><Bar dataKey="attempted" name="Calls attempted" fill="#d8fb63" radius={[5, 5, 0, 0]} /><Bar dataKey="connected" name="Connected" fill="#282c2a" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Empty message="Log calls to see activity." />}</Card>
      <Card><CardTitle title="Lead status" subtitle="Current lead distribution" />{m.leadStatusCounts.some((item) => item.value) ? <div className="status-chart-row"><div className="donut-wrap"><ResponsiveContainer width="100%" height={210}><PieChart><Pie data={m.leadStatusCounts.filter((x) => x.value)} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={3} stroke="none">{m.leadStatusCounts.filter((x) => x.value).map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{m.totalLeads}</strong><small>Leads</small></div></div><div className="legend-list">{m.leadStatusCounts.filter((x) => x.value).map((entry, index) => <div key={entry.name}><i style={{ background: colors[index % colors.length] }} />{entry.name}<b>{entry.value}</b></div>)}</div></div> : <Empty message="Add leads to see stage distribution." />}</Card>
      <Card><CardTitle title="Revenue trend" subtitle="Closed-won revenue by month" action={<span className="muted-label">Last 6 months</span>} />{m.revenueTrend.some((item) => item.revenue) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={220}><LineChart data={m.revenueTrend}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#eceeea" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#8a8f8c', fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} width={66} tickFormatter={(value) => money(Number(value))} tick={{ fill: '#a2a6a2', fontSize: 10 }} /><Tooltip formatter={(v) => money(Number(v))} /><Line type="monotone" dataKey="revenue" name="Closed-won revenue" stroke="#98c83d" strokeWidth={3} dot={{ r: 4, fill: '#98c83d', stroke: '#fff', strokeWidth: 2 }} /><Line type="monotone" dataKey="target" name="Monthly target" stroke="#2866AC" strokeDasharray="5 4" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <Empty message="Close a deal as won to see revenue here." />}</Card>
      <Card><CardTitle title="Pipeline by stage" subtitle="Opportunity value by stage" />{m.pipelineStages.some((item) => item.deals) ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={220}><BarChart data={m.pipelineStages}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#eceeea" /><YAxis axisLine={false} tickLine={false} width={66} tickFormatter={(value) => money(Number(value))} tick={{ fill: '#a2a6a2', fontSize: 10 }} /><XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: '#737975', fontSize: 10 }} /><Tooltip formatter={(v) => money(Number(v))} /><Bar dataKey="value" name="Deal value" fill="#c9ed66" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Empty message="Create an opportunity to build your pipeline." />}</Card>
    </section>
    <section className="bottom-row"><Card><CardTitle title="Recent activity" action={<Link to="/leads" className="text-link">View leads <ArrowUpRight size={14} /></Link>} />{data.activities.slice(0, 4).map((item) => {
      const lead = data.leads.find((x) => x.id === item.leadId);
      return <div className="recent-row" key={item.id}><span className="timeline-dot" /><div><strong>{item.title}</strong><small>{lead?.name || 'Lead'} · {format(new Date(item.createdAt), 'd MMM, h:mm a')}</small></div><span className="activity-kind">{item.type}</span></div>;
    })}{!data.activities.length && <Empty message="Recent calls and stage changes will appear here." />}</Card>
      <Card className="pipeline-card"><span>Closed-won revenue</span><strong>{money(m.closedWonRevenue)}</strong><small>{m.closedWonDeals} deals · average {money(m.averageDealValue)}</small><Link to="/opportunities?view=won" className="text-link">Review won opportunities <ArrowUpRight size={14} /></Link></Card>
    </section>
  </div>;
}
