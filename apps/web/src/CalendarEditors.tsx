import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Clock3, Link2, MapPin, Target, Trash2 } from 'lucide-react';
import { ReminderManager } from './ReminderManager';
import type { CalendarEvent, CalendarEventStatus, CalendarEventType, CalendarItem, FollowUpTask, Opportunity, Priority } from '../../../packages/shared/src/index';
import { Button, Modal } from './layout';
import { request } from './api';
import { useApp } from './context';
import { dateKeyInTimezone, dateTimeInput, formatDateKey, formatTime, shiftDateKey, zonedDateTimeToIso } from './calendarTime';
import { categoryColor } from './calendarViews';

const eventTypes: CalendarEventType[] = ['Meeting', 'Call', 'Follow-up', 'Proposal', 'Opportunity', 'Other'];
const priorities: Priority[] = ['Low', 'Medium', 'High', 'Critical'];

export function CalendarEventEditor({ initialDateTime, initialAllDay, event, members, items, timezone, onClose, onSaved }: { initialDateTime: string; initialAllDay: boolean; event: CalendarEvent | null; members: string[]; items: CalendarItem[]; timezone: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data, toast } = useApp();
  const inputStart = event ? dateTimeInput(event.startAt, timezone) : initialDateTime;
  const inputEnd = event ? dateTimeInput(event.endAt, timezone) : initialDateTime;
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [startDate, setStartDate] = useState(inputStart.slice(0, 10));
  const [endDate, setEndDate] = useState(event ? inputEnd.slice(0, 10) : initialDateTime.slice(0, 10));
  const [startTime, setStartTime] = useState(inputStart.slice(11) || '09:00');
  const [endTime, setEndTime] = useState(event ? inputEnd.slice(11) : '09:30');
  const [allDay, setAllDay] = useState(event?.allDay ?? initialAllDay);
  const [type, setType] = useState<CalendarEventType>(event?.type || 'Meeting');
  const [status, setStatus] = useState<CalendarEventStatus>(event?.status || 'Scheduled');
  const [leadId, setLeadId] = useState(event?.leadId || '');
  const [opportunityId, setOpportunityId] = useState(event?.opportunityId || '');
  const [assignedTo, setAssignedTo] = useState(event?.assignedTo || data?.user.name || '');
  const [priority, setPriority] = useState<Priority>(event?.priority || 'Medium');
  const [location, setLocation] = useState(event?.location || '');
  const [meetingLink, setMeetingLink] = useState(event?.meetingLink || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [saveAnyway, setSaveAnyway] = useState(false);
  const leads = data?.leads.filter((item) => !item.archived) || [];
  const opportunities = data?.opportunities || [];
  const submit = async () => {
    setError('');
    if (!title.trim()) { setError('Enter an event title.'); return; }
    if (!startDate || !endDate || endDate < startDate) { setError('Choose a valid start date and end date.'); return; }
    let startAt = ''; let endAt = '';
    try {
      startAt = zonedDateTimeToIso(startDate, allDay ? '00:00' : startTime, timezone);
      endAt = zonedDateTimeToIso(allDay ? shiftDateKey(endDate, 1) : endDate, allDay ? '00:00' : endTime, timezone);
    } catch { setError('Enter a valid date and time.'); return; }
    if (Date.parse(endAt) <= Date.parse(startAt)) { setError('End time must be after the start time.'); return; }
    const busyItems = items.filter((item) => item.sourceId !== event?.id && item.status !== 'Cancelled' && item.assignedTo.toLowerCase() === assignedTo.toLowerCase() && Date.parse(item.startAt) < Date.parse(endAt) && Date.parse(item.endAt) > Date.parse(startAt));
    if (busyItems.length && !saveAnyway) { setConflicts(busyItems.slice(0, 4).map((item) => item.title)); return; }
    setBusy(true);
    try {
      const payload = { title: title.trim(), description, startAt, endAt, allDay, type, status, leadId: leadId || null, opportunityId: opportunityId || null, assignedTo, priority, location, meetingLink };
      await request(event ? '/calendar/events/' + event.id : '/calendar/events', { method: event ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      await onSaved(); toast(event ? 'Calendar event updated.' : 'Calendar event saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this event.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!event || !window.confirm('Delete this calendar event? This cannot be undone.')) return;
    setBusy(true);
    try { await request('/calendar/events/' + event.id, { method: 'DELETE' }); await onSaved(); toast('Calendar event deleted.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this event.'); }
    finally { setBusy(false); }
  };
  const changed = () => { setConflicts([]); setSaveAnyway(false); };
  return <Modal title={event ? 'Edit calendar event' : 'New calendar event'} sub="This event is saved in your CRM calendar." onClose={onClose} wide>
    <div className="calendar-event-form">
      <label>Title<input autoFocus value={title} onChange={(e) => { setTitle(e.target.value); changed(); }} maxLength={180} placeholder="e.g. Product walkthrough" /></label>
      <label className="calendar-event-description">Description<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={3000} placeholder="Meeting purpose or next steps" /></label>
      <label className="calendar-all-day-toggle"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); changed(); }} /> All day</label>
      <div className="calendar-event-form-grid calendar-event-form-dates"><label>Start date<input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); changed(); }} /></label><label>End date<input type="date" min={startDate} value={endDate} onChange={(e) => { setEndDate(e.target.value); changed(); }} /></label>{!allDay && <><label>Start time<input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); changed(); }} /></label><label>End time<input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); changed(); }} /></label></>}</div>
      <div className="calendar-event-form-grid calendar-event-form-options"><label>Event type<select value={type} onChange={(e) => setType(e.target.value as CalendarEventType)}>{eventTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Status<select value={status} onChange={(e) => setStatus(e.target.value as CalendarEventStatus)}><option>Scheduled</option><option>Completed</option><option>Cancelled</option></select></label><label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label><label>Assigned to<select value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); changed(); }}>{members.map((member) => <option key={member}>{member}</option>)}</select></label></div>
      <div className="calendar-event-form-grid calendar-event-form-related"><label>Related lead<select value={leadId} onChange={(e) => { setLeadId(e.target.value); changed(); }}><option value="">No lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.company}</option>)}</select></label><label>Related opportunity<select value={opportunityId} onChange={(e) => { const id = e.target.value; setOpportunityId(id); const opp = opportunities.find((item) => item.id === id); if (opp) setLeadId(opp.leadId); changed(); }}><option value="">No opportunity</option>{opportunities.map((opp) => <option key={opp.id} value={opp.id}>{opp.name}</option>)}</select></label><label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={240} placeholder="Office or meeting room" /></label><label>Meeting link<input type="url" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} maxLength={600} placeholder="https://…" /></label></div>
    </div>
    {conflicts.length > 0 && <div className="calendar-overlap-warning"><b>This time overlaps another calendar item:</b><span>{conflicts.join(' · ')}</span><small>Adjust the time or save anyway if the overlap is intentional.</small></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions calendar-editor-actions">{event && <Button variant="ghost" onClick={() => void remove()} disabled={busy}><Trash2 size={14} /> Delete</Button>}<span /><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => { if (conflicts.length && !saveAnyway) { setSaveAnyway(true); return; } void submit(); }} disabled={busy}>{busy ? 'Saving…' : saveAnyway ? 'Save despite overlap' : event ? 'Save event' : 'Create event'}</Button></div>
  </Modal>;
}

export function CalendarTaskEditor({ task, timezone, members, onClose, onSaved }: { task: FollowUpTask; timezone: string; members: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const [type, setType] = useState<FollowUpTask['type']>(task.type);
  const [start, setStart] = useState(dateTimeInput(task.dueAt, timezone));
  const [end, setEnd] = useState(dateTimeInput(task.endsAt || new Date(Date.parse(task.dueAt) + 30 * 60_000).toISOString(), timezone));
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [assignedTo, setAssignedTo] = useState(task.assignedTo);
  const [notes, setNotes] = useState(task.notes);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => {
    const [startDate, startTime] = start.split('T'); const [endDate, endTime] = end.split('T');
    if (!startDate || !startTime || !endDate || !endTime) { setError('Choose a valid start and end time.'); return; }
    const dueAt = zonedDateTimeToIso(startDate, startTime, timezone); const endsAt = zonedDateTimeToIso(endDate, endTime, timezone);
    if (Date.parse(endsAt) <= Date.parse(dueAt)) { setError('End time must be after the start time.'); return; }
    setBusy(true); setError('');
    try { await request('/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ type, dueAt, endsAt, priority, assignedTo, notes }) }); await onSaved(); toast('CRM activity updated.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this activity.'); }
    finally { setBusy(false); }
  };
  return <Modal title="Edit CRM activity" sub="Changes update the original follow-up record." onClose={onClose}><div className="calendar-event-form"><label>Activity type<select value={type} onChange={(e) => setType(e.target.value as FollowUpTask['type'])}>{['Call','Email','Meeting','RNR callback','Call Back Later','Proposal Follow-up','Other'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Start date and time<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>End date and time<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label><label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label><label>Assigned to<select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>{members.map((member) => <option key={member}>{member}</option>)}</select></label><label>Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save activity'}</Button></div></Modal>;
}

export function OpportunityDateEditor({ opportunity, timezone, onClose, onSaved }: { opportunity: Opportunity; timezone: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const [date, setDate] = useState(opportunity.expectedClose ? dateTimeInput(opportunity.expectedClose, timezone).slice(0, 10) : dateKeyInTimezone(new Date(), timezone));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { await request('/opportunities/' + opportunity.id, { method: 'PATCH', body: JSON.stringify({ expectedClose: zonedDateTimeToIso(date, '00:00', timezone) }) }); await onSaved(); toast('Expected close date updated.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reschedule the opportunity.'); } finally { setBusy(false); } };
  return <Modal title="Reschedule opportunity close" sub="This updates the original opportunity." onClose={onClose}><label className="calendar-form-label">Expected close date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save close date'}</Button></div></Modal>;
}

export function CalendarItemDetails({ item, timezone, onClose, onEditEvent, onEditTask, onEditOpportunity }: { item: CalendarItem; timezone: string; onClose: () => void; onEditEvent: () => void; onEditTask: () => void; onEditOpportunity: () => void }) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const canEditTask = item.source === 'task' && item.status === 'Scheduled';
  const canEditOpportunity = item.source === 'opportunity' && item.status === 'Scheduled';
  const leadLink = item.leadId && item.leadName ? '/leads?open=' + encodeURIComponent(item.leadId) : '';
  const oppLink = item.opportunityId ? '/opportunities?opportunity=' + encodeURIComponent(item.opportunityId) : '';
  if (reminderOpen && (item.source === 'task' || item.source === 'event')) return <ReminderManager sourceType={item.source} sourceId={item.sourceId} startAt={item.startAt} sourceName={item.title} onClose={() => setReminderOpen(false)} />;
  return <Modal title={item.title} sub={`${item.type} · ${item.status}`} onClose={onClose}><div className="calendar-item-details"><div><Clock3 size={14} /><span>{formatDateKey(dateKeyInTimezone(item.startAt, timezone))} · {item.allDay ? 'All day' : `${formatTime(item.startAt, timezone)} – ${formatTime(item.endAt, timezone)}`}</span></div>{item.leadName && <div><Target size={14} /><span>{item.leadName}{item.company ? ' · ' + item.company : ''}</span></div>}<div><i className={'calendar-category-dot ' + categoryColor[item.category]} /><span>{item.category} · {item.assignedTo} · {item.priority} priority</span></div>{item.description && <p>{item.description}</p>}{item.location && <div><MapPin size={14} /><span>{item.location}</span></div>}{item.meetingLink && <a href={item.meetingLink} target="_blank" rel="noreferrer"><Link2 size={14} /> Open meeting link</a>}<div className="calendar-related-links">{leadLink && <Link to={leadLink} onClick={onClose}>Open related lead</Link>}{oppLink && <Link to={oppLink} onClick={onClose}>Open opportunity</Link>}</div></div><div className="modal-actions">{(item.source === 'event' || item.source === 'task') && item.status === 'Scheduled' && <Button onClick={() => setReminderOpen(true)}><Bell size={14} /> Set reminder</Button>}{item.source === 'event' && <Button onClick={onEditEvent}>Edit event</Button>}{canEditTask && <Button onClick={onEditTask}>Edit follow-up</Button>}{canEditOpportunity && <Button onClick={onEditOpportunity}>Reschedule close date</Button>}<Button variant="primary" onClick={onClose}>Done</Button></div></Modal>;
}



