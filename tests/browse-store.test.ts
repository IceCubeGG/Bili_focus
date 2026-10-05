import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowseStore } from '../src/electron/browse-store';
import { DEFAULT_BROWSE_SETTINGS, type BrowseSettings } from '../src/shared/contracts';

const settings: BrowseSettings = { version: 1, activePresetId: 'music', presets: [{ id: 'music', name: 'Music', labels: ['Music'], uploaders: [{ id: '123', name: 'Musician' }], match: 'all' }] };

describe('desktop recommendation preset persistence', () => {
  let fixture: string;
  let path: string;
  beforeEach(async () => { fixture = await mkdtemp(join(tmpdir(), 'bili-focus-browse-test-')); path = join(fixture, 'browse-presets.json'); });
  afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

  it('starts with defaults only when no saved file exists', async () => {
    expect(await new BrowseStore(path).load()).toEqual(DEFAULT_BROWSE_SETTINGS);
  });

  it('rejects corrupt saved JSON so it cannot silently disable filtering', async () => {
    await writeFile(path, '{broken');
    await expect(new BrowseStore(path).load()).rejects.toThrow();
  });

  it.each([null, [], {}, { version: 1, presets: [] }, { version: 1, activePresetId: 'missing', presets: [] }, { version: 1, activePresetId: 123, presets: [] }])('rejects malformed existing preference documents: %j', async (document) => {
    await writeFile(path, JSON.stringify(document));
    await expect(new BrowseStore(path).load()).rejects.toThrow();
  });

  it('rejects a corrupt saved uploader dimension instead of broadening an AND preset', async () => {
    const corrupt = structuredClone(settings);
    corrupt.presets[0].uploaders[0].id = 'invalid-uid';
    await writeFile(path, JSON.stringify(corrupt));
    await expect(new BrowseStore(path).load()).rejects.toThrow('without changes');
  });

  it('accepts canonical saved settings regardless of JSON property order', async () => {
    await writeFile(path, JSON.stringify({ presets: settings.presets, activePresetId: settings.activePresetId, version: 1 }));
    expect(await new BrowseStore(path).load()).toEqual(settings);
  });

  it('saves preset definitions and the active selection across restart', async () => {
    const store = new BrowseStore(path);
    expect(await store.update({ ...settings, cookies: 'session-secret' })).toEqual(settings);
    expect(await new BrowseStore(path).load()).toEqual(settings);
    expect(await readFile(path, 'utf8')).not.toContain('session-secret');
  });

  it('serializes changes so the last selected preset survives restart', async () => {
    const store = new BrowseStore(path);
    await Promise.all([store.update(settings), store.update({ ...settings, activePresetId: null })]);
    expect(await new BrowseStore(path).load()).toEqual({ ...settings, activePresetId: null });
  });

  it('keeps nested presets isolated from input and snapshot mutations', async () => {
    const store = new BrowseStore(path);
    const input = structuredClone(settings);
    await store.update(input);
    input.presets[0].labels.push('Injected');
    const snapshot = store.get();
    snapshot.presets[0].uploaders[0].name = 'Injected';
    expect(store.get()).toEqual(settings);
  });

  it('keeps the previous saved selection if a write fails', async () => {
    const store = new BrowseStore(join(fixture, 'parent', 'browse.json'));
    await writeFile(join(fixture, 'parent'), 'blocks-a-directory');
    await expect(store.update(settings)).rejects.toThrow();
    expect(store.get()).toEqual(DEFAULT_BROWSE_SETTINGS);
  });

  it.each([null, [], 'preset', 1])('rejects invalid documents without altering preferences', async (value) => {
    const store = new BrowseStore(path);
    await expect(store.update(value)).rejects.toThrow('Invalid recommendation presets');
    expect(store.get()).toEqual(DEFAULT_BROWSE_SETTINGS);
  });
});
