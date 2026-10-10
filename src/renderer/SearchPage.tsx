import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, Search } from 'lucide-react';
import type { PlatformInfo, VideoCandidate } from '../shared/contracts';
import { platformBridge } from '../platform/bridge';
import { mergeSearchVideos, searchQuery } from '../core/search';
import { useI18n } from './i18n';

function SearchCard({ video, openVideo }: { video: VideoCandidate; openVideo: (bvid: string) => void }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  const seconds = video.durationSeconds;
  const duration = seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <article className="video-card live-video-card search-card" data-bvid={video.bvid}>
    <button className="video-thumbnail live-thumbnail video-open" onClick={() => openVideo(video.bvid)} aria-label={t('Watch {0}', { 0: video.title })}>
      {video.cover && !failed ? <img src={video.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="cover-fallback">Bili Focus</span>}
      <span className="video-duration">{duration}</span>
    </button>
    <div className="video-content"><span className="video-category">{new Intl.NumberFormat(locale, { notation: 'compact' }).format(video.views)} {t('views')}{video.publishedAt ? ` · ${new Date(video.publishedAt).toLocaleDateString(locale)}` : ''}</span>
      <h3 title={video.title}><button className="video-title-open" onClick={() => openVideo(video.bvid)}>{video.title}</button></h3>
      <div className="video-uploader"><span>{video.uploader.name}</span></div><small className="search-bvid">{video.bvid}</small>
    </div>
  </article>;
}

type Results = { query: string; videos: VideoCandidate[]; total: number; cursor: string | null; hasMore: boolean; loading: boolean; error: string | null };
const empty: Results = { query: '', videos: [], total: 0, cursor: null, hasMore: false, loading: false, error: null };
export default function SearchPage({ compactCards, platform, close, openVideo }: { compactCards: boolean; platform: PlatformInfo; close: () => void; openVideo: (bvid: string) => void }) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [results, setResults] = useState<Results>(empty);
  const [validation, setValidation] = useState<string | null>(null);
  const sequence = useRef(0), pending = useRef(false), inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); return () => { sequence.current++; }; }, []);
  const load = async (query: string, more = false) => {
    if (more && (pending.current || !results.hasMore)) return;
    const id = ++sequence.current; pending.current = true; setValidation(null);
    const cursor = more ? results.cursor : null;
    setResults(previous => ({ ...(more ? previous : empty), query, loading: true, error: null }));
    try {
      const page = await platformBridge.searchVideos({ query, cursor });
      if (id !== sequence.current) return;
      setResults(previous => ({ query, videos: mergeSearchVideos(more ? previous.videos : [], page), total: page.total, cursor: page.cursor, hasMore: page.hasMore, loading: false, error: null }));
    } catch (error) {
      if (id === sequence.current) setResults(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not reach Bilibili search. Check your connection and retry.' }));
    } finally { if (id === sequence.current) pending.current = false; }
  };
  return <section className="search-page" aria-labelledby="search-title">
    <button className="text-button search-back" onClick={close}><ArrowLeft size={17} />{t('Back to feed')}</button>
    <div className="page-heading"><div><span className="eyebrow">{t('FIND A VIDEO')}</span><h1 id="search-title">{t('Search videos')}</h1><p>{t('Search Bilibili by keyword, or enter an exact BV code.')}</p></div></div>
    <form className="video-search-form" onSubmit={event => { event.preventDefault(); try { const query = searchQuery(input); setInput(query); void load(query); } catch (error) { setValidation((error as Error).message); } }}>
      <label className="search-input"><Search size={20} /><input ref={inputRef} data-testid="video-search-input" type="search" aria-label={t('Keyword or BV code')} placeholder={t('Keyword or BV code')} value={input} maxLength={200} onChange={event => { setInput(event.target.value); setValidation(null); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
      <button className="button primary" type="submit" disabled={platform.kind === 'browser'}>{t('Search')}</button>
    </form>
    <p className="feed-footnote">{t('Search results are separate from your Browse presets. Bilibili may limit or restrict available results.')}</p>
    {platform.kind === 'browser' && <p className="feed-message">{t('Video search requires the desktop or Android app.')}</p>}
    {validation && <p className="feed-error" role="alert">{t(validation)}</p>}
    {results.query && <p className="feed-count" role="status">{t('{0} loaded · {1} results for “{2}”', { 0: results.videos.length, 1: results.total, 2: results.query })}</p>}
    {results.videos.length > 0 && <div className={`video-grid live-video-grid ${compactCards ? 'compact' : ''}`}>{results.videos.map(video => <SearchCard key={video.bvid} video={video} openVideo={openVideo} />)}</div>}
    {results.loading && <p className="feed-message" role="status"><LoaderCircle className="spin" size={18} />{t('Searching Bilibili…')}</p>}
    {results.error && <div className="feed-error" role="alert"><p>{t(results.error)}</p><button className="button secondary" onClick={() => void load(results.query, results.hasMore)}>{t('Retry search')}</button></div>}
    {results.query && !results.loading && !results.error && !results.videos.length && <div className="feed-empty"><Search size={32} /><h2>{t('No matching videos')}</h2><p>{t('Try another keyword or check the BV code. Deleted or private videos are not available.')}</p></div>}
    {!results.loading && !results.error && results.hasMore && <div className="feed-pagination"><button className="button secondary" onClick={() => void load(results.query, true)}>{t('Load more results')}</button></div>}
  </section>;
}
