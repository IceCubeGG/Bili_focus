import { contextBridge, ipcRenderer } from 'electron';
import type { BilibiliBridge } from '../shared/contracts';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: BilibiliBridge = {
  getSaveFolders: () => ipcRenderer.invoke('folders:get'),
  controlSaveFolder: (options) => ipcRenderer.invoke('folders:control', options),
  listSavedFiles: (options) => ipcRenderer.invoke('folders:files', options),
  openSavedFile: (options) => ipcRenderer.invoke('folders:open-file', options),
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  chooseDownloadFolder: () => ipcRenderer.invoke('downloads:choose'),
  startDownload: (options) => ipcRenderer.invoke('downloads:start', options),
  controlDownload: (options) => ipcRenderer.invoke('downloads:control', options),
  getVideoDetails: (options) => ipcRenderer.invoke('video:details', options),
  getVideoPlayback: (options) => ipcRenderer.invoke('video:playback', options),
  releaseVideoPlayback: (options) => ipcRenderer.invoke('video:release', options),
  getDanmu: (options) => ipcRenderer.invoke('video:danmu', options),
  sendDanmu: (options) => ipcRenderer.invoke('video:send-danmu', options),
  getVideoComments: (options) => ipcRenderer.invoke('video:comments', options),
  sendVideoComment: (options) => ipcRenderer.invoke('video:send-comment', options),
  openCreatorProfile: (options) => ipcRenderer.invoke('video:creator', options),
  getPlatform: () => ipcRenderer.invoke('platform:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  getAccount: () => ipcRenderer.invoke('account:get'),
  getLogin: () => ipcRenderer.invoke('account:get-login'),
  startLogin: () => ipcRenderer.invoke('account:login'),
  startWebLogin: () => ipcRenderer.invoke('account:web-login'),
  cancelLogin: () => ipcRenderer.invoke('account:cancel-login'),
  refreshAccount: () => ipcRenderer.invoke('account:refresh'),
  signOut: () => ipcRenderer.invoke('account:sign-out'),
  getRecommendationPage: (options) => ipcRenderer.invoke('browse:recommendations', options),
  searchVideos: (options) => ipcRenderer.invoke('search:videos', options),
  getSubscriptionPage: (options) => ipcRenderer.invoke('subscribe:videos', options),
  getUploaderVideoPage: (options) => ipcRenderer.invoke('subscribe:uploader-videos', options),
  getFollowedUploaderPage: (options) => ipcRenderer.invoke('subscribe:uploaders', options),
  getSubscriptionGroups: () => ipcRenderer.invoke('subscribe:get-groups'),
  updateSubscriptionGroups: (settings) => ipcRenderer.invoke('subscribe:update-groups', settings),
  getVideoLabels: (options) => ipcRenderer.invoke('browse:labels', options),
  getBrowseSettings: () => ipcRenderer.invoke('browse:get-settings'),
  updateBrowseSettings: (settings) => ipcRenderer.invoke('browse:update-settings', settings),
  onAccountChanged: (callback) => subscribe('account:changed', callback),
  onLoginChanged: (callback) => subscribe('login:changed', callback),
};

contextBridge.exposeInMainWorld('bilibili', bridge);
