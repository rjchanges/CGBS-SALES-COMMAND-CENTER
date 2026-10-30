import { useState } from 'react';
import { Bell, BellOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Reminder } from '../../../packages/shared/src/index';
import { Button, Modal } from './layout';
import { useApp } from './context';
import { request } from './api';
import { dateTimeInput, zonedDateTimeToIso } from './calendarTime';

const intervals = [{ value: 5, label: '5 minutes before' }, { value: 10, label: '10 minutes before' }, { value: 15, label: '15 minutes before' }, { value: 30, label: '30 minutes before' }, { value: 60, label: '1 hour before' }, { value: 1440, label: '1 day before' }];
export function ReminderManager({ sourceType, sourceId, startAt, sourceName, onClose }: { sourceType: 'task' | 'event'; sourceId: string; startAt: string; sourceName: string; onClose: () => void }) {
  const { data, refresh, toast } = useApp();
  const timezone = data?.settings.timezone || 'Asia/Kolkata';
  const reminders = (data?.reminders || []).filter((item) => item.sourceType === sourceType && item.sourceId === sourceId);
  const [edit, setEdit] = useState<Reminder | null>(null);
  const [choice, setChoice] = useState('15');
  const [customAt, setCustomAt] = useState(dateTimeInput(new Date(Date.parse(startAt) - 15 * 60_000), timezone));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const minutesBefore = choice === 'custom' ? null : Number(choice);
    const payload = { minutesBefore, sendAt: minutesBefore === null ? zonedDateTimeToIso(customAt.slice(0, 10), customAt.slice(11, 16), timezone) : null, channels: ['in-app'] };
    setSaving(true);
    try { await request(edit ? '/reminders/' + edit.id : `/reminders/${sourceType}/${sourceId}`, { method: edit ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); await refresh(); toast(edit ? 'Reminder updated.' : 'Reminder scheduled.'); setEdit(null); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not save reminder.', 'error'); }
    finally { setSaving(false); }
  };
  const toggle = async (item: Reminder) => { try { await request('/reminders/' + item.id, { method: 'PATCH', body: JSON.stringify({ minutesBefore: item.minutesBefore, sendAt: item.sendAt, channels: item.channels, enabled: !item.enabled }) }); await refresh(); toast(item.enabled ? 'Reminder disabled.' : 'Reminder enabled.'); } catch (error) { toast(error instanceof Error ? error.message : 'Could not update reminder.', 'error'); } };
  const remove = async (item: Reminder) => { try { await request('/reminders/' + item.id, { method: 'DELETE' }); await refresh(); toast('Reminder deleted.'); } catch (error) { toast(error instanceof Error ? error.message : 'Could not delete reminder.', 'error'); } };
  return <Modal title={'Reminders · ' + sourceName} sub={'Times shown in ' + timezone + '. In-app delivery is saved and scheduled by the API.'} onClose={onClose}>
    <div className="reminder-manager"><div className="reminder-items">{reminders.map((item) => <div className="reminder-item" key={item.id}><span><Bell size={15} /></span><div><b>{item.minutesBefore === null ? 'Custom time' : intervals.find((interval) => interval.value === item.minutesBefore)?.label || `${item.minutesBefore} min before`}</b><small>{new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.sendAt))} · {item.status}</small></div><button className="icon-button" aria-label="Edit reminder" disabled={item.status === 'Delivered'} onClick={() => { setEdit(item); setChoice(item.minutesBefore === null ? 'custom' : String(item.minutesBefore)); setCustomAt(dateTimeInput(item.sendAt, timezone)); }}><Pencil size={14} /></button><button className="icon-button" aria-label={item.enabled ? 'Disable reminder' : 'Enable reminder'} onClick={() => void toggle(item)}>{item.enabled ? <BellOff size={14} /> : <Bell size={14} />}</button><button className="icon-button" aria-label="Delete reminder" onClick={() => void remove(item)}><Trash2 size={14} /></button></div>)}{!reminders.length && <p className="empty-inline">No reminders configured.</p>}</div><div className="reminder-editor"><label>Remind me<select value={choice} onChange={(event) => setChoice(event.target.value)}>{intervals.map((interval) => <option key={interval.value} value={interval.value}>{interval.label}</option>)}<option value="custom">Custom date and time</option></select></label>{choice === 'custom' && <label>Reminder time<input type="datetime-local" value={customAt} onChange={(event) => setCustomAt(event.target.value)} /></label>}<div className="reminder-channel"><input type="checkbox" checked readOnly /><span><b>In-app notification</b><small>Saved to the notification inbox; backend scheduler works while CRM is closed.</small></span></div><div className="reminder-channel muted"><input type="checkbox" disabled /><span><b>Browser push</b><small>Push service is not configured. Setup is documented in REMINDERS.md.</small></span></div><Button variant="primary" disabled={saving} onClick={() => void save()}><Plus size={14} />{saving ? 'Saving…' : edit ? 'Save reminder' : 'Add reminder'}</Button></div></div>
  </Modal>;
}

