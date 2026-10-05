import { isDeepStrictEqual } from 'node:util';
import type { Credentials } from '../core/account-ports';
import type { FollowedUploaderPage, SubscriptionPage, UploaderVideoPage, VideoCandidate } from '../shared/contracts';
import { signWbi, wbiKey } from './wbi';

const API = 'https://api.bilibili.com';
const BVID = /^BV[0-9A-Za-z]{10}$/;
const OFFSET = /^[A-Za-z0-9_:-]{1,256}$/;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
const text = (value: unknown, maximum: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
function uid(value: unknown): string | null {
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)) return value;
  const number = integer(value);
  return number && number > 0 ? String(number) : null;
}
function cover(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.endsWith('.hdslb.com')) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}
function duration(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) return 0;
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some(part => part >= 60)) return 0;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds <= 604800 ? seconds : 0;
}

export function uploaderPageIndex(cursor: unknown): number {
  if (cursor === null) return 1;
  if (typeof cursor !== 'string' || !/^[1-9]\d{0,7}$/.test(cursor) || Number(cursor) > 33333334) throw new Error('Invalid uploader video page. Refresh this uploader.');
  return Number(cursor);
}

export function parseUploaderVideo(value: unknown, requestedUid: string): VideoCandidate | null {
  const item = record(value);
  if (!item || uid(item.mid) !== requestedUid || typeof item.bvid !== 'string' || !BVID.test(item.bvid) || item.ad_info != null || item.business_info != null || item.is_ad === true || item.is_ad === 1 || item.is_ad === '1') return null;
  const title = text(item.title, 300), name = text(item.author, 80);
  if (!title || !name) return null;
  const published = integer(item.created, 4102444800);
  return { bvid: item.bvid, title, cover: cover(item.pic), durationSeconds: duration(item.length), uploader: { id: requestedUid, name }, views: integer(item.play) ?? 0, publishedAt: published ? published * 1000 : null };
}

export function parseUploaderVideoPage(value: unknown, requestedUid: string, page: number): UploaderVideoPage {
  const data = record(value), paging = record(data?.page), list = record(data?.list)?.vlist;
  const total = integer(paging?.count, 1000000000);
  if (!Array.isArray(list) || list.length > 30 || total === null || paging?.pn !== page || paging?.ps !== 30 || (!list.length && (page - 1) * 30 < total)) throw new Error('Bilibili returned an unexpected uploader library. Please retry.');
  const unique = new Map<string, VideoCandidate>();
  for (const item of list) { const video = parseUploaderVideo(item, requestedUid); if (video) unique.set(video.bvid, video); }
  const hasMore = page * 30 < total;
  return { videos: [...unique.values()], total, hasMore, cursor: hasMore ? String(page + 1) : null };
}

/** The author of an original archive post is its uploader; repost authors are excluded. */
export function parseSubscriptionItem(value: unknown): VideoCandidate | null {
  const item = record(value);
  if (!item || item.type !== 'DYNAMIC_TYPE_AV' || item.orig != null || item.ad_info != null || item.business_info != null || item.is_ad === true || item.is_ad === 1 || item.is_ad === '1') return null;
  const modules = record(item.modules);
  const author = record(modules?.module_author);
  const major = record(record(modules?.module_dynamic)?.major);
  const archive = record(major?.archive);
  if (!author || author.following === false || (author.following != null && typeof author.following !== 'boolean') || major?.type !== 'MAJOR_TYPE_ARCHIVE' || !archive || archive.ad_info != null || archive.business_info != null || archive.is_ad === true || archive.is_ad === 1 || archive.is_ad === '1') return null;
  const uploaderId = uid(author.mid);
  const name = text(author.name, 80);
  const title = text(archive.title, 300);
  if (!uploaderId || !name || !title || typeof archive.bvid !== 'string' || !BVID.test(archive.bvid)) return null;
  const published = integer(author.pub_ts, 4102444800);
  const play = record(archive.stat)?.play;
  const views = integer(play) ?? (typeof play === 'string' && /^\d{1,16}$/.test(play) ? integer(Number(play)) ?? 0 : 0);
  return { bvid: archive.bvid, title, cover: cover(archive.cover), durationSeconds: duration(archive.duration_text), uploader: { id: uploaderId, name }, views, publishedAt: published ? published * 1000 : null };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Bilibili returned an empty Subscribe response. Please retry.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch { throw new Error('Bilibili returned an unexpected Subscribe response. Please retry.'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class SubscriptionClient {
  private readonly relations = new Map<string, { following: boolean; expiresAt: number }>();
  private cacheSession: Credentials | null = null;
  private epoch = 0;
  private activeRequests = 0;
  private activePages = 0;
  private readonly requestQueue: Array<() => void> = [];

  constructor(
    private readonly credentials: () => Credentials | null,
    private readonly revision: () => number,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly onExpired: () => void = () => {},
  ) {}

  private async acquire(): Promise<void> {
    if (this.activeRequests < 4) { this.activeRequests++; return; }
    await new Promise<void>(resolve => this.requestQueue.push(resolve));
  }
  private release(): void {
    const next = this.requestQueue.shift();
    if (next) next(); else this.activeRequests--;
  }

  private async call(path: string, parameters: Record<string, string>, credentials: Credentials, current: () => void, referer = 'https://t.bilibili.com/'): Promise<unknown> {
    await this.acquire();
    try {
      current();
      const url = new URL(path, API);
      if (url.origin !== API) throw new Error('Unsupported Subscribe endpoint.');
      url.search = new URLSearchParams(parameters).toString();
      const headers = new Headers({ Accept: 'application/json', Referer: referer, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' });
      if (path === '/x/space/wbi/arc/search') headers.set('Origin', 'https://space.bilibili.com');
      const cookies = Object.entries(credentials.cookies).filter(([name, value]) => /^[\w-]{1,80}$/.test(name) && typeof value === 'string' && value.length <= 4096 && !/[\r\n;]/.test(value));
      headers.set('Cookie', cookies.map(([name, value]) => `${name}=${value}`).join('; '));
      let response: Response;
      try { response = await this.request(url.href, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
      catch { throw new Error('Could not reach Bilibili. Check your connection and try again.'); }
      if (!response.ok) throw new Error(`Bilibili Subscribe is unavailable (HTTP ${response.status}). Please retry.`);
      const result = record(await boundedJson(response));
      current();
      if (!result || typeof result.code !== 'number') throw new Error('Bilibili returned an unexpected Subscribe response. Please retry.');
      if (result.code !== 0) {
        if (result.code === -101) this.onExpired();
        throw new Error(result.code === -101 ? 'Your Bilibili session has expired. Sign in again to view followed uploads.' : `Bilibili rejected the Subscribe request (code ${result.code}). Please retry.`);
      }
      return result.data;
    } finally { this.release(); }
  }

  async getSubscriptionPage(options: unknown): Promise<SubscriptionPage> {
    if (this.activePages >= 4) throw new Error('Subscribe is busy. Wait for the current request to finish and retry.');
    this.activePages++;
    try { return await this.loadSubscriptionPage(options); }
    finally { this.activePages--; }
  }

  async getUploaderVideoPage(options: unknown): Promise<UploaderVideoPage> {
    const input = record(options);
    if (!input || typeof input.uploaderId !== 'string' || uid(input.uploaderId) !== input.uploaderId) throw new Error('Choose a valid followed uploader.');
    const page = uploaderPageIndex(input.cursor), uploaderId = input.uploaderId;
    if (this.activePages >= 4) throw new Error('Subscribe is busy. Wait for the current request to finish and retry.');
    this.activePages++;
    try {
      const credentials = structuredClone(this.credentials()), revision = this.revision();
      if (!credentials?.cookies.SESSDATA) throw new Error('Sign in to view this uploader’s videos.');
      const current = () => { if (revision !== this.revision() || !isDeepStrictEqual(credentials, this.credentials())) throw new Error('Your account changed. Refresh this uploader.'); };
      const relation = record(await this.call('/x/relation', { fid: uploaderId }, credentials, current));
      if (!relation || uid(relation.mid) !== uploaderId || (relation.attribute !== 2 && relation.attribute !== 6)) throw new Error('This uploader is no longer followed. Refresh your subscriptions.');
      const nav = record(await this.call('/x/web-interface/nav', {}, credentials, current));
      const images = record(nav?.wbi_img), key = wbiKey(images?.img_url, images?.sub_url);
      const parameters = signWbi({ mid: uploaderId, pn: String(page), ps: '30', order: 'pubdate', tid: '0', keyword: '', platform: 'web', web_location: '333.1387', order_avoided: 'true' }, key, this.now());
      const data = await this.call('/x/space/wbi/arc/search', parameters, credentials, current, `https://space.bilibili.com/${uploaderId}/upload/video`);
      current();
      return parseUploaderVideoPage(data, uploaderId, page);
    } finally { this.activePages--; }
  }

  async getFollowedUploaderPage(options: unknown, accountUid: string): Promise<FollowedUploaderPage> {
    const cursor = record(options)?.cursor;
    if (!uid(accountUid) || (cursor !== null && (typeof cursor !== 'string' || !/^[1-9]\d{0,3}$/.test(cursor) || Number(cursor) > 2000))) throw new Error('Invalid followed-uploader page.');
    if (this.activePages >= 4) throw new Error('Please wait for the current subscriptions to load.');
    this.activePages++;
    try {
      const credentials = structuredClone(this.credentials()); const revision = this.revision();
      if (!credentials?.cookies.SESSDATA) throw new Error('Sign in to load your followed uploaders.');
      const current = () => { if (revision !== this.revision() || !isDeepStrictEqual(credentials, this.credentials())) throw new Error('Your account changed. Refresh subscriptions.'); };
      const page = cursor === null ? 1 : Number(cursor);
      const data = record(await this.call('/x/relation/followings', { vmid: accountUid, pn: String(page), ps: '50', order: 'desc', order_type: 'attention' }, credentials, current));
      current();
      const total = integer(data?.total, 100000);
      if (!data || !Array.isArray(data.list) || data.list.length > 50 || total === null || (!data.list.length && page * 50 < total)) throw new Error('Bilibili returned an unexpected followed-uploader list.');
      const seen = new Set<string>();
      const uploaders: FollowedUploaderPage['uploaders'] = [];
      for (const raw of data.list) {
        const item = record(raw); const id = uid(item?.mid); const name = text(item?.uname, 80);
        if (!item || !id || !name || (item.attribute !== 2 && item.attribute !== 6) || seen.has(id)) continue;
        seen.add(id); uploaders.push({ id, name, avatar: cover(item.face) });
      }
      const hasMore = page * 50 < total && page < 2000;
      return { uploaders, total, hasMore, cursor: hasMore ? String(page + 1) : null };
    } finally { this.activePages--; }
  }

  private async loadSubscriptionPage(options: unknown): Promise<SubscriptionPage> {
    const input = record(options);
    if (!input || (input.cursor !== null && (typeof input.cursor !== 'string' || !OFFSET.test(input.cursor)))) throw new Error('Invalid Subscribe cursor.');
    const cursor = input.cursor as string | null;
    const credentials = structuredClone(this.credentials());
    if (!credentials?.cookies.SESSDATA || /[\r\n;]/.test(credentials.cookies.SESSDATA) || credentials.cookies.SESSDATA.length > 4096) { this.relations.clear(); throw new Error('Sign in to Bilibili to view uploads from accounts you follow.'); }
    if (cursor === null || !isDeepStrictEqual(this.cacheSession, credentials)) { this.epoch++; this.relations.clear(); this.cacheSession = structuredClone(credentials); }
    const epoch = this.epoch;
    const revision = this.revision();
    const current = () => {
      if (epoch !== this.epoch || revision !== this.revision() || !isDeepStrictEqual(credentials, this.credentials())) throw new Error('Your account changed. Refresh Subscribe.');
    };
    const data = record(await this.call('/x/polymer/web-dynamic/v1/feed/all', { type: 'video', ...(cursor ? { offset: cursor } : {}) }, credentials, current));
    current();
    if (!data || !Array.isArray(data.items) || data.items.length > 100 || (typeof data.has_more !== 'boolean' && data.has_more !== 0 && data.has_more !== 1)) throw new Error('Bilibili returned an unexpected followed-video list. Please retry.');
    const hasMore = data.has_more === true || data.has_more === 1;
    if (hasMore && (typeof data.offset !== 'string' || !OFFSET.test(data.offset))) throw new Error('Bilibili returned an unexpected Subscribe cursor. Please retry.');
    if (hasMore && data.offset === cursor) throw new Error('Bilibili did not advance the Subscribe cursor. Refresh to retry.');
    const candidates = data.items.map(parseSubscriptionItem).filter((video): video is VideoCandidate => video !== null);
    const ids = [...new Set(candidates.map(video => video.uploader.id))];
    const membership = new Map<string, boolean>();
    let index = 0;
    let failed = false;
    let failure: unknown;
    const worker = async () => {
      try { while (index < ids.length && !failed) {
        current();
        const id = ids[index++];
        const cached = this.relations.get(id);
        if (cached && cached.expiresAt > this.now()) { membership.set(id, cached.following); continue; }
        const relation = record(await this.call('/x/relation', { fid: id }, credentials, current));
        current();
        if (!relation || uid(relation.mid) !== id || ![0, 1, 2, 6, 128].includes(relation.attribute as number) || typeof relation.attribute !== 'number') throw new Error('Could not verify followed accounts. Refresh Subscribe to retry.');
        const following = relation.attribute === 2 || relation.attribute === 6;
        membership.set(id, following);
        this.relations.set(id, { following, expiresAt: this.now() + 30000 });
        while (this.relations.size > 512) this.relations.delete(this.relations.keys().next().value!);
      } } catch (error) { if (!failed) { failed = true; failure = error; } }
    };
    // Hold page admission until every already-started worker drains. A quick
    // verification failure cannot leave detached requests growing the queue.
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    if (failed) throw failure;
    current();
    const unique = new Map<string, VideoCandidate>();
    for (const video of candidates) if (membership.get(video.uploader.id) && !unique.has(video.bvid)) unique.set(video.bvid, video);
    const videos = [...unique.values()].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const next = hasMore && data.offset !== cursor ? data.offset as string : null;
    return { videos, cursor: next, hasMore: next !== null };
  }
}
