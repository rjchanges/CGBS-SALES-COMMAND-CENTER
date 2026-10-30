import type { NextFunction, Request, Response } from 'express';

export type AuthedRequest = Request & { user?: { id: string; name: string; role: 'Admin' | 'Manager' | 'Salesperson' } };

export function requireDemoSession(demoMode: boolean) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!demoMode) return res.status(503).json({ error: 'Production authentication is not configured. Connect Supabase before disabling DEMO_MODE.' });
    if (req.headers.authorization !== 'Bearer demo-session') return res.status(401).json({ error: 'Your demo session has expired.' });
    req.user = { id: 'demo-admin', name: 'Rahul Raj M', role: 'Admin' };
    next();
  };
}