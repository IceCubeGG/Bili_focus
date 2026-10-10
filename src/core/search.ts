import type { VideoCandidate, VideoSearchPage } from '../shared/contracts';

export function searchQuery(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || value.length > 200) throw new Error('Enter a keyword or BV code (1–200 characters).');
  const query = value.trim();
  if (!query) throw new Error('Enter a keyword or BV code (1–200 characters).');
  if (/^bv[0-9a-z]*$/i.test(query)) {
    if (!/^bv[0-9a-z]{10}$/i.test(query)) throw new Error('Enter a complete BV code: BV followed by 10 letters or numbers.');
    return `BV${query.slice(2)}`;
  }
  return query;
}

export function searchPageIndex(value: unknown): number {
  if (value === null) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1000) throw new Error('Invalid search page. Start a new search.');
  return Number(value);
}

/** Search highlighting is metadata, not executable markup. React receives plain text only. */
export function searchTitle(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4000) return '';
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#39|#\d{1,7}|#x[0-9a-f]{1,6});/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith('&#x') ? parseInt(key.slice(3, -1), 16) : Number(key.slice(2, -1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300);
}

export function searchDuration(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) return 0;
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some(part => part >= 60)) return 0;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds <= 604800 ? seconds : 0;
}

export function mergeSearchVideos(previous: VideoCandidate[], page: VideoSearchPage): VideoCandidate[] {
  const seen = new Set(previous.map(video => video.bvid));
  return [...previous, ...page.videos.filter(video => !seen.has(video.bvid) && !!seen.add(video.bvid))];
}
