import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, FileText, History, Mail, Phone, PhoneCall, Search, SkipForward } from 'lucide-react';
import { addDays, addMinutes, format } from 'date-fns';
import type { Lead, VoiceCall } from '../../../../packages/shared/src/index';
import { Button, Card, PageHeading } from '../layout';
import { useApp } from '../context';
import { request } from '../api';
import { formatMoney } from '../formatMoney';
import { FollowUpSalesEditor } from '../FollowUpSalesEditor';

const outcomes = ['Answered', 'No Answer', 'Busy', 'RNR', 'Interested', 'Not Interested', 'Meeting Scheduled', 'Invalid Number', 'Call Back Later'];
const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
type CallingProfileResponse = { profile: { phone: string; verifiedAt: string | null } | null; provider: { configured: boolean; callingMessage: string } };
function callbackDefault(minutes: number) { return format(addMinutes(new Date(), minutes), "yyyy-MM-dd'T'HH:mm"); }

export function CallingPage() {
  const { data, refresh, toast } = useApp();
  const leads = useMemo(() => (data?.leads || []).filter((lead) => !lead.archived && !['Won','Lost'].includes(lead.status)), [data]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('');
  const [stage, setStage] = useState('');
  const [outcome, setOutcome] = useState('Answered');
  const [contactMethod, setContactMethod] = useState('Phone');
  const [notesByLead, setNotesByLead] = useState<Record<string, string>>({});
  const [callbackMode, setCallbackMode] = useState('30');
  const [customDate, setCustomDate] = useState(callbackDefault(30));
  const [saving, setSaving] = useState(false);
  const [salesEditorOpen, setSalesEditorOpen] = useState(false);
  const [callingProfile, setCallingProfile] = useState<CallingProfileResponse | null>(null);
  const [voiceCalls, setVoiceCalls] = useState<VoiceCall[]>([]);
  const [callingLeadId, setCallingLeadId] = useState('');
  const voiceRequestKeys = useRef(new Map<string, string>());
  const callRequestId = useRef('');
  useEffect(() => {
    let active = true;
    const loadProfile = async () => { try { const value = await request<CallingProfileResponse>('/calling/profile'); if (active) setCallingProfile(value); } catch { /* Settings shows provider setup requirements. */ } };
    const loadCalls = async () => { try { const value = await request<VoiceCall[]>('/voice-calls'); if (active) { setVoiceCalls(value); for (const call of value) if (['Completed','No Answer','Busy','Failed','Cancelled'].includes(call.status)) voiceRequestKeys.current.delete(call.leadId); } } catch { /* Keep the last confirmed call state. */ } };
    void loadProfile(); void loadCalls();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadCalls(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (!data) return null;
  const visibleLeads = leads.filter((item) => (!query || [item.id, item.name, item.company, item.role, item.phone, item.email, item.priority, item.status].some((value) => value.toLowerCase().includes(query.toLowerCase()))) && (!priority || item.priority === priority) && (!stage || item.status === stage)).sort((a,b) => priorityOrder[a.priority] - priorityOrder[b.priority] || Date.parse(a.nextFollowUp || '2999-01-01') - Date.parse(b.nextFollowUp || '2999-01-01'));
  const lead = visibleLeads.find((item) => item.id === selectedId) || visibleLeads[0] as Lead | undefined;
  const index = lead ? visibleLeads.findIndex((item) => item.id === lead.id) : 0;
  const notes = lead ? notesByLead[lead.id] || '' : '';
  const setNotes = (value: string) => { if (lead) setNotesByLead((old) => ({ ...old, [lead.id]: value })); };
  const relatedCalls = lead ? data.calls.filter((call) => call.leadId === lead.id).slice(0, 5) : [];
  const relatedActivities = lead ? data.activities.filter((item) => item.leadId === lead.id).slice(0, 5) : [];
  const linkedFollowUp = lead ? data.tasks.filter((task) => task.leadId === lead.id && task.status === 'Due').sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0] : undefined;
  const pendingVoiceOutcome = lead ? voiceCalls.find((call) => call.leadId === lead.id && ['Completed','No Answer','Busy','Failed','Cancelled'].includes(call.status) && !call.outcomeRecordedAt) : undefined;
  const hasActiveVoiceCall = voiceCalls.some((call) => call.userId === data.user.id && !['Completed','No Answer','Busy','Failed','Cancelled'].includes(call.status));
  const moveTo = (offset: number) => {
    if (!visibleLeads.length) return;
    const next = visibleLeads[(index + offset + visibleLeads.length) % visibleLeads.length]!;
    setSelectedId(next.id); setOutcome('Answered');
  };
  const callbackAt = () => {
    const now = new Date();
    if (callbackMode === '15') return addMinutes(now, 15).toISOString();
    if (callbackMode === '30') return addMinutes(now, 30).toISOString();
    if (callbackMode === '60') return addMinutes(now, 60).toISOString();
    if (callbackMode === 'tomorrow') return addDays(now, 1).toISOString();
    const selected = new Date(customDate);
    return Number.isNaN(selected.getTime()) ? '' : selected.toISOString();
  };
  const saveCall = async () => {
    if (!lead) return;
    const needsAction = ['Interested', 'RNR', 'No Answer', 'Busy', 'Call Back Later', 'Meeting Scheduled'].includes(outcome);
    if (needsAction && !callbackAt()) { toast('Choose a valid date and time for the next action.', 'error'); return; }
    setSaving(true);
    if (pendingVoiceOutcome) {
      try {
        const actionType = outcome === 'Meeting Scheduled' ? 'Meeting' : outcome === 'RNR' ? 'RNR callback' : outcome === 'Call Back Later' ? 'Call Back Later' : 'Call';
        await request('/voice-calls/' + pendingVoiceOutcome.id + '/outcome', { method: 'PATCH', body: JSON.stringify({ outcome, notes, contactMethod, ...(needsAction ? { nextAction: { type: actionType, dueAt: callbackAt(), notes } } : {}) }) });
        setNotes(''); await refresh(); setVoiceCalls(await request<VoiceCall[]>('/voice-calls')); toast('Call outcome saved and CRM activity updated.');
      } catch (error) { toast(error instanceof Error ? error.message : 'Could not save call outcome.', 'error'); }
      finally { setSaving(false); }
      return;
    }
    if (!callRequestId.current) callRequestId.current = crypto.randomUUID();
    try {
      const actionType = outcome === 'Meeting Scheduled' ? 'Meeting' : outcome === 'RNR' ? 'RNR callback' : outcome === 'Call Back Later' ? 'Call Back Later' : 'Call';
      await request('/calls', { method: 'POST', body: JSON.stringify({ leadId: lead.id, outcome, notes, contactMethod, clientMutationId: callRequestId.current, ...(needsAction ? { nextAction: { type: actionType, dueAt: callbackAt(), notes } } : {}) }) });
      callRequestId.current = '';
      setNotes(''); await refresh(); toast('Call logged and lead activity updated.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save call.', 'error'); }
    finally { setSaving(false); }
  };
  const startVoiceCall = async (targetLead: Lead) => {
    setContactMethod('Phone');
    const agentPhone = callingProfile?.profile?.phone;
    if (!callingProfile?.provider.configured) { toast(callingProfile?.provider.callingMessage || 'Exotel calling is not configured. Open Settings → Calling.', 'error'); return; }
    if (!agentPhone || !callingProfile.profile?.verifiedAt) { toast('Verify your own mobile number in Settings → Calling before calling.', 'error'); return; }
    const clientPhone = targetLead.phone.trim().replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(clientPhone)) { toast('This lead needs an international phone number before calling.', 'error'); return; }
    const prompt = `Agent-first call confirmation\n\nExotel will call you, ${data.user.name} (${agentPhone}), first. After you answer, Exotel will call ${targetLead.name} at ${clientPhone} and bridge the conversation.\n\nContinue?`;
    if (!window.confirm(prompt)) return;
    setCallingLeadId(targetLead.id);
    try {
      const idempotencyKey = voiceRequestKeys.current.get(targetLead.id) || crypto.randomUUID().replaceAll('-', '');
      voiceRequestKeys.current.set(targetLead.id, idempotencyKey);
      const call = await request<VoiceCall>('/voice-calls', { method: 'POST', body: JSON.stringify({ leadId: targetLead.id, idempotencyKey }) });
      setVoiceCalls((current) => [call, ...current.filter((item) => item.id !== call.id)]);
      toast('Request submitted. Exotel will call you first; the call is not connected yet.');
      await refresh();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not start the Exotel call.', 'error'); }
    finally { setCallingLeadId(''); }
  };
  return <div className="page-stack">
    <PageHeading eyebrow="Focused outbound selling" title="Calling workspace" description="Find a lead, open your dialer, log the outcome, and capture the next step." action={<span className="queue-count">{visibleLeads.length} leads in this view · {data.metrics.callsToday} calls today</span>} />
    <Card className="calling-queue"><div className="calling-queue-toolbar"><div><h2>Lead calling list</h2><p>Sorted by priority and next follow-up date.</p></div><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, name, company, phone" /></div><select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option>{['Critical','High','Medium','Low'].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter by stage" value={stage} onChange={(event) => setStage(event.target.value)}><option value="">All stages</option>{[...new Set(leads.map((item) => item.status))].map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className="calling-queue-list">{visibleLeads.map((item) => <div role="button" tabIndex={0} aria-pressed={lead?.id === item.id} key={item.id} className={'calling-queue-row ' + (lead?.id === item.id ? 'selected' : '')} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.id); } }}><span className="company-avatar">{item.company.slice(0,1).toUpperCase()}</span><span className="calling-queue-name"><b>{item.name}</b><small>{item.id.slice(0,8)} · {item.company} · {item.role || 'Contact'}</small></span><span className={'priority-label priority-' + item.priority.toLowerCase()}><i className={'priority-dot ' + item.priority.toLowerCase()} />{item.priority}</span><span className="calling-queue-status">{item.status}</span><span>{item.nextFollowUp ? format(new Date(item.nextFollowUp), 'd MMM, h:mm a') : 'No follow-up'}</span>{item.phone && <button type="button" className="icon-button" title="Call through Exotel" aria-label={'Call ' + item.name + ' through Exotel'} disabled={!callingProfile?.provider.configured || !callingProfile.profile?.verifiedAt || callingLeadId === item.id || hasActiveVoiceCall} onClick={(event) => { event.stopPropagation(); void startVoiceCall(item); }}><Phone size={15} /></button>}</div>)}{!visibleLeads.length && <div className="empty-inline">No leads match these filters.</div>}</div>
    </Card>
    {!lead ? <Card className="empty-call"><div className="empty-table"><span><PhoneCall size={25} /></span><b>No leads are ready for a call</b><small>Add an active lead to start your calling session.</small><Button variant="primary" onClick={() => window.location.assign('/leads')}>Open leads</Button></div></Card> : <div className="calling-layout">
      <Card className="call-lead-card">
        <div className="call-card-top"><span className="eyebrow">Lead {String(index + 1).padStart(2, '0')} of {String(visibleLeads.length).padStart(2, '0')}</span><div><button className="icon-button" onClick={() => moveTo(-1)} aria-label="Previous lead" disabled={visibleLeads.length < 2}><ArrowLeft size={17} /></button><button className="icon-button" onClick={() => moveTo(1)} aria-label="Next lead" disabled={visibleLeads.length < 2}><ArrowRight size={17} /></button></div></div>
        <div className="call-company-mark">{lead.company.slice(0,1).toUpperCase()}</div><div className="call-lead-head"><h2>{lead.name}</h2><span className="priority-label"><i className={'priority-dot ' + lead.priority.toLowerCase()} />{lead.priority}</span></div>
        <p className="call-role">{lead.role || 'Contact'} at <b>{lead.company}</b></p><div className="call-value">{formatMoney(lead.revenue, lead.currency)} <small>estimated opportunity</small></div>
        <div className="call-stage"><span className={'status-badge status-' + lead.status.replace(/\s/g,'-').toLowerCase()}>{lead.status}</span><div className="table-progress"><span><i style={{ width: lead.progression + '%' }} /></span><b>{lead.progression}%</b></div></div>
        <div className="call-contact"><div><Phone size={16} /><span>{lead.phone || 'No phone added'}</span></div><div><Mail size={16} /><span>{lead.email || 'No email added'}</span></div></div>
        <div className="call-actions"><Button onClick={() => setSalesEditorOpen(true)}><FileText size={15} /> Sales details &amp; next step</Button>{lead.phone && <Button variant="primary" onClick={() => void startVoiceCall(lead)} disabled={!callingProfile?.provider.configured || !callingProfile.profile?.verifiedAt || callingLeadId === lead.id || hasActiveVoiceCall}><PhoneCall size={16} />{callingLeadId === lead.id ? 'Submitting…' : 'Call via Exotel'}</Button>}{lead.email && <a className="button button-default" target="_blank" rel="noreferrer" href={'https://outlook.office.com/mail/deeplink/compose?to=' + encodeURIComponent(lead.email) + '&subject=' + encodeURIComponent(lead.aiEmailSubject || 'Following up with ' + lead.company) + '&body=' + encodeURIComponent(lead.aiOpeningMessage || '')}><Mail size={15} /> Draft email</a>}<Button onClick={() => moveTo(1)}><SkipForward size={15} /> Next lead</Button></div>
        {!callingProfile?.provider.configured && <p className="call-provider-hint">{callingProfile?.provider.callingMessage || 'Loading Exotel calling setup…'} <a href="/settings#calling">Open Calling Settings</a></p>}{callingProfile?.provider.configured && !callingProfile.profile?.verifiedAt && <p className="call-provider-hint">Verify your own mobile number in <a href="/settings#calling">Calling Settings</a> to place agent-first calls.</p>}
        {voiceCalls.find((item) => item.leadId === lead.id) && <div className="voice-call-status"><span>Click-to-call status</span><b>{voiceCalls.find((item) => item.leadId === lead.id)?.status}</b>{voiceCalls.find((item) => item.leadId === lead.id)?.errorMessage && <small>{voiceCalls.find((item) => item.leadId === lead.id)?.errorMessage}</small>}</div>}
        <p className="call-disclaimer">Exotel calls your verified mobile first, then connects the client. Email drafts are not sent automatically.</p>
        <div className="call-context"><div><span>Last contacted</span><b>{lead.lastContacted ? format(new Date(lead.lastContacted), 'd MMM, h:mm a') : 'Never'}</b></div><div><span>Next follow-up</span><b>{lead.nextFollowUp ? format(new Date(lead.nextFollowUp), 'd MMM, h:mm a') : 'Not set'}</b></div><div><span>Source</span><b>{lead.source}</b></div><div><span>Win probability</span><b>{lead.probability}%</b></div></div>
      </Card>
      <div className="call-workflow">
        <Card className="call-log-card"><div className="card-title-row"><div><h2>{pendingVoiceOutcome ? 'Record Exotel call outcome' : 'Log this call'}</h2><p>{pendingVoiceOutcome ? 'Save the result of the completed provider call and schedule any next step.' : 'Record what happened to keep your reports accurate.'}</p></div><span className="neutral-badge">{pendingVoiceOutcome ? pendingVoiceOutcome.status : 'Manual log'}</span></div>
          <div className="form-grid call-form-grid"><label>Contact method<select value={contactMethod} disabled={Boolean(pendingVoiceOutcome)} onChange={(event) => setContactMethod(event.target.value)}><option>Phone</option><option>Email</option><option>LinkedIn</option><option>Other</option></select></label><label>Call outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)}>{outcomes.map((item) => <option key={item}>{item}</option>)}</select></label>
            {(['Interested','RNR','No Answer','Busy','Call Back Later','Meeting Scheduled'].includes(outcome)) && <div className="field-wide callback-panel"><label>{outcome === 'Meeting Scheduled' ? 'Meeting date and time' : 'Next action interval'}<select value={callbackMode} onChange={(event) => setCallbackMode(event.target.value)}><option value="15">In 15 minutes</option><option value="30">In 30 minutes</option><option value="60">In 1 hour</option><option value="tomorrow">Tomorrow (same time)</option><option value="custom">Choose date and time</option></select></label>{callbackMode === 'custom' && <label>Date and time<input type="datetime-local" value={customDate} onChange={(event) => setCustomDate(event.target.value)} required /></label>}<small>This schedules or reschedules the next action for this lead.</small></div>}
            <label className="field-wide">Call notes<textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did you learn? What is the next step?" /></label>
          </div><div className="call-form-footer"><span><Check size={15} /> Updates the lead’s last contacted date and activity history.</span><Button variant="primary" onClick={() => void saveCall()} disabled={saving}>{saving ? 'Saving…' : pendingVoiceOutcome ? 'Save call outcome' : 'Save call'}</Button></div>
        </Card>
        <Card><div className="card-title-row"><div><h2>Recent context</h2><p>Notes and previous calls with {lead.name}.</p></div><History size={18} className="muted-icon" /></div>
          {lead.notes && <div className="previous-note"><FileText size={17} /><div><b>Lead notes</b><p>{lead.notes}</p></div></div>}
          <div className="mini-history">{relatedCalls.slice(0,3).map((call) => <div key={call.id}><span className="timeline-dot" /><div><b>{call.outcome}</b><small>{format(new Date(call.createdAt), 'd MMM, h:mm a')}</small>{call.notes && <p>{call.notes}</p>}</div></div>)}{!relatedCalls.length && <p className="empty-inline">No previous calls have been logged.</p>}</div>
          {relatedActivities.length > 0 && <div className="last-activity"><Clock3 size={14} /> Last activity: {relatedActivities[0]?.title}</div>}
        </Card>
      </div>
    </div>}{salesEditorOpen && lead && <FollowUpSalesEditor task={linkedFollowUp} lead={lead} actionType={outcome === 'Meeting Scheduled' ? 'Meeting' : outcome === 'RNR' ? 'RNR callback' : outcome === 'Call Back Later' ? 'Call Back Later' : 'Call'} onClose={() => setSalesEditorOpen(false)} />}
  </div>;
}







