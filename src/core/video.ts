import type { Danmu, VideoComment, VideoCommentsPage, VideoDetails } from '../shared/contracts';

export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const number = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
export const cleanText = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
export function videoId(value: unknown): string {
  if (typeof value !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(value)) throw new Error('Invalid video identifier.');
  return value;
}
export function numericId(value: unknown): string {
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)) return value;
  if (number(value) > 0) return String(value);
  throw new Error('Invalid numeric identifier.');
}
export function imageUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try { const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.endsWith('.hdslb.com') || url.username || url.password || url.port) return '';
    url.protocol = 'https:'; return url.href;
  } catch { return ''; }
}
export function postText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`Enter 1–${max} characters without control characters.`);
  return value.trim();
}
export function parseVideoDetails(raw: unknown, bvid: string, rawTags: unknown): VideoDetails {
  const data = object(raw), owner = object(data.owner);
  if (data.bvid !== bvid || !cleanText(data.title, 300).trim() || !Array.isArray(data.pages) || !data.pages.length || data.pages.length > 1000) throw new Error('Bilibili returned unexpected video details.');
  const parts = data.pages.map((value, index) => { const part = object(value); return { cid: numericId(part.cid), page: index + 1, title: cleanText(part.part, 300) || `Part ${index + 1}`, durationSeconds: number(part.duration, 604800) }; });
  if (new Set(parts.map(part => part.cid)).size !== parts.length) throw new Error('Bilibili returned duplicate video parts.');
  const sections = object(data.ugc_season).sections;
  const episodes = (Array.isArray(sections) ? sections.slice(0, 100) : []).flatMap(value => { const section = object(value); return (Array.isArray(section.episodes) ? section.episodes.slice(0, 500) : []).flatMap(value => {
    const episode = object(value); try { return [{ bvid: videoId(episode.bvid), title: cleanText(episode.title || object(episode.arc).title, 300), section: cleanText(section.title, 120) }]; } catch { return []; }
  }); }).slice(0, 500);
  const tags = (Array.isArray(rawTags) ? rawTags.slice(0, 100) : []).map(value => cleanText(object(value).tag_name, 80).trim()).filter(Boolean);
  return { bvid, aid: numericId(data.aid), title: cleanText(data.title, 300), cover: imageUrl(data.pic), durationSeconds: number(data.duration, 604800),
    uploader: { id: numericId(owner.mid), name: cleanText(owner.name, 80) || 'Uploader' }, uploaderAvatar: imageUrl(owner.face),
    views: number(object(data.stat).view), publishedAt: number(data.pubdate, 4102444800) ? number(data.pubdate, 4102444800) * 1000 : null,
    description: cleanText(data.desc, 20000), tags: [...new Set(tags)], parts, episodes };
}
export function parseComment(value: unknown, preview = true): VideoComment | null {
  try { const item = object(value), member = object(item.member); const text = cleanText(object(item.content).message, 4000);
    if (!text) return null;
    return { id: numericId(item.rpid_str ?? item.rpid), author: { id: numericId(member.mid), name: cleanText(member.uname, 80) || 'Bilibili user', avatar: imageUrl(member.avatar) },
      text, publishedAt: number(item.ctime, 4102444800) ? number(item.ctime, 4102444800) * 1000 : null, likes: number(item.like), replyCount: number(item.rcount),
      replies: preview && Array.isArray(item.replies) ? item.replies.slice(0, 10).map(value => parseComment(value, false)).filter((value): value is VideoComment => value !== null) : [] };
  } catch { return null; }
}
export function parseComments(raw: unknown, page: number, root: string | null): VideoCommentsPage {
  const data = object(raw), paging = object(data.page);
  if (!Object.keys(paging).length || number(paging.num) !== page || !(data.replies === null || Array.isArray(data.replies))) throw new Error('Bilibili returned unexpected comments.');
  const total = number(paging.count), normal = Array.isArray(data.replies) ? data.replies.slice(0, 50) : [];
  const top = object(data.top);
  const pinned = !root && page === 1 ? [...(Array.isArray(data.top_replies) ? data.top_replies.slice(0, 10) : []), ...['upper', 'admin', 'vote'].map(key => top[key]).filter(Boolean)] : [];
  const unique = new Map<string, VideoComment>();
  for (const value of [...pinned, ...normal]) { const comment = parseComment(value); if (comment) unique.set(comment.id, comment); }
  const size = number(paging.size, 50) || 20;
  return { items: [...unique.values()], page, total, hasMore: page * size < total, closed: data.input_disable === true || object(data.control).input_disable === true };
}

/** Minimal bounded protobuf reader; unsupported scripted/advanced Danmu are never executed. */
export function decodeDanmu(bytes: Uint8Array): Danmu[] {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('The Danmu segment is too large.');
  class Reader {
    offset = 0;
    constructor(readonly data: Uint8Array) {}
    varint(): bigint { let result = 0n; for (let i = 0; i < 10; i++) { const byte = this.data[this.offset++]; if (byte === undefined || i === 9 && byte > 1) throw new Error('Invalid Danmu data.'); result |= BigInt(byte & 127) << BigInt(i * 7); if (!(byte & 128)) return result; } throw new Error('Invalid Danmu data.'); }
    chunk(): Uint8Array { const length = Number(this.varint()); if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) throw new Error('Invalid Danmu data.'); const result = this.data.subarray(this.offset, this.offset + length); this.offset += length; return result; }
    skip(wire: number): void { if (wire === 0) this.varint(); else if (wire === 2) this.chunk(); else if (wire === 1 || wire === 5) { this.offset += wire === 1 ? 8 : 4; if (this.offset > this.data.length) throw new Error('Invalid Danmu data.'); } else throw new Error('Invalid Danmu data.'); }
  }
  const outer = new Reader(bytes), result = new Map<string, Danmu>(), decoder = new TextDecoder('utf-8', { fatal: true });
  while (outer.offset < bytes.length) {
    const key = Number(outer.varint()), field = key >>> 3, wire = key & 7;
    if (field !== 1 || wire !== 2) { outer.skip(wire); continue; }
    const reader = new Reader(outer.chunk()); let id = '', time = 0, mode = 0, color = 16777215, text = '';
    while (reader.offset < reader.data.length) {
      const key = Number(reader.varint()), field = key >>> 3, wire = key & 7;
      if ([1, 2, 3, 5].includes(field) && wire === 0) { const value = reader.varint(); if (field === 1) id = String(value); else if (field === 2) time = Number(value) / 1000; else if (field === 3) mode = Number(value); else color = Number(value); }
      else if ([7, 12].includes(field) && wire === 2) { const value = decoder.decode(reader.chunk()); if (field === 7) text = cleanText(value, 300); else id = value; }
      else reader.skip(wire);
    }
    if (id && /^\d{1,20}$/.test(id) && text && [1, 4, 5].includes(mode) && Number.isFinite(time) && time >= 0 && time <= 604800 && Number.isInteger(color) && color >= 0 && color <= 16777215) result.set(id, { id, timeSeconds: time, text, color, mode: mode as Danmu['mode'] });
    if (result.size > 6000) throw new Error('Too many items in this Danmu segment.');
  }
  return [...result.values()].sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function activeDanmu(items: Danmu[], time: number): (Danmu & { progress: number; lane: number })[] {
  const lanes = Array(10).fill(-Infinity) as number[], result: (Danmu & { progress: number; lane: number })[] = [];
  for (const item of items) {
    let hash = 0; for (const digit of item.id) hash = (hash * 31 + digit.charCodeAt(0)) >>> 0;
    const lane = hash % 10;
    if (item.timeSeconds - lanes[lane] < 2) continue;
    lanes[lane] = item.timeSeconds;
    const elapsed = time - item.timeSeconds;
    if (elapsed < 0 || elapsed >= 8) continue;
    result.push({ ...item, progress: elapsed / 8, lane });
    if (result.length === 40) break;
  }
  return result;
}
