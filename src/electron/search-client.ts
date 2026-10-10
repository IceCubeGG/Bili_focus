import { isDeepStrictEqual } from 'node:util';
import type { Credentials } from '../core/account-ports';
import { searchDuration, searchPageIndex, searchQuery, searchTitle } from '../core/search';
import type { VideoCandidate, VideoSearchPage } from '../shared/contracts';
import { parseVideoCandidate } from './recommendation-client';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown, max: number): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
export function parseSearchPage(value: unknown, page: number): VideoSearchPage {
  const data = record(value);
  if (data.v_voucher) throw new Error('Bilibili requires verification. Sign in on the official Bilibili page, then retry search.');
  const total = count(data.numResults, 1000000000), pages = count(data.numPages, 1000000);
  if (data.page !== page || total === null || pages === null || !Array.isArray(data.result) || data.result.length > 100) throw new Error('Bilibili returned unexpected search results. Please retry.');
  const videos = new Map<string, VideoCandidate>();
  for (const raw of data.result) {
    const item = record(raw);
    if (item.type !== 'video') continue;
    const video = parseVideoCandidate({ ...item, title: searchTitle(item.title), owner: { mid: item.mid, name: item.author }, stat: { view: item.play }, duration: searchDuration(item.duration) });
    if (video && !videos.has(video.bvid)) videos.set(video.bvid, video);
  }
  const hasMore = data.result.length > 0 && page < pages && page < 1000;
  return { videos: [...videos.values()], total, hasMore, cursor: hasMore ? String(page + 1) : null };
}

/** Only fixed Bilibili endpoints; no URLs, cookies, or raw HTML are exposed to React. */
export class SearchClient {
  private active = 0;
  constructor(private readonly credentials: () => Credentials | null, private readonly revision: () => number, private readonly request: typeof fetch = fetch, private readonly onExpired: () => void = () => {}) {}

  async searchVideos(options: unknown): Promise<VideoSearchPage> {
    const input = record(options), query = searchQuery(input.query), page = searchPageIndex(input.cursor);
    const bvid = /^BV[0-9a-z]{10}$/i.test(query);
    if (bvid && page !== 1) throw new Error('Invalid search page. Start a new search.');
    if (this.active >= 4) throw new Error('Search is busy. Wait for the current request and retry.');
    this.active++;
    const credentials = structuredClone(this.credentials()), revision = this.revision();
    const check = () => { if (revision !== this.revision() || !isDeepStrictEqual(credentials, this.credentials())) throw new Error('Your account changed. Search again.'); };
    const cookies = Object.entries(credentials?.cookies ?? {}).filter(([name, value]) => /^[\w-]{1,80}$/.test(name) && typeof value === 'string' && value.length <= 4096 && !/[\r\n;]/.test(value));
    const call = async (path: string, parameters: Record<string, string>): Promise<Record<string, unknown>> => {
      check(); const url = new URL(path, 'https://api.bilibili.com'); url.search = new URLSearchParams(parameters).toString();
      const headers = new Headers({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', Referer: 'https://search.bilibili.com/', Accept: 'application/json' });
      if (cookies.length) headers.set('Cookie', cookies.map(([name, value]) => `${name}=${value}`).join('; '));
      let response: Response;
      try { response = await this.request(url.href, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
      catch { check(); throw new Error('Could not reach Bilibili search. Check your connection and retry.'); }
      check();
      if (!response.ok || !response.body) throw new Error(response.status === 412 ? 'Bilibili requires verification. Sign in on the official Bilibili page, then retry search.' : 'Could not reach Bilibili search. Check your connection and retry.');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      let result: Record<string, unknown>;
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw new Error(); chunks.push(value); }
        result = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch { throw new Error('Bilibili returned unexpected search results. Please retry.'); }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      check();
      if (result.code === -101) { if (credentials) this.onExpired(); throw new Error('Your Bilibili session has expired. Sign in again or search as a guest.'); }
      if (bvid && path === '/x/web-interface/view' && result.code === -404) return { missing: true };
      if (result.code !== 0) throw new Error('Bilibili rejected the search request. Please retry.');
      return record(result.data);
    };
    try {
      if (bvid) {
        const data = await call('/x/web-interface/view', { bvid: query });
        if (data.missing) return { videos: [], total: 0, cursor: null, hasMore: false };
        const video = parseVideoCandidate(data);
        if (!video || video.bvid !== query) throw new Error('Bilibili returned unexpected search results. Please retry.');
        return { videos: [video], total: 1, cursor: null, hasMore: false };
      }
      // A guest browser identifier issued by Bilibili, not a fabricated login session.
      if (!cookies.some(([name]) => name === 'buvid3')) {
        const spi = await call('/x/frontend/finger/spi', {});
        if (typeof spi.b_3 !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(spi.b_3)) throw new Error('Could not prepare Bilibili search. Please retry.');
        cookies.push(['buvid3', spi.b_3]);
      }
      return parseSearchPage(await call('/x/web-interface/search/type', { search_type: 'video', keyword: query, page: String(page), page_size: '20', order: 'totalrank' }), page);
    } finally { this.active--; }
  }
}
