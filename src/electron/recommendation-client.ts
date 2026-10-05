import type { RecommendationPage, VideoCandidate, VideoLabels } from '../shared/contracts';
import type { Credentials } from '../core/account-ports';
import { isDeepStrictEqual } from 'node:util';

const API = 'https://api.bilibili.com';
const BVID = /^BV[0-9A-Za-z]{10}$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
const text = (value: unknown, maximum: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
function verifiedLabel(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const label = value.trim();
  return label.length > 0 && label.length <= 80 ? label : null;
}

function coverUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.endsWith('.hdslb.com')) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

export function parseVideoCandidate(value: unknown): VideoCandidate | null {
  const item = record(value);
  if (!item || typeof item.bvid !== 'string' || !BVID.test(item.bvid) || (item.goto !== undefined && item.goto !== 'av') || item.business_info != null || item.ad_info != null || item.is_ad === true || item.is_ad === 1 || item.is_ad === '1') return null;
  const owner = record(item.owner);
  const uid = typeof owner?.mid === 'string' && /^[1-9]\d{0,19}$/.test(owner.mid) ? owner.mid : integer(owner?.mid)?.toString();
  const title = text(item.title, 300);
  const name = text(owner?.name, 80);
  if (!uid || uid === '0' || !title || !name) return null;
  const stat = record(item.stat);
  const pubdate = integer(item.pubdate, 4102444800);
  return {
    bvid: item.bvid, title, cover: coverUrl(item.pic), durationSeconds: integer(item.duration, 604800) ?? 0,
    uploader: { id: uid, name }, views: integer(stat?.view) ?? 0, publishedAt: pubdate ? pubdate * 1000 : null,
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Bilibili returned an empty response. Please retry.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('Bilibili returned an unexpected response. Please retry.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch { throw new Error('Bilibili returned an unexpected response. Please retry.'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class RecommendationClient {
  private readonly labels = new Map<string, { expiresAt: number; value: VideoLabels }>();
  private readonly labelsPending = new Map<string, Promise<VideoLabels>>();

  constructor(
    private readonly credentials: () => Credentials | null,
    private readonly revision: () => number,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly onExpired: () => void = () => {},
  ) {}

  private async call(path: string, parameters: Record<string, string>, credentials: Credentials | null): Promise<unknown> {
    // Paths are supplied only by the native host; renderer inputs become query values.
    const url = new URL(path, API);
    if (url.origin !== API) throw new Error('Unsupported recommendation endpoint.');
    url.search = new URLSearchParams(parameters).toString();
    const headers = new Headers({ 'User-Agent': 'Mozilla/5.0 BiliFocus/0.1', Referer: 'https://www.bilibili.com/', Accept: 'application/json' });
    if (credentials) {
      const cookies = Object.entries(credentials.cookies).filter(([name, value]) => /^[\w-]{1,80}$/.test(name) && typeof value === 'string' && value.length <= 4096 && !/[\r\n;]/.test(value));
      if (cookies.length) headers.set('Cookie', cookies.map(([name, value]) => `${name}=${value}`).join('; '));
    }
    let response: Response;
    try { response = await this.request(url.href, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Could not reach Bilibili. Check your connection and try again.'); }
    if (!response.ok) throw new Error(`Bilibili recommendations are unavailable (HTTP ${response.status}). Please retry.`);
    const result = record(await boundedJson(response));
    if (!result || typeof result.code !== 'number') throw new Error('Bilibili returned an unexpected response. Please retry.');
    if (result.code !== 0) {
      if (result.code === -101 && credentials) this.onExpired();
      throw new Error(result.code === -101 ? 'Your Bilibili session has expired. Sign in again to refresh recommendations.' : `Bilibili rejected the recommendation request (code ${result.code}). Please retry.`);
    }
    return result.data;
  }

  async getRecommendationPage(options: unknown): Promise<RecommendationPage> {
    const input = record(options);
    const cursor = input?.cursor;
    if (!input || (cursor !== null && (typeof cursor !== 'string' || !/^[1-9]\d{0,3}$/.test(cursor) || Number(cursor) > 1000))) throw new Error('Invalid recommendation cursor.');
    const page = cursor === null ? 1 : Number(cursor);
    const revision = this.revision();
    const credentials = structuredClone(this.credentials());
    const data = await this.call('/x/web-interface/wbi/index/top/feed/rcmd', {
      fresh_type: '4', ps: '30', fresh_idx: String(page), fresh_idx_1h: String(page), fetch_row: '1',
    }, credentials);
    if (revision !== this.revision() || !isDeepStrictEqual(credentials, this.credentials())) throw new Error('Your account changed. Refresh recommendations.');
    const items = record(data)?.item;
    if (!Array.isArray(items) || items.length > 100) throw new Error('Bilibili returned an unexpected recommendation list. Please retry.');
    const seen = new Set<string>();
    const videos: VideoCandidate[] = [];
    for (const item of items) {
      const candidate = parseVideoCandidate(item);
      if (candidate && !seen.has(candidate.bvid)) { seen.add(candidate.bvid); videos.push(candidate); }
    }
    const hasMore = items.length > 0 && page < 1000;
    return { videos, cursor: hasMore ? String(page + 1) : null, hasMore };
  }

  async getVideoLabels(options: unknown): Promise<VideoLabels[]> {
    const bvids = record(options)?.bvids;
    if (!Array.isArray(bvids) || bvids.length > 50 || bvids.some((value) => typeof value !== 'string' || !BVID.test(value))) throw new Error('Invalid video label request.');
    const unique = [...new Set(bvids as string[])];
    const revision = this.revision();
    const results: VideoLabels[] = new Array(unique.length);
    let index = 0;
    const worker = async () => {
      while (index < unique.length) {
        const current = index++;
        results[current] = await this.getLabels(unique[current]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
    if (revision !== this.revision()) throw new Error('Your account changed. Refresh recommendations.');
    return results;
  }

  private getLabels(bvid: string): Promise<VideoLabels> {
    const cached = this.labels.get(bvid);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(structuredClone(cached.value));
    const existing = this.labelsPending.get(bvid);
    if (existing) return existing.then((value) => structuredClone(value));
    const task = this.loadLabels(bvid);
    this.labelsPending.set(bvid, task);
    void task.finally(() => this.labelsPending.delete(bvid));
    return task.then((value) => structuredClone(value));
  }

  private async loadLabels(bvid: string): Promise<VideoLabels> {
    let value: VideoLabels;
    try {
      const data = await this.call('/x/tag/archive/tags', { bvid }, null);
      if (!Array.isArray(data) || data.length > 100) throw new Error('Unexpected video labels.');
      const labels = [...new Set(data.map((item) => verifiedLabel(record(item)?.tag_name)).filter((label): label is string => label !== null))];
      value = { bvid, labels, status: 'ready' };
    } catch { value = { bvid, labels: [], status: 'unavailable' }; }
    this.labels.delete(bvid);
    // A manual retry must make a fresh request immediately after a failed lookup.
    if (value.status === 'ready') this.labels.set(bvid, { expiresAt: this.now() + 600000, value });
    while (this.labels.size > 512) this.labels.delete(this.labels.keys().next().value!);
    return value;
  }
}
