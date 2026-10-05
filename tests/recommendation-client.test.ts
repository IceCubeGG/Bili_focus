import { describe, expect, it, vi } from 'vitest';
import { RecommendationClient, parseVideoCandidate } from '../src/electron/recommendation-client';
import type { Credentials } from '../src/core/account-ports';

const session: Credentials = { cookies: { SESSDATA: 'private-session', bili_jct: 'private-csrf' }, refreshToken: 'private-refresh' };
const bvid = 'BV1Miao6oE3a';
const row = { bvid, goto: 'av', title: 'A real video', pic: 'http://i0.hdslb.com/bfs/archive/video.jpg', duration: 298, pubdate: 1790764566, owner: { mid: 123, name: 'Uploader' }, stat: { view: 42 } };
const json = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const client = (request: typeof fetch) => new RecommendationClient(() => session, () => 0, request);

describe('native recommendation metadata', () => {
  it('returns bounded video fields and upgrades Bilibili covers to HTTPS', () => {
    expect(parseVideoCandidate({ ...row, cookies: 'must-not-cross-bridge', description: 'unneeded' })).toEqual({
      bvid, title: 'A real video', cover: 'https://i0.hdslb.com/bfs/archive/video.jpg', durationSeconds: 298,
      uploader: { id: '123', name: 'Uploader' }, views: 42, publishedAt: 1790764566000,
    });
  });

  it.each([
    { ...row, bvid: 'https://evil.example' },
    { ...row, goto: 'live' },
    { ...row, business_info: { ad: true } },
    { ...row, ad_info: { sponsored: true } },
    { ...row, is_ad: 1 },
    { ...row, owner: { mid: 0, name: 'Uploader' } },
    { ...row, owner: { mid: '123&inject=value', name: 'Uploader' } },
    { ...row, title: '' },
  ])('discards entries that cannot safely become a video card', (entry) => {
    expect(parseVideoCandidate(entry)).toBeNull();
  });

  it.each(['https://hdslb.com.evil.example/a.jpg', 'https://user:secret@i0.hdslb.com/a.jpg', 'javascript:alert(1)', 'https://i0.hdslb.com:8443/a.jpg'])('rejects unsafe cover locations', (pic) => {
    expect(parseVideoCandidate({ ...row, pic })?.cover).toBe('');
  });
});

describe('recommendation transport', () => {
  it('uses the fixed HTTPS endpoint, keeps native cookies in headers, and deduplicates candidates', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ item: [row, row, { ...row, goto: 'live' }] }));
    const result = await client(request).getRecommendationPage({ cursor: null });
    expect(result).toMatchObject({ cursor: '2', hasMore: true });
    expect(result.videos).toHaveLength(1);
    const [input, options] = request.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd');
    expect(url.searchParams.get('fresh_idx')).toBe('1');
    expect(String(input)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(new Headers(options?.headers).get('Cookie')).toBe('SESSDATA=private-session; bili_jct=private-csrf');
    expect(options?.redirect).toBe('error');
  });

  it('allows a guest feed and stops paging after an empty response', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ item: [] }));
    const guest = new RecommendationClient(() => null, () => 0, request);
    expect(await guest.getRecommendationPage({ cursor: '5' })).toEqual({ videos: [], cursor: null, hasMore: false });
    expect(new Headers(request.mock.calls[0][1]?.headers).has('Cookie')).toBe(false);
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get('fresh_idx')).toBe('5');
  });

  it.each([null, {}, { cursor: undefined }, { cursor: '' }, { cursor: '0' }, { cursor: '1&inject=1' }, { cursor: '1001' }, { cursor: 1 }, { cursor: 'https://evil.example' }])('rejects invalid cursor inputs before a request', async (options) => {
    const request = vi.fn<typeof fetch>();
    await expect(client(request).getRecommendationPage(options)).rejects.toThrow('Invalid recommendation cursor');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not return a previous account feed after the session changes', async () => {
    let revision = 0;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { revision++; return json({ item: [row] }); });
    const native = new RecommendationClient(() => session, () => revision, request);
    await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow('Your account changed');
  });

  it.each(['renewed', 'expired'])('rejects a %s credential snapshot even when the account generation is unchanged', async (change) => {
    let current: Credentials | null = session;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = change === 'expired' ? null : { ...session, cookies: { ...session.cookies, SESSDATA: 'rotated-session' } };
      return json({ item: [row] });
    });
    const native = new RecommendationClient(() => current, () => 0, request);
    await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow('Your account changed');
  });

  it('rejects malformed and oversized server responses without leaking server text', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private-session'))
      .mockResolvedValueOnce(json({ item: 'private-session' }))
      .mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    const native = client(request);
    for (let i = 0; i < 3; i++) await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow(/unexpected/);
  });

  it('returns local actionable errors for unavailable and blocked endpoints', async () => {
    const request = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('private-session socket'))
      .mockResolvedValueOnce(new Response('private-session', { status: 412 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: -101, message: 'private-session' })));
    const native = client(request);
    await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow('Could not reach Bilibili');
    await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow('HTTP 412');
    await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow('session has expired');
  });

  it('asks the native account manager to recheck an expired authenticated feed session', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ code: -101 })));
    const expired = vi.fn();
    const native = new RecommendationClient(() => session, () => 0, request, Date.now, expired);
    await expect(native.getRecommendationPage({ cursor: null })).rejects.toThrow('session has expired');
    expect(expired).toHaveBeenCalledTimes(1);
    const guest = new RecommendationClient(() => null, () => 0, request, Date.now, expired);
    await expect(guest.getRecommendationPage({ cursor: null })).rejects.toThrow('session has expired');
    expect(expired).toHaveBeenCalledTimes(1);
  });
});

describe('video label verification', () => {
  it('fetches actual labels, caches them, and never sends account credentials for public labels', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json([{ tag_name: 'Music' }, { tag_name: 'Music' }, { tag_name: '  Live Music  ' }, { tag_name: 'Live\nMusic' }, { tag_name: 'x'.repeat(81) }]));
    const native = client(request);
    const first = await native.getVideoLabels({ bvids: [bvid, bvid] });
    expect(first).toEqual([{ bvid, labels: ['Music', 'Live Music'], status: 'ready' }]);
    first[0].labels.push('Mutation');
    expect(await native.getVideoLabels({ bvids: [bvid] })).toEqual([{ bvid, labels: ['Music', 'Live Music'], status: 'ready' }]);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/x/tag/archive/tags');
    expect(new URL(String(url)).searchParams.get('bvid')).toBe(bvid);
    expect(new Headers(options?.headers).has('Cookie')).toBe(false);
  });

  it('distinguishes unavailable labels from a verified empty label list', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(json([]));
    const native = client(request);
    expect(await native.getVideoLabels({ bvids: [bvid] })).toEqual([{ bvid, labels: [], status: 'unavailable' }]);
    const other = 'BV1Dz42117GZ';
    expect(await native.getVideoLabels({ bvids: [other] })).toEqual([{ bvid: other, labels: [], status: 'ready' }]);
  });

  it('makes a fresh request immediately when unavailable labels are retried', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(json([{ tag_name: 'Music' }]));
    const native = client(request);
    expect(await native.getVideoLabels({ bvids: [bvid] })).toEqual([{ bvid, labels: [], status: 'unavailable' }]);
    expect(await native.getVideoLabels({ bvids: [bvid] })).toEqual([{ bvid, labels: ['Music'], status: 'ready' }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('bounds concurrent label requests while preserving the requested order', async () => {
    let active = 0;
    let maximum = 0;
    const ids = Array.from({ length: 12 }, (_, i) => `BV1Miao6oE${String(i).padStart(2, '0')}`);
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return json([{ tag_name: 'Verified' }]);
    });
    const results = await client(request).getVideoLabels({ bvids: ids });
    expect(maximum).toBe(4);
    expect(results.map((value) => value.bvid)).toEqual(ids);
  });

  it.each([{}, { bvids: ['https://evil.example'] }, { bvids: Array(51).fill(bvid) }])('rejects unsupported label requests before contacting Bilibili', async (options) => {
    const request = vi.fn<typeof fetch>();
    await expect(client(request).getVideoLabels(options)).rejects.toThrow('Invalid video label request');
    expect(request).not.toHaveBeenCalled();
  });
});
