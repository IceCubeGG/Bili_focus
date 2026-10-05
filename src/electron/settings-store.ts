import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/contracts';
import { sanitizeSettings } from '../core/settings';
export { sanitizeSettings } from '../core/settings';

export async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, contents, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async load(): Promise<AppSettings> {
    try { this.settings = sanitizeSettings(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.get();
  }

  get(): AppSettings { return { ...this.settings }; }

  async update(patch: unknown): Promise<AppSettings> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid preferences.');
    const next = sanitizeSettings({ ...this.settings, ...patch });
    this.settings = next;
    const contents = JSON.stringify(next, null, 2);
    const write = this.pending.then(() => atomicWrite(this.path, contents));
    this.pending = write.catch(() => {});
    await write;
    return { ...next };
  }
}
