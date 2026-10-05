import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsStore, type Credentials, type SecretEncryption } from '../src/electron/credentials-store';

const credentials: Credentials = {
  cookies: { SESSDATA: 'sensitive-session', bili_jct: 'sensitive-csrf', DedeUserID: '123' },
  refreshToken: 'sensitive-refresh',
};

describe('secure credential persistence', () => {
  let fixture: string;
  let path: string;
  let encryption: SecretEncryption;

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'bili-focus-credentials-test-'));
    path = join(fixture, 'session.enc');
    encryption = {
      available: vi.fn(() => true),
      encrypt: vi.fn(async () => Buffer.from('opaque-encrypted-payload')),
      decrypt: vi.fn(async () => JSON.stringify(credentials)),
    };
  });
  afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

  it('writes only encrypted bytes and unlocks them through the encryption adapter', async () => {
    const store = new CredentialsStore(path, encryption);
    await store.save(credentials);
    const diskContents = await readFile(path, 'utf8');
    expect(diskContents).toBe(Buffer.from('opaque-encrypted-payload').toString('base64'));
    expect(diskContents).not.toContain('sensitive');
    expect(Buffer.from(diskContents, 'base64').toString()).not.toContain('SESSDATA');
    expect(encryption.encrypt).toHaveBeenCalledWith(JSON.stringify(credentials));
    expect(await store.load()).toEqual(credentials);
    expect(encryption.decrypt).toHaveBeenCalledWith(Buffer.from('opaque-encrypted-payload'));
  });

  it('refuses to store credentials when secure storage is unavailable', async () => {
    encryption.available = vi.fn(() => false);
    const store = new CredentialsStore(path, encryption);
    await expect(store.save(credentials)).rejects.toThrow('Secure credential storage is unavailable');
    expect(encryption.encrypt).not.toHaveBeenCalled();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.load()).toBeNull();
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('does not fall back to plaintext when encryption fails', async () => {
    encryption.encrypt = vi.fn(async () => { throw new Error('encryption failed'); });
    await expect(new CredentialsStore(path, encryption).save(credentials)).rejects.toThrow('encryption failed');
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('starts without an account when no encrypted session exists', async () => {
    expect(await new CredentialsStore(path, encryption).load()).toBeNull();
  });

  it('hides sensitive decryption errors behind an actionable message', async () => {
    await writeFile(path, 'encrypted');
    encryption.decrypt = vi.fn(async () => { throw new Error(`cannot unlock ${credentials.cookies.SESSDATA}`); });
    await expect(new CredentialsStore(path, encryption).load()).rejects.toThrow('Your saved session could not be unlocked. Please sign in again.');
  });

  it.each([
    { cookies: {}, refreshToken: 'refresh' },
    { cookies: { SESSDATA: 123, bili_jct: 'csrf' }, refreshToken: 'refresh' },
    { cookies: { SESSDATA: 'session', bili_jct: 'csrf' }, refreshToken: null },
  ])('rejects decrypted data without a complete session: %j', async (value) => {
    await writeFile(path, 'encrypted');
    encryption.decrypt = vi.fn(async () => JSON.stringify(value));
    expect(await new CredentialsStore(path, encryption).load()).toBeNull();
  });

  it('removes a saved session on sign-out and allows repeated clearing', async () => {
    const store = new CredentialsStore(path, encryption);
    await store.save(credentials);
    await store.clear();
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('clears credentials even when sign-out begins during slow encryption', async () => {
    let finishEncryption!: (value: Buffer) => void;
    encryption.encrypt = vi.fn(() => new Promise<Buffer>((resolve) => { finishEncryption = resolve; }));
    const store = new CredentialsStore(path, encryption);
    const save = store.save(credentials);
    await Promise.resolve();
    const clear = store.clear();
    finishEncryption(Buffer.from('opaque-encrypted-payload'));
    await Promise.all([save, clear]);
    expect(await store.load()).toBeNull();
  });
});
