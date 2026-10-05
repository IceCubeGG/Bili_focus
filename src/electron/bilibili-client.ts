import { constants, publicEncrypt } from 'node:crypto';
import type { AccountSnapshot } from '../shared/contracts';
import { BilibiliError, type Credentials, type AccountApi, type QrCode, type QrPoll } from '../core/account-ports';
export { BilibiliError } from '../core/account-ports';
export type { AccountApi, QrCode, QrPoll } from '../core/account-ports';

const PASSPORT = 'https://passport.bilibili.com';
const API = 'https://api.bilibili.com';
const SITE = 'https://www.bilibili.com';
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40
JNrRuoEUXpabUzGB8QIDAQAB
-----END PUBLIC KEY-----`;

export function collectCookies(headers: Headers, previous: Record<string, string> = {}): Record<string, string> {
  const cookies = { ...previous };
  for (const line of headers.getSetCookie()) {
    const pair = line.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!/^[\w-]+$/.test(name) || /[\r\n;]/.test(value)) continue;
    const domain = /;\s*domain=([^;]+)/i.exec(line)?.[1].trim().replace(/^\./, '').toLowerCase();
    if (domain && domain !== 'bilibili.com' && !domain.endsWith('.bilibili.com')) continue;
    if (value === '' || /;\s*max-age=0(?:;|$)/i.test(line)) delete cookies[name];
    else cookies[name] = value;
  }
  return cookies;
}

export function validateQrUrl(value: string): string {
  const url = new URL(value);
  const permitted = new Set([
    'https://passport.bilibili.com/h5-app/passport/login/scan',
    'https://account.bilibili.com/h5/account-h5/auth/scan-web',
  ]);
  if (url.username || url.password || !permitted.has(`${url.origin}${url.pathname}`)) {
    throw new Error('Bilibili returned an unexpected sign-in link. Please retry.');
  }
  return url.href;
}

type Envelope<T> = { code: number; message?: string; data: T };

export class BilibiliClient implements AccountApi {
  constructor(private readonly request: typeof fetch = fetch) {}

  private async call<T>(url: string, credentials?: Credentials, form?: Record<string, string>): Promise<{ data: T; headers: Headers }> {
    const target = new URL(url);
    if (![PASSPORT, API, SITE].includes(target.origin)) throw new Error('Unsupported account endpoint.');
    const headers = new Headers({ 'User-Agent': 'Mozilla/5.0 BiliFocus/0.1', Referer: `${SITE}/`, Accept: 'application/json' });
    if (credentials) headers.set('Cookie', Object.entries(credentials.cookies).map(([key, value]) => `${key}=${value}`).join('; '));
    if (form) headers.set('Content-Type', 'application/x-www-form-urlencoded');
    let response: Response;
    try {
      response = await this.request(url, { method: form ? 'POST' : 'GET', headers, body: form ? new URLSearchParams(form) : undefined, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Could not reach Bilibili. Check your connection and try again.'); }
    if (!response.ok) throw new Error(`Bilibili is temporarily unavailable (HTTP ${response.status}). Please retry.`);
    let result: Envelope<T>;
    try { result = await response.json() as Envelope<T>; }
    catch { throw new Error('Bilibili returned an unexpected response. Please retry.'); }
    if (result.code !== 0) {
      const message = result.code === -101 ? 'Your Bilibili session has expired. Please sign in again.' : result.code === -111 ? 'Bilibili could not validate this session. Please sign in again.' : `Bilibili rejected the request (code ${result.code}). Please retry.`;
      throw new BilibiliError(result.code, message);
    }
    return { data: result.data, headers: response.headers };
  }

  async generateQr(): Promise<QrCode> {
    const { data } = await this.call<{ url: string; qrcode_key: string }>(`${PASSPORT}/x/passport-login/web/qrcode/generate`);
    if (!data || typeof data.qrcode_key !== 'string' || !data.qrcode_key) throw new Error('Bilibili did not generate a sign-in code. Please retry.');
    return { url: validateQrUrl(data.url), key: data.qrcode_key };
  }

  async pollQr(key: string): Promise<QrPoll> {
    const { data, headers } = await this.call<{ code: number; refresh_token?: string }>(`${PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`);
    if (data.code !== 0) return { code: data.code, credentials: null };
    const cookies = collectCookies(headers);
    if (!cookies.SESSDATA || !cookies.bili_jct) throw new Error('The sign-in response was incomplete. Please generate a new code.');
    return { code: 0, credentials: { cookies, refreshToken: data.refresh_token ?? '' } };
  }

  async validate(credentials: Credentials): Promise<NonNullable<AccountSnapshot['profile']>> {
    const { data } = await this.call<{ isLogin: boolean; mid: number; uname: string; face: string; level_info?: { current_level: number }; vipStatus?: number }>(`${API}/x/web-interface/nav`, credentials);
    if (!data.isLogin) throw new BilibiliError(-101, 'Your Bilibili session has expired. Please sign in again.');
    let avatar = '';
    try { const url = new URL(data.face); if (url.protocol === 'https:' && url.hostname.endsWith('.hdslb.com')) avatar = url.href; } catch { /* A missing avatar should not break sign-in. */ }
    return { uid: data.mid, name: data.uname, avatar, level: data.level_info?.current_level ?? 0, isVip: data.vipStatus === 1 };
  }

  async renew(credentials: Credentials, persist: (next: Credentials) => Promise<void>): Promise<Credentials> {
    let current = credentials;
    if (current.pendingRefreshToken) {
      await this.confirm(current);
      current = { ...current, pendingRefreshToken: undefined };
      await persist(current);
    }
    if (!current.refreshToken) return current;
    const { data } = await this.call<{ refresh: boolean; timestamp: number }>(`${PASSPORT}/x/passport-login/web/cookie/info?csrf=${encodeURIComponent(current.cookies.bili_jct)}`, current);
    if (!data.refresh) return current;
    const path = publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(`refresh_${data.timestamp}`)).toString('hex');
    let html: string;
    try {
      const response = await this.request(`${SITE}/correspond/1/${path}`, { headers: { Cookie: Object.entries(current.cookies).map(([key, value]) => `${key}=${value}`).join('; '), Referer: `${SITE}/`, 'User-Agent': 'Mozilla/5.0 BiliFocus/0.1' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      html = await response.text();
    } catch { throw new Error('Could not renew your Bilibili session. Please retry.'); }
    const refreshCsrf = /<div\b[^>]*\bid=["']1-name["'][^>]*>\s*([^<]+)\s*<\/div>/i.exec(html)?.[1].trim();
    if (!refreshCsrf) throw new Error('Bilibili changed its session renewal response. Please sign in again.');
    const { data: refreshed, headers } = await this.call<{ refresh_token: string }>(`${PASSPORT}/x/passport-login/web/cookie/refresh`, current, { csrf: current.cookies.bili_jct, refresh_csrf: refreshCsrf, source: 'main_web', refresh_token: current.refreshToken });
    const next: Credentials = { cookies: collectCookies(headers, current.cookies), refreshToken: refreshed.refresh_token, pendingRefreshToken: current.refreshToken };
    if (!next.cookies.SESSDATA || !next.cookies.bili_jct || !next.refreshToken) throw new Error('Bilibili returned an incomplete renewed session. Please sign in again.');
    // Save the rotated session before retiring the previous refresh token.
    await persist(next);
    await this.confirm(next);
    next.pendingRefreshToken = undefined;
    await persist(next);
    return next;
  }

  private async confirm(credentials: Credentials): Promise<void> {
    await this.call(`${PASSPORT}/x/passport-login/web/confirm/refresh`, credentials, { csrf: credentials.cookies.bili_jct, refresh_token: credentials.pendingRefreshToken! });
  }

  async logout(credentials: Credentials): Promise<void> {
    await this.call(`${PASSPORT}/login/exit/v2`, credentials, { biliCSRF: credentials.cookies.bili_jct });
  }
}
