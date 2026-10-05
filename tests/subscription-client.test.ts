import { describe, expect, it, vi } from 'vitest';
import { SubscriptionClient, parseSubscriptionItem } from '../src/electron/subscription-client';
import type { Credentials } from '../src/core/account-ports';

const session: Credentials = { cookies: { SESSDATA: 'private-subscribe-session', bili_jct: 'private-csrf' }, refreshToken: 'private-refresh' };
const bvid = 'BV1Miao6oE3a';
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const item = (id = 70001, video = bvid, following: unknown = true, published = 1791000000) => ({
  type: 'DYNAMIC_TYPE_AV', id_str: '123', modules: {
    module_author: { mid: id, name: `Uploader ${id}`, pub_ts: published, following },
    module_dynamic: { major: { type: 'MAJOR_TYPE_ARCHIVE', archive: { bvid: video, title: 'An original upload', cover: 'http://i0.hdslb.com/bfs/archive/video.jpg', duration_text: '3:05', stat: { play: '1234' } } } },
  },
});
const page = (items: unknown[], offset = 'next_123', hasMore = true) => ({ items, offset, has_more: hasMore });
const mockApi = (items: unknown[], relations: Record<string, unknown> = { '70001': { mid: 70001, attribute: 2 } }) => vi.fn<typeof fetch>().mockImplementation(async input => {
  const url = new URL(String(input));
  if (url.pathname === '/x/polymer/web-dynamic/v1/feed/all') return envelope(page(items));
  if (url.pathname === '/x/relation') return envelope(relations[url.searchParams.get('fid')!]);
  throw new Error('Unexpected fixture request');
});
const native = (request: typeof fetch) => new SubscriptionClient(() => session, () => 0, request);

describe('authenticated followed-uploader directory', () => {
  it('requests the native account roster, normalizes safe profiles, and pages independently of uploads', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(envelope({ total: 51, list: [
      { mid: 123, uname: 'Creator without recent uploads', face: '//i0.hdslb.com/a.jpg', attribute: 2 },
      { mid: '456', uname: 'Mutual creator', face: 'https://evil.example/a.jpg', attribute: 6 },
      { mid: 789, uname: 'Not followed', attribute: 0 }, { mid: 123, uname: 'Duplicate', attribute: 2 },
    ] }));
    const result = await native(request).getFollowedUploaderPage({ cursor: null }, '70001');
    expect(result).toEqual({ total: 51, hasMore: true, cursor: '2', uploaders: [{ id: '123', name: 'Creator without recent uploads', avatar: 'https://i0.hdslb.com/a.jpg' }, { id: '456', name: 'Mutual creator', avatar: '' }] });
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.pathname).toBe('/x/relation/followings'); expect(url.searchParams.get('vmid')).toBe('70001'); expect(url.searchParams.get('pn')).toBe('1');
    expect(new Headers(request.mock.calls[0][1]?.headers).get('Cookie')).toContain(session.cookies.SESSDATA);
  });
  it.each([{}, { cursor: '' }, { cursor: 'x&vmid=999' }, { cursor: '2001' }])('rejects malformed roster cursors %j', async input => {
    const request = vi.fn<typeof fetch>(); await expect(native(request).getFollowedUploaderPage(input, '70001')).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('rejects signed-out and stale account results without returning another account’s roster', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(envelope({ total: 0, list: [] }));
    await expect(new SubscriptionClient(() => null, () => 0, request).getFollowedUploaderPage({ cursor: null }, '70001')).rejects.toThrow('Sign in');
    expect(request).not.toHaveBeenCalled();
    let revision = 0; request.mockImplementation(async () => { revision++; return envelope({ total: 1, list: [{ mid: 123, uname: 'Old', attribute: 2 }] }); });
    await expect(new SubscriptionClient(() => session, () => revision, request).getFollowedUploaderPage({ cursor: null }, '70001')).rejects.toThrow('account changed');
  });
  it('fails malformed roster metadata rather than deriving a partial list from feed cards', async () => {
    await expect(native(vi.fn<typeof fetch>().mockResolvedValue(envelope({ total: '50', list: [] }))).getFollowedUploaderPage({ cursor: null }, '70001')).rejects.toThrow('unexpected');
  });
});

describe('Subscribe original upload parser', () => {
  it('returns safe video DTOs without dynamic text, cookies, or arbitrary links', () => {
    expect(parseSubscriptionItem({ ...item(), cookie: 'private-subscribe-session' })).toEqual({
      bvid, title: 'An original upload', cover: 'https://i0.hdslb.com/bfs/archive/video.jpg', durationSeconds: 185,
      uploader: { id: '70001', name: 'Uploader 70001' }, views: 1234, publishedAt: 1791000000000,
    });
  });

  it.each(['DYNAMIC_TYPE_FORWARD', 'DYNAMIC_TYPE_WORD', 'DYNAMIC_TYPE_LIVE_RCMD', 'DYNAMIC_TYPE_AD'])('rejects non-original-video post type %s', type => {
    expect(parseSubscriptionItem({ ...item(), type })).toBeNull();
  });

  it.each(['orig', 'ad_info', 'business_info'])('rejects an original-shaped item carrying %s', field => {
    expect(parseSubscriptionItem({ ...item(), [field]: {} })).toBeNull();
  });

  it.each([true, 1, '1'])('excludes advertising markers: %j', is_ad => {
    expect(parseSubscriptionItem({ ...item(), is_ad })).toBeNull();
    const original = item();
    expect(parseSubscriptionItem({ ...original, modules: { ...original.modules, module_dynamic: { major: { ...original.modules.module_dynamic.major, archive: { ...original.modules.module_dynamic.major.archive, is_ad } } } } })).toBeNull();
  });

  it('rejects explicit not-followed and malformed following flags but keeps missing flags for relation verification', () => {
    expect(parseSubscriptionItem(item(70001, bvid, false))).toBeNull();
    expect(parseSubscriptionItem(item(70001, bvid, 'true'))).toBeNull();
    const missing = item(); delete (missing.modules.module_author as { following?: unknown }).following;
    expect(parseSubscriptionItem(missing)?.uploader.id).toBe('70001');
    expect(parseSubscriptionItem(item(70001, bvid, null))?.uploader.id).toBe('70001');
  });

  it('rejects unsafe covers and malformed uploader/video identities', () => {
    const row = item(); row.modules.module_dynamic.major.archive.cover = 'https://i0.hdslb.com.evil.example/video.jpg';
    expect(parseSubscriptionItem(row)?.cover).toBe('');
    expect(parseSubscriptionItem(item(0))).toBeNull();
    expect(parseSubscriptionItem(item(70001, 'https://evil.example'))).toBeNull();
  });
});

describe('authenticated Subscribe transport', () => {
  it('does not make any network request for a guest', async () => {
    const request = vi.fn<typeof fetch>();
    const client = new SubscriptionClient(() => null, () => 0, request);
    await expect(client.getSubscriptionPage({ cursor: null })).rejects.toThrow('Sign in to Bilibili');
    expect(request).not.toHaveBeenCalled();
  });

  it('uses fixed authenticated endpoints and independent exact-UID relationship checks', async () => {
    const request = mockApi([item()]);
    const result = await native(request).getSubscriptionPage({ cursor: null });
    expect(result.videos).toHaveLength(1);
    expect(result).toMatchObject({ cursor: 'next_123', hasMore: true });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [input, options] of request.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.bilibili.com');
      expect(String(input)).not.toContain('private');
      expect(new Headers(options?.headers).get('Cookie')).toBe('SESSDATA=private-subscribe-session; bili_jct=private-csrf');
      expect(options?.redirect).toBe('error');
    }
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get('type')).toBe('video');
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get('fid')).toBe('70001');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('allows normal/mutual follow relations, recovers absent flags, and excludes recommendations and explicit false flags', async () => {
    const missing = item(70003, 'BV1Dz42117GZ'); delete (missing.modules.module_author as { following?: unknown }).following;
    const request = mockApi([item(), item(70002, 'BV1Cu411z7mG', false), missing, item(70004, 'BV1aa411a7aA')], {
      '70001': { mid: 70001, attribute: 2 }, '70002': { mid: 70002, attribute: 2 }, '70003': { mid: 70003, attribute: 6 }, '70004': { mid: 70004, attribute: 0 },
    });
    expect((await native(request).getSubscriptionPage({ cursor: null })).videos.map(value => value.uploader.id)).toEqual(['70001', '70003']);
    expect(request.mock.calls.some(([url]) => new URL(String(url)).searchParams.get('fid') === '70002')).toBe(false);
  });

  it.each([{ mid: 999, attribute: 2 }, { mid: 70001, attribute: '2' }, { mid: 70001, attribute: 3 }, { attribute: 2 }, null])('rejects malformed or mismatched relationship data: %j', async relation => {
    const request = mockApi([item()], { '70001': relation });
    await expect(native(request).getSubscriptionPage({ cursor: null })).rejects.toThrow('Could not verify followed accounts');
  });

  it.each([0, 1, 128])('excludes verified non-following relation attribute %i', async attribute => {
    expect((await native(mockApi([item()], { '70001': { mid: 70001, attribute } })).getSubscriptionPage({ cursor: null })).videos).toEqual([]);
  });

  it('rejects the whole page on a failed relationship lookup instead of showing unverified creators', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope(page([item()]))).mockRejectedValueOnce(new Error('private socket failure'));
    await expect(native(request).getSubscriptionPage({ cursor: null })).rejects.toThrow('Could not reach Bilibili');
  });

  it('sorts admitted originals newest first and deduplicates videos', async () => {
    const request = mockApi([item(70001, bvid, true, 1791000000), item(70001, 'BV1Dz42117GZ', true, 1792000000), item()]);
    expect((await native(request).getSubscriptionPage({ cursor: null })).videos.map(value => value.bvid)).toEqual(['BV1Dz42117GZ', bvid]);
  });

  it('refresh re-verifies a followed uploader instead of reusing a positive cached relation after unfollow', async () => {
    let attribute = 2;
    const request = vi.fn<typeof fetch>().mockImplementation(async input => new URL(String(input)).pathname === '/x/relation' ? envelope({ mid: 70001, attribute }) : envelope(page([item()], 'next_456')));
    const client = native(request);
    expect((await client.getSubscriptionPage({ cursor: null })).videos).toHaveLength(1);
    await client.getSubscriptionPage({ cursor: 'next_123' });
    expect(request.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/x/relation')).toHaveLength(1);
    attribute = 0;
    expect((await client.getSubscriptionPage({ cursor: null })).videos).toHaveLength(0);
    expect(request.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/x/relation')).toHaveLength(2);
  });

  it.each(['generation', 'credentials', 'expired'])('does not return followed videos after the %s changes during verification', async change => {
    let revision = 0;
    let current: Credentials | null = session;
    const request = vi.fn<typeof fetch>().mockImplementation(async input => {
      if (new URL(String(input)).pathname !== '/x/relation') return envelope(page([item()]));
      if (change === 'generation') revision++;
      else current = change === 'expired' ? null : { ...session, cookies: { ...session.cookies, SESSDATA: 'rotated-secret' } };
      return envelope({ mid: 70001, attribute: 2 });
    });
    const client = new SubscriptionClient(() => current, () => revision, request);
    await expect(client.getSubscriptionPage({ cursor: null })).rejects.toThrow('Your account changed');
  });

  it('rechecks account expiry and never falls back to a guest endpoint', async () => {
    const expired = vi.fn();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: -101, message: 'private-server-message' })));
    const client = new SubscriptionClient(() => session, () => 0, request, Date.now, expired);
    await expect(client.getSubscriptionPage({ cursor: null })).rejects.toThrow('session has expired');
    expect(expired).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(['generation', 'credentials'])('does not publish stale expiry after a %s change', async change => {
    let revision = 0;
    let current = session;
    const expired = vi.fn();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (change === 'generation') revision++;
      else current = { ...session, cookies: { ...session.cookies, SESSDATA: 'new-session' } };
      return new Response(JSON.stringify({ code: -101 }));
    });
    const client = new SubscriptionClient(() => current, () => revision, request, Date.now, expired);
    await expect(client.getSubscriptionPage({ cursor: null })).rejects.toThrow('Your account changed');
    expect(expired).not.toHaveBeenCalled();
  });

  it.each([null, {}, { cursor: '' }, { cursor: 'https://evil.example' }, { cursor: 'offset&injected=1' }, { cursor: 'a'.repeat(257) }, { cursor: 123 }])('rejects unsafe opaque cursors without network access: %j', async options => {
    const request = vi.fn<typeof fetch>();
    await expect(native(request).getSubscriptionPage(options)).rejects.toThrow('Invalid Subscribe cursor');
    expect(request).not.toHaveBeenCalled();
  });

  it('encodes the bounded opaque offset and rejects a repeated advancement cursor', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope(page([], 'offset:456'))).mockResolvedValueOnce(envelope(page([], 'offset:123')));
    const client = native(request);
    const result = await client.getSubscriptionPage({ cursor: 'offset:123' });
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get('offset')).toBe('offset:123');
    expect(result).toEqual({ videos: [], cursor: 'offset:456', hasMore: true });
    await expect(client.getSubscriptionPage({ cursor: 'offset:123' })).rejects.toThrow('did not advance');
  });

  it('rejects renderer request spam after four admitted pages instead of growing a wait queue', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { await gate; return envelope(page([], '', false)); });
    const client = native(request);
    const pending = Array.from({ length: 4 }, () => client.getSubscriptionPage({ cursor: 'existing_offset' }));
    await expect(client.getSubscriptionPage({ cursor: 'extra_offset' })).rejects.toThrow('Subscribe is busy');
    release!();
    await Promise.all(pending);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('limits relationship requests to four concurrent native calls', async () => {
    let active = 0;
    let maximum = 0;
    const rows = Array.from({ length: 12 }, (_, index) => item(70001 + index, `BV1Miao6oE${String(index).padStart(2, '0')}`));
    const request = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname !== '/x/relation') return envelope(page(rows));
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return envelope({ mid: Number(url.searchParams.get('fid')), attribute: 2 });
    });
    expect((await native(request).getSubscriptionPage({ cursor: null })).videos).toHaveLength(12);
    expect(maximum).toBe(4);
  });

  it('drains started verification workers before rejecting a failed page', async () => {
    let release: (() => void) | undefined;
    let ready: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { ready = resolve; });
    let blocked = 0;
    let settled = false;
    const rows = Array.from({ length: 8 }, (_, index) => item(70001 + index, `BV1Miao6oE${String(index).padStart(2, '0')}`));
    const request = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname !== '/x/relation') return envelope(page(rows));
      const id = Number(url.searchParams.get('fid'));
      if (id === 70001) return envelope({ mid: id, attribute: 'unverified' });
      if (++blocked === 3) ready!();
      await gate;
      return envelope({ mid: id, attribute: 2 });
    });
    const pending = native(request).getSubscriptionPage({ cursor: null });
    void pending.catch(() => { settled = true; });
    await started;
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    release!();
    await expect(pending).rejects.toThrow('Could not verify followed accounts');
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/x/relation')).toHaveLength(4);
  });
});
