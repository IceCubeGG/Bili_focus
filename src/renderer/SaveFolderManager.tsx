import { useEffect, useState } from 'react';
import { FolderPlus, RefreshCw } from 'lucide-react';
import { platformBridge, platformKind } from '../platform/bridge';
import type { DownloadsSnapshot, SaveFoldersSnapshot, SavedFilesSnapshot } from '../shared/contracts';
import { useI18n } from './i18n';

export default function SaveFolderManager({ onDownloadsChanged }: { onDownloadsChanged: (value: DownloadsSnapshot) => void }) {
  const { t, locale } = useI18n();
  const [folders, setFolders] = useState<SaveFoldersSnapshot>({ folders: [], activeFolderId: null });
  const [selected, setSelected] = useState(''), [files, setFiles] = useState<SavedFilesSnapshot | null>(null);
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [visible, setVisible] = useState(20);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    void platformBridge.getSaveFolders().then(value => { if (!stopped) { setFolders(value); setSelected(value.activeFolderId ?? value.folders[0]?.id ?? ''); } }).catch(error => { if (!stopped) setError(error instanceof Error ? error.message : 'Could not load saved folders.'); });
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    let stopped = false; setFiles(null); setVisible(20); setError(null);
    if (!selected) { setLoading(false); return; }
    setLoading(true);
    void platformBridge.listSavedFiles({ folderId: selected }).then(value => { if (!stopped) setFiles(value); }).catch(error => { if (!stopped) setError(error instanceof Error ? error.message : 'Could not load saved files.'); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [selected, revision]);
  const action = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : 'Folder action could not finish.'); }
    finally { setBusy(false); }
  };
  const choose = () => action(async () => {
    onDownloadsChanged(await platformBridge.chooseDownloadFolder());
    const next = await platformBridge.getSaveFolders(); setFolders(next); setSelected(next.activeFolderId ?? next.folders[0]?.id ?? ''); setRevision(value => value + 1);
  });
  const control = (actionName: 'select' | 'forget') => action(async () => {
    const next = await platformBridge.controlSaveFolder({ id: selected, action: actionName }); setFolders(next);
    onDownloadsChanged(await platformBridge.getDownloads());
    if (actionName === 'forget') setSelected(next.activeFolderId ?? next.folders[0]?.id ?? '');
  });
  const matching = (files?.files ?? []).filter(file => (kind === 'all' || file.kind === kind) && file.name.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  return <div className="save-folder-manager">
    <div className="save-folder-actions"><button className="button secondary" disabled={busy || platformKind === 'browser'} onClick={() => void choose()}><FolderPlus size={16} />{t('Add save folder')}</button>
      <button className="button secondary" disabled={busy || loading || !selected} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />{t('Refresh files')}</button></div>
    {platformKind === 'browser' && <p className="watch-muted">{t('Folder management requires the desktop or Android app.')}</p>}
    {!!folders.folders.length && <>
      <label className="save-folder-label">{t('Browse saved folders')}<select aria-label={t('Browse saved folders')} disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); setQuery(''); }}>
        {folders.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.label}{folder.id === folders.activeFolderId ? ` · ${t('Download destination')}` : ''}</option>)}
      </select></label>
      <p className="download-file">{folders.folders.find(folder => folder.id === selected)?.location}</p>
      <div className="save-folder-actions"><button className="button secondary" disabled={busy || selected === folders.activeFolderId} onClick={() => void control('select')}>{selected === folders.activeFolderId ? t('Download destination') : t('Use for new downloads')}</button>
        <button className="text-button" disabled={busy} onClick={() => void control('forget')}>{t('Forget folder')}</button></div>
      <p className="watch-muted">{t('Forgetting a folder never deletes files. Queued downloads keep their original destination. Browsing a folder does not change the download destination.')}</p>
      <div className="saved-file-filters"><input type="search" aria-label={t('Search saved files')} placeholder={t('Search saved files')} value={query} onChange={event => { setQuery(event.target.value); setVisible(20); }} />
        <select aria-label={t('File type')} value={kind} onChange={event => { setKind(event.target.value); setVisible(20); }}><option value="all">{t('Videos and covers')}</option><option value="video">{t('Videos')}</option><option value="cover">{t('Covers')}</option></select></div>
      {loading ? <p role="status" className="watch-muted">{t('Loading saved files…')}</p> : files && <>
        <p className="watch-muted">{t('{0} saved files', { 0: matching.length.toLocaleString(locale) })} · {t('Videos and images directly in this folder. Open uses your installed player or image viewer.')}</p>
        {files.truncated && <p role="status" className="watch-muted">{t('Large folder: only the first 1,000 media files or 10,000 directory entries were scanned. Choose a smaller folder to see the rest.')}</p>}
        <div className="saved-file-list">{matching.slice(0, visible).map(file => <article className="saved-file" key={file.id}><div><strong>{file.name}</strong><span>{file.kind === 'video' ? t('Video') : t('Cover')} · {t('{0} MiB', { 0: (file.bytes / 1048576).toLocaleString(locale, { maximumFractionDigits: 1 }) })}{file.modifiedAt > 0 ? ` · ${new Date(file.modifiedAt).toLocaleDateString(locale)}` : ''}</span></div>
          <button className="button secondary" disabled={busy} onClick={() => void action(() => platformBridge.openSavedFile({ folderId: selected, fileId: file.id }))}>{t('Open file')}</button></article>)}</div>
        {!matching.length && <p className="watch-muted">{t('No matching videos or covers in this folder.')}</p>}
        {matching.length > visible && <button className="button secondary" onClick={() => setVisible(value => value + 20)}>{t('Show more files')}</button>}
      </>}
    </>}
    {error && <p className="feed-error" role="alert">{t(error)}</p>}
  </div>;
}
