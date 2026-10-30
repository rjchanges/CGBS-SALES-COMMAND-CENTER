import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectTwoNumbers, exotelConfig, exotelHost, sendExotelVerificationSms } from './exotelClient.js';

const configured = exotelConfig({ EXOTEL_API_KEY: 'test-key', EXOTEL_API_TOKEN: 'test-token', EXOTEL_ACCOUNT_SID: 'account', EXOTEL_CALLER_ID: '+911234567890', EXOTEL_REGION: 'india', EXOTEL_WEBHOOK_BASE_URL: 'https://crm.example.test', EXOTEL_WEBHOOK_USERNAME: 'hook-user', EXOTEL_WEBHOOK_PASSWORD: 'hook-pass', EXOTEL_SMS_FROM: 'CGBS', EXOTEL_DLT_ENTITY_ID: 'entity', EXOTEL_DLT_TEMPLATE_ID: 'template' });
afterEach(() => vi.unstubAllGlobals());

describe('Exotel provider adapter', () => {
  it('selects account-region endpoints', () => {
    expect(exotelHost('india')).toBe('api.in.exotel.com');
    expect(exotelHost('singapore')).toBe('api.exotel.com');
  });
  it('uses Connect Two Numbers with the salesperson first and recording explicitly off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Call: { Sid: 'sid-123', Status: 'queued' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await connectTwoNumbers({ from: '+919876543210', to: '+918765432109', voiceCallId: 'crm-call-1' }, configured);
    expect(result.providerCallId).toBe('sid-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.in.exotel.com/v1/Accounts/account/Calls/connect.json');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('From')).toBe('+919876543210'); expect(body.get('To')).toBe('+918765432109');
    expect(body.get('CallerId')).toBe('+911234567890'); expect(body.get('Record')).toBe('false');
    expect(init.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
  });
  it('sends OTP using Exotel SMS API and errors without credential setup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"SMSMessage":{}}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    await sendExotelVerificationSms('+919876543210', '123456', configured);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/Sms/send.json');
    await expect(sendExotelVerificationSms('+919876543210', '123456', exotelConfig({}))).rejects.toThrow(/not configured/i);
  });
});
