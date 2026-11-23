import { afterEach, describe, expect, it, vi } from 'vitest';
const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: mockGetSession } } }));
import { request } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
});

describe('API request errors', () => {
  it('explains when the local Vite proxy cannot reach the API server', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('ECONNREFUSED', { status: 502 })));

    await expect(request('/auth/me')).rejects.toThrow('The local API server is not running.');
  });

  it('preserves API error messages', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Your account is disabled.' }), { status: 403 })));

    await expect(request('/auth/me')).rejects.toThrow('Your account is disabled.');
  });

  it('explains when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(request('/bootstrap')).rejects.toThrow('Check that the API server is running and VITE_API_URL is configured.');
  });

  it('retries transient network failures before surfacing an API connection error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ leads: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = request<{ leads: unknown[] }>('/bootstrap');
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({ leads: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('attaches the current Supabase access token to protected API requests', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'verified-supabase-jwt' } } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ user: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await request('/auth/me');

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer verified-supabase-jwt');
  });

  it('uses the same-origin API path in development so Vite can proxy it', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ user: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await request('/auth/me');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me');
  });
});
