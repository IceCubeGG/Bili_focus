import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptySubscriptionGroups, validateSubscriptionGroups } from '../core/subscription-groups';
import { atomicWrite } from './settings-store';
import type { SubscriptionGroups } from '../shared/contracts';

/** Separate nonsecret files per account; no renderer-controlled paths. */
export class SubscriptionGroupStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}
  private path(uid: string): string {
    if (!/^[1-9]\d{0,19}$/.test(uid)) throw new Error('Sign in to manage subscription groups.');
    return join(this.directory, `subscribe-groups-${uid}.json`);
  }
  async get(uid: string): Promise<SubscriptionGroups> {
    try {
      const value = await readFile(this.path(uid), 'utf8');
      if (Buffer.byteLength(value) > 512000) throw new Error('Saved subscription groups are too large.');
      return validateSubscriptionGroups(JSON.parse(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySubscriptionGroups();
      throw new Error('Saved subscription groups could not be loaded. No group selection has been applied.');
    }
  }
  async update(uid: string, input: unknown): Promise<SubscriptionGroups> {
    const path = this.path(uid); const next = validateSubscriptionGroups(input);
    const write = this.pending.then(() => atomicWrite(path, JSON.stringify(next)));
    this.pending = write.catch(() => {}); await write;
    return structuredClone(next);
  }
}
