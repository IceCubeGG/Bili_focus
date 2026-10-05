import { numericId, object, videoId } from './video';

export const VIDEO_LIMIT = 2 * 1024 * 1024 * 1024;
export const COVER_LIMIT = 20 * 1024 * 1024;
export function downloadRequest(value: unknown): { bvid: string; cid: string | null; kind: 'video' | 'cover' } {
  const input = object(value), bvid = videoId(input.bvid);
  if (input.kind !== 'video' && input.kind !== 'cover') throw new Error('Choose video or cover.');
  return { bvid, kind: input.kind, cid: input.kind === 'video' ? numericId(input.cid) : null };
}
export function downloadName(title: string): string {
  const cleaned = [...title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')].slice(0, 70).join('').replace(/[. ]+$/g, '').trim();
  return (!cleaned || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(cleaned)) ? 'video' : cleaned;
}
export function downloadType(bytes: Uint8Array, kind: 'video' | 'cover'): { extension: string; mime: string } {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, text: string) => [...text].every((value, index) => bytes[offset + index] === value.charCodeAt(0));
  if (kind === 'video') {
    if (bytes.length >= 12 && ascii(4, 'ftyp')) return { extension: 'mp4', mime: 'video/mp4' };
    if (starts(0x1a, 0x45, 0xdf, 0xa3)) return { extension: 'webm', mime: 'video/webm' };
  } else {
    if (starts(0xff, 0xd8, 0xff)) return { extension: 'jpg', mime: 'image/jpeg' };
    if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return { extension: 'png', mime: 'image/png' };
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { extension: 'webp', mime: 'image/webp' };
    if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { extension: 'gif', mime: 'image/gif' };
  }
  throw new Error('The downloaded file is not a supported video or cover image.');
}
