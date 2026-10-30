import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, addMinutes, format, isBefore, isSameDay, startOfDay } from 'date-fns';
import { Bell, CalendarDays, Check, Clock3, Edit3, ExternalLink, History, Mail, Phone, Plus, RotateCw, X } from 'lucide-react';
import { ReminderManager } from '../ReminderManager';
import { countdownParts, meetingState } from '../meetingCountdown';
import { leadStatuses, type FollowUpTask } from '../../../../packages/shared/src/index';
import { Button, Card, Modal, PageHeading } from '../layout';
import { useApp } from '../context';
import { request } from '../api';
import { FollowUpSalesEditor } from '../FollowUpSalesEditor';


function TaskEditor({ onClose, onSaved, task, initialType, initialLeadId }: { onClose: () => void; onSaved: () => Promise<void>; task?: FollowUpTask; initialType?: FollowUpTask['type']; initialLeadId?: string }) {
  const { data, toast } = useApp();
  const defaultDueAt = format(addDays(new Date(), 1), "yyyy-MM-dd'T'09:30");
  const [leadId, setLeadId] = useState(task?.leadId || initialLeadId || data?.leads[0]?.id || '');
  const [type, setType] = useState<FollowUpTask['type']>(task?.type || initialType || 'Call');
  const [dueAt, setDueAt] = useState(task ? format(new Date(task.dueAt), "yyyy-MM-dd'T'HH:mm") : defaultDueAt);
  const [endsAt, setEndsAt] = useState(task?.endsAt ? format(new Date(task.endsAt), "yyyy-MM-dd'T'HH:mm") : format(addMinutes(task ? new Date(task.dueAt) : new Date(defaultDueAt), 30), "yyyy-MM-dd'T'HH:mm"));
  const [priority, setPriority] = useState<FollowUpTask['priority']>(task?.priority || 'Medium');
  const [notes, setNotes] = useState(task?.notes || '');
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo || data?.user.name || 'Rahul Raj M');
  const members = [...new Set([data?.user.name || '', ...(data?.leads.map((lead) => lead.assignedTo) || []), ...(data?.tasks.map((item) => item.assignedTo) || []), ...(data?.calls.map((item) => item.createdBy) || [])].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const canAssign = data?.user.role === 'Admin' || data?.user.role === 'Manager';
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!leadId || !dueAt || !endsAt || Date.parse(endsAt) <= Date.parse(dueAt)) { toast('Choose a lead and an end time after the start time.', 'error'); return; }
    setBusy(true);
    try {
      if (task) await request('/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ type, dueAt: new Date(dueAt).toISOString(), endsAt: new Date(endsAt).toISOString(), priority, assignedTo, notes }) });
      else await request('/tasks', { method: 'POST', body: JSON.stringify({ leadId, type, dueAt: new Date(dueAt).toISOString(), endsAt: new Date(endsAt).toISOString(), priority, assignedTo, notes }) });
      await onSaved(); toast(task ? 'Follow-up updated.' : 'Follow-up scheduled.'); onClose();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save follow-up.', 'error'); }
    finally { setBusy(false); }
  };
  return <Modal title={task ? 'Reschedule follow-up' : 'Schedule a follow-up'} sub="Add a clear, time-bound next step." onClose={onClose}>
    <div className="modal-form"><label>Lead<select value={leadId} onChange={(e) => setLeadId(e.target.value)}>{data?.leads.filter((lead) => !lead.archived).map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.company}</option>)}</select></label><label>Task type<select value={type} onChange={(e) => setType(e.target.value as FollowUpTask['type'])}>{['Call','Email','Meeting','RNR callback','Call Back Later','Proposal Follow-up','Other'].map((x) => <option key={x}>{x}</option>)}</select></label><label>Start date and time<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label><label>End date and time<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label><label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value as FollowUpTask['priority'])}>{['Low','Medium','High','Critical'].map((x) => <option key={x}>{x}</option>)}</select></label><label>Assigned to<select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={!canAssign}>{members.map((member) => <option key={member}>{member}</option>)}</select></label><label>Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What needs to happen next?" /></label></div><div className="modal-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : task ? 'Save changes' : 'Schedule follow-up'}</Button></div>
  </Modal>;
}
function MeetingCountdown({ task, now, timezone }: { task: FollowUpTask; now: number; timezone: string }) { const state = meetingState(task, now); const parts = countdownParts(task.dueAt, now); return <small className={'meeting-countdown meeting-' + state.toLowerCase().replace(/ /g, '-')}><b>{state}</b>{['Upcoming','Starting Soon'].includes(state) && <span>{parts.days}d {parts.hours}h {parts.minutes}m {parts.seconds}s</span>}{state === 'In Progress' && <span>In progress · {timezone}</span>}{state === 'Overdue' && <span>Overdue · {timezone}</span>}</small>; }function taskActionIcon(type: string) { return type === 'Email' ? <Mail size={17} /> : type === 'Meeting' ? <CalendarDays size={17} /> : <Phone size={17} />; }

export function FollowUpsPage() {
  const { data, refresh, toast } = useApp();
  const [filter, setFilter] = useState('All active');
  const [editing, setEditing] = useState<FollowUpTask | 'new' | null>(null);
  const [salesDetailsTask, setSalesDetailsTask] = useState<FollowUpTask | null>(null);
  const [reminderTask, setReminderTask] = useState<FollowUpTask | null>(null);
  const [completingTask, setCompletingTask] = useState<FollowUpTask | null>(null);
  const [completionLeadStatus, setCompletionLeadStatus] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [completionBusy, setCompletionBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const [scheduleHistoryTaskId, setScheduleHistoryTaskId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [createType, setCreateType] = useState<FollowUpTask['type']>('Call');
  const [leadForCreate, setLeadForCreate] = useState('');
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreateType((searchParams.get('type') as FollowUpTask['type']) || 'Call');
      setLeadForCreate(searchParams.get('lead') || '');
      setEditing('new');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const queues = ['All active', 'Due Today', 'Upcoming', 'Overdue', 'RNR', 'Meetings', 'Completed', 'Cancelled'];
  const tasks = useMemo(() => (data?.tasks || []).filter((task) => {
    const due = new Date(task.dueAt); const now = new Date();
    if (filter === 'All active') return task.status === 'Due';
    if (filter === 'Due Today') return task.status === 'Due' && isSameDay(due, now);
    if (filter === 'Upcoming') return task.status === 'Due' && due > startOfDay(addDays(now, 1));
    if (filter === 'Overdue') return task.status === 'Due' && isBefore(due, startOfDay(now));
    if (filter === 'RNR') return task.type === 'RNR callback' || task.type === 'Call Back Later';
    if (filter === 'Meetings') return task.type === 'Meeting';
    return task.status === filter;
  }).sort((a,b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)), [data, filter]);  const finish = async (task: FollowUpTask, status: 'Completed' | 'Cancelled') => {
    if (status === 'Completed') {
      setCompletionLeadStatus(data?.leads.find((lead) => lead.id === task.leadId)?.status || 'New Lead');
      setCompletionNotes(''); setCompletingTask(task); return;
    }
    const reason = window.prompt('Reason for cancelling this follow-up?');
    if (reason === null) return;
    try { await request('/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ status, cancelledReason: reason || '' }) }); await refresh(); toast('Follow-up cancelled.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not update follow-up.', 'error'); }
  };
  const completeFollowUp = async () => {
    if (!completingTask) return;
    const scheduleNext = window.confirm('Is another follow-up needed for this active sales process?');
    setCompletionBusy(true);
    try {
      await request('/tasks/' + completingTask.id, { method: 'PATCH', body: JSON.stringify({ status: 'Completed', leadStatus: completionLeadStatus, completionNotes }) });
      await refresh();
      const nextTask = completingTask;
      setCompletingTask(null); toast('Follow-up completed and lead status updated.');
      if (scheduleNext) { setCreateType(nextTask.type); setLeadForCreate(nextTask.leadId); setEditing('new'); }
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not update follow-up.', 'error'); }
    finally { setCompletionBusy(false); }
  };
  const reopen = async (task: FollowUpTask) => {
    if (!window.confirm('Reopen this completed follow-up?')) return;
    try { await request('/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ status: 'Due' }) }); await refresh(); toast('Follow-up reopened.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not reopen follow-up.', 'error'); }
  };  const completed = data?.tasks.filter((task) => task.status === 'Completed').length || 0;
  const active = data?.tasks.filter((task) => task.status === 'Due').length || 0;
  return <div className="page-stack">
    <PageHeading eyebrow="Stay a step ahead" title="Follow-up centre" description="Prioritize callbacks, overdue tasks, meetings, and every next step." action={<Button variant="primary" onClick={() => { setCreateType('Call'); setEditing('new'); }}><Plus size={17} /> New follow-up</Button>} />
    <div className="summary-strip"><div><span>Active tasks</span><b>{active}</b></div><div><span>Overdue</span><b className="danger-text">{data?.metrics.overdueFollowUps || 0}</b></div><div><span>Due today</span><b>{data?.metrics.followUpsToday || 0}</b></div><div><span>Completed</span><b>{completed}</b></div></div>
    <Card className="task-card"><div className="queue-tabs">{queues.map((queue) => <button key={queue} className={filter === queue ? 'on' : ''} onClick={() => setFilter(queue)}>{queue}{queue === 'Overdue' && data?.metrics.overdueFollowUps ? <i className="queue-bubble">{data.metrics.overdueFollowUps}</i> : null}</button>)}</div>
      <div className="task-list">{tasks.map((task) => {
        const lead = data?.leads.find((item) => item.id === task.leadId);
        const overdue = task.status === 'Due' && Date.parse(task.dueAt) < Date.now();
        return <article className={'task-row ' + (overdue ? 'task-overdue' : '')} key={task.id}><span className="task-type-icon">{taskActionIcon(task.type)}</span><div className="task-main"><div className="task-name-row"><b>{lead?.name || 'Unknown lead'}</b><span className={'priority-tag p-' + task.priority.toLowerCase()}>{task.priority}</span>{overdue && <span className="overdue-tag">Overdue</span>}</div><span>{lead?.company || 'No company'} · {task.type}</span><small>{task.notes || 'No additional notes.'}</small><small className="task-meta">Task ID {task.id} · Lead ID {task.leadId} · Status {task.status} · Assigned to {task.assignedTo} · Created {format(new Date(task.createdAt), 'd MMM yyyy, h:mm a')}{task.completedAt ? ' · Completed ' + format(new Date(task.completedAt), 'd MMM yyyy, h:mm a') + (task.completedBy ? ' by ' + task.completedBy : '') : ''}</small>{(data?.reminders || []).filter((item) => item.sourceType === 'task' && item.sourceId === task.id).length > 0 && <small>{(data?.reminders || []).filter((item) => item.sourceType === 'task' && item.sourceId === task.id).length} configured reminder(s)</small>}</div><div className="task-due"><b>{format(new Date(task.dueAt), 'EEE, d MMM')}</b><small>{new Intl.DateTimeFormat('en', { timeZone: data?.settings.timezone || 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(task.dueAt))}{task.endsAt ? ' – ' + new Intl.DateTimeFormat('en', { timeZone: data?.settings.timezone || 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(task.endsAt)) : ''}</small>{task.type === 'Meeting' && <MeetingCountdown task={task} now={clock} timezone={data?.settings.timezone || 'Asia/Kolkata'} />}</div><div className="task-controls">{task.scheduleHistory?.length ? <button className="icon-button" title="View schedule history" aria-label="View schedule history" onClick={() => setScheduleHistoryTaskId(scheduleHistoryTaskId === task.id ? null : task.id)}><History size={15} /></button> : null}{task.status === 'Completed' && <button className="icon-button" title="Reopen follow-up" aria-label="Reopen follow-up" onClick={() => void reopen(task)}><RotateCw size={15} /></button>}{task.status === 'Due' && <><button className="icon-button" title="Set reminder" aria-label="Set reminder" onClick={() => setReminderTask(task)}><Bell size={15} /></button><button className="icon-button" title="Set reminder" aria-label="Set reminder" onClick={() => setReminderTask(task)}><Bell size={15} /></button><button className="icon-button" title="Set reminder" aria-label="Set reminder" onClick={() => setReminderTask(task)}><Bell size={15} /></button><button className="icon-button sales-details-action" title="Sales details & next step" aria-label="Sales details & next step" onClick={() => setSalesDetailsTask(task)}><Edit3 size={15} /></button><button className="task-complete" title="Mark complete" onClick={() => void finish(task, 'Completed')}><Check size={16} /> Complete</button><button className="icon-button" title="Reschedule" onClick={() => setEditing(task)}><RotateCw size={16} /></button><button className="icon-button" title="Cancel" onClick={() => void finish(task, 'Cancelled')}><X size={16} /></button></>}<Link className="icon-button" title="Open lead" aria-label="Open lead" to={'/leads?open=' + encodeURIComponent(task.leadId)}><ExternalLink size={15} /></Link>{lead?.phone && <a className="icon-button" title="Call lead" href={'tel:' + lead.phone}><Phone size={15} /></a>}{lead?.email && <a className="icon-button" title="Email lead" href={'mailto:' + lead.email}><Mail size={15} /></a>}</div>{scheduleHistoryTaskId === task.id && task.scheduleHistory?.length ? <div className="task-schedule-history"><b>Previous schedules</b>{[...task.scheduleHistory].reverse().map((entry, index) => <small key={entry.changedAt + index}>{format(new Date(entry.dueAt), 'd MMM yyyy, h:mm a')} · changed {format(new Date(entry.changedAt), 'd MMM yyyy, h:mm a')} by {entry.changedBy}</small>)}</div> : null}</article>;
      })}{!tasks.length && <div className="empty-table"><span><Clock3 size={24} /></span><b>Nothing in this queue</b><small>Scheduled follow-ups will appear here.</small><Button variant="primary" onClick={() => setEditing('new')}><Plus size={16} /> Schedule a follow-up</Button></div>}</div>
    </Card>
    {editing && <TaskEditor task={editing === 'new' ? undefined : editing} initialType={createType} initialLeadId={leadForCreate} onClose={() => { setEditing(null); setLeadForCreate(''); }} onSaved={async () => { await refresh(); setLeadForCreate(''); }} />}{reminderTask && <ReminderManager sourceType="task" sourceId={reminderTask.id} startAt={reminderTask.dueAt} sourceName={reminderTask.type} onClose={() => setReminderTask(null)} />}{salesDetailsTask && data?.leads.find((lead) => lead.id === salesDetailsTask.leadId) && <FollowUpSalesEditor task={salesDetailsTask} lead={data.leads.find((lead) => lead.id === salesDetailsTask.leadId)!} onClose={() => setSalesDetailsTask(null)} />}
    {completingTask && <Modal title="Complete follow-up" sub="Record the result and update this lead’s status." onClose={() => { if (!completionBusy) setCompletingTask(null); }}><div className="modal-form"><label>Lead status after this follow-up<select value={completionLeadStatus} onChange={(event) => setCompletionLeadStatus(event.target.value)}>{leadStatuses.filter((status) => status !== 'Won' && status !== 'Lost').map((status) => <option key={status}>{status}</option>)}</select></label><label>Completion notes<textarea rows={3} value={completionNotes} onChange={(event) => setCompletionNotes(event.target.value)} placeholder="What happened during this follow-up?" /></label><small>Won and Lost outcomes are managed from Opportunities.</small></div><div className="modal-actions"><Button variant="ghost" onClick={() => setCompletingTask(null)} disabled={completionBusy}>Cancel</Button><Button variant="primary" onClick={() => void completeFollowUp()} disabled={completionBusy}>{completionBusy ? 'Saving…' : 'Complete & update status'}</Button></div></Modal>}
  </div>;
}














