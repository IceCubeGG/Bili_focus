import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '../src/core/account-manager';
import type { AccountApi, Credentials, CredentialVault, WebLoginProvider } from '../src/core/account-ports';
import type { AccountSnapshot, LoginSnapshot } from '../src/shared/contracts';

const credentials: Credentials = { cookies: { SESSDATA: 'web-session-private', bili_jct: 'web-csrf-private' }, refreshToken: '' };
const profile = { uid: 123, name: 'Web account', avatar: '', level: 5, isVip: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('official web account sign-in', () => {
  let store: CredentialVault;
  let api: AccountApi;
  let provider: WebLoginProvider;
  let receiveCredentials: (value: Credentials) => Promise<void>;
  let windowClosed: () => void;
  let manager: AccountManager;
  let accountEvents: AccountSnapshot[];
  let loginEvents: LoginSnapshot[];

  beforeEach(() => {
    store = {
      isAvailable: vi.fn(() => true),
      load: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    api = {
      generateQr: vi.fn(async () => ({ url: 'https://passport.bilibili.com/scan', key: 'qr' })),
      pollQr: vi.fn(async () => ({ code: 86101, credentials: null })),
      validate: vi.fn(async () => profile),
      renew: vi.fn(async (value) => value),
      logout: vi.fn(async () => {}),
    };
    provider = {
      open: vi.fn(async (onCredentials, onClose) => { receiveCredentials = onCredentials; windowClosed = onClose; }),
      close: vi.fn(),
    };
    accountEvents = [];
    loginEvents = [];
    manager = new AccountManager(store, api, async () => 'data:image/png;base64,qr',
      (value) => { accountEvents.push(value); }, (value) => { loginEvents.push(value); }, { webLogin: provider });
  });

  afterEach(() => manager.dispose());

  it('opens the official provider without generating a QR or accepting an account yet', async () => {
    expect(await manager.startWebLogin()).toMatchObject({ status: 'web-login', method: 'web', qrDataUrl: null });
    expect(loginEvents.map(value => value.status)).toEqual(['idle', 'opening', 'web-login']);
    expect(provider.open).toHaveBeenCalledTimes(1);
    expect(api.generateQr).not.toHaveBeenCalled();
    expect(api.validate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(manager.getAccount().status).toBe('signed-out');
  });

  it('validates and securely saves the session before publishing sign-in success', async () => {
    const events: string[] = [];
    vi.mocked(api.validate).mockImplementation(async () => { events.push('validate'); return profile; });
    vi.mocked(store.save).mockImplementation(async () => { events.push('save'); });
    manager = new AccountManager(store, api, async () => '',
      (value) => { if (value.status === 'signed-in') events.push('publish'); },
      (value) => { loginEvents.push(value); }, { webLogin: provider });
    await manager.startWebLogin();
    await receiveCredentials(credentials);
    expect(events).toEqual(['validate', 'save', 'publish']);
    expect(api.validate).toHaveBeenCalledWith(credentials);
    expect(store.save).toHaveBeenCalledWith(credentials);
    expect(manager.getAccount()).toMatchObject({ status: 'signed-in', profile });
    expect(manager.getLogin()).toMatchObject({ status: 'success', method: 'web', qrDataUrl: null });
    expect(provider.close).toHaveBeenCalledTimes(2);
    const publicState = JSON.stringify({ account: manager.getAccount(), login: manager.getLogin(), loginEvents });
    expect(publicState).not.toContain('web-session-private');
    expect(publicState).not.toContain('web-csrf-private');
    expect(publicState).not.toContain('cookies');
  });

  it('does not open a credential entry window if secure storage is unavailable', async () => {
    vi.mocked(store.isAvailable).mockReturnValue(false);
    expect((await manager.startWebLogin()).status).toBe('error');
    expect(provider.open).not.toHaveBeenCalled();
    expect(api.validate).not.toHaveBeenCalled();
  });

  it('reports a missing native provider without touching account transport', async () => {
    manager = new AccountManager(store, api, async () => '');
    expect((await manager.startWebLogin()).status).toBe('error');
    expect(api.validate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('reports a failed official window load and closes its provider', async () => {
    vi.mocked(provider.open).mockRejectedValue(new Error('Official sign-in could not load.'));
    expect(await manager.startWebLogin()).toMatchObject({ status: 'error', method: 'web', message: 'Official sign-in could not load.' });
    expect(provider.close).toHaveBeenCalledTimes(2);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not save cookies that Bilibili rejects', async () => {
    vi.mocked(api.validate).mockRejectedValue(new Error('Your Bilibili session expired.'));
    await manager.startWebLogin();
    await receiveCredentials(credentials);
    expect(manager.getAccount().status).toBe('signed-out');
    expect(manager.getLogin().status).toBe('error');
    expect(store.save).not.toHaveBeenCalled();
    expect(provider.close).toHaveBeenCalledTimes(2);
  });

  it('cancels when the native window is dismissed and ignores its late cookies', async () => {
    await manager.startWebLogin();
    windowClosed();
    await receiveCredentials(credentials);
    expect(manager.getLogin()).toMatchObject({ status: 'idle', method: 'web', qrDataUrl: null });
    expect(manager.getAccount().status).toBe('signed-out');
    expect(api.validate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not revive an opening window after cancellation', async () => {
    const opening = deferred<void>();
    vi.mocked(provider.open).mockImplementation(async (onCredentials, onClose) => {
      receiveCredentials = onCredentials;
      windowClosed = onClose;
      await opening.promise;
    });
    const start = manager.startWebLogin();
    expect(manager.getLogin().status).toBe('opening');
    manager.cancelLogin();
    opening.resolve();
    await start;
    await receiveCredentials(credentials);
    expect(manager.getLogin().status).toBe('idle');
    expect(api.validate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('ignores callbacks from a previous window when another sign-in replaces it', async () => {
    await manager.startWebLogin();
    const staleCredentials = receiveCredentials;
    const staleClose = windowClosed;
    await manager.startWebLogin();
    staleClose();
    await staleCredentials(credentials);
    expect(manager.getLogin().status).toBe('web-login');
    expect(api.validate).not.toHaveBeenCalled();
    await receiveCredentials(credentials);
    expect(manager.getLogin().status).toBe('success');
    expect(api.validate).toHaveBeenCalledTimes(1);
  });

  it('ignores a late account validation after the user dismisses sign-in', async () => {
    const validation = deferred<typeof profile>();
    vi.mocked(api.validate).mockReturnValue(validation.promise);
    await manager.startWebLogin();
    const finish = receiveCredentials(credentials);
    windowClosed();
    validation.resolve(profile);
    await finish;
    expect(manager.getLogin().status).toBe('idle');
    expect(manager.getAccount().status).toBe('signed-out');
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([false, true])('restores the previous vault if canceled while saving (existing account: %s)', async (existing) => {
    const previous: Credentials = { cookies: { SESSDATA: 'previous-private', bili_jct: 'previous-csrf' }, refreshToken: 'previous-refresh' };
    let persisted: Credentials | null = existing ? previous : null;
    vi.mocked(store.load).mockImplementation(async () => persisted);
    vi.mocked(store.clear).mockImplementation(async () => { persisted = null; });
    await manager.initialize();
    const saving = deferred<void>();
    vi.mocked(store.save).mockImplementation(async (value) => {
      if (value === credentials) await saving.promise;
      persisted = value;
    });
    await manager.startWebLogin();
    const finish = receiveCredentials(credentials);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.save).toHaveBeenCalledWith(credentials);
    manager.cancelLogin();
    saving.resolve();
    await finish;
    expect(manager.getLogin().status).toBe('idle');
    expect(manager.getAccount().status).toBe(existing ? 'signed-in' : 'signed-out');
    expect(persisted).toEqual(existing ? previous : null);
    if (existing) expect(store.save).toHaveBeenLastCalledWith(previous);
    else expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it('keeps success when closing the provider triggers its normal window-close callback', async () => {
    await manager.startWebLogin();
    vi.mocked(provider.close).mockImplementation(() => { windowClosed(); });
    await receiveCredentials(credentials);
    expect(manager.getLogin().status).toBe('success');
    expect(manager.getAccount().status).toBe('signed-in');
  });

  it.each(['cancel', 'web-cancel', 'window-close'] as const)('restores the verified account when a pending refresh is interrupted by %s', async (action) => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    const previous = await manager.initialize();
    const validation = deferred<typeof profile>();
    vi.mocked(api.validate).mockReturnValue(validation.promise);
    const refresh = manager.refreshAccount();
    expect(manager.getAccount().status).toBe('checking');
    if (action === 'cancel') manager.cancelLogin();
    else {
      await manager.startWebLogin();
      if (action === 'window-close') windowClosed();
      else manager.cancelLogin();
    }
    expect(manager.getAccount()).toEqual(previous);
    validation.resolve({ ...profile, name: 'Late obsolete response' });
    await refresh;
    expect(manager.getAccount()).toEqual(previous);
    expect(manager.getAccount().status).not.toBe('checking');
  });

  it('allows a fresh account check while a canceled refresh is still pending', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    await manager.initialize();
    const obsoleteValidation = deferred<typeof profile>();
    vi.mocked(api.validate).mockReturnValueOnce(obsoleteValidation.promise);
    const obsoleteRefresh = manager.refreshAccount();
    manager.cancelLogin();
    vi.mocked(api.validate).mockResolvedValueOnce({ ...profile, name: 'Latest account' });
    const currentRefresh = manager.refreshAccount();
    expect(currentRefresh).not.toBe(obsoleteRefresh);
    expect(await currentRefresh).toMatchObject({ status: 'signed-in', profile: { name: 'Latest account' } });
    obsoleteValidation.resolve({ ...profile, name: 'Obsolete account' });
    await obsoleteRefresh;
    expect(manager.getAccount()).toMatchObject({ status: 'signed-in', profile: { name: 'Latest account' } });
  });

  it('does not publish a delayed sign-out or its remote failure over a newer sign-in', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    await manager.initialize();
    const clearing = deferred<void>();
    const remoteLogout = deferred<void>();
    vi.mocked(store.clear).mockReturnValue(clearing.promise);
    vi.mocked(api.logout).mockReturnValue(remoteLogout.promise);
    const signOut = manager.signOut();
    await manager.startWebLogin();
    const eventsAfterOpening = accountEvents.length;
    const nextProfile = { ...profile, uid: 456, name: 'New signed-in account' };
    vi.mocked(api.validate).mockResolvedValue(nextProfile);
    const newSignIn = receiveCredentials({ cookies: { SESSDATA: 'next-private', bili_jct: 'next-csrf' }, refreshToken: '' });
    clearing.resolve();
    await newSignIn;
    expect(manager.getAccount()).toMatchObject({ status: 'signed-in', profile: nextProfile, message: null });
    expect(accountEvents.slice(eventsAfterOpening).some(value => value.status === 'signed-out')).toBe(false);
    if (vi.mocked(api.logout).mock.calls.length > 0) remoteLogout.reject(new Error('Old account logout unreachable'));
    else remoteLogout.resolve();
    await signOut;
    expect(manager.getAccount()).toMatchObject({ status: 'signed-in', profile: nextProfile, message: null });
    expect(manager.getLogin().status).toBe('success');
  });
});
