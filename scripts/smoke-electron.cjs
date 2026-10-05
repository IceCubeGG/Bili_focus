// Launch the built app against a separate, disposable preferences directory.
// No account is authenticated, and no production session is read or revoked.
const { app, BrowserWindow } = require('electron');
const { mkdtemp, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bili-focus-smoke-'));
  app.setPath('userData', directory);
  const watchdog = setTimeout(() => { console.error('Desktop smoke check timed out.'); app.exit(1); }, 45000);
  app.on('browser-window-created', (_event, window) => {
    window.once('ready-to-show', () => setImmediate(() => window.hide()));
    if (window.getParentWindow()) return;
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`(async () => {
          if (!window.bilibili) throw new Error('Secure preload bridge did not load.');
          const platform = await window.bilibili.getPlatform();
          if (!platform.loginMethods.includes('qr') || !platform.loginMethods.includes('web')) throw new Error('Sign-in capabilities were not exposed.');
          const settings = await window.bilibili.getSettings();
          const account = await window.bilibili.getAccount();
          if (!account.secureStorage) throw new Error('OS credential encryption is not available.');
          const saved = await window.bilibili.updateSettings({ appearance: 'dark', compactCards: true, lastTab: 'options' });
          if (saved.appearance !== 'dark' || !saved.compactCards) throw new Error('Preferences were not saved.');
          await window.bilibili.updateSettings(settings);
          const login = await window.bilibili.startLogin();
          if (login.status !== 'waiting' || !login.qrDataUrl?.startsWith('data:image/png')) throw new Error(login.message || 'Live QR generation did not complete.');
          const cancelled = await window.bilibili.cancelLogin();
          if (cancelled.status !== 'idle') throw new Error('QR cancellation did not complete.');
          return { bridgeLoaded: true, encryptedStorage: account.secureStorage, accountStatus: account.status, liveQrGeneration: login.status, cancellation: cancelled.status, navigationButtons: document.querySelectorAll('.bottom-nav button').length, signInMethods: platform.loginMethods };
        })()`);
        if (result.navigationButtons !== 3) throw new Error('Three-tab navigation did not render.');
        const persisted = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
        if (persisted.version !== 1) throw new Error('Persisted settings schema mismatch.');
        const official = await window.webContents.executeJavaScript('window.bilibili.startWebLogin()');
        if (official.status !== 'web-login') throw new Error(official.message || 'Official sign-in did not open.');
        const popup = BrowserWindow.getAllWindows().find(value => value !== window);
        if (!popup) throw new Error('The official sign-in window is missing.');
        const preferences = popup.webContents.getLastWebPreferences();
        if (preferences.preload || preferences.nodeIntegration || !preferences.contextIsolation || !preferences.sandbox) throw new Error('The official sign-in window is not isolated.');
        if (popup.webContents.session === window.webContents.session) throw new Error('The official sign-in cookie store is not isolated.');
        const officialUrl = new URL(popup.webContents.getURL());
        if (!['https://passport.bilibili.com', 'https://account.bilibili.com'].includes(officialUrl.origin)) throw new Error('The official sign-in opened an unexpected address.');
        await window.webContents.executeJavaScript('window.bilibili.cancelLogin()');
        if (!popup.isDestroyed()) throw new Error('Official sign-in cancellation did not close its window.');
        result.officialWebSignIn = 'loaded-and-cancelled';
        result.isolatedAuthCookies = true;
        console.log(JSON.stringify(result, null, 2));
        console.log('Desktop smoke check passed. Test preferences: ' + directory);
        clearTimeout(watchdog);
        app.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Desktop smoke check failed.');
        clearTimeout(watchdog);
        app.exit(1);
      }
    });
  });
  require('../dist-electron/main.cjs');
})();
