import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectSubscriptionVideos, validateSubscriptionGroups } from '../src/core/subscription-groups';
import { SubscriptionGroupStore } from '../src/electron/subscription-group-store';
import type { VideoCandidate } from '../src/shared/contracts';

const settings = { version: 1 as const, groups: [{ id: 'science', name: 'Science', uploaderIds: ['123', '456'] }] };
const videos: VideoCandidate[] = ['123', '456', '789'].map((id, index) => ({ bvid: String(index), title: id, cover: '', uploader: { id, name: id }, publishedAt: index, durationSeconds: 1, views: 0 }));
describe('subscription groups and strict local selection', () => {
  it('selects only a single uploader without mutating the original feed', () => {
    expect(selectSubscriptionVideos(videos, { kind: 'uploader', id: '456' }, settings)).toEqual([videos[1]]);
    expect(videos).toHaveLength(3);
  });
  it('selects group members, and never broadens empty or missing groups', () => {
    expect(selectSubscriptionVideos(videos, { kind: 'group', id: 'science' }, settings)).toEqual(videos.slice(0, 2));
    expect(selectSubscriptionVideos(videos, { kind: 'group', id: 'missing' }, settings)).toEqual([]);
    expect(selectSubscriptionVideos(videos, { kind: 'group', id: 'science' }, { version: 1, groups: [{ ...settings.groups[0], uploaderIds: [] }] })).toEqual([]);
    expect(selectSubscriptionVideos(videos, { kind: 'all' }, settings)).toEqual(videos);
  });
  it('trims names, isolates returned members, and permits creators in several groups', () => {
    const input = structuredClone(settings); input.groups.push({ id: 'favorites', name: ' Favorites ', uploaderIds: ['123'] });
    const result = validateSubscriptionGroups(input); expect(result.groups[1].name).toBe('Favorites');
    result.groups[0].uploaderIds.push('999'); expect(input.groups[0].uploaderIds).not.toContain('999');
  });
  it.each([null, {}, { ...settings, cookies: 'secret' }, { ...settings, version: 2 }, { version: 1, groups: [...settings.groups, ...settings.groups] },
    { version: 1, groups: [{ ...settings.groups[0], name: '' }] }, { version: 1, groups: [{ ...settings.groups[0], uploaderIds: ['123', '123'] }] },
    { version: 1, groups: [{ ...settings.groups[0], uploaderIds: ['https://evil.example'] }] }, { version: 1, groups: Array.from({ length: 31 }, (_, i) => ({ id: `g${i}`, name: 'Group', uploaderIds: [] })) }])('rejects malformed or over-limit definitions %j', value => { expect(() => validateSubscriptionGroups(value)).toThrow(); });
  it('persists lists per account across store restarts and rejects corrupt saved data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bili-subscribe-groups-'));
    try {
      const store = new SubscriptionGroupStore(directory);
      await store.update('123', settings);
      expect(await new SubscriptionGroupStore(directory).get('123')).toEqual(settings);
      expect(await store.get('456')).toEqual({ version: 1, groups: [] });
      await expect(store.update('../unsafe', settings)).rejects.toThrow();
      expect(await readFile(join(directory, 'subscribe-groups-123.json'), 'utf8')).not.toContain('cookies');
      await writeFile(join(directory, 'subscribe-groups-123.json'), '{broken');
      await expect(store.get('123')).rejects.toThrow('could not be loaded');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
