import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_BROWSE_SETTINGS, type BrowseSettings } from '../shared/contracts';
import { sanitizeBrowseSettings } from '../core/browse-settings';
import { atomicWrite } from './settings-store';

export class BrowseStore {
  private settings: BrowseSettings = structuredClone(DEFAULT_BROWSE_SETTINGS);
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async load(): Promise<BrowseSettings> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Saved recommendation presets are invalid.');
      const document = saved as Record<string, unknown>;
      if (document.version !== 1 || !Array.isArray(document.presets) || (document.activePresetId !== null && typeof document.activePresetId !== 'string')) throw new Error('Saved recommendation presets are invalid.');
      const settings = sanitizeBrowseSettings(document);
      if (document.activePresetId !== null && settings.activePresetId !== document.activePresetId) throw new Error('The saved active recommendation preset could not be restored.');
      if (!isDeepStrictEqual(document, settings)) throw new Error('Saved recommendation rules could not be restored without changes.');
      this.settings = settings;
    }
    catch (error) {
      // Only a genuinely new profile defaults to an unrestricted feed. Existing
      // preferences that cannot be restored must surface an error to the renderer.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.settings = structuredClone(DEFAULT_BROWSE_SETTINGS);
    }
    return this.get();
  }

  get(): BrowseSettings { return structuredClone(this.settings); }

  async update(input: unknown): Promise<BrowseSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid recommendation presets.');
    const next = sanitizeBrowseSettings(input);
    const contents = JSON.stringify(next, null, 2);
    const write = this.pending.then(async () => {
      await atomicWrite(this.path, contents);
      this.settings = next;
    });
    this.pending = write.catch(() => {});
    await write;
    return structuredClone(next);
  }
}
