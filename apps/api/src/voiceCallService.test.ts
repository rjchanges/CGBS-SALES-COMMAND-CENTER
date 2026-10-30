import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedState } from './seedData.js';
import { applyVoiceStatus, prepareVoiceCall, savePendingPhone, statusFromProvider, verifyExotelBasicAuth, verifyPendingPhone } from './voiceCallService.js';
import { recordVoiceCallOutcome } from './callService.js';

const actor = { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin' as const };
let state = createSeedState();
beforeEach(() => { state = createSeedState(); state.leads[0]!.phone = '+918765432109'; });

describe('agent-first voice calling', () => {
  it('verifies an E.164 profile before allowing calls', () => {
    expect(() => savePendingPhone(state, actor, '9876543210', 'hash', new Date(Date.now() + 600_000).toISOString())).toThrow(/E.164/);
    savePendingPhone(state, actor, '+919876543210', 'otp-hash', new Date(Date.now() + 600_000).toISOString());
    expect(() => prepareVoiceCall(state, state.leads[0]!.id, actor, 'req-1')).toThrow(/Verify your own/);
    verifyPendingPhone(state, actor, 'otp-hash');
    const prepared = prepareVoiceCall(state, state.leads[0]!.id, actor, 'req-1');
    expect(prepared.call.fromNumber).toBe('+919876543210');
    expect(prepared.call.toNumber).toBe(state.leads[0]!.phone);
  });

  it('prevents registering a caller number already owned by another user', () => {
    const salesperson = { id: 'seller-2', name: 'Sales User', role: 'Salesperson' as const };
    savePendingPhone(state, actor, '+919876543210', 'admin-hash', new Date(Date.now() + 600_000).toISOString()); verifyPendingPhone(state, actor, 'admin-hash');
    expect(() => savePendingPhone(state, salesperson, '+919876543210', 'seller-hash', new Date(Date.now() + 600_000).toISOString())).toThrow(/already registered/);
  });

  it('does not let salespeople use another employee profile or call an unassigned lead', () => {
    const salesperson = { id: 'seller-1', name: 'Other Seller', role: 'Salesperson' as const };
    savePendingPhone(state, actor, '+919876543210', 'hash', new Date(Date.now() + 600_000).toISOString());
    verifyPendingPhone(state, actor, 'hash');
    state.leads[0]!.assignedTo = salesperson.name;
    savePendingPhone(state, salesperson, '+14155552671', 'seller-hash', new Date(Date.now() + 600_000).toISOString()); verifyPendingPhone(state, salesperson, 'seller-hash');
    expect(() => prepareVoiceCall(state, state.leads[1]!.id, salesperson, 'not-assigned')).toThrow(/permission/);
    const call = prepareVoiceCall(state, state.leads[0]!.id, salesperson, 'seller-call');
    expect(call.call.fromNumber).toBe('+14155552671');
    expect(call.call.fromNumber).not.toBe('+919876543210');
  });

  it('creates one provider request for an idempotency key and maps agent answer before client connection', () => {
    savePendingPhone(state, actor, '+919876543210', 'hash', new Date(Date.now() + 600_000).toISOString()); verifyPendingPhone(state, actor, 'hash');
    const first = prepareVoiceCall(state, state.leads[0]!.id, actor, 'unique-key');
    const duplicate = prepareVoiceCall(state, state.leads[0]!.id, actor, 'unique-key');
    expect(duplicate.duplicate).toBe(true); expect(duplicate.call.id).toBe(first.call.id);
    expect(statusFromProvider('in-progress', 'in-progress', null)).toBe('Connecting to Client');
    expect(statusFromProvider('in-progress', 'in-progress', 'in-progress')).toBe('Connected');
  });

  it('handles failed calls and terminal webhook retries without duplicate CRM records', () => {
    savePendingPhone(state, actor, '+919876543210', 'hash', new Date(Date.now() + 600_000).toISOString()); verifyPendingPhone(state, actor, 'hash');
    const { call } = prepareVoiceCall(state, state.leads[0]!.id, actor, 'failed-call'); call.providerCallId = 'provider-sid';
    applyVoiceStatus(state, call, { status: 'No Answer', providerCallId: 'provider-sid', eventId: 'event-1' });
    applyVoiceStatus(state, call, { status: 'No Answer', providerCallId: 'provider-sid', eventId: 'event-2' });
    expect(state.calls.filter((item) => item.providerCallId === 'provider-sid')).toHaveLength(1);
    expect(state.calls[0]!.outcome).toBe('No Answer');
    expect(statusFromProvider('failed')).toBe('Failed');
    expect(statusFromProvider('busy')).toBe('Busy');
  });

  it('records one final provider call, its salesperson outcome, and a next follow-up', () => {
    savePendingPhone(state, actor, '+919876543210', 'hash', new Date(Date.now() + 600_000).toISOString()); verifyPendingPhone(state, actor, 'hash');
    const { call } = prepareVoiceCall(state, state.leads[0]!.id, actor, 'outcome-key'); call.providerCallId = 'provider-outcome';
    applyVoiceStatus(state, call, { status: 'Completed', providerCallId: call.providerCallId, durationSeconds: 85 });
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    recordVoiceCallOutcome(state, call.id, { outcome: 'Interested', notes: 'Asked for a proposal.', nextAction: { type: 'Call', dueAt } }, actor);
    expect(state.calls.filter((item) => item.providerCallId === call.providerCallId)).toHaveLength(1);
    expect(state.calls.find((item) => item.providerCallId === call.providerCallId)?.outcome).toBe('Interested');
    expect(state.tasks.some((item) => item.leadId === call.leadId && item.status === 'Due')).toBe(true);
    expect(call.outcomeRecordedAt).toBeTruthy();
    expect(() => recordVoiceCallOutcome(state, call.id, { outcome: 'Interested' }, actor)).toThrow(/already been recorded/);
  });

  it('authenticates callbacks using timing-safe configured Basic credentials', () => {
    const auth = 'Basic ' + Buffer.from('callback-user:callback-pass').toString('base64');
    expect(verifyExotelBasicAuth(auth, 'callback-user', 'callback-pass')).toBe(true);
    expect(verifyExotelBasicAuth(auth, 'callback-user', 'wrong')).toBe(false);
    expect(verifyExotelBasicAuth(undefined, 'callback-user', 'callback-pass')).toBe(false);
  });
});
