export type ExotelRegion = 'india' | 'singapore';
export type ExotelEnv = Record<string, string | undefined>;
export type ExotelConfig = {
  configured: boolean; verificationConfigured: boolean; region: ExotelRegion;
  apiKey: string; apiToken: string; accountSid: string; callerId: string;
  smsFrom: string; webhookBaseUrl: string; webhookUsername: string; webhookPassword: string;
  dltEntityId: string; dltTemplateId: string;
};

export function exotelConfig(env: ExotelEnv): ExotelConfig {
  const region: ExotelRegion = env.EXOTEL_REGION === 'singapore' ? 'singapore' : 'india';
  const config = {
    region, apiKey: env.EXOTEL_API_KEY || '', apiToken: env.EXOTEL_API_TOKEN || '', accountSid: env.EXOTEL_ACCOUNT_SID || '',
    callerId: env.EXOTEL_CALLER_ID || '', smsFrom: env.EXOTEL_SMS_FROM || '', webhookBaseUrl: (env.EXOTEL_WEBHOOK_BASE_URL || '').replace(/\/$/, ''),
    webhookUsername: env.EXOTEL_WEBHOOK_USERNAME || '', webhookPassword: env.EXOTEL_WEBHOOK_PASSWORD || '',
    dltEntityId: env.EXOTEL_DLT_ENTITY_ID || '', dltTemplateId: env.EXOTEL_DLT_TEMPLATE_ID || '',
  };
  const credentials = Boolean(config.apiKey && config.apiToken && config.accountSid);
  const webhook = /^https:\/\//i.test(config.webhookBaseUrl) && Boolean(config.webhookUsername && config.webhookPassword);
  const smsRegulatory = region === 'singapore' || Boolean(config.dltEntityId && config.dltTemplateId);
  return { ...config, configured: credentials && Boolean(config.callerId) && webhook, verificationConfigured: credentials && Boolean(config.smsFrom) && smsRegulatory, };
}

export function exotelHost(region: ExotelRegion) { return region === 'india' ? 'api.in.exotel.com' : 'api.exotel.com'; }
function authHeader(config: ExotelConfig) { return 'Basic ' + Buffer.from(`${config.apiKey}:${config.apiToken}`).toString('base64'); }
function messageFrom(body: string) { return body.match(/<Message>([^<]{1,300})<\/Message>/i)?.[1] || ''; }

async function exotelRequest(url: string, config: ExotelConfig, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { Authorization: authHeader(config), ...init.headers }, signal: AbortSignal.timeout(12_000) });
  const text = await response.text();
  let payload: any = {};
  try { payload = JSON.parse(text); } catch { /* Exotel may send XML on provider errors. */ }
  if (!response.ok) throw new Error(messageFrom(text) || payload?.RestException?.Message || `Exotel returned HTTP ${response.status}.`);
  return payload;
}

export async function sendExotelVerificationSms(to: string, code: string, config: ExotelConfig) {
  if (!config.verificationConfigured) throw new Error('Exotel SMS verification is not configured.');
  const form = new URLSearchParams({ From: config.smsFrom, To: to, Body: `Your CGBS calling verification code is ${code}. It expires in 10 minutes.` });
  if (config.dltEntityId) form.set('DltEntityId', config.dltEntityId);
  if (config.dltTemplateId) form.set('DltTemplateId', config.dltTemplateId);
  const url = `https://${exotelHost(config.region)}/v1/Accounts/${encodeURIComponent(config.accountSid)}/Sms/send.json`;
  await exotelRequest(url, config, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
}

export async function connectTwoNumbers(input: { from: string; to: string; voiceCallId: string }, config: ExotelConfig) {
  if (!config.configured) throw new Error('Exotel calling is not configured.');
  const form = new URLSearchParams({ From: input.from, To: input.to, CallerId: config.callerId, Record: 'false', StatusCallback: `${config.webhookBaseUrl}/api/exotel/callback`, StatusCallbackContentType: 'application/json', CustomField: input.voiceCallId.slice(0, 128) });
  form.append('StatusCallbackEvents[]', 'answered'); form.append('StatusCallbackEvents[]', 'terminal');
  const url = `https://${exotelHost(config.region)}/v1/Accounts/${encodeURIComponent(config.accountSid)}/Calls/connect.json`;
  const payload = await exotelRequest(url, config, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  const call = payload?.Call || payload?.call;
  const sid = call?.Sid || call?.sid;
  if (typeof sid !== 'string' || !sid) throw new Error('Exotel accepted the request without returning a call ID.');
  return { providerCallId: sid, status: call?.Status || call?.status, startedAt: call?.StartTime || call?.start_time, endedAt: call?.EndTime || call?.end_time, durationSeconds: Number(call?.Duration || call?.duration || 0) || null };
}

export type ExotelCallDetails = { Call?: { Sid?: string; Status?: string; StartTime?: string | null; EndTime?: string | null; Duration?: string | number | null; Details?: { ConversationDuration?: number | string; Leg1Status?: string; Leg2Status?: string } } };
export async function getExotelCallDetails(callSid: string, config: ExotelConfig) {
  if (!config.configured) throw new Error('Exotel calling is not configured.');
  const url = `https://${exotelHost(config.region)}/v1/Accounts/${encodeURIComponent(config.accountSid)}/Calls/${encodeURIComponent(callSid)}.json?details=true`;
  return await exotelRequest(url, config, { method: 'GET' }) as ExotelCallDetails;
}
