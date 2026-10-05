import { readFile, rm } from 'node:fs/promises';
import { atomicWrite } from './settings-store';

import type { Credentials } from '../core/account-ports';
export type { Credentials } from '../core/account-ports';

export interface SecretEncryption {
  available(): boolean;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class CredentialsStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: string, private readonly encryption: SecretEncryption) {}
  isAvailable(): boolean { return this.encryption.available(); }

  async load(): Promise<Credentials | null> {
    if (!this.isAvailable()) return null;
    let encoded: string;
    try { encoded = await readFile(this.path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const data = JSON.parse(await this.encryption.decrypt(Buffer.from(encoded, 'base64'))) as Credentials;
      if (!data.cookies || typeof data.cookies.SESSDATA !== 'string' || typeof data.cookies.bili_jct !== 'string' || typeof data.refreshToken !== 'string') return null;
      return data;
    } catch { throw new Error('Your saved session could not be unlocked. Please sign in again.'); }
  }

  async save(credentials: Credentials): Promise<void> {
    if (!this.isAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
    const write = this.pending.then(async () => {
      const encrypted = await this.encryption.encrypt(JSON.stringify(credentials));
      await atomicWrite(this.path, encrypted.toString('base64'));
    });
    this.pending = write.catch(() => {});
    await write;
  }

  async clear(): Promise<void> {
    const clear = this.pending.then(() => rm(this.path, { force: true }));
    this.pending = clear.catch(() => {});
    await clear;
  }
}
