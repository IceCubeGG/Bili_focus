import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { DEFAULT_SETTINGS, DEFAULT_BROWSE_SETTINGS, type AccountSnapshot, type AppSettings, type BrowseSettings, type BilibiliBridge, type LoginSnapshot, type PlatformInfo, type VideoLabels } from '../shared/contracts';
import { sanitizeSettings } from '../core/settings';
import { sanitizeBrowseSettings } from '../core/browse-settings';

type AndroidPlugin = Omit<BilibiliBridge, 'updateSettings' | 'updateBrowseSettings' | 'updateSubscriptionGroups' | 'getVideoLabels' | 'onAccountChanged' | 'onLoginChanged'> & {
  updateSubscriptionGroups(options: { settings: import('../shared/contracts').SubscriptionGroups }): Promise<import('../shared/contracts').SubscriptionGroups>;
  updateSettings(options: { patch: Partial<Omit<AppSettings, 'version'>> }): Promise<AppSettings>;
  updateBrowseSettings(options: { settings: BrowseSettings }): Promise<BrowseSettings>;
  getVideoLabels(options: { bvids: string[] }): Promise<{ labels: VideoLabels[] }>;
  addListener(event: string, callback: (value: unknown) => void): Promise<PluginListenerHandle>;
};

export const platformKind: PlatformInfo['kind'] = window.bilibili ? 'desktop' : Capacitor.getPlatform() === 'android' ? 'android' : 'browser';

function androidBridge(): BilibiliBridge {
  const native = registerPlugin<AndroidPlugin>('BiliAccount');
  const listen = <T>(event: string, callback: (value: T) => void): (() => void) => {
    let cancelled = false;
    const handle = native.addListener(event, (value) => { if (!cancelled) callback(value as T); });
    return () => { cancelled = true; void handle.then(value => value.remove()).catch(() => {}); };
  };
  return {
    getSaveFolders: () => native.getSaveFolders(),
    controlSaveFolder: (options) => native.controlSaveFolder(options),
    listSavedFiles: (options) => native.listSavedFiles(options),
    openSavedFile: (options) => native.openSavedFile(options),
    getDownloads: () => native.getDownloads(),
    chooseDownloadFolder: () => native.chooseDownloadFolder(),
    startDownload: (options) => native.startDownload(options),
    controlDownload: (options) => native.controlDownload(options),
    getVideoDetails: (options) => native.getVideoDetails(options),
    getVideoPlayback: (options) => native.getVideoPlayback(options),
    releaseVideoPlayback: (options) => native.releaseVideoPlayback(options),
    getDanmu: (options) => native.getDanmu(options),
    sendDanmu: (options) => native.sendDanmu(options),
    getVideoComments: (options) => native.getVideoComments(options),
    sendVideoComment: (options) => native.sendVideoComment(options),
    openCreatorProfile: (options) => native.openCreatorProfile(options),
    getPlatform: () => native.getPlatform(),
    getSettings: () => native.getSettings(),
    updateSettings: (patch) => native.updateSettings({ patch }),
    getAccount: () => native.getAccount(),
    getLogin: () => native.getLogin(),
    startLogin: () => native.startLogin(),
    startWebLogin: () => native.startWebLogin(),
    cancelLogin: () => native.cancelLogin(),
    refreshAccount: () => native.refreshAccount(),
    signOut: () => native.signOut(),
    getRecommendationPage: (options) => native.getRecommendationPage(options),
    getSubscriptionPage: (options) => native.getSubscriptionPage(options),
    getUploaderVideoPage: (options) => native.getUploaderVideoPage(options),
    getFollowedUploaderPage: (options) => native.getFollowedUploaderPage(options),
    getSubscriptionGroups: () => native.getSubscriptionGroups(),
    updateSubscriptionGroups: (settings) => native.updateSubscriptionGroups({ settings }),
    getVideoLabels: async (options) => (await native.getVideoLabels(options)).labels,
    getBrowseSettings: () => native.getBrowseSettings(),
    updateBrowseSettings: (settings) => native.updateBrowseSettings({ settings }),
    onAccountChanged: (callback) => listen('accountChanged', callback),
    onLoginChanged: (callback) => listen('loginChanged', callback),
  };
}

function previewBridge(): BilibiliBridge {
  const key = 'bili-focus.settings.v1';
  const account: AccountSnapshot = { status: 'signed-out', profile: null, lastCheckedAt: null, message: 'Account sign-in requires the desktop or Android app.', secureStorage: false };
  let settings = { ...DEFAULT_SETTINGS };
  let browseSettings: BrowseSettings = { ...DEFAULT_BROWSE_SETTINGS, presets: [] };
  try { settings = sanitizeSettings(JSON.parse(localStorage.getItem(key) ?? 'null')); } catch { /* Preview storage is optional. */ }
  try { browseSettings = sanitizeBrowseSettings(JSON.parse(localStorage.getItem('bili-focus.browse.v1') ?? 'null')); } catch { /* Preview storage is optional. */ }
  const login: LoginSnapshot = { status: 'idle', qrDataUrl: null, expiresAt: null, message: null };
  const unsupported = async (): Promise<LoginSnapshot> => ({ ...login, status: 'error', message: 'Account sign-in is available in the native app.' });
  return {
    getSaveFolders: async () => ({ folders: [], activeFolderId: null }),
    controlSaveFolder: async () => { throw new Error('Folder management requires the desktop or Android app.'); },
    listSavedFiles: async () => { throw new Error('Folder management requires the desktop or Android app.'); },
    openSavedFile: async () => { throw new Error('Folder management requires the desktop or Android app.'); },
    getDownloads: async () => ({ folder: null, jobs: [] }),
    chooseDownloadFolder: async () => { throw new Error('Folder selection requires the desktop or Android app.'); },
    startDownload: async () => { throw new Error('Downloads require the desktop or Android app.'); },
    controlDownload: async () => { throw new Error('Downloads require the desktop or Android app.'); },
    getVideoDetails: async () => { throw new Error('Video playback requires the desktop or Android app.'); },
    getVideoPlayback: async () => { throw new Error('Video playback requires the desktop or Android app.'); },
    releaseVideoPlayback: async () => {},
    getDanmu: async () => { throw new Error('Danmu requires the desktop or Android app.'); },
    sendDanmu: async () => { throw new Error('Sign in in the desktop or Android app to send Danmu.'); },
    getVideoComments: async () => { throw new Error('Comments require the desktop or Android app.'); },
    sendVideoComment: async () => { throw new Error('Sign in in the desktop or Android app to post comments.'); },
    openCreatorProfile: async () => { throw new Error('Creator profiles open from the desktop or Android app.'); },
    getPlatform: async () => ({ kind: 'browser', loginMethods: [] }),
    getSettings: async () => ({ ...settings }),
    updateSettings: async (patch) => {
      const next = sanitizeSettings({ ...settings, ...patch });
      localStorage.setItem(key, JSON.stringify(next));
      settings = next;
      return { ...settings };
    },
    getAccount: async () => structuredClone(account),
    getLogin: async () => ({ ...login }),
    startLogin: unsupported,
    startWebLogin: unsupported,
    cancelLogin: async () => ({ ...login }),
    refreshAccount: async () => structuredClone(account),
    signOut: async () => structuredClone(account),
    getRecommendationPage: async () => { throw new Error('Live recommendations are available in the desktop or Android app.'); },
    getSubscriptionPage: async () => { throw new Error('Followed-account videos require sign-in in the desktop or Android app.'); },
    getUploaderVideoPage: async () => { throw new Error('Uploader videos require native sign-in.'); },
    getFollowedUploaderPage: async () => { throw new Error('Followed uploaders require native sign-in.'); },
    getSubscriptionGroups: async () => { throw new Error('Subscription groups require native sign-in.'); },
    updateSubscriptionGroups: async () => { throw new Error('Subscription groups require native sign-in.'); },
    getVideoLabels: async ({ bvids }) => bvids.map(bvid => ({ bvid, labels: [], status: 'unavailable' as const })),
    getBrowseSettings: async () => structuredClone(browseSettings),
    updateBrowseSettings: async (value) => {
      const next = sanitizeBrowseSettings(value);
      localStorage.setItem('bili-focus.browse.v1', JSON.stringify(next));
      browseSettings = next;
      return structuredClone(next);
    },
    onAccountChanged: () => () => {},
    onLoginChanged: () => () => {},
  };
}

export const platformBridge: BilibiliBridge = window.bilibili ?? (platformKind === 'android' ? androidBridge() : previewBridge());
