import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionClient, parseUploaderVideoPage, uploaderPageIndex } from '../src/electron/subscription-client';
import { signWbi, wbiKey } from '../src/electron/wbi';
import { mergeUploaderVideos } from '../src/core/subscriptions';
import type { Credentials } from '../src/core/account-ports';

const session: Credentials = { cookies: { SESSDATA: 'library-fixture', bili_jct: 'fixture-csrf' }, refreshToken: '' };
const now = 1702204169000;
const images = { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' };
const archive = (number: number, mid = '123') => ({ mid, bvid: `BV${String(number).padStart(10, '0')}`, author: 'Library creator', title: `Upload ${number}`, created: 1700000000 - number, pic: '//i0.hdslb.com/cover.jpg', play: 12, length: '03:05' });
const data = (page: number, count = 65) => ({ page: { pn: page, ps: 30, count }, list: { vlist: Array.from({ length: Math.min(30, Math.max(0, count - (page - 1) * 30)) }, (_, index) => archive((page - 1) * 30 + index + 1)) } });
const json = (value: unknown) => new Response(JSON.stringify({ code: 0, data: value }));
const api = () => vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
  const url = new URL(String(input));
  expect(new Headers(options?.headers).get('Cookie')).toContain('library-fixture');
  if (url.pathname === '/x/relation') return json({ mid: '123', attribute: 2 });
  if (url.pathname === '/x/web-interface/nav') return json({ wbi_img: images });
  if (url.pathname === '/x/space/wbi/arc/search') {
    expect(url.searchParams.get('mid')).toBe('123'); expect(url.searchParams.get('order')).toBe('pubdate');
    expect(new Headers(options?.headers).get('Referer')).toBe('https://space.bilibili.com/123/upload/video');
    const parameters = new URLSearchParams(url.search); const signature = parameters.get('w_rid'); parameters.delete('w_rid');
    expect(signature).toBe(createHash('md5').update(parameters.toString() + 'ea1db124af3c7062474693fa704f4ff8').digest('hex'));
    return json(data(Number(url.searchParams.get('pn'))));
  }
  throw new Error('Unexpected request');
});
const client = (request: typeof fetch) => new SubscriptionClient(() => session, () => 0, request, () => now);

describe('followed uploader complete video library', () => {
  it('signs native library requests and pages all 65 uploads independently of dynamics', async () => {
    const request = api(), native = client(request);
    const first = await native.getUploaderVideoPage({ uploaderId: '123', cursor: null });
    const second = await native.getUploaderVideoPage({ uploaderId: '123', cursor: first.cursor });
    const last = await native.getUploaderVideoPage({ uploaderId: '123', cursor: second.cursor });
    expect([first.videos.length, second.videos.length, last.videos.length]).toEqual([30, 30, 5]);
    expect(first).toMatchObject({ total: 65, cursor: '2', hasMore: true });
    expect(last).toMatchObject({ total: 65, cursor: null, hasMore: false });
    expect(mergeUploaderVideos(mergeUploaderVideos(first.videos, second.videos), last.videos)).toHaveLength(65);
    expect(request.mock.calls.some(([input]) => String(input).includes('feed/all'))).toBe(false);
    expect(JSON.stringify(first)).not.toContain('library-fixture');
  });
  it('retains all 905 uploads rather than stopping at the recent-feed limit', () => {
    let videos = parseUploaderVideoPage(data(1, 905), '123', 1).videos;
    for (let page = 2; page <= 31; page++) videos = mergeUploaderVideos(videos, parseUploaderVideoPage(data(page, 905), '123', page).videos);
    expect(videos).toHaveLength(905); expect(videos.at(-1)?.bvid).toBe('BV0000000905');
    expect(mergeUploaderVideos(videos, [videos[0]])).toHaveLength(905);
  });
  it('excludes mismatched uploader cards, unsafe covers, malformed IDs, and duplicates', () => {
    const value = data(1, 5);
    value.list.vlist = [archive(1), archive(1), archive(2, '999'), { ...archive(3), bvid: 'bad' }, { ...archive(4), pic: 'https://evil.example/a.jpg' }];
    const result = parseUploaderVideoPage(value, '123', 1);
    expect(result.videos.map(video => video.bvid)).toEqual(['BV0000000001', 'BV0000000004']);
    expect(result.videos[1].cover).toBe(''); expect(result.videos[0].durationSeconds).toBe(185);
  });
  it('keeps a truly empty library empty and rejects false end-of-library metadata', () => {
    expect(parseUploaderVideoPage(data(1, 0), '123', 1)).toMatchObject({ videos: [], total: 0, hasMore: false, cursor: null });
    for (const value of [{ ...data(1), page: { pn: 2, ps: 30, count: 65 } }, { ...data(1), page: { pn: 1, ps: 30, count: '65' } }, { ...data(1), list: { vlist: [] } }]) expect(() => parseUploaderVideoPage(value, '123', 1)).toThrow('unexpected');
  });
  it('rejects guest requests and no-longer-followed creators before loading a catalog', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ mid: '123', attribute: 0 }));
    await expect(new SubscriptionClient(() => null, () => 0, request).getUploaderVideoPage({ uploaderId: '123', cursor: null })).rejects.toThrow('Sign in');
    expect(request).not.toHaveBeenCalled();
    await expect(client(request).getUploaderVideoPage({ uploaderId: '123', cursor: null })).rejects.toThrow('no longer followed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects a delayed account result before it can return videos', async () => {
    let revision = 0;
    const request = api(); const original = request.getMockImplementation()!;
    request.mockImplementation(async (input, options) => { const response = await original(input, options); if (String(input).includes('arc/search')) revision++; return response; });
    await expect(new SubscriptionClient(() => session, () => revision, request, () => now).getUploaderVideoPage({ uploaderId: '123', cursor: null })).rejects.toThrow('account changed');
  });
  it.each([{ uploaderId: '../123', cursor: null }, { uploaderId: '123', cursor: '2&mid=999' }, { uploaderId: '123', cursor: '0' }, { uploaderId: '123' }])('rejects malformed inputs before network requests: %j', async options => {
    const request = vi.fn<typeof fetch>(); await expect(client(request).getUploaderVideoPage(options)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('reports server rejection without silently substituting the recent feed', async () => {
    const request = api(), original = request.getMockImplementation()!;
    request.mockImplementation((input, options) => String(input).includes('arc/search') ? Promise.resolve(new Response(JSON.stringify({ code: -352 }))) : original(input, options));
    await expect(client(request).getUploaderVideoPage({ uploaderId: '123', cursor: '2' })).rejects.toThrow('code -352');
    expect(request.mock.calls.some(([input]) => String(input).includes('feed/all'))).toBe(false);
  });
});

describe('WBI request signature', () => {
  it('matches the public navigation key and uses canonical sorted query encoding', () => {
    const key = wbiKey(images.img_url, images.sub_url); expect(key).toBe('ea1db124af3c7062474693fa704f4ff8');
    const result = signWbi({ foo: "114!'()*", bar: '514', zab: '1919810' }, key, now);
    expect(result.w_rid).toBe(createHash('md5').update('bar=514&foo=114&wts=1702204169&zab=1919810' + key).digest('hex'));
    expect(result.foo).toBe('114'); expect(uploaderPageIndex('31')).toBe(31);
    expect(() => wbiKey('https://evil.example/7cd084941338484aae1ad9425b84077c.png', images.sub_url)).toThrow();
  });
});
