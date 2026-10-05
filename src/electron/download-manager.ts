import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, open, link, unlink, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { DownloadJob, DownloadsSnapshot } from '../shared/contracts';
import { COVER_LIMIT, VIDEO_LIMIT, downloadName, downloadRequest, downloadType } from '../core/downloads';
import { atomicWrite } from './settings-store';
import type { VideoClient } from './video-client';

/** Only native-resolved sources, one worker, exclusive staging and no overwrite. */
export class DownloadManager {
  private folder: string | null = null;
  private jobs: DownloadJob[] = [];
  private busy = false;
  private active: AbortController | null = null;
  private closed = false;
  private loadError: string | null = null;
  private saveTail = Promise.resolve();
  private revision: number;
  constructor(private readonly path: string, private readonly videos: VideoClient, private readonly accountRevision: () => number) { this.revision = accountRevision(); }
  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.jobs) || saved.jobs.length > 50 || !(saved.folder === null || typeof saved.folder === 'string' && isAbsolute(saved.folder))) throw new Error();
      this.folder = saved.folder;
      this.jobs = saved.jobs.map((value: DownloadJob) => {
        const request = downloadRequest(value);
        if (!/^[a-f0-9-]{36}$/.test(value.id) || typeof value.title !== 'string' || value.title.length > 400 || !['queued','running','completed','failed','cancelled'].includes(value.state) || !Array.isArray(value.files) || value.files.length > 50 || value.files.some(file => typeof file !== 'string' || !isAbsolute(file)) || !Number.isSafeInteger(value.createdAt)) throw new Error();
        return { ...request, id: value.id, title: value.title, createdAt: value.createdAt, files: value.files, downloadedBytes: 0, totalBytes: null, state: ['queued','running'].includes(value.state) ? 'failed' : value.state, error: ['queued','running'].includes(value.state) ? 'App closed before completion. Retry starts again with fresh access.' : value.state === 'failed' ? 'Download failed. Retry or remove it.' : null } as DownloadJob;
      });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.loadError = 'Saved download history could not be restored. It has been preserved; downloads are paused until it is repaired.'; throw new Error(this.loadError); } }
  }
  get(): DownloadsSnapshot { if (this.loadError) throw new Error(this.loadError); return structuredClone({ folder: this.folder, jobs: this.jobs }); }
  private save(): Promise<void> { const data = JSON.stringify({ version: 1, ...this.get() }); const saved = this.saveTail.then(() => atomicWrite(this.path, data)); this.saveTail = saved.catch(() => {}); return saved; }
  async chooseFolder(path: string): Promise<DownloadsSnapshot> {
    this.get();
    if (!isAbsolute(path)) throw new Error('Select a folder through the system picker.');
    const resolved = await realpath(path); if (!(await stat(resolved)).isDirectory()) throw new Error('Select a folder.');
    this.folder = resolved; await this.save(); return this.get();
  }
  syncAccount(): void {
    if (this.revision === this.accountRevision()) return;
    this.revision = this.accountRevision(); this.active?.abort();
    for (const job of this.jobs) if (['queued','running'].includes(job.state)) { job.state = 'cancelled'; job.error = 'Account changed. Retry explicitly to use current access.'; }
    if (!this.loadError) void this.save().catch(() => {});
  }
  close(): void { this.closed = true; this.active?.abort(); }
  async start(value: unknown): Promise<DownloadsSnapshot> {
    this.get();
    const input = downloadRequest(value); if (!this.folder) throw new Error('Choose a save folder in Options first.');
    if (this.jobs.length >= 50) throw new Error('Remove old queue entries before adding more (maximum 50).');
    if (this.jobs.some(job => job.bvid === input.bvid && job.cid === input.cid && job.kind === input.kind && ['queued','running'].includes(job.state))) throw new Error('This item is already queued.');
    this.jobs.unshift({ ...input, id: randomUUID(), title: input.bvid, state: 'queued', downloadedBytes: 0, totalBytes: null, files: [], error: null, createdAt: Date.now() });
    await this.save(); this.pump(); return this.get();
  }
  async control(value: unknown): Promise<DownloadsSnapshot> {
    this.get();
    const input = value as { id: string; action: string }, job = this.jobs.find(job => job.id === input?.id); if (!job) throw new Error('Queue item not found.');
    if (input.action === 'cancel' && ['queued','running'].includes(job.state)) { if (job.state === 'running') this.active?.abort(); job.state = 'cancelled'; job.error = null; }
    else if (input.action === 'retry' && ['failed','cancelled'].includes(job.state)) { if (this.busy && job.state === 'cancelled' && this.active?.signal.aborted) throw new Error('Wait for cancellation to finish.'); job.state = 'queued'; job.error = null; job.downloadedBytes = 0; job.totalBytes = null; }
    else if (input.action === 'remove' && !['queued','running'].includes(job.state)) this.jobs = this.jobs.filter(value => value !== job);
    else throw new Error('This queue action is unavailable.');
    await this.save(); this.pump(); return this.get();
  }
  private pump(): void {
    if (this.busy || this.closed) return; const job = [...this.jobs].reverse().find(job => job.state === 'queued'); if (!job) return;
    this.busy = true; const controller = new AbortController(); this.active = controller; job.state = 'running'; const folder = this.folder!, revision = this.accountRevision();
    void this.run(job, folder, controller, revision).finally(async () => { this.active = null; this.busy = false; await this.save().catch(() => {}); this.pump(); });
  }
  private async run(job: DownloadJob, folder: string, controller: AbortController, revision: number): Promise<void> {
    const staged: string[] = [], outputs: string[] = []; let handle: string | null = null;
    const check = () => { if (controller.signal.aborted || job.state !== 'running' || revision !== this.accountRevision()) throw new Error('Download cancelled.'); };
    try {
      await mkdir(folder, { recursive: true }); check(); const details = await this.videos.getVideoDetails({ bvid: job.bvid }); check(); job.title = details.title;
      const playback = job.kind === 'video' ? await this.videos.getVideoPlayback({ bvid: job.bvid, cid: job.cid, format: 'progressive' }) : null;
      if (playback) handle = playback.handle; check(); const sources = playback?.sources.map(source => source.url) ?? ['cover'];
      const destinations: string[] = [];
      for (let index = 0; index < sources.length; index++) {
        check(); const response = job.kind === 'video' ? await this.videos.stream(new Request(sources[index], { signal: controller.signal })) : await this.videos.coverStream({ bvid: job.bvid }, controller.signal);
        if (response.status !== 200 || !response.body) throw new Error('The download source is unavailable.');
        const limit = job.kind === 'video' ? VIDEO_LIMIT : COVER_LIMIT, length = Number(response.headers.get('Content-Length'));
        if (!Number.isSafeInteger(length) || length <= 0 || length > limit) { await response.body.cancel(); throw new Error('Invalid or oversized file (video: 2 GiB per segment; cover: 20 MiB).'); }
        job.totalBytes = (job.totalBytes ?? 0) + length;
        const temporary = join(folder, `.bili-${randomUUID()}.part`); const output = await open(temporary, 'wx'); staged.push(temporary);
        const reader = response.body.getReader(); let count = 0, first = new Uint8Array(), stalled: ReturnType<typeof setTimeout> | undefined;
        try {
          while (true) {
            check(); stalled = setTimeout(() => controller.abort(), 30000); const chunk = await reader.read(); clearTimeout(stalled); check(); if (chunk.done) break;
            count += chunk.value.length; if (count > length) throw new Error('Unexpected download length.');
            if (first.length < 32) { const combined = new Uint8Array(first.length + Math.min(chunk.value.length, 32 - first.length)); combined.set(first); combined.set(chunk.value.subarray(0, combined.length - first.length), first.length); first = combined; }
            let offset = 0; while (offset < chunk.value.length) { const written = await output.write(chunk.value, offset, chunk.value.length - offset); if (!written.bytesWritten) throw new Error('Could not write the file.'); offset += written.bytesWritten; }
            job.downloadedBytes += chunk.value.length;
          }
          if (count !== length) throw new Error('Incomplete file. Retry starts again.');
          const type = downloadType(first, job.kind), mime = response.headers.get('Content-Type')?.split(';')[0].trim();
          if (mime !== type.mime && mime !== 'application/octet-stream') throw new Error('File type did not match its contents.');
          await output.sync(); const suffix = sources.length > 1 ? `-segment${index + 1}` : '';
          destinations.push(join(folder, `${downloadName(details.title)}-${job.bvid}${job.cid ? `-P${details.parts.find(part => part.cid === job.cid)!.page}` : '-cover'}${suffix}-${randomUUID().slice(0, 8)}.${type.extension}`));
        } finally { clearTimeout(stalled); await reader.cancel().catch(() => {}); await output.close(); }
      }
      check(); for (let index = 0; index < staged.length; index++) {
        check();
        try { await link(staged[index], destinations[index]); }
        catch (error) {
          // exFAT/FAT and some document/share folders do not support hard links.
          // Exclusive copy still cannot overwrite a user's existing file.
          if (!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await copyFile(staged[index], destinations[index], constants.COPYFILE_EXCL);
        }
        outputs.push(destinations[index]);
        if ((await stat(destinations[index])).size !== (await stat(staged[index])).size) throw new Error('The saved file is incomplete.');
      }
      check(); job.files = outputs; job.state = 'completed'; job.error = null;
    } catch (error) {
      controller.abort(); for (const path of outputs) await unlink(path).catch(() => {});
      job.state = job.state === 'cancelled' || revision !== this.accountRevision() ? 'cancelled' : 'failed'; job.error = error instanceof Error ? error.message : 'Download failed. Retry or choose another folder.'; job.files = [];
    } finally { if (handle) this.videos.releaseVideoPlayback({ handle }); for (const path of staged) await unlink(path).catch(() => {}); }
  }
}
