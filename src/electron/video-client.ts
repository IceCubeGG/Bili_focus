import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Credentials } from '../core/account-ports';
import { cleanText, decodeDanmu, numericId, number, object, parseComments, parseVideoDetails, postText, videoId } from '../core/video';
import type { DanmuPage, VideoCommentsPage, VideoDetails, VideoPlayback, VideoPostResult } from '../shared/contracts';
import { signWbi, wbiKey } from './wbi';
import { dashTrack, QUALITY_LABELS, requestedQuality } from '../core/playback';
import type { DashTrack } from '../shared/contracts';

export function mediaUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Unexpected video stream.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash || !['.bilivideo.com', '.bilivideo.cn'].some(domain => url.hostname.endsWith(domain))) throw new Error('Unexpected video stream.');
  url.protocol = 'https:'; return url.href;
}
export function mediaRange(value: string | null): string | null {
  if (value === null) return null;
  if (!/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(value)) throw new Error('Invalid video range.');
  const match = /^bytes=(\d+)-(\d+)$/.exec(value);
  if (match && BigInt(match[1]) > BigInt(match[2])) throw new Error('Invalid video range.');
  return value;
}
type Context = { credentials: Credentials | null; revision: number; check: () => void };
type MediaEntry = { urls: string[]; context: Context; controllers: Set<AbortController>; released: boolean };

/** Fixed native API/stream endpoints. Neither session cookies nor CDN URLs reach React. */
export class VideoClient {
  private details = new Map<string, VideoDetails>();
  private media = new Map<string, MediaEntry>();
  private scope = -1;
  private scopeCredentials: Credentials | null = null;
  private active = 0;
  private posting = new Set<string>();
  private lastPost = new Map<string, number>();
  constructor(private readonly credentials: () => Credentials | null, private readonly revision: () => number, private readonly request: typeof fetch = fetch, private readonly now: () => number = Date.now, private readonly onExpired: () => void = () => {}) {}
  clear(): void { this.details.clear(); for (const handle of this.media.keys()) this.releaseVideoPlayback({ handle }); }
  syncAccount(): void { this.context(); }
  private context(requireLogin = false): Context {
    const revision = this.revision(), credentials = this.credentials();
    if (this.scope !== revision || !isDeepStrictEqual(this.scopeCredentials, credentials)) { this.clear(); this.scope = revision; this.scopeCredentials = credentials; }
    if (requireLogin && (!credentials?.cookies.SESSDATA || !credentials.cookies.bili_jct)) throw new Error('Sign in to send Danmu or comments.');
    return { credentials, revision, check: () => { if (revision !== this.revision() || !isDeepStrictEqual(credentials, this.credentials())) throw new Error('Your account changed. Reopen the video.'); } };
  }
  private async bytes(path: string, params: Record<string, string>, context: Context, form?: Record<string, string>): Promise<Uint8Array> {
    if (this.active >= 6) throw new Error('Please wait for the current video requests.');
    this.active++;
    try {
      context.check(); const url = new URL(path, 'https://api.bilibili.com'); url.search = new URLSearchParams(params).toString();
      const headers = new Headers({ Accept: '*/*', Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' });
      if (context.credentials) headers.set('Cookie', Object.entries(context.credentials.cookies).filter(([name, value]) => /^[\w-]{1,80}$/.test(name) && typeof value === 'string' && value.length <= 4096 && !/[\r\n;]/.test(value)).map(([name, value]) => `${name}=${value}`).join('; '));
      if (form) headers.set('Content-Type', 'application/x-www-form-urlencoded');
      let response: Response;
      try { response = await this.request(url.href, { headers, method: form ? 'POST' : 'GET', body: form ? new URLSearchParams(form).toString() : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
      catch { throw new Error(form ? 'The send result could not be confirmed. Check Bilibili before sending again.' : 'Could not reach Bilibili. Check your connection and retry.'); }
      if (!response.ok || !response.body) throw new Error(`Bilibili video request failed (HTTP ${response.status}).`);
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) throw new Error('Bilibili returned too much video data.'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      context.check(); const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
    } finally { this.active--; }
  }
  private async api(path: string, params: Record<string, string>, context: Context, form?: Record<string, string>): Promise<unknown> {
    let result: Record<string, unknown>;
    try { result = object(JSON.parse(new TextDecoder().decode(await this.bytes(path, params, context, form)))); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(form ? 'The send result could not be confirmed. Check Bilibili before sending again.' : 'Bilibili returned unexpected video data.'); throw error; }
    const guestKeys = path === '/x/web-interface/nav' && context.credentials === null && result.code === -101 && Object.keys(object(object(result.data).wbi_img)).length > 0;
    if (result.code !== 0 && !guestKeys) {
      if (result.code === -101) this.onExpired();
      if (result.code === 12002 && !form && params.pn) return { page: { num: Number(params.pn), count: 0 }, replies: null, input_disable: true };
      throw new Error(result.code === -101 ? 'Sign in again to continue.' : `Bilibili rejected the video request (code ${typeof result.code === 'number' ? result.code : 'unknown'}). ${form ? 'Your message was not confirmed.' : 'This video or feature may be restricted.'}`);
    }
    return result.data;
  }
  private async signing(context: Context): Promise<string> {
    const data = object(await this.api('/x/web-interface/nav', {}, context)), keys = object(data.wbi_img);
    return wbiKey(keys.img_url, keys.sub_url);
  }
  async getVideoDetails(options: unknown): Promise<VideoDetails> {
    const bvid = videoId(object(options).bvid), context = this.context();
    const data = await this.api('/x/web-interface/view', { bvid }, context);
    let tags: unknown = []; try { tags = await this.api('/x/tag/archive/tags', { bvid }, context); } catch { context.check(); }
    const details = parseVideoDetails(data, bvid, tags); context.check();
    this.details.set(bvid, details); if (this.details.size > 32) this.details.delete(this.details.keys().next().value!);
    return structuredClone(details);
  }
  private async video(bvid: string, context: Context): Promise<VideoDetails> {
    const result = this.details.get(bvid) ?? await this.getVideoDetails({ bvid }); context.check(); return result;
  }
  private async part(input: Record<string, unknown>, context: Context): Promise<{ video: VideoDetails; cid: string }> {
    const bvid = videoId(input.bvid), cid = numericId(input.cid), video = await this.video(bvid, context);
    if (!video.parts.some(part => part.cid === cid)) throw new Error('Choose a part belonging to this video.');
    return { video, cid };
  }
  async getVideoPlayback(options: unknown): Promise<VideoPlayback> {
    const input = object(options), requested = requestedQuality(input.quality), progressive = input.format === 'progressive';
    if (input.format !== undefined && !progressive) throw new Error('Invalid playback format.');
    const context = this.context(), { video, cid } = await this.part(input, context), key = await this.signing(context);
    const data = object(await this.api('/x/player/wbi/playurl', signWbi({ bvid: video.bvid, cid, qn: String(requested), fnval: progressive ? '1' : '144', fnver: '0', fourk: progressive ? '0' : '1', ...(progressive ? { platform: 'html5' } : {}) }, key, this.now()), context));
    if (data.is_preview === 1 || data.is_preview === true) throw new Error('A playable stream is unavailable or restricted. Paid/preview access is not bypassed.');
    const handle = randomUUID(), urls: string[] = [];
    const register = () => { context.check(); if (this.media.size >= 8) this.releaseVideoPlayback({ handle: this.media.keys().next().value! }); this.media.set(handle, { urls, context, controllers: new Set(), released: false }); };
    const local = () => `bili-media://stream/${handle}/${urls.length - 1}`;
    const dash = object(data.dash);
    if (!progressive && Array.isArray(dash.video) && Array.isArray(dash.audio)) {
      const tracks = (values: unknown[], kind: 'video' | 'audio'): DashTrack[] => values.slice(0, 40).flatMap(value => {
        try { const track = dashTrack(value, kind); if (kind === 'video' && !Object.hasOwn(QUALITY_LABELS, track.quality)) return []; urls.push(mediaUrl(object(value).baseUrl ?? object(value).base_url)); return [{ ...track, url: local() }]; } catch { return []; }
      });
      const videoTracks = tracks(dash.video, 'video'), audioTracks = tracks(dash.audio.slice(0, 6), 'audio');
      const ids = [...new Set(videoTracks.map(track => track.quality))].sort((a, b) => b - a);
      const durationSeconds = number(dash.duration, 604800);
      if (!ids.length || !audioTracks.length || !durationSeconds) throw new Error('A playable DASH stream is unavailable or restricted.');
      const quality = ids.includes(requested) ? requested : ids.find(id => id <= requested) ?? ids.at(-1)!;
      register(); return { handle, sources: [], quality, qualityLabel: QUALITY_LABELS[quality], qualities: ids.map(id => ({ id, label: QUALITY_LABELS[id] })), dash: { durationSeconds, video: videoTracks, audio: audioTracks } };
    }
    if (!Array.isArray(data.durl) || !data.durl.length || data.durl.length > 50 || data.is_preview === 1 || data.is_preview === true) throw new Error('A playable MP4 stream is unavailable or restricted. Paid/preview access is not bypassed.');
    urls.push(...data.durl.map(value => mediaUrl(object(value).url))); register();
    const quality = number(data.quality);
    return { handle, quality, qualities: [{ id: quality, label: QUALITY_LABELS[quality] ?? 'Available MP4' }], qualityLabel: QUALITY_LABELS[quality] ?? 'Available MP4', sources: urls.map((_url, index) => ({ url: `bili-media://stream/${handle}/${index}`, durationSeconds: number(object((data.durl as unknown[])[index]).length, 604800000) / 1000 })) };
  }
  releaseVideoPlayback(options: unknown): void {
    const handle = object(options).handle; if (typeof handle !== 'string') return;
    const entry = this.media.get(handle); if (entry) { entry.released = true; for (const controller of entry.controllers) controller.abort(); this.media.delete(handle); }
  }
  async coverStream(options: unknown, signal: AbortSignal): Promise<Response> {
    const context = this.context(), details = await this.video(videoId(object(options).bvid), context);
    if (!details.cover) throw new Error('A cover image is unavailable.');
    const response = await this.request(details.cover, { headers: { Referer: 'https://www.bilibili.com/', 'Accept-Encoding': 'identity' }, redirect: 'error', signal });
    context.check(); if (!response.body) return response;
    const reader = response.body.getReader();
    return new Response(new ReadableStream<Uint8Array>({ async pull(target) { try { context.check(); const chunk = await reader.read(); context.check(); if (chunk.done) target.close(); else target.enqueue(chunk.value); } catch { await reader.cancel().catch(() => {}); target.error(new Error('Cover download stopped.')); } }, async cancel() { await reader.cancel().catch(() => {}); } }), { status: response.status, headers: response.headers });
  }
  async stream(request: Request): Promise<Response> {
    let entry: MediaEntry | undefined; let controller: AbortController | undefined;
    try {
      const url = new URL(request.url), match = /^\/([a-f0-9-]{36})\/(\d{1,2})$/.exec(url.pathname);
      if (url.hostname !== 'stream' || url.search || !match || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 400 });
      entry = this.media.get(match[1]); if (!entry || !entry.urls[Number(match[2])]) return new Response(null, { status: 410 });
      entry.context.check(); if (entry.controllers.size >= 4) return new Response(null, { status: 429 });
      const range = mediaRange(request.headers.get('Range')), headers = new Headers({ Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' }); if (range) headers.set('Range', range);
      controller = new AbortController(); entry.controllers.add(controller);
      const abort = () => controller!.abort(); request.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 20000); let upstream: Response;
      try { upstream = await this.request(entry.urls[Number(match[2])], { method: request.method, headers, redirect: 'error', signal: controller.signal }); } finally { clearTimeout(timeout); }
      entry.context.check(); if (entry.released) throw new Error('Video stream closed.');
      const mime = upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? 'video/mp4';
      if (!['video/mp4', 'audio/mp4', 'video/webm', 'application/octet-stream'].includes(mime)) throw new Error('Unexpected media response.');
      const output = new Headers({ 'Content-Type': mime === 'application/octet-stream' ? 'video/mp4' : mime, 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) { const value = upstream.headers.get(name); if (value) output.set(name, value); }
      if (![200, 206, 416].includes(upstream.status)) { controller.abort(); entry.controllers.delete(controller); return new Response(null, { status: 502 }); }
      if (!upstream.body || request.method === 'HEAD') { entry.controllers.delete(controller); request.signal.removeEventListener('abort', abort); return new Response(null, { status: upstream.status, headers: output }); }
      const reader = upstream.body.getReader(), activeEntry = entry, activeController = controller;
      const cleanup = () => { activeEntry.controllers.delete(activeController); request.signal.removeEventListener('abort', abort); };
      const body = new ReadableStream<Uint8Array>({ async pull(target) { try { activeEntry.context.check(); if (activeEntry.released) throw new Error(); const chunk = await reader.read(); activeEntry.context.check(); if (activeEntry.released) throw new Error(); if (chunk.done) { cleanup(); target.close(); } else target.enqueue(chunk.value); } catch { cleanup(); activeController.abort(); await reader.cancel().catch(() => {}); target.error(new Error('Video stream stopped.')); } }, async cancel() { cleanup(); activeController.abort(); await reader.cancel().catch(() => {}); } });
      return new Response(body, { status: upstream.status, headers: output });
    } catch { if (controller) { controller.abort(); entry?.controllers.delete(controller); } return new Response(null, { status: 403 }); }
  }
  async getDanmu(options: unknown): Promise<DanmuPage> {
    const input = object(options), context = this.context(), { cid, video } = await this.part(input, context), segment = number(input.segment, 1680);
    if (!segment || segment > Math.max(1, Math.ceil((video.parts.find(part => part.cid === cid)!.durationSeconds || 604800) / 360))) throw new Error('Invalid Danmu segment.');
    const key = await this.signing(context), bytes = await this.bytes('/x/v2/dm/web/seg.so', signWbi({ type: '1', oid: cid, segment_index: String(segment) }, key, this.now()), context);
    return { segment, items: decodeDanmu(bytes) };
  }
  async getVideoComments(options: unknown): Promise<VideoCommentsPage> {
    const input = object(options), bvid = videoId(input.bvid), context = this.context(), video = await this.video(bvid, context), page = number(input.page, 1000000);
    const root = input.root === null ? null : numericId(input.root); if (!page || !['hot', 'newest'].includes(String(input.sort))) throw new Error('Invalid comment page.');
    return parseComments(await this.api(root ? '/x/v2/reply/reply' : '/x/v2/reply', { oid: video.aid, type: '1', pn: String(page), ps: '20', sort: input.sort === 'hot' ? '2' : '0', ...(root ? { root } : {}) }, context), page, root);
  }
  private async post(kind: string, task: () => Promise<void>): Promise<VideoPostResult> {
    if (this.posting.has(kind) || this.now() - (this.lastPost.get(kind) ?? -Infinity) < 5000) throw new Error('Wait five seconds before sending another message.');
    this.posting.add(kind); this.lastPost.set(kind, this.now());
    try { await task(); return { message: 'Sent to Bilibili. Moderation may delay its appearance.' }; } finally { this.posting.delete(kind); }
  }
  async sendDanmu(options: unknown): Promise<VideoPostResult> {
    const input = object(options), text = postText(input.text, 100), context = this.context(true), { cid, video } = await this.part(input, context), time = input.timeSeconds;
    const duration = video.parts.find(part => part.cid === cid)!.durationSeconds;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > (duration || 604800)) throw new Error('Invalid Danmu position.');
    return this.post('danmu', async () => { const key = await this.signing(context); await this.api('/x/v2/dm/post', signWbi({ csrf: context.credentials!.cookies.bili_jct, web_location: '1315873' }, key, this.now()), context, { type: '1', oid: cid, bvid: video.bvid, msg: text, progress: String(Math.round(time * 1000)), color: '16777215', fontsize: '25', pool: '0', mode: '1', rnd: String(BigInt(this.now()) * 1000n), csrf: context.credentials!.cookies.bili_jct }); });
  }
  async sendVideoComment(options: unknown): Promise<VideoPostResult> {
    const input = object(options), text = postText(input.text, 1000), context = this.context(true), video = await this.video(videoId(input.bvid), context);
    const root = input.root === null ? null : numericId(input.root), parent = input.parent === null ? null : numericId(input.parent);
    if (!!root !== !!parent) throw new Error('Choose a valid reply target.');
    return this.post('comment', async () => { await this.api('/x/v2/reply/add', {}, context, { oid: video.aid, type: '1', message: text, plat: '1', csrf: context.credentials!.cookies.bili_jct, ...(root ? { root, parent: parent! } : {}) }); });
  }
}
