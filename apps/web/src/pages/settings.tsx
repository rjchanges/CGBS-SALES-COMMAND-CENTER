import { useMemo, useState } from 'react';
import { Bell, BellRing, Check, Copy, Mail, PhoneCall, PlugZap, Save, Send, Sparkles, UserRound, WandSparkles } from 'lucide-react';
import { format } from 'date-fns';
import type { Template } from '../../../../packages/shared/src/index';
import { Button, Card, Modal, PageHeading } from '../layout';
import { request } from '../api';
import { TargetManager } from '../TargetManager';
import { useApp } from '../context';
import { CallingSettings } from '../CallingSettings';

function renderTemplate(value: string, lead: { name: string; company: string; role: string; industry: string }, salesperson: string) {
  return value.replaceAll('{{lead_name}}', lead.name).replaceAll('{{company_name}}', lead.company).replaceAll('{{role}}', lead.role).replaceAll('{{industry}}', lead.industry).replaceAll('{{salesperson_name}}', salesperson).replaceAll('{{deal_amount}}', 'the agreed deal amount').replaceAll('{{meeting_date}}', 'the scheduled date');
}

export function TemplatesPage() {
  const { data, refresh, toast } = useApp();
  const [selected, setSelected] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leadId, setLeadId] = useState('');
  const [ai, setAi] = useState('');
  const [busy, setBusy] = useState(false);
  const leads = data?.leads.filter((lead) => !lead.archived) || [];
  const lead = leads.find((item) => item.id === leadId) || leads[0];
  const previewSubject = useMemo(() => lead ? renderTemplate(subject, lead, data?.user.name || '') : subject, [subject, lead, data?.user.name]);
  const previewBody = useMemo(() => lead ? renderTemplate(body, lead, data?.user.name || '') : body, [body, lead, data?.user.name]);
  const openTemplate = (template: Template) => { setSelected(template); setName(template.name); setSubject(template.subject); setBody(template.body); };
  const save = async () => {
    if (!selected) return;
    try { await request('/templates/' + selected.id, { method: 'PUT', body: JSON.stringify({ name, subject, body }) }); await refresh(); toast('Template saved.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not save template.', 'error'); }
  };
  const generate = async () => {
    if (!lead) return;
    setBusy(true);
    try {
      const result = await request<{ text: string; generated: boolean; source: string }>('/ai/outreach', { method: 'POST', body: JSON.stringify(lead) });
      setAi(result.text); toast(result.generated ? 'AI suggestions generated. Review them before use.' : 'Local suggestion generated from the lead details.');
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not generate suggestions.', 'error'); }
    finally { setBusy(false); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); }
    catch { toast('Clipboard access is unavailable in this browser.', 'error'); }
  };
  const sendDraft = () => {
    if (!lead) return;
    const finalBody = ai || previewBody;
    window.location.href = 'mailto:' + encodeURIComponent(lead.email) + '?subject=' + encodeURIComponent(ai ? 'A quick conversation about ' + lead.company : previewSubject) + '&body=' + encodeURIComponent(finalBody);
  };
  if (!data) return null;
  return <div className="page-stack">
    <PageHeading eyebrow="Clear words, more consistent follow-up" title="Email templates" description="Preview reusable drafts with lead details before opening your email app." action={<span className="neutral-badge"><Mail size={14} /> Mailto fallback active</span>} />
    <div className="template-layout"><Card className="template-list-card"><div className="card-title-row"><div><h2>Your templates</h2><p>{data.templates.length} saved</p></div></div><div className="template-list">{data.templates.map((template) => <button className={'template-option ' + (selected?.id === template.id ? 'active' : '')} key={template.id} onClick={() => openTemplate(template)}><span className="template-icon"><Mail size={17} /></span><span><b>{template.name}</b><small>{template.subject}</small></span><span>›</span></button>)}{!data.templates.length && <p className="empty-inline">No saved templates yet.</p>}</div></Card>
      <div className="template-editor-stack">{selected ? <Card className="template-editor"><div className="card-title-row"><div><h2>Edit template</h2><p>Variables render from the selected lead.</p></div><Button onClick={() => void save()}><Save size={15} /> Save</Button></div><div className="modal-form"><label>Template name<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>Email subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label><label>Email body<textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></label></div><div className="variable-list"><small>Available variables</small>{['{{lead_name}}','{{company_name}}','{{role}}','{{industry}}','{{salesperson_name}}','{{meeting_date}}','{{deal_amount}}'].map((x) => <code key={x}>{x}</code>)}</div></Card> : <Card className="empty-template"><Mail size={25} /><b>Choose a template to edit</b><span>Preview and personalize an email before creating a draft.</span></Card>}
        <Card className="email-preview"><div className="card-title-row"><div><h2>Preview and draft</h2><p>Nothing is sent automatically.</p></div><label className="lead-picker">Preview for<select value={lead?.id || ''} onChange={(e) => setLeadId(e.target.value)}>{leads.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="mail-preview-box"><div><span>To</span><b>{lead?.email || 'Add an email address to this lead'}</b></div><div><span>Subject</span><b>{previewSubject || 'Choose a template to preview the subject'}</b></div><p>{previewBody || 'Your rendered message will appear here.'}</p></div><div className="preview-actions"><Button onClick={() => void copy(previewBody)}><Copy size={15} /> Copy draft</Button><Button variant="primary" onClick={sendDraft} disabled={!lead?.email}><Send size={15} /> Open email draft</Button></div></Card>
      </div>
    </div>
    <Card className="ai-card"><div className="ai-card-title"><span><WandSparkles size={18} /></span><div><h2>AI outreach assistant</h2><p>Suggestions use only saved lead details. Check them before copying or emailing.</p></div></div><div className="ai-controls"><label>Lead<select value={lead?.id || ''} onChange={(e) => setLeadId(e.target.value)}>{leads.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.company}</option>)}</select></label><Button variant="dark" onClick={() => void generate()} disabled={!lead || busy}><Sparkles size={16} />{busy ? 'Generating…' : 'Generate suggestions'}</Button></div>{ai && <div className="ai-result"><div className="ai-label"><span className="soft-badge">Generated suggestion · verify before use</span><div><Button onClick={() => void copy(ai)}><Copy size={15} /> Copy</Button><Button variant="primary" onClick={sendDraft} disabled={!lead?.email}><Send size={15} /> Open draft</Button></div></div><textarea rows={9} value={ai} onChange={(e) => setAi(e.target.value)} /></div>}</Card>
  </div>;
}

export function NotificationsPage() {
  const { data, refresh, toast } = useApp();
  const tasks = (data?.tasks || []).filter((task) => task.status === 'Due').sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt));
  const enable = async () => {
    if (!('Notification' in window)) { toast('This browser does not support desktop notifications.', 'error'); return; }
    const permission = await Notification.requestPermission();
    toast(permission === 'granted' ? 'Desktop notifications enabled.' : 'Notification permission was not granted.', permission === 'granted' ? 'success' : 'error');

  };
  const complete = async (id: string) => { try { await request('/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'Completed' }) }); await refresh(); toast('Follow-up completed.'); } catch (error) { toast(error instanceof Error ? error.message : 'Could not update reminder.', 'error'); } };
  return <div className="page-stack"><PageHeading eyebrow="Keep the next action visible" title="Notifications" description="Scheduled reminders are delivered to your persistent in-app inbox." action={<Button onClick={() => void enable()}><BellRing size={16} /> Enable browser alerts</Button>} />
    <div className="notification-settings"><Bell size={18} /><div><b>Reminder delivery</b><span>The API scheduler records due reminders in your persistent inbox, even while the CRM page is closed. Browser push needs additional service setup.</span></div><span className="neutral-badge">Local demo</span></div>
    <Card className="notifications-card"><div className="card-title-row"><div><h2>Delivered notifications</h2><p>{(data?.notifications || []).filter((item) => !item.readAt).length} unread in-app reminders</p></div></div><div className="notification-list">{(data?.notifications || []).map((item) => <article className="notification-row" key={item.id}><span className="notification-icon"><Bell size={17} /></span><div><b>{item.title}</b><span>{item.body}</span><small>{format(new Date(item.createdAt), 'EEE, d MMM · h:mm a')}{item.readAt ? ' · Read' : ''}</small></div>{!item.readAt && <Button onClick={() => void request('/notifications/' + item.id, { method: 'PATCH', body: JSON.stringify({ read: true }) }).then(refresh)}>Mark read</Button>}</article>)}{!data?.notifications.length && <p className="empty-inline">No reminder notifications have been delivered yet.</p>}</div></Card>    <Card className="notifications-card"><div className="card-title-row"><div><h2>Open reminders</h2><p>{tasks.length} active follow-up{tasks.length === 1 ? '' : 's'}</p></div></div><div className="notification-list">{tasks.map((task) => {
      const lead = data?.leads.find((item) => item.id === task.leadId);
      const overdue = Date.parse(task.dueAt) < Date.now();
      return <article className="notification-row" key={task.id}><span className={'notification-icon ' + (overdue ? 'urgent' : '')}><Bell size={17} /></span><div><b>{task.type} with {lead?.name || 'a lead'}</b><span>{lead?.company || 'Company not set'} · {task.notes || 'Follow-up reminder'}</span><small>{overdue ? 'Overdue · ' : ''}{format(new Date(task.dueAt), 'EEE, d MMM · h:mm a')}</small></div><Button onClick={() => void complete(task.id)}><Check size={15} /> Done</Button></article>;
    })}{!tasks.length && <div className="empty-table"><span><Bell size={23} /></span><b>All caught up</b><small>New follow-up reminders will appear here.</small></div>}</div></Card>
  </div>;
}

export function SettingsPage() {
  const { data, refresh, toast, logout } = useApp();
  const [currency, setCurrency] = useState(data?.settings.currency || 'INR');
  const [timezone, setTimezone] = useState(data?.settings.timezone || 'Asia/Kolkata');
  const [saving, setSaving] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  if (!data) return null;
  const save = async () => {
    setSaving(true);
    try { await request('/settings', { method: 'PUT', body: JSON.stringify({ currency, timezone }) }); await refresh(); toast('Workspace settings saved.'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not save settings.', 'error'); }
    finally { setSaving(false); }
  };
  return <div className="page-stack"><PageHeading eyebrow="Make the workspace fit your team" title="Settings" description="Manage targets, profile information, notifications and integrations." action={<Button variant="primary" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save settings'}</Button>} />
    <div className="settings-layout"><div className="settings-nav"><a className="active" href="#profile"><UserRound size={16} /> Profile</a><a href="#calling"><PhoneCall size={16} /> Calling</a><a href="#targets"><TrendingUpIcon /> Targets</a><a href="#notifications"><Bell size={16} /> Notifications</a><a href="#integrations"><PlugZap size={16} /> Integrations</a></div>
      <div className="settings-panels"><Card id="profile"><div className="settings-section-title"><span className="settings-icon"><UserRound size={18} /></span><div><h2>User profile</h2><p>Your administrator profile for this demo workspace.</p></div></div><div className="form-grid"><label>Full name<input value={data.user.name} readOnly /></label><label>Role<input value={data.user.role} readOnly /></label><label>Email<input value="rahul@example.test" readOnly /></label><label>Workspace<input value="CGBS Sales" readOnly /></label></div><div className="account-actions"><span className="neutral-badge">Local demo account</span><Button onClick={() => setAccountOpen(true)}>Sign out</Button></div></Card>
        <Card id="locale"><div className="settings-section-title"><span className="settings-icon"><TrendingUpIcon /></span><div><h2>Currency and time zone</h2><p>These settings control currency formatting and calendar display.</p></div></div><div className="form-grid"><label>Currency display<select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Timezone<input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" /></label></div></Card>
        <Card id="calling"><div className="settings-section-title"><span className="settings-icon"><PhoneCall size={18} /></span><div><h2>Calling</h2><p>Verify your mobile number before starting agent-first calls from the CRM.</p></div></div><CallingSettings /></Card>
        <Card id="targets"><div className="settings-section-title"><span className="settings-icon"><TrendingUpIcon /></span><div><h2>Custom sales targets</h2><p>Create, revise, deactivate, and review performance targets.</p></div></div><TargetManager /></Card>
      <Card id="notifications"><div className="settings-section-title"><span className="settings-icon"><Bell size={18} /></span><div><h2>Notifications</h2><p>Choose when the workspace can remind you about a follow-up.</p></div></div><div className="notification-pref"><span><b>Browser desktop notifications</b><small>Supported while this workspace is open.</small></span><Button onClick={() => void (async () => { if (!('Notification' in window)) return toast('Notifications are not supported.', 'error'); const permission = await Notification.requestPermission(); toast(permission === 'granted' ? 'Permission enabled.' : 'Permission not granted.', permission === 'granted' ? 'success' : 'error'); })()}>Request permission</Button></div><p className="field-help">This browser alert permission applies while the CRM is open. Background push requires the server setup described in REMINDERS.md.</p></Card>
        <Card id="integrations"><div className="settings-section-title"><span className="settings-icon"><PlugZap size={18} /></span><div><h2>Integrations</h2><p>Optional services remain safe when credentials are missing.</p></div></div><div className="integration-row"><div className="integration-logo ai-logo"><Sparkles size={19} /></div><div><b>AI outreach</b><small>{import.meta.env.VITE_AI_CONFIGURED ? 'Server configured' : 'Template-based fallback active'}</small></div><span className="integration-status">{import.meta.env.VITE_AI_CONFIGURED ? 'Connected' : 'Fallback'}</span></div><div className="integration-row"><div className="integration-logo outlook-logo"><Mail size={19} /></div><div><b>Outlook / Microsoft Graph</b><small>Graph OAuth is not configured. Email drafts use your mail app.</small></div><span className="integration-status muted">Not connected</span></div><div className="integration-row"><div className="integration-logo supabase-logo">S</div><div><b>Supabase</b><small>SQL schema and policies are included. App currently uses local JSON persistence.</small></div><span className="integration-status muted">Not connected</span></div></Card>
      </div>
    </div>
    {accountOpen && <Modal title="Sign out" sub="You will return to the local demo start screen." onClose={() => setAccountOpen(false)}><p className="confirm-copy">Sign out of the current demo session?</p><div className="modal-actions"><Button variant="ghost" onClick={() => setAccountOpen(false)}>Cancel</Button><Button variant="primary" onClick={logout}>Sign out</Button></div></Modal>}
  </div>;
}
function TrendingUpIcon() { return <span className="trending-up-glyph">↗</span>; }





