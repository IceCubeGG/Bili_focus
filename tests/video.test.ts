import { describe, expect, it } from 'vitest';
import { activeDanmu, decodeDanmu, imageUrl, numericId, parseComments, parseVideoDetails, postText, videoId } from '../src/core/video';
import { danmuFixture } from './fixtures/video-fixture';

const BV = 'BV1xx411c7mD';
const raw = () => ({ bvid: BV, aid: 2, title: 'A video', pic: '//i0.hdslb.com/a.jpg', desc: '<b>Plain text</b>\nDescription', duration: 400, owner: { mid: 3, name: 'Creator', face: 'https://i0.hdslb.com/face.jpg' }, stat: { view: 42 }, pubdate: 1600000000, pages: [{ cid: 62131, part: 'Part one', duration: 400 }] });
const comment = (id: string) => ({ rpid_str: id, member: { mid: '3', uname: 'Viewer', avatar: '//i0.hdslb.com/face.jpg' }, content: { message: '<script>not executable</script>\nHello' }, like: 2, rcount: 1, ctime: 1600000000 });

describe('video metadata and social boundaries', () => {
  it('normalizes metadata, parts, tags and series episodes without exposing raw data', () => {
    const result = parseVideoDetails({ ...raw(), csrf: 'secret', ugc_season: { sections: [{ title: 'Series', episodes: [{ bvid: BV, title: 'Episode' }, { bvid: 'https://bad.example' }] }] } }, BV, [{ tag_name: 'Science' }, { tag_name: 'Science' }]);
    expect(result.parts).toEqual([{ cid: '62131', page: 1, title: 'Part one', durationSeconds: 400 }]);
    expect(result.tags).toEqual(['Science']); expect(result.episodes).toEqual([{ bvid: BV, title: 'Episode', section: 'Series' }]);
    expect(result.description).toContain('<b>Plain text</b>'); expect(JSON.stringify(result)).not.toContain('secret'); expect(result.cover).toBe('https://i0.hdslb.com/a.jpg');
  });
  it.each([{ ...raw(), bvid: 'BV1xx411c7mE' }, { ...raw(), pages: [] }, { ...raw(), pages: [{ cid: 0 }] }, { ...raw(), pages: [{ cid: 1 }, { cid: 1 }] }])('rejects mismatched or malformed details', value => expect(() => parseVideoDetails(value, BV, [])).toThrow());
  it.each(['bad', 'https://bilibili.com', 'BV1xx411c7mD?x=1', 1])('rejects invalid BVIDs', value => expect(() => videoId(value)).toThrow());
  it('preserves large string IDs without accepting unsafe numbers', () => { expect(numericId('9007199254740999999')).toBe('9007199254740999999'); expect(() => numericId(9007199254740999)).toThrow(); });
  it.each(['https://bad.hdslb.com.evil/a', 'https://user:password@i0.hdslb.com/a', 'javascript:alert(1)', 'https://i0.hdslb.com:80/a'])('excludes unsafe images', value => expect(imageUrl(value)).toBe(''));
  it('validates messages by Unicode code points and preserves multiline comments', () => { expect(postText('  Hi\n世界 ', 1000)).toBe('Hi\n世界'); expect(postText('😀'.repeat(100), 100)).toHaveLength(200); expect(() => postText('😀'.repeat(101), 100)).toThrow(); });
  it.each(['', '  ', '\u0000injected'])('rejects empty/control-character messages', value => expect(() => postText(value, 100)).toThrow());
  it('normalizes/deduplicates pinned comments, previews and page state', () => { const result = parseComments({ page: { num: 1, count: 30 }, top_replies: [comment('100')], replies: [{ ...comment('100'), replies: [comment('101')] }, comment('102')] }, 1, null); expect(result.items).toHaveLength(2); expect(result.items[0].replies[0].id).toBe('101'); expect(result.hasMore).toBe(true); expect(result.items[0].text).toContain('<script>'); });
  it('supports closed sections and excludes malformed authors', () => { expect(parseComments({ page: { num: 1, count: 0 }, replies: null, input_disable: true }, 1, null).closed).toBe(true); expect(parseComments({ page: { num: 1, count: 1 }, replies: [{ ...comment('1'), member: { mid: 0 } }] }, 1, null).items).toEqual([]); });
  it('rejects unexpected comment cursors', () => expect(() => parseComments({ page: { num: 2, count: 30 }, replies: [] }, 1, null)).toThrow());
  it('recognizes native comment controls and pinned upper comments', () => { const result = parseComments({ page: { num: 1, size: 10, count: 15 }, top: { upper: comment('1') }, replies: [], control: { input_disable: true } }, 1, null); expect(result.closed).toBe(true); expect(result.hasMore).toBe(true); expect(result.items[0].id).toBe('1'); });
});
describe('Danmu parsing and timing', () => {
  it('decodes protobuf without losing large IDs', () => expect(decodeDanmu(danmuFixture())).toEqual([{ id: '9007199254740999', timeSeconds: 5, text: 'Hello 世界', color: 16777215, mode: 1 }]));
  it.each([4, 5])('supports fixed display mode %s', mode => expect(decodeDanmu(danmuFixture(mode))[0].mode).toBe(mode));
  it.each([7, 8, 9])('excludes advanced/code/BAS mode %s', mode => expect(decodeDanmu(danmuFixture(mode))).toEqual([]));
  it('deduplicates repeated items', () => expect(decodeDanmu(new Uint8Array([...danmuFixture(), ...danmuFixture()]))).toHaveLength(1));
  it.each([new Uint8Array([10, 100, 1]), new Uint8Array([10, 2, 8, 128]), new Uint8Array([15]), new Uint8Array(2 * 1024 * 1024 + 1)])('rejects truncated/unsupported/oversized data', bytes => expect(() => decodeDanmu(bytes)).toThrow());
  it('ties motion to playback time, pause and seek rather than wall-clock time', () => { const items = decodeDanmu(danmuFixture()); expect(activeDanmu(items, 4)).toEqual([]); expect(activeDanmu(items, 9)[0].progress).toBe(0.5); expect(activeDanmu(items, 9)).toEqual(activeDanmu(items, 9)); expect(activeDanmu(items, 13)).toEqual([]); expect(activeDanmu(items, 5)[0].progress).toBe(0); });
  it('bounds overlay density', () => { const items = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), text: 'hello', mode: 1 as const, color: 0, timeSeconds: 0 })); expect(activeDanmu(items, 1)).toHaveLength(10); });
});
