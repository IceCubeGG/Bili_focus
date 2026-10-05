import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/contracts';
import { sanitizeSettings, SettingsStore } from '../src/electron/settings-store';

describe('settings validation', () => {
  it('keeps recognized values and discards unsupported fields', () => {
    expect(sanitizeSettings({ version: 100, lastTab: 'subscribe', appearance: 'dark', compactCards: true, token: 'never-a-preference' }))
      .toEqual({ version: 1, lastTab: 'subscribe', appearance: 'dark', compactCards: true, language: 'en' });
  });

  it.each([null, undefined, [], 'subscribe', 42])('uses defaults for an invalid document: %j', (value) => {
    expect(sanitizeSettings(value)).toEqual(DEFAULT_SETTINGS);
  });

  it('does not accept arrays or objects that stringify to recognized enum values', () => {
    expect(sanitizeSettings({ lastTab: ['subscribe'], appearance: { toString: () => 'dark' }, compactCards: 'true' }))
      .toEqual(DEFAULT_SETTINGS);
  });
});

describe('persistent settings', () => {
  let fixture: string;
  let path: string;

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'bili-focus-settings-test-'));
    path = join(fixture, 'preferences.json');
  });
  afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

  it('starts with defaults when there is no saved preferences file', async () => {
    expect(await new SettingsStore(path).load()).toEqual(DEFAULT_SETTINGS);
  });
  it('persists the selected interface language across restart', async () => {
    const store = new SettingsStore(path); await store.update({ language: 'zh-CN' });
    expect((await new SettingsStore(path).load()).language).toBe('zh-CN');
    await store.update({ language: 'en' }); expect((await new SettingsStore(path).load()).language).toBe('en');
  });

  it('recovers from malformed saved JSON without losing app startup', async () => {
    await writeFile(path, '{broken-json');
    expect(await new SettingsStore(path).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('retains tab and appearance across restart without persisting unrelated fields', async () => {
    const store = new SettingsStore(path);
    await store.load();
    await store.update({ lastTab: 'options', appearance: 'light', compactCards: true, cookies: 'private' });
    const restarted = new SettingsStore(path);
    expect(await restarted.load()).toEqual({ version: 1, lastTab: 'options', appearance: 'light', compactCards: true, language: 'en' });
    expect(await readFile(path, 'utf8')).not.toContain('private');
  });

  it('serializes rapid preference changes so the final selection survives restart', async () => {
    const store = new SettingsStore(path);
    await Promise.all([
      store.update({ lastTab: 'subscribe' }),
      store.update({ appearance: 'dark' }),
      store.update({ lastTab: 'options', compactCards: true }),
    ]);
    expect(await new SettingsStore(path).load()).toEqual({ version: 1, lastTab: 'options', appearance: 'dark', compactCards: true, language: 'en' });
  });

  it('protects stored state from mutation by the caller', async () => {
    const store = new SettingsStore(path);
    const snapshot = store.get();
    snapshot.lastTab = 'options';
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([null, 'dark', [], 1])('rejects an invalid preference patch: %j', async (patch) => {
    const store = new SettingsStore(path);
    await expect(store.update(patch)).rejects.toThrow('Invalid preferences.');
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });
});
