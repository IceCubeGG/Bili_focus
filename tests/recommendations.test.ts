import { describe, expect, it } from 'vitest';
import { candidateMatchesPreset, filterCandidates } from '../src/core/recommendations';
import type { BrowsePreset, VideoCandidate, VideoLabels } from '../src/shared/contracts';

const video: VideoCandidate = {
  bvid: 'BV1example', title: 'Math and Science', cover: '', durationSeconds: 60,
  uploader: { id: '123', name: 'Teacher' }, views: 5, publishedAt: null,
};
const labels: VideoLabels = { bvid: video.bvid, labels: ['Math', 'Knowledge'], status: 'ready' };
const preset = (patch: Partial<BrowsePreset> = {}): BrowsePreset => ({
  id: 'study', name: 'Study', labels: ['Math'], uploaders: [{ id: '123', name: 'Teacher' }], match: 'all', ...patch,
});

describe('strict recommendation allow list', () => {
  it.each([
    ['all', 'Math', '123', true], ['all', 'Math', '456', false], ['all', 'Music', '123', false], ['all', 'Music', '456', false],
    ['any', 'Math', '123', true], ['any', 'Math', '456', true], ['any', 'Music', '123', true], ['any', 'Music', '456', false],
  ] as const)('%s combines label %s and uploader %s correctly', (match, label, id, expected) => {
    expect(candidateMatchesPreset(video, labels, preset({ match, labels: [label], uploaders: [{ id, name: '' }] }))).toBe(expected);
  });

  it('uses OR inside a dimension and only compares exact normalized tag names', () => {
    expect(candidateMatchesPreset(video, labels, preset({ labels: ['Music', ' math '], uploaders: [{ id: '456', name: '' }, { id: '123', name: '' }] }))).toBe(true);
    expect(candidateMatchesPreset(video, labels, preset({ labels: ['mat'], uploaders: [] }))).toBe(false);
    expect(candidateMatchesPreset(video, labels, preset({ labels: ['Science'], uploaders: [] }))).toBe(false);
    expect(candidateMatchesPreset(video, labels, preset({ labels: ['Teacher'], uploaders: [] }))).toBe(false);
  });

  it.each([undefined, { ...labels, status: 'unavailable' as const }, { ...labels, bvid: 'BV_other' }])('does not treat unknown, unavailable or mismatched tags as a label match', (unavailable) => {
    expect(candidateMatchesPreset(video, unavailable, preset())).toBe(false);
    expect(candidateMatchesPreset(video, unavailable, preset({ match: 'any' }))).toBe(true);
    expect(candidateMatchesPreset(video, unavailable, preset({ uploaders: [] }))).toBe(false);
  });

  it.each(['all', 'any'] as const)('allows uploader-only presets without needing tag metadata in %s mode', (match) => {
    expect(candidateMatchesPreset(video, undefined, preset({ match, labels: [] }))).toBe(true);
    expect(candidateMatchesPreset(video, undefined, preset({ match, labels: [], uploaders: [{ id: '456', name: '' }] }))).toBe(false);
  });

  it.each(['all', 'any'] as const)('empty custom presets never broaden the feed in %s mode', (match) => {
    expect(candidateMatchesPreset(video, labels, preset({ match, labels: [], uploaders: [] }))).toBe(false);
    expect(candidateMatchesPreset(video, labels, preset({ match, labels: [' '], uploaders: [{ id: 'invalid', name: '' }] }))).toBe(false);
  });

  it('unrestricted selection returns all videos and a separate array', () => {
    const input = [video];
    const result = filterCandidates(input, new Map(), null);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('filters mixed candidates in original order with either Map or record metadata', () => {
    const other = { ...video, bvid: 'BV2', uploader: { id: '456', name: 'Other' } };
    const third = { ...video, bvid: 'BV3' };
    const inputs = [video, other, third];
    const metadata = { [video.bvid]: labels, BV2: { ...labels, bvid: 'BV2' }, BV3: { ...labels, bvid: 'BV3', labels: ['Music'] } };
    expect(filterCandidates(inputs, metadata, preset()).map((item) => item.bvid)).toEqual([video.bvid]);
    expect(filterCandidates(inputs, new Map(Object.entries(metadata)), preset({ match: 'any' })).map((item) => item.bvid)).toEqual([video.bvid, 'BV2', 'BV3']);
  });
});
