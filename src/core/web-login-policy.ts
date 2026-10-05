export const OFFICIAL_LOGIN_URL = 'https://passport.bilibili.com/pc/passport/login?gourl=https%3A%2F%2Fwww.bilibili.com%2F';

const authOrigins = new Set(['https://passport.bilibili.com', 'https://account.bilibili.com', 'https://www.bilibili.com']);

export function isOfficialAuthNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && authOrigins.has(url.origin);
  } catch { return false; }
}

export interface SessionCookie { name: string; value: string; domain?: string; }

export function credentialsFromOfficialCookies(cookies: SessionCookie[]): Record<string, string> | null {
  const allowed = new Set(['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid', 'buvid3', 'buvid4']);
  const collected: Record<string, string> = {};
  for (const cookie of cookies) {
    const domain = (cookie.domain ?? '').replace(/^\./, '').toLowerCase();
    if ((domain !== 'bilibili.com' && domain !== 'www.bilibili.com') || !allowed.has(cookie.name) || !cookie.value || /[\r\n;]/.test(cookie.value)) continue;
    collected[cookie.name] = cookie.value;
  }
  return collected.SESSDATA && collected.bili_jct ? collected : null;
}
