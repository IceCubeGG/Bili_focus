import { useI18n } from './i18n';
import { useEffect, useState } from 'react';
import { Download, FolderClosed, LoaderCircle } from 'lucide-react';
import { platformBridge, platformKind } from '../platform/bridge';
import type { DownloadsSnapshot } from '../shared/contracts';
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export default function DownloadsPanel() {
  const { t, locale } = useI18n();
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot>({ folder: null, jobs: [] });
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false, loading = false;
    const refresh = async () => { if (loading) return; loading = true; try { const value = await platformBridge.getDownloads(); if (!stopped) setSnapshot(value); } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : 'Could not load the download queue.'); } finally { loading = false; } };
    void refresh(); const timer = setInterval(() => void refresh(), 800); return () => { stopped = true; clearInterval(timer); };
  }, []);
  const act = async (operation: () => Promise<DownloadsSnapshot>) => { setBusy(true); setError(null); try { setSnapshot(await operation()); } catch (error) { setError(error instanceof Error ? error.message : 'Download action could not finish.'); } finally { setBusy(false); } };
  return <section className="settings-card download-card" aria-labelledby="downloads-title"><div className="settings-card-heading"><div className="card-heading-icon"><FolderClosed size={18} /></div><h2 id="downloads-title">{t("Save folder & downloads")}</h2></div>
    <p className="download-folder">{snapshot.folder ?? t("Choose a folder before downloading.")}</p><button className="button secondary" disabled={busy || platformKind === 'browser'} onClick={() => void act(() => platformBridge.chooseDownloadFolder())}><FolderClosed size={16} />{snapshot.folder ? t("Change folder") : t("Choose save folder")}</button>
    <p className="watch-muted">{t("Download the selected video part or its cover from the video page. Only save content you have permission to keep. Retries restart from the beginning; downloads run while this app is open. Removing an entry never deletes completed files.")}</p>
    {error && <p className="feed-error" role="alert">{t(error)}</p>}
    <div className="download-queue">{snapshot.jobs.map(job => <article className="download-job" key={job.id} data-download-id={job.id}><div><strong>{job.title}</strong><span>{job.kind === 'cover' ? t("Cover") : t("Video part")} · {t(job.state)}{job.state === "running" ? ` · ${size(job.downloadedBytes)}${job.totalBytes ? ` / ${size(job.totalBytes)}` : ''}` : ''}</span></div>
      {job.state === "running" && <><LoaderCircle className="spin" size={16} /><progress max={job.totalBytes ?? undefined} value={job.totalBytes ? job.downloadedBytes : undefined} aria-label={t("Downloading {0}", { 0: job.title })} /></>}
      {job.files.map(file => <p className="download-file" key={file}>{file}</p>)}{job.error && <p className="feed-error">{t(job.error)}</p>}
      <div>{['queued','running'].includes(job.state) ? <button className="text-button" disabled={busy} onClick={() => void act(() => platformBridge.controlDownload({ id: job.id, action: 'cancel' }))}>{t("Cancel")}</button> : <>{['failed','cancelled'].includes(job.state) && <button className="text-button" disabled={busy} onClick={() => void act(() => platformBridge.controlDownload({ id: job.id, action: 'retry' }))}>{t("Retry from start")}</button>}<button className="text-button" disabled={busy} onClick={() => void act(() => platformBridge.controlDownload({ id: job.id, action: 'remove' }))}>{t("Remove entry")}</button></>}</div>
    </article>)}{!snapshot.jobs.length && <p className="watch-muted"><Download size={15} /> {t("Your download queue is empty.")}</p>}</div>
  </section>;
}
