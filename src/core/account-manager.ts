import type { AccountSnapshot, LoginSnapshot } from '../shared/contracts';
import { BilibiliError, type AccountApi, type Credentials, type CredentialVault, type WebLoginProvider } from './account-ports';

interface ManagerOptions {
  pollIntervalMs?: number;
  qrLifetimeMs?: number;
  now?: () => number;
  webLogin?: WebLoginProvider;
}

export class AccountManager {
  private credentials: Credentials | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refreshPromise: Promise<AccountSnapshot> | null = null;
  private refreshPreviousAccount: AccountSnapshot | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private account: AccountSnapshot;
  private login: LoginSnapshot = { status: 'idle', qrDataUrl: null, expiresAt: null, message: null };
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly qrLifetimeMs: number;

  constructor(
    private readonly store: CredentialVault,
    private readonly api: AccountApi,
    private readonly encodeQr: (url: string) => Promise<string>,
    private readonly onAccount: (snapshot: AccountSnapshot) => void = () => {},
    private readonly onLogin: (snapshot: LoginSnapshot) => void = () => {},
    options: ManagerOptions = {},
  ) {
    this.webLogin = options.webLogin;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.qrLifetimeMs = options.qrLifetimeMs ?? 180000;
    this.account = { status: 'signed-out', profile: null, lastCheckedAt: null, message: null, secureStorage: store.isAvailable() };
  }

  private readonly webLogin?: WebLoginProvider;

  getAccount(): AccountSnapshot { return structuredClone(this.account); }
  getLogin(): LoginSnapshot { return { ...this.login }; }

  // Native hosts use this internally for feeds; the renderer bridge never exposes it.
  getFeedCredentials(): Credentials | null {
    return this.credentials && this.account.status !== 'expired' ? structuredClone(this.credentials) : null;
  }

  getSessionRevision(): number { return this.generation; }

  private accountChanged(update: Partial<AccountSnapshot>): void {
    this.account = { ...this.account, ...update };
    this.onAccount(this.getAccount());
  }

  private loginChanged(update: Partial<LoginSnapshot>): void {
    this.login = { ...this.login, ...update };
    this.onLogin(this.getLogin());
  }

  async initialize(): Promise<AccountSnapshot> {
    const generation = this.generation;
    try {
      const saved = await this.store.load();
      if (generation !== this.generation) return this.getAccount();
      this.credentials = saved;
    }
    catch { if (generation === this.generation) this.accountChanged({ message: 'Your saved session could not be unlocked. Please sign in again.' }); }
    if (this.credentials) return this.refreshAccount();
    return this.getAccount();
  }

  async startLogin(): Promise<LoginSnapshot> {
    this.cancelLogin();
    const generation = this.generation;
    if (!this.store.isAvailable()) {
      this.loginChanged({ status: 'error', message: 'Secure credential storage is unavailable. Sign-in is disabled.' });
      return this.getLogin();
    }
    this.loginChanged({ status: 'generating', method: 'qr', qrDataUrl: null, expiresAt: null, message: null });
    try {
      const qr = await this.api.generateQr();
      if (generation !== this.generation) return this.getLogin();
      const qrDataUrl = await this.encodeQr(qr.url);
      if (generation !== this.generation) return this.getLogin();
      this.loginChanged({ status: 'waiting', qrDataUrl, expiresAt: this.now() + this.qrLifetimeMs });
      this.schedulePoll(qr.key, generation);
    } catch (error) {
      if (generation === this.generation) this.loginChanged({ status: 'error', message: this.errorMessage(error) });
    }
    return this.getLogin();
  }

  cancelLogin(): LoginSnapshot {
    this.generation++;
    this.refreshPromise = null;
    if (this.account.status === 'checking' && this.refreshPreviousAccount) {
      this.accountChanged(this.refreshPreviousAccount);
    }
    this.refreshPreviousAccount = null;
    this.webLogin?.close();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.loginChanged({ status: 'idle', qrDataUrl: null, expiresAt: null, message: null });
    return this.getLogin();
  }

  async startWebLogin(): Promise<LoginSnapshot> {
    this.cancelLogin();
    const generation = this.generation;
    if (!this.store.isAvailable() || !this.webLogin) {
      this.loginChanged({ status: 'error', method: 'web', message: 'Official web sign-in is unavailable on this device.' });
      return this.getLogin();
    }
    this.loginChanged({ status: 'opening', method: 'web', qrDataUrl: null, expiresAt: null, message: null });
    try {
      await this.webLogin.open(async (credentials) => {
        if (generation !== this.generation) return;
        try {
          const profile = await this.api.validate(credentials);
          if (generation !== this.generation) return;
          await this.persistSession(credentials, generation);
          if (generation !== this.generation) return;
          this.accountChanged({ status: 'signed-in', profile, lastCheckedAt: this.now(), message: null });
          this.loginChanged({ status: 'success', method: 'web', message: 'You are signed in to Bilibili.' });
          this.webLogin?.close();
        } catch (error) {
          if (generation === this.generation) {
            this.loginChanged({ status: 'error', method: 'web', message: this.errorMessage(error) });
            this.webLogin?.close();
          }
        }
      }, () => {
        if (generation === this.generation && ['opening', 'web-login'].includes(this.login.status)) {
          this.cancelLogin();
          this.loginChanged({ method: 'web', message: 'The Bilibili sign-in window was closed.' });
        }
      });
      if (generation === this.generation && this.login.status === 'opening') this.loginChanged({ status: 'web-login', method: 'web', message: 'Finish password or SMS sign-in in the official Bilibili window.' });
    } catch (error) {
      if (generation === this.generation) {
        this.loginChanged({ status: 'error', method: 'web', message: this.errorMessage(error) });
        this.webLogin?.close();
      }
    }
    return this.getLogin();
  }

  private schedulePoll(key: string, generation: number): void {
    this.timer = setTimeout(() => { this.timer = null; void this.poll(key, generation); }, this.pollIntervalMs);
  }

  private async poll(key: string, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (this.now() >= (this.login.expiresAt ?? 0)) {
      this.loginChanged({ status: 'expired', qrDataUrl: null, message: 'This QR code has expired. Generate a new one to continue.' });
      return;
    }
    try {
      const result = await this.api.pollQr(key);
      if (generation !== this.generation) return;
      if (result.code === 86038) {
        this.loginChanged({ status: 'expired', qrDataUrl: null, message: 'This QR code has expired. Generate a new one to continue.' });
        return;
      }
      if (result.code === 86101 || result.code === 86090) {
        this.loginChanged({ status: result.code === 86090 ? 'scanned' : 'waiting', message: null });
        this.schedulePoll(key, generation);
        return;
      }
      if (result.code !== 0 || !result.credentials) throw new Error('Bilibili could not complete sign-in. Please generate a new code.');
      const profile = await this.api.validate(result.credentials);
      if (generation !== this.generation) return;
      await this.persistSession(result.credentials, generation);
      if (generation !== this.generation) return;
      this.accountChanged({ status: 'signed-in', profile, lastCheckedAt: this.now(), message: null });
      this.loginChanged({ status: 'success', qrDataUrl: null, message: 'You are signed in to Bilibili.' });
    } catch (error) {
      if (generation === this.generation) this.loginChanged({ status: 'error', qrDataUrl: null, message: this.errorMessage(error) });
    }
  }

  refreshAccount(): Promise<AccountSnapshot> {
    if (this.refreshPromise) return this.refreshPromise;
    const refresh = this.refresh();
    this.refreshPromise = refresh;
    void refresh.finally(() => { if (this.refreshPromise === refresh) this.refreshPromise = null; });
    return refresh;
  }

  private async refresh(): Promise<AccountSnapshot> {
    if (!this.credentials) return this.getAccount();
    const generation = this.generation;
    this.refreshPreviousAccount = this.getAccount();
    this.accountChanged({ status: 'checking', message: null });
    try {
      const profile = await this.api.validate(this.credentials);
      if (generation !== this.generation) return this.getAccount();
      // Validate first: an optional renewal failure must not hide a usable session.
      this.refreshPreviousAccount = null;
      this.accountChanged({ status: 'signed-in', profile, lastCheckedAt: this.now() });
      try {
        const renewed = await this.api.renew(this.credentials, async (next) => {
          if (generation !== this.generation) throw new Error('Session changed.');
          await this.persistSession(next, generation);
          if (generation !== this.generation) throw new Error('Session changed.');
        });
        if (generation === this.generation) this.credentials = renewed;
      } catch (error) {
        if (generation === this.generation) this.accountChanged({ message: `You are signed in, but session renewal needs attention. ${this.errorMessage(error)}` });
      }
    } catch (error) {
      if (generation !== this.generation) return this.getAccount();
      this.refreshPreviousAccount = null;
      this.accountChanged({ status: error instanceof BilibiliError && error.code === -101 ? 'expired' : 'offline', lastCheckedAt: this.now(), message: this.errorMessage(error) });
    }
    return this.getAccount();
  }

  async signOut(): Promise<AccountSnapshot> {
    this.cancelLogin();
    const generation = this.generation;
    this.refreshPromise = null;
    const previous = this.credentials;
    this.credentials = null;
    await this.queueStorage(() => this.store.clear());
    if (generation === this.generation) this.accountChanged({ status: 'signed-out', profile: null, lastCheckedAt: null, message: null });
    if (previous) {
      try { await this.api.logout(previous); }
      catch { if (generation === this.generation) this.accountChanged({ message: 'Signed out on this device. Bilibili could not be reached to revoke the remote session.' }); }
    }
    return this.getAccount();
  }

  dispose(): void { this.cancelLogin(); }

  private queueStorage(operation: () => Promise<void>): Promise<void> {
    const task = this.storageQueue.then(operation);
    this.storageQueue = task.catch(() => {});
    return task;
  }

  private persistSession(next: Credentials, generation: number): Promise<void> {
    return this.queueStorage(async () => {
      if (generation !== this.generation) return;
      await this.store.save(next);
      if (generation === this.generation) this.credentials = next;
      else if (this.credentials) await this.store.save(this.credentials);
      else await this.store.clear();
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
  }
}
