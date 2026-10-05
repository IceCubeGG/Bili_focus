import { describe, expect, it } from 'vitest';
import { mergeSubscriptionVideos, SUBSCRIPTION_VIDEO_LIMIT } from '../src/core/subscriptions';
import type { VideoCandidate } from '../src/shared/contracts';

const video = (bvid: string, publishedAt: number | null, patch: Partial<VideoCandidate> = {}): VideoCandidate => ({
  bvid, title: `Upload ${bvid}`, cover: '', durationSeconds: 60, uploader: { id: '123', name: 'Followed creator' },
  views: 1, publishedAt, ...patch,
});

describe('subscription upload ordering', () => {
  it('combines pages by publication time rather than the order that requests return', () => {
    const previous = [video('older', 1000), video('newer', 3000)];
    const incoming = [video('middle', 2000), video('newest', 4000)];
    expect(mergeSubscriptionVideos(previous, incoming).map(item => item.bvid)).toEqual(['newest', 'newer', 'middle', 'older']);
  });

  it('deduplicates across pages and within one page with the latest metadata', () => {
    const original = video('same', 1000, { title: 'Original title', views: 1 });
    const updated = video('same', 1000, { title: 'Updated title', views: 9 });
    const latest = video('same', 1000, { title: 'Latest title', views: 15 });
    expect(mergeSubscriptionVideos([original], [updated, latest])).toEqual([latest]);
  });

  it('preserves first-seen ordering for equal publication times after duplicate updates', () => {
    const first = video('first', 1000);
    const second = video('second', 1000);
    const third = video('third', 1000);
    const update = video('first', 1000, { views: 10 });
    const result = mergeSubscriptionVideos([first, second], [third, update]);
    expect(result.map(item => item.bvid)).toEqual(['first', 'second', 'third']);
    expect(result[0].views).toBe(10);
    expect(mergeSubscriptionVideos(result, [second, update]).map(item => item.bvid)).toEqual(['first', 'second', 'third']);
  });

  it('places unknown or invalid publication times after known times without an unstable comparator', () => {
    const result = mergeSubscriptionVideos([video('unknown-first', null), video('epoch', 0)], [
      video('invalid', Number.NaN), video('known', 1000), video('unknown-second', null), video('negative', -1), video('infinite', Number.POSITIVE_INFINITY),
    ]);
    expect(result.map(item => item.bvid)).toEqual(['known', 'epoch', 'unknown-first', 'invalid', 'unknown-second', 'negative', 'infinite']);
  });

  it('keeps the newest 400 unique uploads after merging even when a later page adds newer videos', () => {
    const previous = Array.from({ length: SUBSCRIPTION_VIDEO_LIMIT }, (_, index) => video(`previous-${index}`, index));
    const incoming = [video('latest', 1000), video('previous-399', 399, { views: 99 }), video('second-latest', 999)];
    const result = mergeSubscriptionVideos(previous, incoming);
    expect(result).toHaveLength(400);
    expect(new Set(result.map(item => item.bvid)).size).toBe(400);
    expect(result.slice(0, 3).map(item => item.bvid)).toEqual(['latest', 'second-latest', 'previous-399']);
    expect(result.some(item => item.bvid === 'previous-0' || item.bvid === 'previous-1')).toBe(false);
    expect(result.find(item => item.bvid === 'previous-399')?.views).toBe(99);
  });

  it('does not sort, overwrite or mutate the original arrays or nested upload data', () => {
    const previous = [video('older', 1000), video('newer', 3000)];
    const incoming = [video('middle', 2000)];
    const before = structuredClone({ previous, incoming });
    for (const item of [...previous, ...incoming]) { Object.freeze(item.uploader); Object.freeze(item); }
    Object.freeze(previous); Object.freeze(incoming);
    const result = mergeSubscriptionVideos(previous, incoming);
    expect({ previous, incoming }).toEqual(before);
    expect(result).not.toBe(previous);
    expect(result).not.toBe(incoming);
    expect(result.map(item => item.bvid)).toEqual(['newer', 'middle', 'older']);
  });

  it('accepts empty pages and leaves no cached upload state shared between invocations', () => {
    expect(mergeSubscriptionVideos([], [])).toEqual([]);
    expect(mergeSubscriptionVideos([video('saved', 1000)], []).map(item => item.bvid)).toEqual(['saved']);
    expect(mergeSubscriptionVideos([], [video('fresh-account', 2000)]).map(item => item.bvid)).toEqual(['fresh-account']);
    expect(mergeSubscriptionVideos([], [])).toEqual([]);
  });
});
