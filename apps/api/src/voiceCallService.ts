import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { CGBSState, UserCallingProfile, VoiceCall, VoiceCallStatus } from '../../../packages/shared/dist/index.js';
import type { TargetActor } from './targetService.js';
import { isE164PhoneNumber, normalizeE164PhoneNumber } from './phoneNumber.js';

export class VoiceCallError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export type VoiceActor = TargetActor & { id: string };

export function callingProfile(state: CGBSState, actor: VoiceActor) {
  return state.callingProfiles.find((item) => item.userId === actor.id) || null;
}
export function savePendingPhone(state: CGBSState, actor: VoiceActor, phone: string, codeHash: string, expiresAt: string) {
  if (!isE164PhoneNumber(phone)) throw new VoiceCallError('Enter a valid phone number in international E.164 format, such as +919876543210.');
  if (state.callingProfiles.some((item) => item.userId !== actor.id && (item.phone === phone && item.verifiedAt || item.pendingPhone === phone))) throw new VoiceCallError('This mobile number is already registered or pending verification for another employee.', 409);
  const profile = state.callingProfiles.find((item) => item.userId === actor.id);
  const pending: UserCallingProfile = profile || { userId: actor.id, userName: actor.name, phone: '', verifiedAt: null, pendingPhone: '', verificationCodeHash: '', verificationExpiresAt: null, verificationAttempts: 0, updatedAt: new Date().toISOString() };
  if (!profile) state.callingProfiles.push(pending);
  pending.userName = actor.name; pending.pendingPhone = phone; pending.verificationCodeHash = codeHash;
  pending.verificationExpiresAt = expiresAt; pending.verificationAttempts = 0; pending.updatedAt = new Date().toISOString();
  return pending;
}
export function verifyPendingPhone(state: CGBSState, actor: VoiceActor, codeHash: string, now = Date.now()) {
  const profile = callingProfile(state, actor);
  if (!profile?.pendingPhone || !profile.verificationCodeHash || !profile.verificationExpiresAt) throw new VoiceCallError('Request a verification code first.', 409);
  if (Date.parse(profile.verificationExpiresAt) <= now) throw new VoiceCallError('That verification code expired. Request a new code.', 410);
  if (profile.verificationAttempts >= 5) throw new VoiceCallError('Too many incorrect codes. Request a new code.', 429);
  profile.verificationAttempts += 1;
  if (!safeEqual(profile.verificationCodeHash, codeHash)) throw new VoiceCallError('The verification code is incorrect.', 400);
  profile.phone = profile.pendingPhone; profile.verifiedAt = new Date(now).toISOString(); profile.pendingPhone = '';
  profile.verificationCodeHash = ''; profile.verificationExpiresAt = null; profile.verificationAttempts = 0; profile.updatedAt = profile.verifiedAt;
  return profile;
}

export function prepareVoiceCall(state: CGBSState, leadId: string, actor: VoiceActor, idempotencyKey: string) {
  const duplicate = state.voiceCalls.find((item) => item.userId === actor.id && item.idempotencyKey === idempotencyKey);
  if (duplicate) return { call: duplicate, duplicate: true };
  if (state.voiceCalls.some((item) => item.userId === actor.id && !['Completed','No Answer','Busy','Failed','Cancelled'].includes(item.status))) throw new VoiceCallError('You already have an active click-to-call request. Wait for it to finish before starting another call.', 409);
  const lead = state.leads.find((item) => item.id === leadId && !item.archived);
  if (!lead) throw new VoiceCallError('Lead not found.', 404);
  if (lead.status === 'Won' || lead.status === 'Lost') throw new VoiceCallError('This lead is closed. Reopen it from Opportunities before calling.', 409);
  if (actor.role !== 'Admin' && actor.role !== 'Manager' && lead.assignedTo.toLowerCase() !== actor.name.toLowerCase()) throw new VoiceCallError('You do not have permission to call this lead.', 403);
  const clientNumber = normalizeE164PhoneNumber(lead.phone);
  if (!clientNumber) throw new VoiceCallError('This lead needs a valid international phone number before calling.');
  const profile = callingProfile(state, actor);
  if (!profile?.phone || !profile.verifiedAt) throw new VoiceCallError('Verify your own mobile number in Calling Settings before placing calls.', 409);
  const now = new Date().toISOString();
  const call: VoiceCall = { id: randomUUID(), leadId, userId: actor.id, userName: actor.name, fromNumber: profile.phone, toNumber: clientNumber, provider: 'exotel', providerCallId: null, status: 'Request Submitted', idempotencyKey, requestedAt: now, startedAt: null, endedAt: null, durationSeconds: null, lastProviderEventId: null, errorMessage: '', outcomeRecordedAt: null };
  state.voiceCalls.unshift(call);
  return { call, duplicate: false };
}

export function canViewVoiceCall(call: VoiceCall, actor: VoiceActor) {
  return call.userId === actor.id || actor.role === 'Admin' || actor.role === 'Manager';
}

export function statusFromProvider(status: unknown, leg1?: unknown, leg2?: unknown, durationSeconds?: number | null): VoiceCallStatus | null {
  const normalized = String(status || '').toLowerCase().replaceAll('_', '-');
  const first = String(leg1 || '').toLowerCase().replaceAll('_', '-');
  const second = String(leg2 || '').toLowerCase().replaceAll('_', '-');
  if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(normalized)) {
    if (normalized === 'completed') return 'Completed';
    if (normalized === 'busy' || first === 'busy' || second === 'busy') return 'Busy';
    if (normalized === 'no-answer' || first === 'no-answer' || second === 'no-answer') return 'No Answer';
    if (normalized === 'canceled' || normalized === 'cancelled') return 'Cancelled';
    return 'Failed';
  }
  if (second === 'in-progress' || second === 'completed' || second === 'answered') return 'Connected';
  if (first === 'in-progress' || first === 'completed' || first === 'answered' || normalized === 'in-progress') return 'Connecting to Client';
  if (normalized === 'ringing' || first === 'ringing' || normalized === 'queued' || normalized === 'initiated') return 'Calling You';
  return null;
}

export function applyVoiceStatus(state: CGBSState, call: VoiceCall, input: { status: VoiceCallStatus; providerCallId?: string; eventId?: string | null; startedAt?: string | null; endedAt?: string | null; durationSeconds?: number | null; errorMessage?: string }) {
  if (call.lastProviderEventId && input.eventId === call.lastProviderEventId) return call;
  const finalStates: VoiceCallStatus[] = ['Completed', 'No Answer', 'Busy', 'Failed', 'Cancelled'];
  const progress: VoiceCallStatus[] = ['Request Submitted','Calling You','Connecting to Client','Connected'];
  const downgrade = finalStates.includes(call.status) && !finalStates.includes(input.status) || progress.includes(call.status) && progress.includes(input.status) && progress.indexOf(input.status) < progress.indexOf(call.status);
  if (!downgrade) call.status = input.status;
  call.providerCallId = input.providerCallId || call.providerCallId;
  call.lastProviderEventId = input.eventId || call.lastProviderEventId;
  call.startedAt = input.startedAt || call.startedAt; call.endedAt = input.endedAt || call.endedAt;
  call.durationSeconds = input.durationSeconds ?? call.durationSeconds; call.errorMessage = input.errorMessage || '';
  const now = new Date().toISOString();
  if (finalStates.includes(call.status) && call.providerCallId && !state.calls.some((item) => item.providerCallId === call.providerCallId)) {
    const lead = state.leads.find((item) => item.id === call.leadId);
    const outcome = call.status === 'Completed' ? 'Answered' : call.status;
    const durationSeconds = call.durationSeconds ?? 0;
    state.calls.unshift({ id: call.id, leadId: call.leadId, outcome, notes: 'Click-to-call via Exotel.', durationMinutes: Math.ceil(durationSeconds / 60), durationSeconds, provider: 'exotel', providerCallId: call.providerCallId, startedAt: call.startedAt, endedAt: call.endedAt, createdAt: call.startedAt || call.requestedAt, createdBy: call.userName, clientMutationId: `exotel:${call.providerCallId}` });
    if (lead) { lead.lastContacted = call.startedAt || call.requestedAt; lead.updatedAt = now; }
    state.activities.unshift({ id: randomUUID(), leadId: call.leadId, type: 'Call', title: 'Click-to-call · ' + call.status, detail: `Call by ${call.userName}${durationSeconds ? ` · ${durationSeconds}s` : ''}.`, createdAt: now, createdBy: call.userName });
  }
  return call;
}

export function verifyExotelBasicAuth(header: string | undefined, username: string, password: string) {
  if (!header?.startsWith('Basic ') || !username || !password) return false;
  const actual = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const expected = `${username}:${password}`;
  return safeEqual(actual, expected);
}

function safeEqual(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
