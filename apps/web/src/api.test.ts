import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, setSession } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('API request errors', () => {
  it('explains when the local Vite proxy cannot reach the API server', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })));

    await expect(request('/auth/demo')).rejects.toThrow('The local API server is not running.');
  });

  it('preserves API error messages', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Local demo access is disabled.' }), { status: 403 })));

    await expect(request('/auth/demo')).rejects.toThrow('Local demo access is disabled.');
  });

  it('explains when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(request('/bootstrap')).rejects.toThrow('Check that the API server is running and VITE_API_URL is configured.');
  });
});
