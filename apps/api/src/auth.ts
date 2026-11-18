import type { NextFunction, Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runAsDatabaseActor } from './databaseContext.js';

export type AppUser = { id: string; name: string; role: 'Admin' | 'Manager' | 'Salesperson'; email: string };
export type AuthedRequest = Request & { user?: AppUser; supabase?: SupabaseClient };

export function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set when DEMO_MODE is false.');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function requireAuth(supabase: SupabaseClient, userClientFactory = (token: string) => createClient(
  process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  },
)) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Sign in to continue.' });
    }
    const token = header.slice(7);
    try {
      // getUser(jwt) verifies the access token with Supabase Auth, rather than
      // trusting its decoded claims. Subsequent queries use this user's JWT so RLS applies.
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
      if (authError) {
        const status = Number((authError as { status?: number }).status || 0);
        if (status === 400 || status === 401) return res.status(401).json({ error: 'Your session has expired or is invalid. Sign in again.' });
        if (status === 403) return res.status(403).json({ error: 'Supabase denied this session. Contact support if the problem continues.' });
        return res.status(503).json({ error: 'Could not verify the session with Supabase. Please try again.' });
      }
      if (!authUser) return res.status(401).json({ error: 'Your session is invalid. Sign in again.' });
      const userClient = userClientFactory(token);
      const { data: existingProfile, error: profileError } = await userClient
        .from('profiles')
        .select('id, full_name, role, active')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profileError) {
        const code = (profileError as { code?: string }).code;
        if (code === '42501') return res.status(403).json({ error: 'The database denied access to your account profile. Check the profiles RLS policies.' });
        if (code === '42P01' || code === 'PGRST205') return res.status(503).json({ error: 'The profiles table is unavailable. Apply the Supabase schema migrations.' });
        return res.status(503).json({ error: `Could not read your account profile from the database${code ? ` (${code})` : ''}. Please try again.` });
      }

      let profile = existingProfile;
      if (!profile) {
        // The RPC is SECURITY DEFINER but derives its target exclusively from
        // auth.uid(). It can only repair the current user's missing profile.
        const { data: repairedProfile, error: repairError } = await userClient.rpc('ensure_own_profile');
        if (repairError) {
          const code = (repairError as { code?: string }).code;
          if (code === '42501') return res.status(403).json({ error: 'The database denied profile recovery. Check the profiles RLS policies.' });
          if (code === 'PGRST202' || code === '42883') return res.status(503).json({ error: 'Automatic profile recovery is not installed. Apply migration 202611200001_profile_recovery.sql.' });
          return res.status(503).json({ error: `Could not recover your account profile${code ? ` (${code})` : ''}. Please try again.` });
        }
        profile = (Array.isArray(repairedProfile) ? repairedProfile[0] : repairedProfile) as typeof existingProfile;
        if (!profile) return res.status(404).json({ error: 'Your authenticated account has no profile, and profile recovery returned no row. Apply the profile recovery migration.' });
      }
      if (profile.id !== authUser.id) return res.status(403).json({ error: 'The database returned a profile for a different account. Access denied.' });
      if (!profile.active) return res.status(403).json({ error: 'Your account is disabled. Contact support.' });
      const roleMap: Record<string, AppUser['role']> = { admin: 'Admin', manager: 'Manager', salesperson: 'Salesperson' };
      if (!Object.hasOwn(roleMap, profile.role)) return res.status(403).json({ error: 'Your account has an invalid role. Contact an administrator.' });
      req.user = { id: authUser.id, name: profile.full_name, role: roleMap[profile.role], email: authUser.email ?? '' };
      req.supabase = userClient;
      return runAsDatabaseActor({ id: authUser.id, role: profile.role as 'admin' | 'manager' | 'salesperson' }, next);
    } catch {
      return res.status(503).json({ error: 'Supabase or the database could not be reached while validating your account. Please try again.' });
    }
  };
}

export function requireDemoSession(demoMode: boolean) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!demoMode) return res.status(503).json({ error: 'Production authentication is not configured. Connect Supabase before disabling DEMO_MODE.' });
    if (req.headers.authorization !== 'Bearer demo-session') return res.status(401).json({ error: 'Your demo session has expired.' });
    req.user = { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin', email: 'demo@example.com' };
    next();
  };
}
