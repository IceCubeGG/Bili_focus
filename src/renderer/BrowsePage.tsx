import { useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleHelp, LoaderCircle, Plus, RefreshCw, SlidersHorizontal, Tag, Trash2, UserPlus, UsersRound, WifiOff, X } from 'lucide-react';
import { DEFAULT_BROWSE_SETTINGS, type AccountSnapshot, type BrowsePreset, type BrowseSettings, type PlatformInfo, type VideoCandidate, type VideoLabels } from '../shared/contracts';
import { platformBridge } from '../platform/bridge';
import { sanitizeBrowseSettings } from '../core/browse-settings';
import { filterCandidates } from '../core/recommendations';

const failure = (error: unknown) => error instanceof Error ? error.message : 'Could not reach Bilibili. Please try again.';
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const count = (value: number, locale: string) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const newPreset = (): BrowsePreset => ({ id: crypto.randomUUID(), name: 'My preset', labels: [], uploaders: [], match: 'all' });

function CandidateCard({ video, labels, onLabels, onUploader, openVideo }: { video: VideoCandidate; labels?: VideoLabels; onLabels: () => void; onUploader: () => void; openVideo: (bvid: string) => void }) {
  const { t, locale } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  return <article className="video-card live-video-card" data-bvid={video.bvid} data-uploader-id={video.uploader.id}>
    <button className="video-thumbnail live-thumbnail video-open" onClick={() => openVideo(video.bvid)} aria-label={t("Watch {0}", { 0: video.title })}>
      {video.cover && !imageFailed ? <img src={video.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <span className="cover-fallback">Bili Focus</span>}
      <span className="video-duration">{duration(video.durationSeconds)}</span>
    </button>
    <div className="video-content">
      <span className="video-category">{count(video.views, locale)} {t("views")}{video.publishedAt ? ` · ${new Date(video.publishedAt).toLocaleDateString(locale)}` : ''}</span>
      <h3 title={video.title}><button className="video-title-open" onClick={() => openVideo(video.bvid)}>{video.title}</button></h3>
      <div className="video-uploader"><span>{video.uploader.name}</span><button className="icon-button" onClick={onUploader} aria-label={t("Add {0} to a preset", { 0: video.uploader.name })} title={t("Add uploader to a preset")}><UserPlus size={16} /></button></div>
      <div className="video-labels">
        {labels?.status === 'ready' ? labels.labels.slice(0, 4).map(label => <span key={label}>{label}</span>) : <button className="text-button" onClick={onLabels}><Tag size={13} />{labels?.status === 'unavailable' ? t("Retry tags") : t("View tags")}</button>}
        {labels?.status === 'ready' && !labels.labels.length && <span>{t("No tags supplied")}</span>}
      </div>
    </div>
  </article>;
}

function PresetEditor({ settings, initial, candidates, availableLabels, saving, saveError, onSave, onDelete, close }: {
  settings: BrowseSettings; initial: BrowsePreset; candidates: VideoCandidate[]; availableLabels: string[]; saving: boolean; saveError: string | null;
  onSave: (preset: BrowsePreset) => void; onDelete: (id: string) => void; close: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<BrowsePreset>(structuredClone(initial));
  const [labelText, setLabelText] = useState('');
  const [uploaderId, setUploaderId] = useState('');
  const [uploaderName, setUploaderName] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const addLabel = (value: string) => {
    const label = value.trim();
    if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) { setValidation("Enter a tag with 1–80 characters and no control characters."); return; }
    if (draft.labels.length >= 30) { setValidation("A preset can contain up to 30 tags."); return; }
    setDraft(old => ({ ...old, labels: old.labels.some(item => item.toLowerCase() === label.toLowerCase()) ? old.labels : [...old.labels, label] }));
    setLabelText(''); setValidation(null);
  };
  const addUploader = (id: string, name: string) => {
    if (!/^[1-9]\d{0,19}$/.test(id.trim())) { setValidation('Enter the uploader’s numeric Bilibili UID.'); return; }
    if (draft.uploaders.length >= 50) { setValidation('A preset can contain up to 50 uploaders.'); return; }
    setDraft(old => ({ ...old, uploaders: old.uploaders.some(item => item.id === id.trim()) ? old.uploaders : [...old.uploaders, { id: id.trim(), name: name.trim().slice(0, 80) || `UID ${id.trim()}` }] }));
    setUploaderId(''); setUploaderName(''); setValidation(null);
  };
  const submit = () => {
    if (!draft.name.trim()) { setValidation('Give this preset a name.'); return; }
    if (!draft.labels.length && !draft.uploaders.length) { setValidation("Choose at least one tag or uploader. An empty allowlist shows no videos."); return; }
    onSave({ ...draft, name: draft.name.trim() });
  };
  const creatorChoices = [...new Map(candidates.map(video => [video.uploader.id, video.uploader])).values()].slice(0, 20);
  return <dialog className="preset-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!saving) close(); }} aria-labelledby="preset-title">
    <div className="preset-dialog-heading"><div><span className="eyebrow">{t("YOUR RECOMMENDATION RULES")}</span><h2 id="preset-title">{t("Feed settings")}</h2></div><button className="icon-button" onClick={close} disabled={saving} aria-label={t("Close feed settings")}><X size={20} /></button></div>
    <div className="preset-editor-layout">
      <aside className="preset-list" aria-label={t("Saved presets")}>
        {settings.presets.map(preset => <button key={preset.id} className={draft.id === preset.id ? 'selected' : ''} onClick={() => { setDraft(structuredClone(preset)); setValidation(null); }} disabled={saving}>{preset.name}{settings.activePresetId === preset.id && <Check size={15} />}</button>)}
        <button className="new-preset" disabled={saving || settings.presets.length >= 20} onClick={() => { setDraft(newPreset()); setValidation(null); }}><Plus size={16} />{t("New preset")}</button>
      </aside>
      <div className="preset-form">
        <label className="field-label">{t("Preset name")}<input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="field-label">{t("When both lists contain choices")}<select value={draft.match} onChange={event => setDraft({ ...draft, match: event.target.value as BrowsePreset['match'] })}><option value="all">{t("Tag AND uploader")}</option><option value="any">{t("Tag OR uploader")}</option></select></label>
        <p className="preset-help">{t("Any tag in the tag list can match. Any UID in the uploader list can match. Tags use Bilibili’s video tags, rather than words in the title.")}</p>
        <section className="preset-field"><h3><Tag size={16} />{t("Allowed tags")} <span>{draft.labels.length}/30</span></h3>
          <div className="entry-row"><input aria-label={t("Tag name")} placeholder={t("Exact video tag, e.g. 科技")} value={labelText} maxLength={80} onChange={event => setLabelText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addLabel(labelText); } }} /><button className="button secondary" onClick={() => addLabel(labelText)}><Plus size={16} />{t("Add")}</button></div>
          <div className="selected-rules">{draft.labels.map(label => <button key={label} onClick={() => setDraft({ ...draft, labels: draft.labels.filter(item => item !== label) })} aria-label={t("Remove tag {0}", { 0: label })}>{label}<X size={12} /></button>)}</div>
          {availableLabels.length > 0 && <div className="rule-suggestions"><span>{t("Tags from loaded videos")}</span>{availableLabels.slice(0, 25).map(label => <button key={label} disabled={draft.labels.some(item => item.toLowerCase() === label.toLowerCase())} onClick={() => addLabel(label)}>{label}</button>)}</div>}
        </section>
        <section className="preset-field"><h3><UsersRound size={16} />{t("Allowed uploaders")} <span>{draft.uploaders.length}/50</span></h3>
          <div className="entry-row uploader-entry"><input aria-label={t("Uploader UID")} inputMode="numeric" placeholder={t("Bilibili UID")} value={uploaderId} maxLength={20} onChange={event => setUploaderId(event.target.value)} /><input aria-label={t("Uploader display name")} placeholder={t("Display name (optional)")} value={uploaderName} maxLength={80} onChange={event => setUploaderName(event.target.value)} /><button className="button secondary" onClick={() => addUploader(uploaderId, uploaderName)}><Plus size={16} />{t("Add")}</button></div>
          <div className="selected-rules">{draft.uploaders.map(uploader => <button key={uploader.id} title={`UID ${uploader.id}`} onClick={() => setDraft({ ...draft, uploaders: draft.uploaders.filter(item => item.id !== uploader.id) })} aria-label={t("Remove uploader {0}", { 0: uploader.name })}>{uploader.name}<X size={12} /></button>)}</div>
          {creatorChoices.length > 0 && <div className="rule-suggestions"><span>{t("Uploaders from this feed")}</span>{creatorChoices.map(uploader => <button key={uploader.id} disabled={draft.uploaders.some(item => item.id === uploader.id)} onClick={() => addUploader(uploader.id, uploader.name)}>{uploader.name}</button>)}</div>}
        </section>
        {(validation || saveError) && <p className="feed-error" role="alert">{t(validation || saveError || "")}</p>}
        <div className="preset-editor-actions"><button className="button primary" onClick={submit} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{t("Save and apply")}</button><button className="button secondary" onClick={close} disabled={saving}>{t("Cancel")}</button>
          {settings.presets.some(preset => preset.id === draft.id) && <button className="button subtle" onClick={() => onDelete(draft.id)} disabled={saving || settings.activePresetId === draft.id}><Trash2 size={15} />{t("Delete preset")}</button>}
        </div>
        {settings.activePresetId === draft.id && <p className="preset-help">{t("Choose another preset before deleting the active one.")}</p>}
      </div>
    </div>
  </dialog>;
}

export default function BrowsePage({ account, compactCards, platform, openVideo }: { account: AccountSnapshot; compactCards: boolean; platform: PlatformInfo; openVideo: (bvid: string) => void }) {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<BrowseSettings>(DEFAULT_BROWSE_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<BrowsePreset | null>(null);
  const [videos, setVideos] = useState<VideoCandidate[]>([]);
  const [labels, setLabels] = useState<Record<string, VideoLabels>>({});
  const labelsRef = useRef<Record<string, VideoLabels>>({});
  const labelPending = useRef(new Set<string>());
  const [labelRequests, setLabelRequests] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const cursor = useRef<string | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const native = platform.kind !== 'browser';
  const session = `${account.profile?.uid ?? 'guest'}:${account.status === 'expired' ? 'expired' : 'available'}`;
  const active = settings.presets.find(preset => preset.id === settings.activePresetId) ?? null;
  // Never show an unfiltered fallback while a saved allowlist is still loading.
  const visible = useMemo(() => settingsReady ? filterCandidates(videos, labels, active) : [], [settingsReady, videos, labels, active]);

  useEffect(() => {
    let current = true;
    platformBridge.getBrowseSettings().then(value => { if (current) { setSettings(sanitizeBrowseSettings(value)); setSettingsReady(true); } }).catch(() => { if (current) setSettingsError('Feed settings could not be loaded. Restart the app before changing them.'); });
    return () => { current = false; };
  }, []);

  const loadPage = useCallback(async (reset: boolean) => {
    if (!native || (busy.current && !reset)) return;
    const current = reset ? ++epoch.current : epoch.current;
    busy.current = true; setLoading(true); setError(null);
    if (reset) { cursor.current = null; setVideos([]); setHasMore(true); labelsRef.current = {}; labelPending.current.clear(); setLabels({}); setLabelRequests(0); }
    try {
      const page = await platformBridge.getRecommendationPage({ cursor: cursor.current });
      if (current !== epoch.current) return;
      setVideos(previous => [...new Map([...(reset ? [] : previous), ...page.videos].map(video => [video.bvid, video])).values()].slice(0, 400));
      cursor.current = page.cursor; setHasMore(page.hasMore && page.cursor !== null);
    } catch (failureValue) { if (current === epoch.current) setError(failure(failureValue)); }
    finally { if (current === epoch.current) { busy.current = false; setLoading(false); } }
  }, [native]);

  useEffect(() => { void loadPage(true); return () => { epoch.current++; busy.current = false; }; }, [loadPage, session]);

  const loadLabels = useCallback(async (bvids: string[], retry = false) => {
    const ids = [...new Set(bvids)].filter(bvid => !labelPending.current.has(bvid) && (retry || !labelsRef.current[bvid]));
    if (!ids.length) return;
    const current = epoch.current;
    ids.forEach(id => labelPending.current.add(id)); setLabelRequests(old => old + 1);
    try {
      for (let start = 0; start < ids.length; start += 20) {
        if (current !== epoch.current) break;
        const batch = ids.slice(start, start + 20);
        let response: VideoLabels[];
        try { response = await platformBridge.getVideoLabels({ bvids: batch }); }
        catch { response = []; }
        if (current !== epoch.current) break;
        const result: Record<string, VideoLabels> = {};
        for (const bvid of batch) result[bvid] = response.find(value => value.bvid === bvid) ?? { bvid, labels: [], status: 'unavailable' };
        labelsRef.current = { ...labelsRef.current, ...result }; setLabels(labelsRef.current);
      }
    } finally { if (current === epoch.current) { ids.forEach(id => labelPending.current.delete(id)); setLabelRequests(old => Math.max(0, old - 1)); } }
  }, []);

  const labelRule = active?.labels.join('\u0000') ?? '';
  useEffect(() => { if (labelRule) void loadLabels(videos.map(video => video.bvid)); }, [videos, labelRule, loadLabels]);

  const persist = async (value: BrowseSettings): Promise<boolean> => {
    setSaving(true); setSettingsError(null);
    try { setSettings(await platformBridge.updateBrowseSettings(sanitizeBrowseSettings(value))); return true; }
    catch { setSettingsError('Your preset could not be saved. Please retry.'); return false; }
    finally { setSaving(false); }
  };
  const savePreset = async (preset: BrowsePreset) => {
    const next = settings.presets.some(item => item.id === preset.id) ? settings.presets.map(item => item.id === preset.id ? preset : item) : [...settings.presets, preset];
    if (next.length > 20) { setSettingsError('You already have 20 presets. Edit or delete an inactive preset before adding another.'); return; }
    if (await persist({ version: 1, activePresetId: preset.id, presets: next })) setEditor(null);
  };
  const openUploaderPreset = (video: VideoCandidate) => {
    const draft = active ? structuredClone(active) : newPreset();
    if (!draft.uploaders.some(item => item.id === video.uploader.id)) {
      if (draft.uploaders.length >= 50) { setSettingsError('This preset already contains 50 uploaders. Remove one in Feed settings first.'); return; }
      draft.uploaders.push(video.uploader);
    }
    setEditor(draft);
  };
  const unavailable = videos.filter(video => labels[video.bvid]?.status === 'unavailable').length;
  const suggestions = [...new Set(Object.values(labels).flatMap(value => value.status === 'ready' ? value.labels : []))];
  const feedDescription = account.status === 'expired'
    ? 'Your session expired. Showing guest recommendations; sign in again in Options.'
    : account.profile ? t("Recommendations for {0}, shaped by your rules.", { 0: account.profile.name })
      : 'Explore Bilibili recommendations. Sign in for your account’s feed.';
  return <>
    <div className="page-heading browse-heading"><div><div className="eyebrow"><span className="pink-line" />{t("A LITTLE MORE YOU")}</div><h1>{t("A feed that feels like you")}<span className="pink-text">.</span></h1><p>{t(feedDescription)}</p></div><button className="button secondary feed-settings" disabled={!settingsReady || saving} onClick={() => setEditor(active ? structuredClone(active) : newPreset())}><SlidersHorizontal size={17} />{t("Feed settings")}</button></div>
    <section className="feed-toolbar" aria-label={t("Recommendation controls")}><label>{t("Preset")}<select aria-label={t("Active recommendation preset")} value={settings.activePresetId ?? ''} disabled={!settingsReady || saving} onChange={event => void persist({ ...settings, activePresetId: event.target.value || null })}><option value="">{t("All recommendations")}</option>{settings.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><button className="button secondary" disabled={!native || loading} onClick={() => void loadPage(true)}><RefreshCw size={16} className={loading ? 'spin' : ''} />{t("Refresh")}</button><span className="feed-count">{t("{0} shown · {1} candidates checked", { 0: visible.length, 1: videos.length })}</span></section>
    {settingsError && !editor && <p className="feed-error" role="alert">{t(settingsError)}</p>}
    {active && <div className="active-rules"><span><SlidersHorizontal size={14} />{active.name}</span>{active.labels.map(label => <span key={label}><Tag size={12} />{label}</span>)}{active.uploaders.map(uploader => <span key={uploader.id}><UsersRound size={12} />{uploader.name}</span>)}<small>{active.labels.length && active.uploaders.length ? active.match === 'all' ? t("Tag AND uploader") : t("Tag OR uploader") : t("Only the selected choices")}</small></div>}
    {labelRequests > 0 && <p className="feed-message" role="status"><LoaderCircle className="spin" size={15} />{t("Checking video tags before showing matches…")}</p>}
    {active?.labels.length && unavailable > 0 ? <p className="feed-message"><CircleHelp size={15} />{t("Tags could not be verified for")} {unavailable} {t("candidates. Unverified tags cannot match your allowlist.")}<button className="text-button" disabled={labelRequests > 0} onClick={() => void loadLabels(videos.filter(video => labels[video.bvid]?.status === 'unavailable').map(video => video.bvid), true)}>{t("Retry tags")}</button></p> : null}
    {!settingsReady ? <div className="loading-state" role="status">{!settingsError && <LoaderCircle className="spin" size={24} />}<p>{settingsError ? t("Recommendations are hidden until your saved rules can be loaded.") : t("Loading your saved feed rules…")}</p></div> : !native ? <div className="feed-empty"><SlidersHorizontal size={32} /><h2>{t("Your presets are ready to edit")}</h2><p>{t("This browser previews the settings. Open the desktop or Android app to load live recommendations.")}</p></div> : <>
      {error && <div className="feed-error feed-error-panel" role="alert"><WifiOff size={19} /><span>{t(error)}</span><button className="text-button" disabled={loading} onClick={() => void loadPage(videos.length === 0)}>{t("Try again")}</button></div>}
      {visible.length > 0 && <div className={`video-grid live-video-grid ${compactCards ? 'compact' : ''}`}>{visible.map(video => <CandidateCard key={video.bvid} video={video} labels={labels[video.bvid]} onLabels={() => void loadLabels([video.bvid], true)} onUploader={() => openUploaderPreset(video)} openVideo={openVideo} />)}</div>}
      {!visible.length && !loading && !labelRequests && !error && <div className="feed-empty"><Tag size={32} /><h2>{active ? t("No matches in these recommendations") : t("No videos returned yet")}</h2><p>{active ? t("Your preset stays strict. Load more candidates or edit its choices.") : t("Refresh to request a new page from Bilibili.")}</p>{active && <button className="button secondary" onClick={() => setEditor(structuredClone(active))}>{t("Edit preset")}</button>}</div>}
      {loading && <div className="loading-state" role="status"><LoaderCircle className="spin" size={24} /><p>{t("Loading Bilibili recommendations…")}</p></div>}
      <div className="feed-pagination">{hasMore && videos.length < 400 && <button className="button secondary" disabled={loading} onClick={() => void loadPage(false)}>{loading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{t("Load more candidates")}</button>}{!hasMore && videos.length > 0 && <p>{t("End of the current recommendation batch. Refresh for a new feed.")}</p>}{videos.length >= 400 && <p>{t("400 candidates checked. Refresh to start a new batch.")}</p>}</div>
      <p className="feed-footnote">{t("Only video recommendations are included. Presets filter Bilibili’s candidate feed; they do not search the entire catalog. Select a thumbnail or title to watch.")}</p>
    </>}
    {editor && <PresetEditor settings={settings} initial={editor} candidates={videos} availableLabels={suggestions} saving={saving} saveError={t(settingsError)} close={() => setEditor(null)} onSave={preset => void savePreset(preset)} onDelete={id => { void persist({ ...settings, presets: settings.presets.filter(preset => preset.id !== id) }).then(saved => { if (saved) setEditor(null); }); }} />}
  </>;
}
