import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { AccountManager } from '../core/account-manager';
import { BilibiliClient } from './bilibili-client';
import { CredentialsStore } from './credentials-store';
import { SettingsStore } from './settings-store';
import { ElectronWebLogin } from './web-login';
import { BrowseStore } from './browse-store';
import { RecommendationClient } from './recommendation-client';
import { SubscriptionClient } from './subscription-client';
import { SubscriptionGroupStore } from './subscription-group-store';
import { VideoClient } from './video-client';
import { DownloadManager } from './download-manager';
import { numericId, object } from '../core/video';
import { translator } from '../core/i18n';

// Normal startup registers before ready; isolated test hosts may register first themselves.
if (!app.isReady()) protocol.registerSchemesAsPrivileged([{ scheme: 'bili-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);

app.setName('Bili Focus');
let window: BrowserWindow | null = null;
let account: AccountManager | null = null;
let videos: VideoClient | null = null;
let downloads: DownloadManager | null = null;
const devUrl = process.env.BILI_DEV_SERVER_URL;
if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('Unsupported development server.');
const indexPath = join(__dirname, '../dist/index.html');
const trustedUrl = devUrl ? new URL(devUrl).href : pathToFileURL(indexPath).href;

function trustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('?')[0].split('#')[0] !== trustedUrl) {
    throw new Error('This request did not originate from the app.');
  }
}

async function start(): Promise<void> {
  const directory = app.getPath('userData');
  const settings = new SettingsStore(join(directory, 'settings.json'));
  await settings.load();
  const browse = new BrowseStore(join(directory, 'browse-presets.json'));
  let browseLoadError: string | null = null;
  try { await browse.load(); }
  catch { browseLoadError = 'Saved recommendation presets could not be restored. Your feed is paused until the settings are repaired.'; }
  const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
  const vault = new CredentialsStore(join(directory, 'session.enc'), {
    available: () => encryptionAvailable && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => {
      const decrypted = await safeStorage.decryptStringAsync(value);
      return decrypted.result;
    },
  });
  const send = (channel: string, value: unknown) => { if (window && !window.isDestroyed()) window.webContents.send(channel, value); };
  account = new AccountManager(vault, new BilibiliClient(), (url) => QRCode.toDataURL(url, { width: 288, margin: 3, errorCorrectionLevel: 'M' }), (value) => { videos?.syncAccount(); downloads?.syncAccount(); send('account:changed', value); }, (value) => send('login:changed', value), { webLogin: new ElectronWebLogin(() => window, () => settings.get().language) });
  videos = new VideoClient(() => { const state = account!.getAccount(); return state.profile && ['signed-in', 'offline'].includes(state.status) ? account!.getFeedCredentials() : null; }, () => account!.getSessionRevision(), fetch, Date.now, () => { void account!.refreshAccount(); });
  protocol.handle('bili-media', (request) => videos!.stream(request));
  downloads = new DownloadManager(join(directory, 'downloads.json'), videos, () => account!.getSessionRevision());
  try { await downloads.load(); } catch { /* Corrupt queue pauses downloads, not the account/feed UI. */ }
  const recommendations = new RecommendationClient(() => account!.getFeedCredentials(), () => account!.getSessionRevision(), fetch, Date.now, () => { void account!.refreshAccount(); });
  const subscriptions = new SubscriptionClient(() => {
    const state = account!.getAccount();
    return state.profile && Number.isSafeInteger(state.profile.uid) && state.profile.uid > 0 && ['signed-in', 'offline'].includes(state.status) ? account!.getFeedCredentials() : null;
  }, () => account!.getSessionRevision(), fetch, Date.now, () => { void account!.refreshAccount(); });
  const subscriptionGroups = new SubscriptionGroupStore(directory);
  const subscriptionUid = () => {
    const state = account!.getAccount();
    if (!state.profile || !['signed-in', 'offline'].includes(state.status) || !account!.getFeedCredentials()) throw new Error('Sign in to manage your subscriptions.');
    return String(state.profile.uid);
  };
  const groupOperation = async (input?: unknown) => {
    const uid = subscriptionUid(); const revision = account!.getSessionRevision();
    const result = input === undefined ? await subscriptionGroups.get(uid) : await subscriptionGroups.update(uid, input);
    if (revision !== account!.getSessionRevision() || uid !== subscriptionUid()) throw new Error('Your account changed. Reopen subscriptions.');
    return result;
  };

  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    'downloads:get': () => downloads!.get(),
    'downloads:choose': async () => { const picked = await dialog.showOpenDialog(window!, { title: translator(settings.get().language)('Choose a download folder'), properties: ['openDirectory', 'createDirectory'] }); return picked.canceled ? downloads!.get() : downloads!.chooseFolder(picked.filePaths[0]); },
    'downloads:start': (options) => downloads!.start(options),
    'downloads:control': (options) => downloads!.control(options),
    'video:details': (options) => videos!.getVideoDetails(options),
    'video:playback': (options) => videos!.getVideoPlayback(options),
    'video:release': (options) => videos!.releaseVideoPlayback(options),
    'video:danmu': (options) => videos!.getDanmu(options),
    'video:send-danmu': (options) => videos!.sendDanmu(options),
    'video:comments': (options) => videos!.getVideoComments(options),
    'video:send-comment': (options) => videos!.sendVideoComment(options),
    'video:creator': async (options) => { await shell.openExternal(`https://space.bilibili.com/${numericId(object(options).uploaderId)}`); },
    'platform:get': () => ({ kind: 'desktop', loginMethods: ['qr', 'web'] }),
    'settings:get': () => settings.get(),
    'settings:update': (patch) => settings.update(patch),
    'account:get': () => account!.getAccount(),
    'account:get-login': () => account!.getLogin(),
    'account:login': () => account!.startLogin(),
    'account:web-login': () => account!.startWebLogin(),
    'account:cancel-login': () => account!.cancelLogin(),
    'account:refresh': () => account!.refreshAccount(),
    'account:sign-out': () => account!.signOut(),
    'browse:get-settings': () => { if (browseLoadError) throw new Error(browseLoadError); return browse.get(); },
    'browse:update-settings': async (input) => { const saved = await browse.update(input); browseLoadError = null; return saved; },
    'browse:recommendations': (options) => recommendations.getRecommendationPage(options),
    'browse:labels': (options) => recommendations.getVideoLabels(options),
    'subscribe:videos': (options) => subscriptions.getSubscriptionPage(options),
    'subscribe:uploader-videos': (options) => subscriptions.getUploaderVideoPage(options),
    'subscribe:uploaders': (options) => subscriptions.getFollowedUploaderPage(options, subscriptionUid()),
    'subscribe:get-groups': () => groupOperation(),
    'subscribe:update-groups': (input) => groupOperation(input),
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args) => { trustedSender(event); return handler(...args); });
  }
  Menu.setApplicationMenu(null);
  createWindow();
  void account.initialize().catch(() => { /* Initialization failures are shown by the account manager. */ });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

function createWindow(): void {
  window = new BrowserWindow({ width: 1180, height: 840, minWidth: 390, minHeight: 600, title: 'Bili Focus', backgroundColor: '#f7f8fa', show: false, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  const current = window;
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  // Only our top-level app may enter fullscreen. Camera, microphone, external
  // pages, subframes and automatic (gesture-free) fullscreen remain denied.
  const fullscreenAllowed = (contents: Electron.WebContents | null, permission: string, mainFrame?: boolean) =>
    permission === 'fullscreen' && mainFrame !== false && contents === current.webContents &&
    contents.getURL().split('?')[0].split('#')[0] === trustedUrl;
  current.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(fullscreenAllowed(contents, permission, details.isMainFrame)));
  current.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => fullscreenAllowed(contents, permission, details.isMainFrame));
  current.once('ready-to-show', () => current.show());
  current.on('closed', () => { if (window === current) window = null; videos?.clear(); account?.cancelLogin(); });
  if (devUrl) void current.loadURL(devUrl); else void current.loadFile(indexPath);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('Bili Focus could not start', 'The app could not read its preferences or initialize secure storage. Check your user-folder permissions and restart the app.');
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { downloads?.close(); videos?.clear(); account?.dispose(); });
}
