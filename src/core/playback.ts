import type { DashTrack, VideoPlayback, VideoQuality } from '../shared/contracts';
import { number, object } from './video';

export const QUALITY_LABELS: Readonly<Record<number, string>> = { 16: '360p', 32: '480p', 64: '720p', 74: '720p 60fps', 80: '1080p', 112: '1080p+', 116: '1080p 60fps', 120: '4K' };
export function requestedQuality(value: unknown): number {
  if (value === undefined) return 64;
  if (typeof value !== 'number' || !Object.hasOwn(QUALITY_LABELS, value)) throw new Error('Invalid video quality.');
  return value;
}
export function byteRange(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,10}-\d{1,10}$/.test(value)) throw new Error('Invalid DASH byte range.');
  const [start, end] = value.split('-').map(Number);
  if (start > end || end > 2147483647 || end - start > 2097152) throw new Error('Invalid DASH byte range.');
  return value;
}
export function dashTrack(value: unknown, kind: 'video' | 'audio'): Omit<DashTrack, 'url'> {
  const raw = object(value), base = object(raw.SegmentBase ?? raw.segment_base);
  const mimeType = String(raw.mimeType ?? raw.mime_type), codecs = String(raw.codecs);
  if (mimeType !== `${kind}/mp4` || !(kind === 'video' ? /^(avc1|hev1|hvc1|av01)\.[a-zA-Z0-9.]{1,60}$/ : /^mp4a\.[a-zA-Z0-9.]{1,30}$/).test(codecs)) throw new Error('Unsupported DASH track.');
  const bandwidth = number(raw.bandwidth, 200000000);
  if (!bandwidth) throw new Error('Invalid DASH bandwidth.');
  return { quality: number(raw.id, 100000), mimeType, codecs, bandwidth, initialization: byteRange(base.Initialization ?? base.initialization), indexRange: byteRange(base.indexRange ?? base.index_range), width: number(raw.width, 16384), height: number(raw.height, 16384) };
}
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
export function supportedQualities(playback: VideoPlayback, supported: (mime: string) => boolean): VideoQuality[] {
  const known = playback.qualities.filter(quality => Object.hasOwn(QUALITY_LABELS, quality.id));
  if (!playback.dash) return known;
  const supports = (track: DashTrack) => supported(`${track.mimeType}; codecs="${track.codecs}"`);
  if (!playback.dash.audio.some(supports)) return [];
  return known.filter(quality => playback.dash!.video.some(track => track.quality === quality.id && supports(track)));
}
/** Keep a single codec in each adaptation set. Prefer widely decoded AVC + AAC-LC. */
export function selectedDashTracks(playback: VideoPlayback, supported: (mime: string) => boolean): [DashTrack, DashTrack] {
  if (!playback.dash) throw new Error('DASH playback unavailable.');
  const choose = (tracks: DashTrack[], preferred: RegExp) => tracks
    .filter(track => supported(`${track.mimeType}; codecs="${track.codecs}"`))
    .sort((a, b) => Number(preferred.test(b.codecs)) - Number(preferred.test(a.codecs)) || b.bandwidth - a.bandwidth)[0];
  const video = choose(playback.dash.video.filter(track => track.quality === playback.quality), /^avc1\./);
  const audio = choose(playback.dash.audio, /^mp4a\.40\.2$/);
  if (!video || !audio) throw new Error('This quality is not supported on this device. Choose a lower quality.');
  return [video, audio];
}
/** Only validated, opaque native URLs go in this in-memory manifest. */
export function dashManifest(playback: VideoPlayback, supported: (mime: string) => boolean): string {
  if (!playback.dash) throw new Error('DASH playback unavailable.');
  const { durationSeconds } = playback.dash;
  const sets = selectedDashTracks(playback, supported).map((track, index) => {
    return `<AdaptationSet contentType="${index ? 'audio' : 'video'}" segmentAlignment="true"><Representation id="${index}-0" mimeType="${track.mimeType}" codecs="${xml(track.codecs)}" bandwidth="${track.bandwidth}"${index ? '' : ` width="${track.width}" height="${track.height}"`}><BaseURL>${xml(track.url)}</BaseURL><SegmentBase indexRange="${byteRange(track.indexRange)}"><Initialization range="${byteRange(track.initialization)}"/></SegmentBase></Representation></AdaptationSet>`;
  });
  if (!(durationSeconds > 0 && durationSeconds <= 604800)) throw new Error('Invalid video duration.');
  return `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${durationSeconds}S" minBufferTime="PT1.5S"><Period duration="PT${durationSeconds}S">${sets.join('')}</Period></MPD>`;
}
