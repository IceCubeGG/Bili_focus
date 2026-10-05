import { describe, expect, it } from 'vitest';
import { credentialsFromOfficialCookies, isOfficialAuthNavigation, OFFICIAL_LOGIN_URL } from '../src/core/web-login-policy';

describe('official sign-in navigation', () => {
  it.each([
    OFFICIAL_LOGIN_URL,
    'https://passport.bilibili.com/pc/passport/login',
    'https://account.bilibili.com/h5/account-h5/auth/login',
    'https://www.bilibili.com/',
  ])('permits the official sign-in origin: %s', (url) => {
    expect(isOfficialAuthNavigation(url)).toBe(true);
  });

  it.each([
    'http://passport.bilibili.com/pc/passport/login',
    'https://passport.bilibili.com.evil.example/login',
    'https://bilibili.com.evil.example/login',
    'https://evil.example/?next=https://passport.bilibili.com',
    'https://passport.bilibili.com:8443/login',
    'https://password:secret@passport.bilibili.com/login',
    'https://user@www.bilibili.com/',
    'https://api.bilibili.com/',
    'https://bilibili.com/',
    'file:///C:/secret.txt',
    'javascript:alert(1)',
    'data:text/html,sign-in',
    '/relative/login',
    'not a URL',
  ])('blocks unrelated, insecure, and credential-bearing navigation: %s', (url) => {
    expect(isOfficialAuthNavigation(url)).toBe(false);
  });
});

describe('official browser session cookie collection', () => {
  const session = { name: 'SESSDATA', value: 'session-private', domain: '.bilibili.com' };
  const csrf = { name: 'bili_jct', value: 'csrf-private', domain: '.bilibili.com' };

  it('collects only known account cookies with official domains', () => {
    expect(credentialsFromOfficialCookies([
      session, csrf,
      { name: 'DedeUserID', value: '123', domain: 'www.bilibili.com' },
      { name: 'buvid3', value: 'device', domain: '.BILIBILI.COM' },
      { name: 'unrelated', value: 'ignored', domain: '.bilibili.com' },
    ])).toEqual({ SESSDATA: 'session-private', bili_jct: 'csrf-private', DedeUserID: '123', buvid3: 'device' });
  });

  it.each([
    [],
    [session],
    [csrf],
    [{ ...session, value: '' }, csrf],
    [session, { ...csrf, domain: 'bilibili.com.evil.example' }],
    [{ ...session, domain: 'evil.example' }, csrf],
    [{ ...session, domain: 'passport.bilibili.com' }, csrf],
    [{ ...session, domain: undefined }, csrf],
  ].map(cookies => ({ cookies })))('rejects incomplete or foreign account cookies', ({ cookies }) => {
    expect(credentialsFromOfficialCookies(cookies)).toBeNull();
  });

  it.each(['secret\r\nInjected=header', 'secret\n', 'secret;Injected=header'])('rejects header injection in a required cookie', (value) => {
    expect(credentialsFromOfficialCookies([{ ...session, value }, csrf])).toBeNull();
  });

  it('cannot replace legitimate cookies with a later foreign-domain cookie', () => {
    expect(credentialsFromOfficialCookies([session, csrf, { ...session, value: 'foreign-private', domain: 'evil.example' }]))
      .toEqual({ SESSDATA: 'session-private', bili_jct: 'csrf-private' });
  });

  it('omits malformed optional cookies while retaining a complete valid session', () => {
    expect(credentialsFromOfficialCookies([session, csrf, { name: 'sid', value: 'bad;cookie', domain: '.bilibili.com' }]))
      .toEqual({ SESSDATA: 'session-private', bili_jct: 'csrf-private' });
  });
});
