import { BrowserWindow, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Credentials, WebLoginProvider } from '../core/account-ports';
import { credentialsFromOfficialCookies, isOfficialAuthNavigation, OFFICIAL_LOGIN_URL } from '../core/web-login-policy';
import { translator } from '../core/i18n';
import type { InterfaceLanguage } from '../shared/contracts';

interface LoginContext {
  window: BrowserWindow;
  session: Session;
  timer: ReturnType<typeof setTimeout> | null;
  listening: (...args: unknown[]) => void;
  checking: boolean;
  closing: boolean;
}

// Bilibili's hosted page owns password/SMS/captcha entry. It has no app preload.
export class ElectronWebLogin implements WebLoginProvider {
  private current: LoginContext | null = null;
  constructor(private readonly parent: () => BrowserWindow | null, private readonly language: () => InterfaceLanguage = () => 'en') {}

  async open(onCredentials: (credentials: Credentials) => Promise<void>, onClose: () => void): Promise<void> {
    this.close();
    const authSession = session.fromPartition(`bili-auth-${randomUUID()}`, { cache: false });
    const parent = this.parent();
    const popup = new BrowserWindow({ parent: parent ?? undefined, width: 1020, height: 760, minWidth: 780, minHeight: 620, title: translator(this.language())('Bilibili — password or SMS sign-in'), autoHideMenuBar: true, show: false, webPreferences: { session: authSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    const context: LoginContext = { window: popup, session: authSession, timer: null, listening: () => {}, checking: false, closing: false };
    this.current = context;
    authSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    authSession.setPermissionCheckHandler(() => false);
    authSession.on('will-download', (event) => event.preventDefault());
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event, url) => { if (!isOfficialAuthNavigation(url)) event.preventDefault(); });
    popup.webContents.on('will-redirect', (event, url) => { if (!isOfficialAuthNavigation(url)) event.preventDefault(); });
    popup.on('page-title-updated', (event) => event.preventDefault());
    popup.on('closed', () => {
      if (this.current !== context) return;
      this.close();
      onClose();
    });
    const inspect = async () => {
      if (this.current !== context || context.closing || context.checking) return;
      context.checking = true;
      try {
        const cookies = credentialsFromOfficialCookies(await authSession.cookies.get({ url: 'https://www.bilibili.com/' }));
        if (!cookies || this.current !== context || context.closing) return;
        // Web sign-in can omit a refresh token. The saved session is validated
        // normally; expiration offers another official sign-in instead.
        await onCredentials({ cookies, refreshToken: '' });
      } finally {
        context.checking = false;
      }
    };
    const schedule = () => {
      if (this.current !== context || context.closing || context.timer) return;
      context.timer = setTimeout(() => {
        context.timer = null;
        void inspect().catch(() => { /* The account manager reports validation failures. */ });
      }, 300);
    };
    context.listening = schedule;
    authSession.cookies.on('changed', context.listening);
    popup.webContents.on('did-navigate', schedule);
    popup.once('ready-to-show', () => { if (!context.closing) popup.show(); });
    try { await popup.loadURL(OFFICIAL_LOGIN_URL); }
    catch {
      if (context.closing || this.current !== context) return;
      this.close();
      throw new Error('The official Bilibili sign-in page could not load. Check your connection and try again.');
    }
  }

  close(): void {
    const context = this.current;
    if (!context) return;
    this.current = null;
    context.closing = true;
    if (context.timer) clearTimeout(context.timer);
    context.session.cookies.off('changed', context.listening);
    if (!context.window.isDestroyed()) context.window.destroy();
    void context.session.clearStorageData().catch(() => {});
    void context.session.clearCache().catch(() => {});
  }
}
