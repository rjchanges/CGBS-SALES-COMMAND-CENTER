import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthHandler } from './healthRoute.js';
import { configureRenderProxyTrust } from './proxyTrust.js';
import { createRetryingScheduler } from './reminderScheduler.js';

async function invokeHandler(handler: express.RequestHandler): Promise<{ status: number; body: unknown }> {
  const result: { status: number; body: unknown } = { status: 200, body: undefined };
  const response = {
    status(code: number) { result.status = code; return this; },
    json(body: unknown) { result.body = body; return this; },
  } as unknown as Response;
  await handler({} as Request, response, vi.fn());
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe('Render proxy configuration', () => {
  it('trusts exactly one managed proxy hop before the API rate limiter', () => {
    const app = express();
    configureRenderProxyTrust(app);
    const limiter = rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: 'draft-7', legacyHeaders: false });
    app.use(limiter);
    expect(app.get('trust proxy')).toBe(1);
    expect(typeof limiter).toBe('function');
    const trust = app.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('198.51.100.10', 1)).toBe(false);
  });
});

describe('database health route', () => {
  it('returns degraded status for invalid or unavailable storage without returning secrets', async () => {
    const response = await invokeHandler(createHealthHandler(false, async () => ({ configured: false, connected: false, storage: 'postgresql', error: 'DATABASE_URL is invalid.' })));
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'degraded', storage: { configured: false, connected: false, error: 'DATABASE_URL is invalid.' } });
  });

  it('returns ready only when PostgreSQL and the required schema are ready', async () => {
    const response = await invokeHandler(createHealthHandler(false, async () => ({ configured: true, connected: true, storage: 'postgresql' })));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', storage: { configured: true, connected: true } });
  });
});

describe('reminder scheduler retry behavior', () => {
  it('backs off repeated connection errors, reports them periodically, and resumes after recovery', async () => {
    let time = 1_000;
    let attempts = 0;
    let shouldFail = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tick = createRetryingScheduler(
      async () => { attempts++; if (shouldFail) throw Object.assign(new Error('database unavailable'), { code: 'ETIMEDOUT' }); },
      () => 'PostgreSQL connection timed out.',
      { initialRetryMs: 10, maxRetryMs: 40, reportIntervalMs: 40, now: () => time },
    );
    await tick();
    await tick();
    expect(attempts).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    time += 10;
    await tick();
    expect(attempts).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
    time += 20;
    await tick();
    expect(attempts).toBe(3);
    expect(log).toHaveBeenCalledTimes(1);
    time += 40;
    await tick();
    expect(attempts).toBe(4);
    expect(log).toHaveBeenCalledTimes(2);
    shouldFail = false;
    time += 40;
    await tick();
    expect(attempts).toBe(5);
    time += 10;
    await tick();
    expect(attempts).toBe(6);
  });
});
