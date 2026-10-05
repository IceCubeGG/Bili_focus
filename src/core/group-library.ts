import type { UploaderVideoPage, VideoCandidate } from '../shared/contracts';
import { mergeUploaderVideos, publicationTime } from './subscriptions';

type CreatorState = { id: string; initialized: boolean; cursor: string | null; ended: boolean; total: number; buffer: VideoCandidate[] };
type LoadCreator = (options: { uploaderId: string; cursor: string | null }) => Promise<UploaderVideoPage>;
export type GroupLibraryProgress = { loaded: number; total: number };

/** Merge creator libraries chronologically while preserving each creator's independent cursor. */
export class GroupLibraryPager {
  private creators: CreatorState[];
  private seen = new Set<string>();
  // Keep successful requests from a failed transaction so retry only refetches failures.
  private pendingPages = new Map<string, UploaderVideoPage>();
  private cancelled = false;
  private busy = false;
  private pageNumber = 0;

  constructor(uploaderIds: readonly string[], private readonly loadCreator: LoadCreator, private readonly progress: (value: GroupLibraryProgress) => void = () => {}) {
    const ids = [...new Set(uploaderIds)].sort();
    if (ids.length > 500 || ids.some(id => !/^[1-9]\d{0,19}$/.test(id))) throw new Error('Choose valid creators for this group.');
    this.creators = ids.map(id => ({ id, initialized: false, cursor: null, ended: false, total: 0, buffer: [] }));
  }

  cancel(): void { this.cancelled = true; this.pendingPages.clear(); }
  private current(): void { if (this.cancelled) throw new Error('The selected group changed.'); }

  private async fill(creator: CreatorState): Promise<void> {
    this.current();
    const requestCursor = creator.initialized ? creator.cursor : null;
    const key = `${creator.id}:${requestCursor ?? 'first'}`;
    let page = this.pendingPages.get(key);
    if (!page) {
      try { page = await this.loadCreator({ uploaderId: creator.id, cursor: requestCursor }); }
      catch (error) {
        this.current();
        throw new Error(`Could not load group member UID ${creator.id}. ${error instanceof Error ? error.message : 'Please retry.'}`);
      }
      this.current();
      const nextPage = requestCursor === null ? 2 : Number(requestCursor) + 1;
      if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 1000000000 || !Array.isArray(page.videos) || page.videos.length > 30
        || typeof page.hasMore !== 'boolean' || (page.hasMore ? page.cursor !== String(nextPage) : page.cursor !== null)) {
        throw new Error(`The video library for UID ${creator.id} returned an unexpected page. Please retry.`);
      }
      this.pendingPages.set(key, page);
    }
    creator.initialized = true; creator.total = page.total; creator.cursor = page.cursor; creator.ended = !page.hasMore;
    creator.buffer = mergeUploaderVideos([], page.videos.filter(video => video.uploader.id === creator.id));
  }

  private async fillHeads(creators: CreatorState[]): Promise<void> {
    // Two native page calls at once leave room for directory/account work.
    const pending = creators.filter(creator => !creator.buffer.length && !creator.ended);
    let index = 0, failed = false, failure: unknown;
    const worker = async () => {
      while (index < pending.length && !failed) {
        const creator = pending[index++];
        try {
          await this.fill(creator);
          this.current();
          this.progress({ loaded: creators.filter(value => value.initialized).length, total: creators.length });
        } catch (error) { if (!failed) { failed = true; failure = error; } }
      }
    };
    // Drain started requests before rejecting so retries cannot flood the native host.
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker));
    if (failed) throw failure;
    this.current();
  }

  async loadPage(): Promise<UploaderVideoPage> {
    this.current();
    if (this.busy) throw new Error('Wait for the current group page to finish.');
    this.busy = true;
    try {
      // Commit buffers, cursors and emitted IDs together only when this page succeeds.
      const creators = this.creators.map(creator => ({ ...creator, buffer: [...creator.buffer] }));
      const seen = new Set(this.seen), videos: VideoCandidate[] = [];
      while (videos.length < 30) {
        await this.fillHeads(creators);
        // An empty filtered page can still have a next native page. Resolve its
        // head before selecting another creator, preserving the global ordering.
        if (creators.some(creator => !creator.buffer.length && !creator.ended)) continue;
        const heads = creators.filter(creator => creator.buffer.length);
        if (!heads.length) break;
        const creator = heads.reduce((latest, value) => publicationTime(value.buffer[0]) > publicationTime(latest.buffer[0]) ? value : latest);
        const video = creator.buffer.shift()!;
        if (!seen.has(video.bvid)) { seen.add(video.bvid); videos.push(video); }
      }
      this.current();
      this.creators = creators; this.seen = seen; this.pageNumber++; this.pendingPages.clear();
      const hasMore = creators.some(creator => creator.buffer.length || !creator.ended);
      return { videos, total: creators.reduce((sum, creator) => sum + creator.total, 0), hasMore, cursor: hasMore ? String(this.pageNumber + 1) : null };
    } finally { this.busy = false; }
  }
}
