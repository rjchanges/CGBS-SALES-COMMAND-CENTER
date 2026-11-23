import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, type AuthedRequest } from './auth.js';

function harness(profile: unknown, authError: unknown = null, profileError: unknown = null, recoveredProfile: unknown = null, repairError: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: profileError });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com', email_confirmed_at: '2026-01-01T00:00:00.000Z' } }, error: authError }) };
  const rpc = vi.fn().mockResolvedValue({ data: recoveredProfile ? [recoveredProfile] : [], error: repairError });
  const client = { auth, from, rpc } as unknown as SupabaseClient;
  const req = { headers: { authorization: 'Bearer signed-jwt' } } as AuthedRequest;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  return { middleware: requireAuth(client, () => client), req, res, next, auth, from, eq, rpc, status, json };
}

describe('Supabase API authentication', () => {
  it('rejects missing bearer tokens', async () => {
    const h = harness({ id: 'user-1', full_name: 'User', role: 'salesperson', active: true });
    h.req.headers.authorization = undefined;
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(401);
    expect(h.auth.getUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired access token', async () => {
    const h = harness(null, { status: 401, message: 'expired' });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(401);
    expect(h.next).not.toHaveBeenCalled();
  });

  it('reports an Auth network/service failure separately from an invalid token', async () => {
    const h = harness(null, { status: 0, message: 'fetch failed' });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(503);
    expect(h.json).toHaveBeenCalledWith({ error: 'Could not verify the session with Supabase. Please try again.' });
  });

  it('continues to reject profiles that are intentionally disabled', async () => {
    const h = harness({ id: 'user-1', full_name: 'User', role: 'salesperson', active: false });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.next).not.toHaveBeenCalled();
  });

  it('accepts direct signup sessions when Supabase email confirmation is disabled', async () => {
    const h = harness({ id: 'user-1', full_name: 'User', role: 'salesperson', active: true });
    h.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com', email_confirmed_at: null } }, error: null });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).not.toHaveBeenCalled();
    expect(h.req.user?.role).toBe('Salesperson');
    expect(h.next).toHaveBeenCalledOnce();
  });

  it('resolves role and identity only from the verified profile', async () => {
    const h = harness({ id: 'user-1', full_name: 'Asha Nair', role: 'salesperson', active: true, pending_approval: true });
    await h.middleware(h.req, h.res, h.next);
    expect(h.req.user).toEqual({ id: 'user-1', name: 'Asha Nair', role: 'Salesperson', email: 'user@example.com' });
    expect(h.req.supabase).toBeDefined();
    expect(h.next).toHaveBeenCalledOnce();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('rejects a profile row whose id differs from the verified Auth identity', async () => {
    const h = harness({ id: 'some-other-user', full_name: 'Wrong User', role: 'salesperson', active: true });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.next).not.toHaveBeenCalled();
  });

  it('recovers a missing profile for the authenticated user through the secure RPC', async () => {
    const recovered = { id: 'user-1', full_name: 'Asha Nair', role: 'salesperson', active: true };
    const h = harness(null, null, null, recovered);
    await h.middleware(h.req, h.res, h.next);
    expect(h.rpc).toHaveBeenCalledWith('ensure_own_profile');
    expect(h.req.user).toEqual({ id: 'user-1', name: 'Asha Nair', role: 'Salesperson', email: 'user@example.com' });
    expect(h.next).toHaveBeenCalledOnce();
  });

  it('identifies an unrecoverable missing profile instead of reporting a permission error', async () => {
    const h = harness(null);
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(404);
    expect(h.json).toHaveBeenCalledWith({ error: 'Your authenticated account has no profile, and profile recovery returned no row. Apply the profile recovery migration.' });
    expect(h.next).not.toHaveBeenCalled();
  });

  it('distinguishes a profiles RLS denial from a missing profile', async () => {
    const h = harness(null, null, { code: '42501', message: 'permission denied' });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled();
  });

  it('reports missing profile recovery schema with a migration hint', async () => {
    const h = harness(null, null, null, null, { code: 'PGRST202', message: 'function missing' });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(503);
    expect(h.json).toHaveBeenCalledWith({ error: 'Automatic profile recovery is not installed. Apply migration 202611200001_profile_recovery.sql.' });
  });

  it('rejects unknown profile roles instead of granting a default role', async () => {
    const h = harness({ id: 'user-1', full_name: 'User', role: 'owner', active: true });
    await h.middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.next).not.toHaveBeenCalled();
  });
});
