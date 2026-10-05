import { useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock3, Heart, LoaderCircle, Plus, QrCode, RefreshCw, UsersRound, WifiOff } from 'lucide-react';
import { platformBridge } from '../platform/bridge';
import { mergeSubscriptionVideos, mergeUploaderVideos, SUBSCRIPTION_VIDEO_LIMIT } from '../core/subscriptions';
import { emptySubscriptionGroups, selectSubscriptionVideos, type SubscriptionSelection } from '../core/subscription-groups';
import SubscriptionDirectory from './SubscriptionDirectory';
import { GroupLibraryPager, type GroupLibraryProgress } from '../core/group-library';
import type { AccountSnapshot, AppTab, PlatformInfo, VideoCandidate } from '../shared/contracts';

type FeedState = { owner: string; videos: VideoCandidate[]; cursor: string | null; hasMore: boolean; total: number | null; loading: boolean; error: string | null };
const emptyFeed = (owner: string): FeedState => ({ owner, videos: [], cursor: null, hasMore: true, total: null, loading: false, error: null });
const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function SubscriptionCard({ video, openVideo }: { video: VideoCandidate; openVideo: (bvid: string) => void }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  return <article className="video-card live-video-card subscription-card" data-bvid={video.bvid} data-uploader-id={video.uploader.id} data-published-at={video.publishedAt}>
    <button className="video-thumbnail live-thumbnail video-open" onClick={() => openVideo(video.bvid)} aria-label={t("Watch {0}", { 0: video.title })}>
      {video.cover && !failed ? <img src={video.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="cover-fallback">Bili Focus</span>}
      <span className="video-duration">{duration(video.durationSeconds)}</span>
    </button>
    <div className="video-content">
      <span className="video-category">{video.publishedAt ? <time dateTime={new Date(video.publishedAt).toISOString()}>{new Date(video.publishedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</time> : t("Publication time unavailable")}</span>
      <h3 title={video.title}><button className="video-title-open" onClick={() => openVideo(video.bvid)}>{video.title}</button></h3>
      <div className="video-uploader"><span>{video.uploader.name}</span><span className="following-badge"><UsersRound size={13} />{t("Following")}</span></div>
    </div>
  </article>;
}

export default function SubscribePage({ account, compactCards, platform, navigate, openVideo }: { account: AccountSnapshot; compactCards: boolean; platform: PlatformInfo; navigate: (tab: AppTab) => void; openVideo: (bvid: string) => void }) {
  const { t, locale } = useI18n();
  const native = platform.kind !== 'browser';
  const allowed = native && Boolean(account.profile) && ['signed-in', 'offline'].includes(account.status);
  const session = `${account.profile?.uid ?? 'guest'}:${account.status}`;
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [selection, setSelection] = useState<SubscriptionSelection>({ kind: 'all' });
  const [groups, setGroups] = useState(emptySubscriptionGroups);
  const [selectionTitle, setSelectionTitle] = useState('All followed uploaders');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [groupProgress, setGroupProgress] = useState<GroupLibraryProgress | null>(null);
  const uploaderId = selection.kind === 'uploader' ? selection.id : null;
  const groupId = selection.kind === 'group' ? selection.id : null;
  const memberKey = JSON.stringify(groupId ? [...(groups.groups.find(group => group.id === groupId)?.uploaderIds ?? [])].sort() : []);
  const groupMembers = useMemo(() => JSON.parse(memberKey) as string[], [memberKey]);
  const libraryMode = selection.kind !== 'all';
  const source = `${session}:${uploaderId ? `uploader:${uploaderId}` : groupId ? `group:${groupId}:${memberKey}` : 'followed'}`;
  const [stored, setStored] = useState<FeedState>(() => emptyFeed(session));
  // Gate during render: another creator's or account's cards never flash.
  const feed = stored.owner === source ? stored : emptyFeed(source);
  const visibleVideos = selectSubscriptionVideos(feed.videos, selection, groups);
  const owner = useRef(source);
  owner.current = source;
  const epoch = useRef(0);
  const busy = useRef(false);
  const cursor = useRef<{ owner: string; value: string | null }>({ owner: source, value: null });
  const groupLibrary = useRef<{ owner: string; pager: GroupLibraryPager } | null>(null);
  const loadPage = useCallback(async (reset: boolean) => {
    if (!allowed || busy.current && !reset) return;
    const current = reset ? ++epoch.current : epoch.current;
    const requestOwner = source;
    busy.current = true;
    const requestCursor = reset || cursor.current.owner !== source ? null : cursor.current.value;
    if (reset) cursor.current = { owner: source, value: null };
    setStored(previous => ({ ...(reset || previous.owner !== requestOwner ? emptyFeed(requestOwner) : previous), loading: true, error: null }));
    try {
      if (groupId && (reset || groupLibrary.current?.owner !== source)) {
        groupLibrary.current?.pager.cancel();
        setGroupProgress({ loaded: 0, total: groupMembers.length });
        groupLibrary.current = { owner: source, pager: new GroupLibraryPager(groupMembers, options => platformBridge.getUploaderVideoPage(options), value => {
          if (owner.current === requestOwner && epoch.current === current) setGroupProgress(value);
        }) };
      }
      const page = groupId ? await groupLibrary.current!.pager.loadPage() : uploaderId ? await platformBridge.getUploaderVideoPage({ uploaderId, cursor: requestCursor }) : await platformBridge.getSubscriptionPage({ cursor: requestCursor });
      if (current !== epoch.current || owner.current !== requestOwner) return;
      cursor.current = { owner: source, value: page.cursor };
      setStored(previous => ({ owner: requestOwner, videos: (libraryMode ? mergeUploaderVideos : mergeSubscriptionVideos)(reset || previous.owner !== requestOwner ? [] : previous.videos, page.videos), cursor: page.cursor, hasMore: page.hasMore && page.cursor !== null, total: 'total' in page ? page.total as number : null, loading: false, error: null }));
    } catch (error) {
      if (current === epoch.current && owner.current === requestOwner) setStored(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load followed-account videos. Please retry.' }));
    } finally { if (current === epoch.current) busy.current = false; }
  }, [allowed, source, uploaderId, groupId, groupMembers, libraryMode]);
  useEffect(() => {
    if (allowed) void loadPage(true);
    return () => {
      epoch.current++; busy.current = false;
      if (groupLibrary.current?.owner === source) { groupLibrary.current.pager.cancel(); groupLibrary.current = null; }
    };
  }, [allowed, loadPage]);

  return <>
    <div className="page-heading subscribe-heading"><div><div className="eyebrow"><span className="pink-line" />{t("THE PEOPLE YOU FOLLOW")}</div><h1>{t("Keep up with your favorites")}<span className="pink-text">.</span></h1><p>{t("New video uploads from accounts you follow on Bilibili. No Browse presets applied.")}</p></div>{allowed && <div className="subscribe-heading-actions"><button className="button secondary subscription-directory-toggle" aria-expanded={directoryOpen} aria-controls="subscription-directory" onClick={() => setDirectoryOpen(!directoryOpen)}><UsersRound size={16} />{directoryOpen ? t("Hide subscriptions") : t("Show subscriptions")}</button><button className="button secondary subscription-refresh" disabled={feed.loading} onClick={() => { void loadPage(true); setRefreshRevision(value => value + 1); }}><RefreshCw size={16} className={feed.loading ? 'spin' : ''} />{t("Refresh")}</button></div>}</div>
    {!allowed ? <div className="subscribe-surface">
      <div className="subscribe-decoration" aria-hidden="true"><span className="creator-circle a">F</span><span className="creator-circle b"><UsersRound size={20} /></span><span className="creator-circle c">S</span><span className="creator-circle d"><Heart size={19} /></span><span className="creator-orbit" /></div>
      <section className="empty-state subscription-sign-in"><div className="empty-state-icon"><UsersRound size={30} /></div><h2>{!native ? t("Your subscriptions live in the native app") : account.status === 'checking' ? t("Checking your Bilibili account") : account.status === 'expired' ? t("Sign in again to see your subscriptions") : t("Your favorite creators, all together")}</h2><p>{!native ? t("Open the desktop or Android app and sign in to load videos from your followed accounts. This browser preview does not load account content.") : account.status === 'checking' ? t("Your followed-account feed will load after the session is verified.") : t("Connect your Bilibili account to load only videos uploaded by accounts you follow.")}</p><div className="empty-state-action"><button className="button primary" onClick={() => navigate('options')}><QrCode size={17} />{account.status === 'checking' ? t("View account status") : t("Go to account sign-in")}<ArrowRight size={16} /></button></div></section>
      <div className="subscribe-details"><span><UsersRound size={15} />{t("Only followed creators")}</span><span><Clock3 size={15} />{t("Newest videos first")}</span><span><Heart size={15} />{t("Separate from Browse presets")}</span></div>
    </div> : <>
      <div className={`subscribe-layout ${directoryOpen ? 'with-directory' : ''}`}>
      {directoryOpen && <SubscriptionDirectory selection={selection} refreshRevision={refreshRevision} onSelect={(next, saved, title) => { setSelection(next); setGroups(saved); setSelectionTitle(title); }} />}
      <section className="subscribe-results" aria-label={t("Subscribed videos")}>
      <div className="subscription-summary"><span><UsersRound size={15} />{libraryMode ? t("{0} loaded{1}", { 0: feed.videos.length, 1: feed.total === null ? '' : t(" / {0} videos", { 0: feed.total }) }) : t("{0} shown / {1} loaded", { 0: visibleVideos.length, 1: feed.videos.length })}</span><span><Clock3 size={15} />{t("Newest first")}</span><span>{groupId ? t("{0} creators · Group video library", { 0: groupMembers.length }) : uploaderId ? t("Uploader video library") : t("Original video uploads only")}</span></div>
      <div className="subscription-selection"><strong>{selection.kind === "all" ? t("All followed uploaders") : selectionTitle}</strong>{selection.kind !== 'all' && <button className="text-button" onClick={() => { setSelection({ kind: 'all' }); setSelectionTitle("All followed uploaders"); }}>{t("Show all followed uploads")}</button>}<p>{groupId ? t("Browse all available uploads from this group’s creators together. Load older videos to continue through their libraries.") : uploaderId ? t("Browse this creator’s video library. Load older videos to continue through all available uploads.") : t("Recent uploads from followed creators. Select an uploader or group to browse their full video libraries.")}</p></div>
      {feed.error && <div className="feed-error feed-error-panel" role="alert"><WifiOff size={19} /><span>{t(feed.error)}</span><button className="text-button" disabled={feed.loading} onClick={() => void loadPage(false)}>{t("Try again")}</button></div>}
      {visibleVideos.length > 0 && <div className={`video-grid live-video-grid subscription-grid ${compactCards ? 'compact' : ''}`}>{visibleVideos.map(video => <SubscriptionCard key={video.bvid} video={video} openVideo={openVideo} />)}</div>}
      {feed.loading && <div className="loading-state" role="status"><LoaderCircle className="spin" size={24} /><p>{groupId ? groupProgress && groupProgress.loaded < groupProgress.total ? t("Loading group libraries… {0} / {1} creators", { 0: groupProgress.loaded, 1: groupProgress.total }) : t("Loading older videos from this group…") : uploaderId ? t("Loading this creator’s videos…") : t("Loading videos from your followed accounts…")}</p></div>}
      {!feed.loading && !feed.error && !visibleVideos.length && <div className="feed-empty"><UsersRound size={32} /><h2>{groupId ? groupMembers.length ? t("No available videos in this group’s libraries") : t("This group has no creators") : uploaderId ? t("No available videos in this uploader’s library") : t("No followed video uploads in this batch")}</h2><p>{feed.hasMore ? t("Load older videos to keep looking. Your selection will stay active.") : groupId && !groupMembers.length ? t("Edit this group to add followed creators.") : libraryMode ? t("You’ve reached the end of the available video libraries.") : t("No more matching uploads are available in this batch.")}</p></div>}
      <div className="feed-pagination subscription-pagination">{feed.hasMore && (libraryMode || feed.videos.length < SUBSCRIPTION_VIDEO_LIMIT) && <button className="button secondary" disabled={feed.loading} onClick={() => void loadPage(false)}>{feed.loading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{libraryMode ? t("Load older videos") : t("Load older uploads")}</button>}{!feed.hasMore && !feed.loading && feed.videos.length > 0 && <p>{groupId ? t("You’ve reached the end of all available video libraries in this group.") : uploaderId ? t("You’ve reached the end of this uploader’s available video library.") : t("You’ve reached the end of the available followed-video feed.")}</p>}{!libraryMode && feed.videos.length >= SUBSCRIPTION_VIDEO_LIMIT && <p>{SUBSCRIPTION_VIDEO_LIMIT} {t("uploads loaded. Refresh to start a new batch.")}</p>}</div>
      <p className="feed-footnote">{libraryMode ? t("Videos are listed directly from the selected creators’ Bilibili spaces. Private, deleted, or unavailable uploads cannot be listed. Select a thumbnail or title to watch.") : t("Only verified followed accounts’ original video uploads are included. Reposts, live streams, ads, and unrelated suggestions are omitted. Select a thumbnail or title to watch.")}</p>
      </section></div>
    </>}
  </>;
}
