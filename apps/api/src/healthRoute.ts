import type { RequestHandler } from 'express';
import { checkDatabaseHealth, type DatabaseHealth } from './postgresStore.js';

export function createHealthHandler(
  demoMode: boolean,
  check = checkDatabaseHealth,
): RequestHandler {
  return async (_req, res) => {
    if (demoMode) {
      return res.json({ status: 'ok', mode: 'local-demo', storage: { configured: true, connected: true, storage: 'local-json' }, timestamp: new Date().toISOString() });
    }
    const storage: DatabaseHealth = await check();
    const ready = storage.connected;
    return res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded', mode: 'production', storage, timestamp: new Date().toISOString() });
  };
}
