import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '../src/electron/account-manager';
import { BilibiliError, type AccountApi, type QrCode, type QrPoll } from '../src/electron/bilibili-client';
import type { Credentials, CredentialsStore } from '../src/electron/credentials-store';
import type { AccountSnapshot, LoginSnapshot } from '../src/shared/contracts';

const credentials: Credentials = { cookies: { SESSDATA: 'private-session', bili_jct: 'private-csrf' }, refreshToken: 'private-refresh' };
const profile = { uid: 123, name: 'Bili user', avatar: 'https://i0.hdslb.com/avatar.jpg', level: 5, isVip: false };
const qr: QrCode = { url: 'https://passport.bilibili.com/h5-app/passport/login/scan?key=test', key: 'test-key' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('account lifecycle', () => {
  let store: Pick<CredentialsStore, 'isAvailable' | 'load' | 'save' | 'clear'>;
  let api: AccountApi;
  let accountEvents: AccountSnapshot[];
  let loginEvents: LoginSnapshot[];
  let manager: AccountManager;
  let encodeQr: (url: string) => Promise<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T03:00:00Z'));
    store = {
      isAvailable: vi.fn(() => true),
      load: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    api = {
      generateQr: vi.fn(async () => qr),
      pollQr: vi.fn(async () => ({ code: 86101, credentials: null })),
      validate: vi.fn(async () => profile),
      renew: vi.fn(async (value) => value),
      logout: vi.fn(async () => {}),
    };
    accountEvents = [];
    loginEvents = [];
    encodeQr = vi.fn(async () => 'data:image/png;base64,mocked-code');
    manager = new AccountManager(store, api, encodeQr,
      (value) => { accountEvents.push(value); },
      (value) => { loginEvents.push(value); },
      { pollIntervalMs: 1000, qrLifetimeMs: 30000 });
  });

  afterEach(() => { manager.dispose(); vi.useRealTimers(); });

  it('starts signed out without requesting authenticated endpoints', async () => {
    expect((await manager.initialize()).status).toBe('signed-out');
    expect(api.validate).not.toHaveBeenCalled();
    expect(api.renew).not.toHaveBeenCalled();
  });

  it('restores and validates the encrypted account after restart', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    expect(await manager.initialize()).toMatchObject({ status: 'signed-in', profile, lastCheckedAt: Date.now(), message: null });
    expect(accountEvents.map((value) => value.status)).toEqual(['checking', 'signed-in']);
    expect(api.validate).toHaveBeenCalledWith(credentials);
  });

  it('supplies a detached native-only feed credential snapshot and invalidates it on sign-out', async () => {
    expect(manager.getFeedCredentials()).toBeNull();
    vi.mocked(store.load).mockResolvedValue(structuredClone(credentials));
    await manager.initialize();
    const revision = manager.getSessionRevision();
    const feedCredentials = manager.getFeedCredentials()!;
    feedCredentials.cookies.SESSDATA = 'changed';
    expect(manager.getFeedCredentials()?.cookies.SESSDATA).toBe('private-session');
    await manager.signOut();
    expect(manager.getSessionRevision()).toBeGreaterThan(revision);
    expect(manager.getFeedCredentials()).toBeNull();
  });

  it('does not attach confirmed-expired credentials to recommendation requests', async () => {
    vi.mocked(store.load).mockResolvedValue(structuredClone(credentials));
    vi.mocked(api.validate).mockRejectedValueOnce(new BilibiliError(-101, 'Session expired'));
    await manager.initialize();
    expect(manager.getFeedCredentials()).toBeNull();
    vi.mocked(api.validate).mockResolvedValueOnce(profile);
    await manager.refreshAccount();
    expect(manager.getFeedCredentials()?.cookies.SESSDATA).toBe('private-session');
  });

  it('distinguishes a revoked session from an offline connection', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    vi.mocked(api.validate).mockRejectedValueOnce(new BilibiliError(-101, 'Session expired'));
    expect((await manager.initialize()).status).toBe('expired');
    vi.mocked(api.validate).mockRejectedValueOnce(new Error('Could not reach Bilibili'));
    expect((await manager.refreshAccount()).status).toBe('offline');
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('keeps a verified account usable if optional renewal fails', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    vi.mocked(api.renew).mockRejectedValue(new Error('Renewal unavailable'));
    expect(await manager.initialize()).toMatchObject({ status: 'signed-in', profile, message: expect.stringContaining('session renewal needs attention') });
  });

  it('does not expose credentials through account or login snapshots and events', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    await manager.initialize();
    const publicState = JSON.stringify({ account: manager.getAccount(), login: manager.getLogin(), accountEvents, loginEvents });
    expect(publicState).not.toContain('private-session');
    expect(publicState).not.toContain('private-csrf');
    expect(publicState).not.toContain('private-refresh');
    const snapshot = manager.getAccount();
    snapshot.profile!.name = 'mutated';
    expect(manager.getAccount().profile!.name).toBe('Bili user');
  });

  it('coalesces repeated refresh requests into one account check', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    await manager.initialize();
    vi.mocked(api.validate).mockClear();
    const pending = deferred<typeof profile>();
    vi.mocked(api.validate).mockReturnValue(pending.promise);
    const first = manager.refreshAccount();
    const second = manager.refreshAccount();
    expect(first).toBe(second);
    expect(api.validate).toHaveBeenCalledTimes(1);
    pending.resolve(profile);
    await first;
  });

  it('reports an unreadable encrypted session without breaking startup', async () => {
    vi.mocked(store.load).mockRejectedValue(new Error('OS unlock error'));
    expect(await manager.initialize()).toMatchObject({ status: 'signed-out', message: expect.stringContaining('could not be unlocked') });
  });

  it('disables sign-in when secure storage is unavailable', async () => {
    vi.mocked(store.isAvailable).mockReturnValue(false);
    expect(await manager.startLogin()).toMatchObject({ status: 'error', qrDataUrl: null });
    expect(api.generateQr).not.toHaveBeenCalled();
  });

  it('moves through waiting, scanned, and confirmed sign-in before publishing a profile', async () => {
    vi.mocked(api.pollQr)
      .mockResolvedValueOnce({ code: 86101, credentials: null })
      .mockResolvedValueOnce({ code: 86090, credentials: null })
      .mockResolvedValueOnce({ code: 0, credentials });
    expect((await manager.startLogin()).status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getLogin().status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getLogin().status).toBe('scanned');
    expect(store.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getLogin()).toMatchObject({ status: 'success', qrDataUrl: null });
    expect(manager.getAccount()).toMatchObject({ status: 'signed-in', profile });
    expect(store.save).toHaveBeenCalledWith(credentials);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires a code when Bilibili reports expiry', async () => {
    vi.mocked(api.pollQr).mockResolvedValue({ code: 86038, credentials: null });
    await manager.startLogin();
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getLogin()).toMatchObject({ status: 'expired', qrDataUrl: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires a code locally and stops making poll requests', async () => {
    await manager.startLogin();
    await vi.advanceTimersByTimeAsync(30000);
    expect(manager.getLogin().status).toBe('expired');
    const callsAtExpiry = vi.mocked(api.pollQr).mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.pollQr).toHaveBeenCalledTimes(callsAtExpiry);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not revive a canceled QR generation when its request finishes late', async () => {
    const pending = deferred<QrCode>();
    vi.mocked(api.generateQr).mockReturnValue(pending.promise);
    const start = manager.startLogin();
    manager.cancelLogin();
    pending.resolve(qr);
    await start;
    expect(manager.getLogin()).toMatchObject({ status: 'idle', qrDataUrl: null });
    expect(encodeQr).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a late confirmed poll after the user cancels sign-in', async () => {
    const pending = deferred<QrPoll>();
    vi.mocked(api.pollQr).mockReturnValue(pending.promise);
    await manager.startLogin();
    await vi.advanceTimersByTimeAsync(1000);
    manager.cancelLogin();
    pending.resolve({ code: 0, credentials });
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getAccount().status).toBe('signed-out');
    expect(manager.getLogin().status).toBe('idle');
    expect(api.validate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('ignores a late profile validation after cancellation', async () => {
    const pending = deferred<typeof profile>();
    vi.mocked(api.pollQr).mockResolvedValue({ code: 0, credentials });
    vi.mocked(api.validate).mockReturnValue(pending.promise);
    await manager.startLogin();
    await vi.advanceTimersByTimeAsync(1000);
    manager.cancelLogin();
    pending.resolve(profile);
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getAccount().status).toBe('signed-out');
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([false, true])('rolls back a canceled credential save (existing account: %s)', async (hasExistingAccount) => {
    let persisted: Credentials | null = hasExistingAccount ? credentials : null;
    vi.mocked(store.load).mockImplementation(async () => persisted);
    vi.mocked(store.clear).mockImplementation(async () => { persisted = null; });
    await manager.initialize();
    const nextCredentials: Credentials = { cookies: { SESSDATA: 'new-private-session', bili_jct: 'new-private-csrf' }, refreshToken: 'new-private-refresh' };
    const saving = deferred<void>();
    vi.mocked(store.save).mockImplementation(async (value) => {
      if (value === nextCredentials) await saving.promise;
      persisted = value;
    });
    vi.mocked(api.pollQr).mockResolvedValue({ code: 0, credentials: nextCredentials });
    await manager.startLogin();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.save).toHaveBeenCalledWith(nextCredentials);
    manager.cancelLogin();
    saving.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getLogin().status).toBe('idle');
    expect(manager.getAccount().status).toBe(hasExistingAccount ? 'signed-in' : 'signed-out');
    expect(persisted).toEqual(hasExistingAccount ? credentials : null);
    if (hasExistingAccount) expect(store.save).toHaveBeenLastCalledWith(credentials);
    else expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it('keeps the user signed out if a previous account check finishes after sign-out', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    await manager.initialize();
    const pending = deferred<typeof profile>();
    vi.mocked(api.validate).mockReturnValue(pending.promise);
    const refresh = manager.refreshAccount();
    await manager.signOut();
    pending.resolve(profile);
    await refresh;
    expect(manager.getAccount()).toMatchObject({ status: 'signed-out', profile: null });
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(api.logout).toHaveBeenCalledWith(credentials);
  });

  it('does not restore a session if sign-out happens while startup reads the vault', async () => {
    const pending = deferred<Credentials | null>();
    vi.mocked(store.load).mockReturnValue(pending.promise);
    const initialize = manager.initialize();
    await manager.signOut();
    pending.resolve(credentials);
    await initialize;
    expect(manager.getAccount()).toMatchObject({ status: 'signed-out', profile: null });
    expect(api.validate).not.toHaveBeenCalled();
  });

  it('clears local credentials even when remote sign-out cannot be reached', async () => {
    vi.mocked(store.load).mockResolvedValue(credentials);
    await manager.initialize();
    vi.mocked(api.logout).mockRejectedValue(new Error('Offline'));
    expect(await manager.signOut()).toMatchObject({ status: 'signed-out', profile: null, message: expect.stringContaining('Signed out on this device') });
    expect(store.clear).toHaveBeenCalledTimes(1);
  });
});
