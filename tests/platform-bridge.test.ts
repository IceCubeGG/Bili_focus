import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type BilibiliBridge } from '../src/shared/contracts';

const capacitor = vi.hoisted(() => ({ getPlatform: vi.fn(() => 'web'), registerPlugin: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: capacitor.getPlatform }, registerPlugin: capacitor.registerPlugin }));

function nativeContract(): BilibiliBridge {
  const account = { status: 'signed-out' as const, profile: null, lastCheckedAt: null, message: null, secureStorage: true };
  const login = { status: 'idle' as const, qrDataUrl: null, expiresAt: null, message: null };
  return {
    getSaveFolders: vi.fn(async () => ({ folders: [], activeFolderId: null })), controlSaveFolder: vi.fn(), listSavedFiles: vi.fn(), openSavedFile: vi.fn(async () => {}),
    getDownloads: vi.fn(async () => ({ folder: null, jobs: [] })), chooseDownloadFolder: vi.fn(), startDownload: vi.fn(), controlDownload: vi.fn(),
    getVideoDetails: vi.fn(), getVideoPlayback: vi.fn(), releaseVideoPlayback: vi.fn(async () => {}),
    getDanmu: vi.fn(), sendDanmu: vi.fn(), getVideoComments: vi.fn(), sendVideoComment: vi.fn(), openCreatorProfile: vi.fn(async () => {}),
    getPlatform: vi.fn(async () => ({ kind: 'desktop' as const, loginMethods: ['qr' as const, 'web' as const] })),
    getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    updateSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    getAccount: vi.fn(async () => ({ ...account })),
    getLogin: vi.fn(async () => ({ ...login })),
    startLogin: vi.fn(async () => ({ ...login })),
    startWebLogin: vi.fn(async () => ({ ...login, status: 'web-login' as const, method: 'web' as const })),
    cancelLogin: vi.fn(async () => ({ ...login })),
    refreshAccount: vi.fn(async () => ({ ...account })),
    signOut: vi.fn(async () => ({ ...account })),
    getRecommendationPage: vi.fn(async () => ({ videos: [], cursor: null, hasMore: false })),
    searchVideos: vi.fn(async () => ({ videos: [], cursor: null, hasMore: false, total: 0 })),
    getSubscriptionPage: vi.fn(async () => ({ videos: [], cursor: null, hasMore: false })),
    getUploaderVideoPage: vi.fn(async () => ({ videos: [], cursor: null, hasMore: false, total: 0 })),
    getFollowedUploaderPage: vi.fn(async () => ({ uploaders: [], cursor: null, hasMore: false, total: 0 })),
    getSubscriptionGroups: vi.fn(async () => ({ version: 1 as const, groups: [] })),
    updateSubscriptionGroups: vi.fn(async (settings) => settings),
    getVideoLabels: vi.fn(async () => []),
    getBrowseSettings: vi.fn(async () => ({ version: 1 as const, activePresetId: null, presets: [] })),
    updateBrowseSettings: vi.fn(async (settings) => settings),
    onAccountChanged: vi.fn(() => () => {}),
    onLoginChanged: vi.fn(() => () => {}),
  };
}

describe('cross-platform renderer bridge', () => {
  let saved: Map<string, string>;
  let storage: Pick<Storage, 'getItem' | 'setItem'>;

  beforeEach(() => {
    vi.resetModules();
    capacitor.getPlatform.mockReturnValue('web');
    capacitor.registerPlugin.mockReset();
    saved = new Map();
    storage = {
      getItem: vi.fn((key: string) => saved.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }),
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses the desktop public contract without registering a mobile plugin', async () => {
    const desktop = nativeContract();
    vi.stubGlobal('window', { bilibili: desktop });
    const { platformKind, platformBridge } = await import('../src/platform/bridge');
    expect(platformKind).toBe('desktop');
    expect(platformBridge).toBe(desktop);
    await platformBridge.startWebLogin();
    expect(desktop.startWebLogin).toHaveBeenCalledTimes(1);
    expect(capacitor.registerPlugin).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('keeps browser preview settings separate from native account credentials', async () => {
    saved.set('SESSDATA', 'secret-that-the-preview-must-not-read');
    saved.set('bili-focus.settings.v1', JSON.stringify({ version: 1, lastTab: 'options', appearance: 'dark', compactCards: true, cookies: { SESSDATA: 'injected' } }));
    const { platformKind, platformBridge } = await import('../src/platform/bridge');
    expect(platformKind).toBe('browser');
    expect(await platformBridge.getPlatform()).toEqual({ kind: 'browser', loginMethods: [] });
    expect(await platformBridge.getSettings()).toEqual({ version: 1, lastTab: 'options', appearance: 'dark', compactCards: true, language: 'en' });
    expect(storage.getItem).toHaveBeenCalledWith('bili-focus.settings.v1');
    expect(storage.getItem).toHaveBeenCalledWith('bili-focus.browse.v1');
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(await platformBridge.startWebLogin()).toMatchObject({ status: 'error', qrDataUrl: null });
    expect(await platformBridge.startLogin()).toMatchObject({ status: 'error', qrDataUrl: null });
    expect(await platformBridge.getAccount()).toMatchObject({ status: 'signed-out', secureStorage: false });
    expect(capacitor.registerPlugin).not.toHaveBeenCalled();
    await platformBridge.updateSettings({ appearance: 'light' });
    const persisted = JSON.parse(saved.get('bili-focus.settings.v1')!);
    expect(persisted).toEqual({ version: 1, lastTab: 'options', appearance: 'light', compactCards: true, language: 'en' });
    expect(JSON.stringify(persisted)).not.toContain('cookies');
  });

  it('dispatches Android account actions and settings through the native plugin', async () => {
    const native = { ...nativeContract(), getVideoLabels: vi.fn(async () => ({ labels: [{ bvid: 'BV1xx411c7mD', labels: ['科技'], status: 'ready' as const }] })), updateSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })), updateBrowseSettings: vi.fn(async (options: { settings: unknown }) => options.settings), updateSubscriptionGroups: vi.fn(async (options: { settings: unknown }) => options.settings), addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })) };
    capacitor.getPlatform.mockReturnValue('android');
    capacitor.registerPlugin.mockReturnValue(native);
    const { platformKind, platformBridge } = await import('../src/platform/bridge');
    expect(platformKind).toBe('android');
    expect(capacitor.registerPlugin).toHaveBeenCalledExactlyOnceWith('BiliAccount');
    await platformBridge.startWebLogin();
    await platformBridge.startLogin();
    await platformBridge.searchVideos({ query: '科技', cursor: '2' });
    expect(native.searchVideos).toHaveBeenCalledExactlyOnceWith({ query: '科技', cursor: '2' });
    await platformBridge.cancelLogin();
    await platformBridge.refreshAccount();
    await platformBridge.signOut();
    const video = { bvid: 'BV1xx411c7mD' };
    await platformBridge.getDownloads(); await platformBridge.chooseDownloadFolder();
    await platformBridge.getSaveFolders(); await platformBridge.controlSaveFolder({ id: 'folder', action: 'select' });
    await platformBridge.listSavedFiles({ folderId: 'folder' }); await platformBridge.openSavedFile({ folderId: 'folder', fileId: 'clip.mp4' });
    expect(native.getSaveFolders).toHaveBeenCalled(); expect(native.controlSaveFolder).toHaveBeenCalledWith({ id: 'folder', action: 'select' });
    expect(native.listSavedFiles).toHaveBeenCalledWith({ folderId: 'folder' }); expect(native.openSavedFile).toHaveBeenCalledWith({ folderId: 'folder', fileId: 'clip.mp4' });
    await platformBridge.startDownload({ ...video, cid: '62131', kind: 'video' }); await platformBridge.controlDownload({ id: 'opaque', action: 'cancel' });
    expect(native.getDownloads).toHaveBeenCalled(); expect(native.chooseDownloadFolder).toHaveBeenCalled();
    expect(native.startDownload).toHaveBeenCalledWith({ ...video, cid: '62131', kind: 'video' }); expect(native.controlDownload).toHaveBeenCalledWith({ id: 'opaque', action: 'cancel' });
    await platformBridge.getVideoDetails(video);
    await platformBridge.getVideoPlayback({ ...video, cid: '62131', quality: 120 });
    await platformBridge.getDanmu({ ...video, cid: '62131', segment: 1 });
    await platformBridge.sendDanmu({ ...video, cid: '62131', text: 'Hello', timeSeconds: 5 });
    await platformBridge.getVideoComments({ ...video, page: 1, sort: 'hot', root: null });
    await platformBridge.sendVideoComment({ ...video, text: 'Hello', root: null, parent: null });
    await platformBridge.releaseVideoPlayback({ handle: 'opaque' });
    await platformBridge.openCreatorProfile({ uploaderId: '3' });
    expect(native.getVideoDetails).toHaveBeenCalledWith(video);
    expect(native.getVideoPlayback).toHaveBeenCalledWith({ ...video, cid: '62131', quality: 120 });
    expect(native.getDanmu).toHaveBeenCalledWith({ ...video, cid: '62131', segment: 1 });
    expect(native.sendDanmu).toHaveBeenCalledWith({ ...video, cid: '62131', text: 'Hello', timeSeconds: 5 });
    expect(native.sendVideoComment).toHaveBeenCalledWith({ ...video, text: 'Hello', root: null, parent: null });
    expect(native.releaseVideoPlayback).toHaveBeenCalledWith({ handle: 'opaque' });
    expect(native.openCreatorProfile).toHaveBeenCalledWith({ uploaderId: '3' });
    await platformBridge.updateSettings({ compactCards: true, language: 'zh-CN' });
    expect(await platformBridge.getSubscriptionPage({ cursor: null })).toEqual({ videos: [], cursor: null, hasMore: false });
    expect(native.getSubscriptionPage).toHaveBeenCalledExactlyOnceWith({ cursor: null });
    await platformBridge.getUploaderVideoPage({ uploaderId: '123', cursor: '2' });
    expect(native.getUploaderVideoPage).toHaveBeenCalledExactlyOnceWith({ uploaderId: '123', cursor: '2' });
    expect(await platformBridge.getFollowedUploaderPage({ cursor: '2' })).toMatchObject({ uploaders: [], total: 0 });
    expect(native.getFollowedUploaderPage).toHaveBeenCalledExactlyOnceWith({ cursor: '2' });
    expect(await platformBridge.getSubscriptionGroups()).toEqual({ version: 1, groups: [] });
    const groups = { version: 1 as const, groups: [{ id: 'science', name: 'Science', uploaderIds: ['123'] }] };
    expect(await platformBridge.updateSubscriptionGroups(groups)).toEqual(groups);
    expect(native.updateSubscriptionGroups).toHaveBeenCalledExactlyOnceWith({ settings: groups });
    expect(native.startWebLogin).toHaveBeenCalledTimes(1);
    expect(native.startLogin).toHaveBeenCalledTimes(1);
    expect(native.cancelLogin).toHaveBeenCalledTimes(1);
    expect(native.refreshAccount).toHaveBeenCalledTimes(1);
    expect(native.signOut).toHaveBeenCalledTimes(1);
    expect(native.updateSettings).toHaveBeenCalledExactlyOnceWith({ patch: { compactCards: true, language: 'zh-CN' } });
    expect(await platformBridge.getVideoLabels({ bvids: ['BV1xx411c7mD'] })).toEqual([{ bvid: 'BV1xx411c7mD', labels: ['科技'], status: 'ready' }]);
    expect(native.getVideoLabels).toHaveBeenCalledExactlyOnceWith({ bvids: ['BV1xx411c7mD'] });
    const browse = { version: 1 as const, activePresetId: 'tech', presets: [{ id: 'tech', name: 'Tech', labels: ['科技'], uploaders: [], match: 'all' as const }] };
    expect(await platformBridge.updateBrowseSettings(browse)).toEqual(browse);
    expect(native.updateBrowseSettings).toHaveBeenCalledExactlyOnceWith({ settings: browse });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists and restores browser presets separately from interface settings and credentials', async () => {
    const { platformBridge } = await import('../src/platform/bridge');
    const settings = { version: 1 as const, activePresetId: 'study', presets: [{ id: 'study', name: 'Study', labels: [' Math ', 'MATH'], uploaders: [{ id: '00123', name: 'Teacher' }], match: 'all' as const }] };
    const savedSettings = await platformBridge.updateBrowseSettings(settings);
    expect(savedSettings.presets[0]).toMatchObject({ labels: ['Math'], uploaders: [{ id: '123', name: 'Teacher' }] });
    expect(saved.get('bili-focus.browse.v1')).toBe(JSON.stringify(savedSettings));
    expect(saved.has('bili-focus.settings.v1')).toBe(false);
    await expect(platformBridge.getRecommendationPage({ cursor: null })).rejects.toThrow('desktop or Android');
    await expect(platformBridge.getSubscriptionPage({ cursor: null })).rejects.toThrow('require sign-in');
    await expect(platformBridge.getUploaderVideoPage({ uploaderId: '123', cursor: null })).rejects.toThrow('require native sign-in');
    await expect(platformBridge.getFollowedUploaderPage({ cursor: null })).rejects.toThrow('require native sign-in');
    await expect(platformBridge.getSubscriptionGroups()).rejects.toThrow('require native sign-in');
    await expect(platformBridge.updateSubscriptionGroups({ version: 1, groups: [] })).rejects.toThrow('require native sign-in');
    savedSettings.presets[0].labels.push('Music');
    expect((await platformBridge.getBrowseSettings()).presets[0].labels).toEqual(['Math']);
    vi.resetModules();
    const restarted = await import('../src/platform/bridge');
    expect(await restarted.platformBridge.getBrowseSettings()).toMatchObject({ activePresetId: 'study', presets: [{ labels: ['Math'] }] });
  });

  it('removes pending Android listeners and stops delivering events after unsubscribe', async () => {
    const remove = vi.fn(async () => {});
    let deliver!: (value: unknown) => void;
    let resolveListener!: (value: { remove: typeof remove }) => void;
    const listenerHandle = new Promise<{ remove: typeof remove }>((resolve) => { resolveListener = resolve; });
    const native = {
      ...nativeContract(),
      addListener: vi.fn((_event: string, callback: (value: unknown) => void) => { deliver = callback; return listenerHandle; }),
    };
    capacitor.getPlatform.mockReturnValue('android');
    capacitor.registerPlugin.mockReturnValue(native);
    const { platformBridge } = await import('../src/platform/bridge');
    const callback = vi.fn();
    const unsubscribe = platformBridge.onAccountChanged(callback);
    const account = await native.getAccount();
    deliver(account);
    expect(callback).toHaveBeenCalledExactlyOnceWith(account);
    unsubscribe();
    deliver(account);
    expect(callback).toHaveBeenCalledTimes(1);
    resolveListener({ remove });
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(native.addListener).toHaveBeenCalledWith('accountChanged', expect.any(Function));
  });
});
