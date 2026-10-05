import { describe, expect, it, vi } from 'vitest';
import { BilibiliClient, BilibiliError, collectCookies, validateQrUrl } from '../src/electron/bilibili-client';
import type { Credentials } from '../src/electron/credentials-store';

vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  publicEncrypt: vi.fn(() => Buffer.from('mock-encrypted-refresh-path')),
}));

const session: Credentials = { cookies: { SESSDATA: 'session-secret', bili_jct: 'csrf-secret' }, refreshToken: 'refresh-secret' };
const qrUrl = 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=login-key';
const json = (data: unknown, headers?: HeadersInit) => new Response(JSON.stringify({ code: 0, data }), { headers });

describe('QR sign-in transport', () => {
  it('accepts the expected HTTPS passport scan link', () => {
    expect(validateQrUrl(qrUrl)).toBe(qrUrl);
  });

  it('accepts the currently returned Bilibili account scan link', () => {
    const url = 'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=login-key';
    expect(validateQrUrl(url)).toBe(url);
  });

  it.each([
    'http://passport.bilibili.com/h5-app/passport/login/scan',
    'https://passport.bilibili.com.evil.example/h5-app/passport/login/scan',
    'https://evil.example/h5-app/passport/login/scan',
    'https://user:password@passport.bilibili.com/h5-app/passport/login/scan',
    'https://passport.bilibili.com/unexpected',
    'https://account.bilibili.com/h5/account-h5/auth/unexpected',
    'https://account.bilibili.com.evil.example/h5/account-h5/auth/scan-web',
    'https://account.bilibili.com:8443/h5/account-h5/auth/scan-web',
    'javascript:alert(1)',
  ])('rejects an unexpected QR link: %s', (url) => {
    expect(() => validateQrUrl(url)).toThrow();
  });

  it('rejects an unexpected link returned by the API before presenting a QR code', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ url: 'https://evil.example/login', qrcode_key: 'login-key' }));
    await expect(new BilibiliClient(request).generateQr()).rejects.toThrow('unexpected sign-in link');
  });

  it.each([86101, 86090, 86038])('returns QR progress %i without creating a session', async (code) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ code }));
    expect(await new BilibiliClient(request).pollQr('key&injected=value')).toEqual({ code, credentials: null });
    expect(request.mock.calls[0][0]).toContain('qrcode_key=key%26injected%3Dvalue');
  });

  it('collects confirmed sign-in cookies without exposing them as a redirect URL', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ code: 0, refresh_token: 'refresh-secret' }, [
      ['Set-Cookie', 'SESSDATA=session-secret; Domain=.bilibili.com; Secure; HttpOnly'],
      ['Set-Cookie', 'bili_jct=csrf-secret; Domain=.bilibili.com; Secure'],
    ]));
    expect(await new BilibiliClient(request).pollQr('login-key')).toEqual({ code: 0, credentials: session });
  });

  it('rejects confirmed sign-in with incomplete credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ code: 0 }, { 'Set-Cookie': 'SESSDATA=session-secret; Secure' }));
    await expect(new BilibiliClient(request).pollQr('login-key')).rejects.toThrow('incomplete');
  });
});

describe('cookie collection', () => {
  it('rejects foreign-domain cookies and applies deletion without changing unrelated cookies', () => {
    const headers = new Headers([
      ['Set-Cookie', 'SESSDATA=new-session; Domain=.bilibili.com; HttpOnly'],
      ['Set-Cookie', 'foreign=ignored; Domain=bilibili.com.evil.example'],
      ['Set-Cookie', 'bili_jct=expired; Max-Age=0'],
      ['Set-Cookie', 'empty=; Secure'],
    ]);
    expect(collectCookies(headers, { SESSDATA: 'old-session', bili_jct: 'old-csrf', empty: 'old', retained: 'value' }))
      .toEqual({ SESSDATA: 'new-session', retained: 'value' });
  });
});

describe('session validation', () => {
  it('returns a profile while keeping session cookies in the request headers', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ isLogin: true, mid: 123, uname: 'Creator', face: 'https://i0.hdslb.com/bfs/face/avatar.jpg', level_info: { current_level: 6 }, vipStatus: 1 }));
    expect(await new BilibiliClient(request).validate(session)).toEqual({ uid: 123, name: 'Creator', avatar: 'https://i0.hdslb.com/bfs/face/avatar.jpg', level: 6, isVip: true });
    const [url, options] = request.mock.calls[0];
    expect(url).not.toContain('session-secret');
    expect(new Headers(options?.headers).get('Cookie')).toBe('SESSDATA=session-secret; bili_jct=csrf-secret');
    expect(options?.redirect).toBe('error');
  });

  it('does not accept profile avatars from arbitrary hosts', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ isLogin: true, mid: 123, uname: 'Creator', face: 'https://evil.example/avatar.jpg' }));
    expect((await new BilibiliClient(request).validate(session)).avatar).toBe('');
  });

  it('distinguishes an expired session from an unreachable server', async () => {
    const expired = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: -101, message: 'untrusted session-secret' })));
    await expect(new BilibiliClient(expired).validate(session)).rejects.toMatchObject({ code: -101 });
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket session-secret'));
    await expect(new BilibiliClient(offline).validate(session)).rejects.toThrow('Could not reach Bilibili. Check your connection and try again.');
  });

  it('treats a non-logged-in navigation response as expired', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ isLogin: false }));
    await expect(new BilibiliClient(request).validate(session)).rejects.toBeInstanceOf(BilibiliError);
    request.mockResolvedValue(json({ isLogin: false }));
    await expect(new BilibiliClient(request).validate(session)).rejects.toMatchObject({ code: -101 });
  });
});

describe('session renewal', () => {
  it('leaves a current session alone when the server does not require rotation', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ refresh: false, timestamp: 1 }));
    const persist = vi.fn();
    expect(await new BilibiliClient(request).renew(session, persist)).toBe(session);
    expect(request).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it('persists the rotated session before retiring its previous token', async () => {
    const events: string[] = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/cookie/info')) return json({ refresh: true, timestamp: 123 });
      if (url.includes('/correspond/')) return new Response('<div id="1-name">renewal-csrf</div>');
      if (url.includes('/cookie/refresh')) return json({ refresh_token: 'new-refresh' }, [
        ['Set-Cookie', 'SESSDATA=new-session; Domain=.bilibili.com'],
        ['Set-Cookie', 'bili_jct=new-csrf; Domain=.bilibili.com'],
      ]);
      if (url.includes('/confirm/refresh')) { events.push('confirm'); return json({}); }
      throw new Error('Unexpected test request');
    });
    const saved: Credentials[] = [];
    const persist = async (value: Credentials) => {
      saved.push(structuredClone(value));
      events.push(value.pendingRefreshToken ? 'save-pending' : 'save-confirmed');
    };
    const result = await new BilibiliClient(request).renew(session, persist);
    expect(events).toEqual(['save-pending', 'confirm', 'save-confirmed']);
    expect(saved[0]).toEqual({ cookies: { SESSDATA: 'new-session', bili_jct: 'new-csrf' }, refreshToken: 'new-refresh', pendingRefreshToken: 'refresh-secret' });
    expect(result).toEqual({ cookies: { SESSDATA: 'new-session', bili_jct: 'new-csrf' }, refreshToken: 'new-refresh', pendingRefreshToken: undefined });
    const confirmation = request.mock.calls.find(([input]) => String(input).includes('/confirm/refresh'));
    expect(new URLSearchParams(confirmation?.[1]?.body as URLSearchParams).get('refresh_token')).toBe('refresh-secret');
    expect(new Headers(confirmation?.[1]?.headers).get('Cookie')).toBe('SESSDATA=new-session; bili_jct=new-csrf');
  });

  it('preserves recovery information if the final token confirmation fails', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ refresh: true, timestamp: 123 }))
      .mockResolvedValueOnce(new Response('<div id="1-name">renewal-csrf</div>'))
      .mockResolvedValueOnce(json({ refresh_token: 'new-refresh' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: -1 })));
    const saved: Credentials[] = [];
    await expect(new BilibiliClient(request).renew(session, async (value) => { saved.push(structuredClone(value)); })).rejects.toThrow();
    expect(saved).toHaveLength(1);
    expect(saved[0].pendingRefreshToken).toBe('refresh-secret');
    expect(saved[0].refreshToken).toBe('new-refresh');
  });

  it('finishes a saved pending rotation before checking whether another refresh is needed', async () => {
    const pendingSession: Credentials = {
      cookies: { SESSDATA: 'new-session', bili_jct: 'new-csrf' },
      refreshToken: 'new-refresh',
      pendingRefreshToken: 'previous-refresh',
    };
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ refresh: false, timestamp: 123 }));
    const persist = vi.fn(async () => {});
    const result = await new BilibiliClient(request).renew(pendingSession, persist);
    expect(String(request.mock.calls[0][0])).toContain('/confirm/refresh');
    expect(String(request.mock.calls[1][0])).toContain('/cookie/info');
    expect(new URLSearchParams(request.mock.calls[0][1]?.body as URLSearchParams).get('refresh_token')).toBe('previous-refresh');
    expect(persist).toHaveBeenCalledWith({ ...pendingSession, pendingRefreshToken: undefined });
    expect(result.pendingRefreshToken).toBeUndefined();
    expect(result.refreshToken).toBe('new-refresh');
  });
});
