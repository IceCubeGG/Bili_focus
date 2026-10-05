import { describe, expect, it, vi } from 'vitest';
import { GroupLibraryPager } from '../src/core/group-library';
import { mergeUploaderVideos } from '../src/core/subscriptions';
import type { UploaderVideoPage, VideoCandidate } from '../src/shared/contracts';

type Options = { uploaderId: string; cursor: string | null };
const video = (uid: string, number: number, time: number): VideoCandidate => ({
  bvid: `BV${String(Number(uid) * 10000 + number).padStart(10, '0')}`, title: `${uid} upload ${number}`, cover: '',
  uploader: { id: uid, name: `Creator ${uid}` }, publishedAt: time, views: 0, durationSeconds: 60,
});
const page = (all: VideoCandidate[], cursor: string | null): UploaderVideoPage => {
  const number = Number(cursor ?? '1'), hasMore = number * 30 < all.length;
  return { videos: all.slice((number - 1) * 30, number * 30), total: all.length, hasMore, cursor: hasMore ? String(number + 1) : null };
};
const fixture = (libraries: Record<string, VideoCandidate[]>) => vi.fn(async ({ uploaderId, cursor }: Options) => page(libraries[uploaderId], cursor));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(value => { resolve = value; }); return { promise, resolve }; };

describe('complete group video libraries', () => {
  it('uses every member library and emits the globally newest prefix across different upload rates', async () => {
    const fast = Array.from({ length: 95 }, (_, index) => video('123', index + 1, 10000 - index));
    const slow = [video('456', 1, 9955.5), video('456', 2, 1)];
    const load = fixture({ '123': fast, '456': slow }), pager = new GroupLibraryPager(['456', '123'], load);
    const expected = mergeUploaderVideos(fast, slow);
    let received: VideoCandidate[] = [];
    for (let index = 0; index < 4; index++) {
      const next = await pager.loadPage(); received = [...received, ...next.videos];
      expect(received.map(value => value.bvid)).toEqual(expected.slice(0, received.length).map(value => value.bvid));
      expect(next.total).toBe(97); expect(next.hasMore).toBe(index < 3);
    }
    expect(received).toHaveLength(97);
    expect(load.mock.calls.filter(([options]) => options.uploaderId === '456')).toHaveLength(1);
    expect(load.mock.calls.filter(([options]) => options.uploaderId === '123').map(([options]) => options.cursor)).toEqual([null, '2', '3', '4']);
  });

  it('retains a 917-video group beyond 400 and finishes only after all creators end', async () => {
    const libraries = { '123': Array.from({ length: 905 }, (_, index) => video('123', index + 1, 2000 - index)), '456': Array.from({ length: 12 }, (_, index) => video('456', index + 1, 500 - index)) };
    const pager = new GroupLibraryPager(['123', '456'], fixture(libraries));
    let result: UploaderVideoPage, received: VideoCandidate[] = [];
    do { result = await pager.loadPage(); received = mergeUploaderVideos(received, result.videos); } while (result.hasMore);
    expect(received).toHaveLength(917); expect(result.total).toBe(917); expect(result.cursor).toBeNull();
    expect(received.some(value => value.bvid === libraries['123'][904].bvid)).toBe(true);
    expect(received.at(-1)?.uploader.id).toBe('456');
  });

  it('initial-page retry reuses successful member results and commits no partial group output', async () => {
    let fail = true;
    const first = [video('123', 1, 100)], second = [video('456', 1, 200)];
    const load = vi.fn(async (options: Options) => {
      if (options.uploaderId === '456' && fail) throw new Error('Fixture outage');
      return page(options.uploaderId === '123' ? first : second, options.cursor);
    });
    const pager = new GroupLibraryPager(['123', '456'], load);
    await expect(pager.loadPage()).rejects.toThrow('UID 456');
    fail = false;
    expect((await pager.loadPage()).videos.map(value => value.uploader.id)).toEqual(['456', '123']);
    expect(load.mock.calls.filter(([options]) => options.uploaderId === '123')).toHaveLength(1);
    expect(load.mock.calls.filter(([options]) => options.uploaderId === '456')).toHaveLength(2);
  });

  it('a mid-page refill failure preserves emitted IDs and member cursors for an exact retry', async () => {
    let fail = false;
    const a = Array.from({ length: 65 }, (_, index) => video('123', index + 1, 1000 - index));
    const b = [video('456', 1, 1001), video('456', 2, 1002)];
    const source = fixture({ '123': a, '456': b });
    const load = vi.fn(async (options: Options) => {
      if (fail && options.uploaderId === '123' && options.cursor === '2') throw new Error('Fixture refill failure');
      return source(options);
    });
    const pager = new GroupLibraryPager(['123', '456'], load), first = await pager.loadPage();
    expect(first.videos).toHaveLength(30); fail = true;
    await expect(pager.loadPage()).rejects.toThrow('refill failure');
    fail = false;
    const second = await pager.loadPage(), last = await pager.loadPage();
    const result = [...first.videos, ...second.videos, ...last.videos];
    expect(result.map(value => value.bvid)).toEqual(mergeUploaderVideos(a, b).map(value => value.bvid));
    expect(new Set(result.map(value => value.bvid)).size).toBe(67);
    expect(load.mock.calls.filter(([options]) => options.uploaderId === '456')).toHaveLength(1);
  });

  it('limits concurrent native calls to two, drains failures, and stops queued creators', async () => {
    const hold = deferred<UploaderVideoPage>(), failNow = deferred<void>(); let active = 0, maximum = 0;
    const load = vi.fn(async (options: Options) => {
      active++; maximum = Math.max(maximum, active);
      try { if (options.uploaderId === '123') { await failNow.promise; throw new Error('Fixture failure'); } return await hold.promise; }
      finally { active--; }
    });
    const pager = new GroupLibraryPager(['123', '456', '789'], load);
    let settled = false;
    const result = pager.loadPage().then(value => { settled = true; return value; }, error => { settled = true; throw error; });
    failNow.resolve();
    await Promise.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(load).toHaveBeenCalledTimes(2);
    hold.resolve(page([], null)); await expect(result).rejects.toThrow('Fixture failure');
    expect(active).toBe(0); expect(maximum).toBe(2); expect(load).toHaveBeenCalledTimes(2);
  });

  it('cancellation drains existing calls and rejects their results without starting more creators', async () => {
    const hold = deferred<UploaderVideoPage>(), load = vi.fn(async () => hold.promise);
    const pager = new GroupLibraryPager(['123', '456', '789'], load), result = pager.loadPage();
    expect(load).toHaveBeenCalledTimes(2); pager.cancel(); hold.resolve(page([], null));
    await expect(result).rejects.toThrow('selected group changed');
    expect(load).toHaveBeenCalledTimes(2); await expect(pager.loadPage()).rejects.toThrow('selected group changed');
  });

  it('empty groups and empty member libraries stay empty, deduplicate member IDs, and never use a fallback feed', async () => {
    const load = fixture({ '123': [] });
    expect(await new GroupLibraryPager([], load).loadPage()).toEqual({ videos: [], total: 0, hasMore: false, cursor: null });
    expect(load).not.toHaveBeenCalled();
    expect(await new GroupLibraryPager(['123', '123'], load).loadPage()).toMatchObject({ videos: [], total: 0, hasMore: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('deduplicates page overlap and excludes cards from a nonmember UID', async () => {
    const uploads = Array.from({ length: 31 }, (_, index) => video('123', index + 1, 1000 - index));
    const load = vi.fn(async ({ cursor }: Options): Promise<UploaderVideoPage> => cursor === null
      ? page(uploads, null)
      : { videos: [uploads[29], uploads[30], video('999', 1, 2000)], total: 31, hasMore: false, cursor: null });
    const pager = new GroupLibraryPager(['123'], load), first = await pager.loadPage(), last = await pager.loadPage();
    expect([...first.videos, ...last.videos]).toHaveLength(31); expect(last.hasMore).toBe(false);
    expect(last.videos.map(value => value.uploader.id)).toEqual(['123']);
  });

  it('continues through empty filtered pages but rejects a repeated native cursor', async () => {
    const load = vi.fn(async ({ cursor }: Options): Promise<UploaderVideoPage> => cursor === null
      ? { videos: [], total: 31, hasMore: true, cursor: '2' }
      : { videos: [video('123', 31, 1)], total: 31, hasMore: false, cursor: null });
    const pager = new GroupLibraryPager(['123'], load);
    expect((await pager.loadPage()).videos).toHaveLength(1); expect(load).toHaveBeenCalledTimes(2);
    const malformed = new GroupLibraryPager(['123'], async () => ({ videos: [], total: 31, hasMore: true, cursor: '1' }));
    await expect(malformed.loadPage()).rejects.toThrow('unexpected page');
  });
});
