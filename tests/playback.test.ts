import { describe, expect, it } from 'vitest';
import { byteRange, dashManifest, dashTrack, requestedQuality } from '../src/core/playback';
import type { VideoPlayback } from '../src/shared/contracts';
const raw = { id: 80, mimeType: 'video/mp4', codecs: 'avc1.640028', bandwidth: 4000000, width: 1920, height: 1080, SegmentBase: { Initialization: '0-999', indexRange: '1000-2000' } };
describe('quality and DASH boundaries', () => {
  it.each([16, 32, 64, 74, 80, 112, 116, 120])('accepts standard quality %s', quality => expect(requestedQuality(quality)).toBe(quality));
  it.each([0, '120', 121, 127, null, [], NaN])('rejects invalid or HDR/protected quality %s', quality => expect(() => requestedQuality(quality)).toThrow('quality'));
  it('defaults to 720p', () => expect(requestedQuality(undefined)).toBe(64));
  it('normalizes both DASH metadata styles without leaking arbitrary fields', () => { const track = dashTrack(raw, 'video'); expect(track.quality).toBe(80); expect(track.initialization).toBe('0-999'); expect(dashTrack({ ...raw, SegmentBase: undefined, segment_base: { initialization: '0-999', index_range: '1000-2000' } }, 'video')).toEqual(track); });
  it.each(['2-1', '-1-10', '0-2147483648', '0-3000000', '0-10,20-30', '0-10\r\nCookie:x'])('rejects invalid index ranges %s', value => expect(() => byteRange(value)).toThrow());
  it.each([{ codecs: '<script>' }, { bandwidth: 0 }, { mimeType: 'text/html' }])('rejects invalid track metadata %j', patch => expect(() => dashTrack({ ...raw, ...patch }, 'video')).toThrow());
  it('builds a selected-quality-only manifest with synchronized AAC audio and escaped local URLs', () => {
    const track = { ...dashTrack(raw, 'video'), url: 'https://localhost/__bili_media/opaque/0' };
    const playback: VideoPlayback = { handle: 'opaque', quality: 80, qualityLabel: '1080p', qualities: [{ id: 80, label: '1080p' }], sources: [], dash: { durationSeconds: 10, video: [track, { ...track, quality: 120, height: 2160 }], audio: [{ ...track, quality: 30280, mimeType: 'audio/mp4', codecs: 'mp4a.40.2', url: 'https://localhost/__bili_media/opaque/1' }] } };
    const xml = dashManifest(playback, () => true); expect(xml).toContain('height="1080"'); expect(xml).not.toContain('2160'); expect(xml).toContain('contentType="audio"'); expect(xml).not.toMatch(/bilivideo|Cookie|SESSDATA/);
    expect(() => dashManifest(playback, () => false)).toThrow('not supported');
  });
});
