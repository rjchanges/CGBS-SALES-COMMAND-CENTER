import { useEffect, useState } from 'react';
import { CheckCircle2, PhoneCall, ShieldCheck } from 'lucide-react';
import { Button } from './layout';
import { request } from './api';
import { useApp } from './context';

type CallingProfileResponse = {
  profile: { phone: string; verifiedAt: string | null; pendingPhone: string } | null;
  provider: { configured: boolean; verificationConfigured: boolean; region: string; callingMessage: string; verificationMessage: string };
};

export function CallingSettings() {
  const { toast } = useApp();
  const [settings, setSettings] = useState<CallingProfileResponse | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reload = async () => {
    const next = await request<CallingProfileResponse>('/calling/profile');
    setSettings(next);
    setPhone(next.profile?.pendingPhone || next.profile?.phone || '');
  };
  useEffect(() => { void reload().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load calling settings.')).finally(() => setLoading(false)); }, []);
  const sendCode = async () => {
    setBusy(true); setError('');
    try { const response = await request<{ message: string }>('/calling/verification', { method: 'POST', body: JSON.stringify({ phone }) }); await reload(); toast(response.message); }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Could not send verification code.'; setError(message); toast(message, 'error'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError('');
    try { await request('/calling/verify', { method: 'POST', body: JSON.stringify({ code }) }); await reload(); setCode(''); toast('Your calling number is verified.'); }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Could not verify this number.'; setError(message); toast(message, 'error'); }
    finally { setBusy(false); }
  };
  return <div className="calling-settings">
    <div className="calling-settings-status"><span className={'integration-status ' + (settings?.provider.configured ? '' : 'muted')}>{settings?.provider.configured ? 'Exotel calling configured' : 'Exotel calling unavailable'}</span><span className="neutral-badge">{settings?.provider.region || '—'}</span></div>
    {!settings?.provider.configured && <p className="field-help calling-settings-message">{settings?.provider.callingMessage || 'Loading provider configuration…'}</p>}
    {settings?.profile?.verifiedAt && <div className="verified-phone"><ShieldCheck size={17} /><span><b>{settings.profile.phone}</b><small>Verified for your account</small></span><CheckCircle2 size={16} /></div>}
    <div className="calling-settings-form"><label>Your mobile number<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+919876543210" pattern="\+[1-9]\d{7,14}" aria-describedby="calling-phone-help" /></label><Button onClick={() => void sendCode()} disabled={busy || loading || !settings?.provider.verificationConfigured || !/^\+[1-9]\d{7,14}$/.test(phone)}><PhoneCall size={14} />{busy ? 'Sending…' : settings?.profile?.verifiedAt ? 'Verify updated number' : 'Send verification code'}</Button></div>
    <small id="calling-phone-help" className="field-help">Use full international E.164 format, such as +919876543210. A new number does not replace your current verified number until it passes verification.</small>
    {settings?.profile?.pendingPhone && <div className="calling-verify-row"><div><b>Verification pending for {settings.profile.pendingPhone}</b><small>Enter the six-digit code from Exotel SMS. It expires in 10 minutes.</small></div><label>Verification code<input value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label><Button variant="primary" onClick={() => void verify()} disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify number'}</Button></div>}
    {!settings?.provider.verificationConfigured && <p className="field-help calling-settings-message">{settings?.provider.verificationMessage}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
