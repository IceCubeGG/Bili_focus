import type { SubscriptionGroups, VideoCandidate } from '../shared/contracts';

export type SubscriptionSelection = { kind: 'all' } | { kind: 'uploader'; id: string } | { kind: 'group'; id: string };
export const emptySubscriptionGroups = (): SubscriptionGroups => ({ version: 1, groups: [] });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid subscription groups.');
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, expected: string[]) => {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(',')) throw new Error('Invalid subscription group fields.');
};
export function validateSubscriptionGroups(input: unknown): SubscriptionGroups {
  const data = object(input); keys(data, ['version', 'groups']);
  if (data.version !== 1 || !Array.isArray(data.groups) || data.groups.length > 30) throw new Error('You can save up to 30 subscription groups.');
  const ids = new Set<string>();
  const groups = data.groups.map(value => {
    const group = object(value); keys(group, ['id', 'name', 'uploaderIds']);
    if (typeof group.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(group.id) || ids.has(group.id)) throw new Error('Invalid subscription group ID.');
    ids.add(group.id);
    if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 || /[\u0000-\u001f\u007f]/.test(group.name)) throw new Error('Enter a group name of 1–80 characters.');
    if (!Array.isArray(group.uploaderIds) || group.uploaderIds.length > 500 || group.uploaderIds.some(id => typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) || new Set(group.uploaderIds).size !== group.uploaderIds.length) throw new Error('Choose up to 500 different uploaders per group.');
    return { id: group.id, name: group.name.trim(), uploaderIds: [...group.uploaderIds] as string[] };
  });
  return { version: 1, groups };
}
export function selectSubscriptionVideos(videos: readonly VideoCandidate[], selection: SubscriptionSelection, settings: SubscriptionGroups): VideoCandidate[] {
  if (selection.kind === 'all') return [...videos];
  const ids = selection.kind === 'uploader' ? [selection.id] : settings.groups.find(group => group.id === selection.id)?.uploaderIds ?? [];
  const allowed = new Set(ids);
  return videos.filter(video => allowed.has(video.uploader.id));
}
