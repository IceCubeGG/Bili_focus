import { useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, ImageDown, LoaderCircle, Maximize, MessageSquare, RefreshCw, Send, UsersRound } from 'lucide-react';
import { platformBridge } from '../platform/bridge';
import { activeDanmu } from '../core/video';
import { useVideoPlayback } from './use-video-playback';
import type { AccountSnapshot, Danmu, VideoComment, VideoCommentsPage, VideoDetails, VideoPart } from '../shared/contracts';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not load this video feature. Please retry.';
const date = (value: number | null, locale: string) => value ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : 'Publication time unavailable';
const canPost = (account: AccountSnapshot) => Boolean(account.profile) && ['signed-in', 'offline'].includes(account.status);
function ErrorPanel({ message, retry }: { message: string; retry?: () => void }) {
  const { t, locale } = useI18n();
  return <div className="feed-error feed-error-panel" role="alert"><span>{t(message)}</span>{retry && <button className="text-button" onClick={retry}>{t("Try again")}</button>}</div>;
}

function VideoPlayer({ details, part, account, danmuOn, setDanmuOn, speed, setSpeed }: { details: VideoDetails; part: VideoPart; account: AccountSnapshot; danmuOn: boolean; setDanmuOn: (value: boolean) => void; speed: number; setSpeed: (value: number) => void }) {
  const { t, locale } = useI18n();
  const video = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const { playback, quality, qualities, loading, notice, playError, setPlayError, streamIndex, time, syncTime, currentTime, chooseQuality, reload, selectSegment } = useVideoPlayback(video, details.bvid, part.cid, speed);
  const [danmuText, setDanmuText] = useState('');
  const [segments, setSegments] = useState<Map<number, Danmu[]>>(new Map());
  const [danmuError, setDanmuError] = useState<string | null>(null), [danmuRetry, setDanmuRetry] = useState(0);
  const [sending, setSending] = useState(false), [sendNotice, setSendNotice] = useState<string | null>(null), [sendError, setSendError] = useState<string | null>(null);
  const [width, setWidth] = useState(800);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const pause = () => { if (document.hidden && !document.fullscreenElement) video.current?.pause(); }; document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause); }, []);
  useEffect(() => {
    let frame = 0, previous = 0;
    const tick = (timestamp: number) => { if (video.current && !video.current.paused && timestamp - previous > 32) { previous = timestamp; syncTime(); } frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [syncTime]);
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); if (stage.current) observer.observe(stage.current); return () => observer.disconnect(); }, []);
  const segment = Math.min(1680, Math.max(1, Math.ceil((part.durationSeconds || 604800) / 360)), Math.floor(time / 360) + 1);
  useEffect(() => {
    if (!danmuOn) return; let cancelled = false;
    if (segments.has(segment)) { setDanmuError(null); return; }
    setDanmuError(null);
    void platformBridge.getDanmu({ bvid: details.bvid, cid: part.cid, segment }).then(value => {
      if (cancelled) return;
      setSegments(old => { const next = new Map(old); next.set(segment, value.items); for (const key of next.keys()) if (Math.abs(key - segment) > 2) next.delete(key); return next; });
    }).catch(error => { if (!cancelled) setDanmuError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [details.bvid, part.cid, danmuOn, segment, danmuRetry, segments]);
  const items = useMemo(() => [...segments.values()].flat().sort((a, b) => a.timeSeconds - b.timeSeconds), [segments]);
  const visible = danmuOn ? activeDanmu(items, time) : [];
  const send = async () => {
    if (sending || !canPost(account) || !danmuText.trim() || !playback) return;
    setSending(true); setSendError(null); setSendNotice(null);
    try { const result = await platformBridge.sendDanmu({ bvid: details.bvid, cid: part.cid, text: danmuText, timeSeconds: currentTime() }); if (alive.current) { setDanmuText(''); setSendNotice(result.message); } }
    catch (error) { if (alive.current) setSendError(errorMessage(error)); }
    finally { if (alive.current) setSending(false); }
  };
  return <section className="watch-player-panel" aria-label={t("Video player")}>
    <div className="watch-player-stage" ref={stage}>
      <video ref={video} hidden={!playback} poster={details.cover || undefined} controls controlsList="nodownload nofullscreen" disablePictureInPicture playsInline preload="metadata"
        onTimeUpdate={syncTime} onSeeked={syncTime} />
      {!playback && <div className="watch-player-placeholder"><LoaderCircle className={playError ? '' : 'spin'} size={30} /><span>{playError ? t("Playback unavailable") : t("Preparing your video…")}</span></div>}
      <div className="danmu-overlay" aria-hidden="true">{visible.map(item => <span key={item.id} className={`danmu-item mode-${item.mode}`} style={{ color: `#${item.color.toString(16).padStart(6, '0')}`,
        ...(item.mode === 1 ? { top: `${5 + item.lane * 7}%`, left: `${(1 - item.progress) * width}px`, transform: `translateX(-${item.progress * 100}%)` } : item.mode === 5 ? { top: `${5 + item.lane * 7}%` } : { bottom: `${18 + item.lane * 5}%` }) }}>{item.text}</span>)}</div>
    </div>
    <div className="watch-playback-tools">
      <label>{t("Quality")}<select aria-label={t("Video quality")} value={quality} onChange={event => chooseQuality(Number(event.target.value))}><option value={0}>{t("Compatible")}</option>{qualities.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
      <label>{t("Speed")}<select aria-label={t("Playback speed")} value={speed} onChange={event => { const next = Number(event.target.value); setSpeed(next); if (video.current) video.current.playbackRate = next; }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      {playback && playback.sources.length > 1 && <label>{t("Stream segment")}<select aria-label={t("Stream segment")} value={streamIndex} onChange={event => selectSegment(Number(event.target.value))}>{playback.sources.map((_value, index) => <option key={index} value={index}>{index + 1} / {playback.sources.length}</option>)}</select></label>}
      <button className="text-button" onClick={reload}><RefreshCw size={14} />{t("Reload player")}</button>
      <button className="text-button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void stage.current?.requestFullscreen().catch(() => setPlayError(t("Fullscreen is unavailable on this device."))); }}><Maximize size={16} />{t("Fullscreen")}</button>
    </div>
    {loading && playback && <p className="watch-notice" role="status">{t("Switching playback…")}</p>}
    {notice && <p className="watch-notice" role="status">{t(notice, { 0: playback?.qualityLabel ?? '' })}</p>}
    <p className="watch-muted">{t("Qualities depend on this video, your account and this device. Compatible is the safe default.")}</p>
    {playError && <ErrorPanel message={playError} retry={reload} />}
    <div className="danmu-bar"><label className="danmu-toggle"><input type="checkbox" checked={danmuOn} onChange={event => setDanmuOn(event.target.checked)} />{t("Danmu")} {danmuOn ? t("on") : t("off")}</label><form onSubmit={event => { event.preventDefault(); void send(); }}><input aria-label={t("Danmu message")} maxLength={100} value={danmuText} onChange={event => setDanmuText(event.target.value)} disabled={!canPost(account)} placeholder={canPost(account) ? t("Send Danmu at the current moment") : t("Sign in to send Danmu")} /><button className="button primary" disabled={!canPost(account) || sending || !danmuText.trim() || !playback}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{t("Send")}</button></form></div>
    {danmuError && <ErrorPanel message={`${t("Danmu")}: ${t(danmuError)}`} retry={() => setDanmuRetry(value => value + 1)} />}
    {sendError && <ErrorPanel message={sendError} />}{sendNotice && <p className="watch-notice" role="status">{t(sendNotice)}</p>}
  </section>;
}

type ReplyTarget = { root: string; parent: string; name: string };
function Comments({ bvid, account }: { bvid: string; account: AccountSnapshot }) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState<'hot' | 'newest'>('hot'), [thread, setThread] = useState<VideoComment | null>(null);
  const [page, setPage] = useState<VideoCommentsPage | null>(null), [items, setItems] = useState<VideoComment[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [text, setText] = useState('');
  const [target, setTarget] = useState<ReplyTarget | null>(null), [posting, setPosting] = useState(false), [postError, setPostError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const cursor = useRef(1), revision = useRef(0), busy = useRef(false), textarea = useRef<HTMLTextAreaElement>(null);
  const owner = `${bvid}:${sort}:${thread?.id ?? 'all'}`, currentOwner = useRef(owner); currentOwner.current = owner;
  const [storedOwner, setStoredOwner] = useState(owner);
  const seen = useRef(new Set<string>());
  const load = useCallback(async (reset: boolean) => {
    if (busy.current && !reset) return;
    const stamp = reset ? ++revision.current : revision.current, requestOwner = owner;
    busy.current = true; setLoading(true); setError(null);
    const next = reset ? 1 : cursor.current;
    if (reset) { setItems([]); setPage(null); setStoredOwner(owner); cursor.current = 1; seen.current.clear(); }
    try { const result = await platformBridge.getVideoComments({ bvid, page: next, sort, root: thread?.id ?? null });
      if (stamp !== revision.current || currentOwner.current !== requestOwner) return;
      const repeated = !reset && result.items.every(item => seen.current.has(item.id));
      if (repeated && result.hasMore) setNotice('Bilibili did not expose more comments for this session. Sign in or refresh to try again.');
      for (const item of result.items) seen.current.add(item.id);
      setItems(old => [...new Map([...(reset ? [] : old), ...result.items].map(item => [item.id, item])).values()]); setPage(repeated ? { ...result, hasMore: false } : result); cursor.current = next + 1;
    } catch (error) { if (stamp === revision.current && currentOwner.current === requestOwner) setError(errorMessage(error)); }
    finally { if (stamp === revision.current) { busy.current = false; setLoading(false); } }
  }, [bvid, sort, thread?.id, owner]);
  useEffect(() => { void load(true); return () => { revision.current++; busy.current = false; }; }, [load]);
  const reply = (item: VideoComment, root: string) => { setTarget({ root, parent: item.id, name: item.author.name }); setText(''); textarea.current?.focus(); textarea.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const send = async () => {
    if (posting || !canPost(account) || !text.trim() || page?.closed) return;
    const stamp = revision.current; setPosting(true); setPostError(null); setNotice(null);
    try { const result = await platformBridge.sendVideoComment({ bvid, text, root: target?.root ?? null, parent: target?.parent ?? null });
      if (stamp !== revision.current) return; setText(''); setTarget(null); setNotice(result.message); void load(true);
    } catch (error) { if (stamp === revision.current) setPostError(errorMessage(error)); }
    finally { setPosting(false); }
  };
  const card = (item: VideoComment, root: string, nested = false) => <article key={item.id} className={`watch-comment ${nested ? 'nested' : ''}`} data-comment-id={item.id}>
    <div className="comment-avatar">{item.author.avatar ? <img src={item.author.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <UsersRound size={20} />}</div><div className="comment-content"><strong>{item.author.name}</strong><p>{item.text}</p><div className="comment-meta"><time>{t(date(item.publishedAt, locale))}</time><span>{item.likes} {t("likes")}</span><button className="text-button" disabled={!canPost(account) || page?.closed} onClick={() => reply(item, root)}>{t("Reply")}</button></div>
      {!nested && item.replies.map(child => card(child, item.id, true))}
      {!nested && item.replyCount > 0 && <button className="text-button comment-thread-button" onClick={() => { setThread(item); setTarget({ root: item.id, parent: item.id, name: item.author.name }); }}>{t("View replies ({0})", { 0: item.replyCount })}</button>}
    </div></article>;
  return <section className="watch-comments" aria-labelledby="comments-title"><div className="watch-section-heading"><h2 id="comments-title"><MessageSquare size={20} />{thread ? t("Replies") : t("Comments")}{storedOwner === owner && page && <span>{page.total}</span>}</h2><div className="watch-comment-tools">{thread ? <button className="text-button" onClick={() => { setThread(null); setTarget(null); }}><ArrowLeft size={15} />{t("Back to comments")}</button> : <select aria-label={t("Comment ordering")} value={sort} onChange={event => { setSort(event.target.value as typeof sort); setTarget(null); }}><option value="hot">{t("Popular")}</option><option value="newest">{t("Newest")}</option></select>}<button className="text-button" disabled={loading} onClick={() => void load(true)}><RefreshCw size={14} />{t("Refresh")}</button></div></div>
    {thread && <div className="thread-original"><strong>{thread.author.name}</strong><p>{thread.text}</p></div>}
    {storedOwner === owner && items.map(item => card(item, thread?.id ?? item.id, !!thread))}
    {loading && <p className="watch-loading" role="status"><LoaderCircle className="spin" size={18} />{t("Loading comments…")}</p>}
    {error && <ErrorPanel message={error} retry={() => void load(false)} />}
    {!loading && !error && !items.length && <p className="watch-muted">{page?.closed ? t("This comment section is closed.") : t("No comments yet.")}</p>}
    {page?.hasMore && !loading && <button className="button secondary load-comments" onClick={() => void load(false)}>{t("Load more")} {thread ? t("replies") : t("comments")}</button>}
    <form className="comment-composer" onSubmit={event => { event.preventDefault(); void send(); }}>{target && <div className="reply-target">{t("Replying to")} {target.name}<button type="button" className="text-button" onClick={() => setTarget(null)}>{t("Cancel reply")}</button></div>}<textarea ref={textarea} aria-label={t("Comment message")} maxLength={1000} rows={3} value={text} disabled={!canPost(account) || page?.closed || posting} onChange={event => setText(event.target.value)} placeholder={!canPost(account) ? t("Sign in to join the conversation") : page?.closed ? t("Comments are closed") : target ? t("Reply to {0}…", { 0: target.name }) : t("Share your thoughts…")} /><div><span>{[...text].length} / 1000</span><button className="button primary" disabled={!canPost(account) || posting || !text.trim() || page?.closed}>{posting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{target ? t("Post reply") : t("Post comment")}</button></div></form>
    {postError && <ErrorPanel message={postError} />}{notice && <p className="watch-notice" role="status">{t(notice)}</p>}
  </section>;
}

export default function VideoPage({ bvid, account, sourceLabel, close, openVideo }: { bvid: string; account: AccountSnapshot; sourceLabel: string; close: () => void; openVideo: (bvid: string) => void }) {
  const { t, locale } = useI18n();
  const [details, setDetails] = useState<VideoDetails | null>(null), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0), [cid, setCid] = useState<string | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [danmuOn, setDanmuOn] = useState(true), [speed, setSpeed] = useState(1);
  const [downloading, setDownloading] = useState(false), [downloadNotice, setDownloadNotice] = useState<string | null>(null), [downloadError, setDownloadError] = useState<string | null>(null);
  const download = async (kind: 'video' | 'cover') => {
    if (downloading) return; setDownloading(true); setDownloadNotice(null); setDownloadError(null);
    try {
      let snapshot = await platformBridge.getDownloads(); if (!snapshot.folder) snapshot = await platformBridge.chooseDownloadFolder();
      if (!snapshot.folder) return;
      await platformBridge.startDownload({ bvid, cid: kind === 'video' ? part?.cid ?? null : null, kind });
      setDownloadNotice('Added to downloads. See progress and saved files in Options.');
    } catch (error) { setDownloadError(errorMessage(error)); } finally { setDownloading(false); }
  };
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); let cancelled = false; setDetails(null); setError(null);
    void platformBridge.getVideoDetails({ bvid }).then(value => { if (!cancelled) { setDetails(value); setCid(value.parts[0].cid); } }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [bvid, revision]);
  const part = details?.parts.find(part => part.cid === cid);
  return <div className="watch-page"><button className="text-button watch-back" onClick={close}><ArrowLeft size={17} />{t("Back to")} {sourceLabel}</button>
    <h1 tabIndex={-1} ref={heading}>{details?.title ?? t("Video")}</h1>
    {error && <ErrorPanel message={error} retry={() => setRevision(value => value + 1)} />}
    {!details && !error && <p className="watch-loading" role="status"><LoaderCircle className="spin" size={24} />{t("Loading video details…")}</p>}
    {details && <><div className="watch-meta"><span>{new Intl.NumberFormat(locale).format(details.views)} {t("views")}</span><time>{t(date(details.publishedAt, locale))}</time><span>{details.bvid}</span></div>
      {part && <VideoPlayer key={`${details.bvid}:${part.cid}:${revision}`} details={details} part={part} account={account} danmuOn={danmuOn} setDanmuOn={setDanmuOn} speed={speed} setSpeed={setSpeed} />}
      <div className="watch-under-player"><button className="watch-creator" onClick={() => { void platformBridge.openCreatorProfile({ uploaderId: details.uploader.id }).catch(error => setCreatorError(errorMessage(error))); }}>{details.uploaderAvatar ? <img src={details.uploaderAvatar} alt="" referrerPolicy="no-referrer" /> : <UsersRound size={26} />}<span><strong>{details.uploader.name}</strong><span>{t("Open creator profile · UID")} {details.uploader.id}</span></span><ExternalLink size={16} /></button><div className="watch-downloads"><button className="button secondary" disabled={downloading || !part} onClick={() => void download('video')}><Download size={17} />{t("Download")}{details.parts.length > 1 ? ` P${part?.page ?? ''}` : ''}</button><button className="button secondary" disabled={downloading || !details.cover} onClick={() => void download('cover')}><ImageDown size={17} />{t("Download cover")}</button><span>{t("Queue and save folder in Options")}</span></div></div>
      {downloadError && <ErrorPanel message={downloadError} />}{downloadNotice && <p className="watch-notice" role="status">{t(downloadNotice)}</p>}
      {creatorError && <ErrorPanel message={creatorError} />}
      {(details.parts.length > 1 || details.episodes.length > 0) && <section className="watch-parts" aria-labelledby="parts-title"><h2 id="parts-title">{t("Parts & episodes")}</h2>{details.parts.length > 1 && <div className="watch-part-list">{details.parts.map(value => <button key={value.cid} className={cid === value.cid ? 'selected' : ''} aria-pressed={cid === value.cid} onClick={() => setCid(value.cid)}>P{value.page} · {value.title}</button>)}</div>}{details.episodes.length > 0 && <label className="watch-episode-select">{t("Series episodes")}<select aria-label={t("Series episode")} value={details.episodes.some(value => value.bvid === bvid) ? bvid : ''} onChange={event => { if (event.target.value) openVideo(event.target.value); }}><option value="" disabled>{t("Select an episode")}</option>{details.episodes.map((value, index) => <option key={`${value.bvid}:${index}`} value={value.bvid}>{value.section ? `${value.section} · ` : ''}{value.title || value.bvid}</option>)}</select></label>}</section>}
      <section className="watch-description"><h2>{t("About this video")}</h2><p>{details.description || t("No description supplied.")}</p><div className="watch-tags" aria-label={t("Video tags")}>{details.tags.map(tag => <span key={tag}>{tag}</span>)}{!details.tags.length && <span>{t("Tags unavailable or not supplied")}</span>}</div></section>
      <Comments bvid={details.bvid} account={account} /></>}
  </div>;
}
