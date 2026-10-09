import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { platformBridge } from '../platform/bridge';
import { supportedQualities } from '../core/playback';
import type { VideoPlayback, VideoQuality } from '../shared/contracts';

const release = (handle: string) => platformBridge.releaseVideoPlayback({ handle }).catch(() => {});
const supported = (mime: string) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime);
const RECOVERED = 'Selected quality could not play. Switched to Compatible playback.';
type Resume = { time: number; playing: boolean };

/** One persistent video element, one active native handle and immediately cancelable DASH load. */
export function useVideoPlayback(video: RefObject<HTMLVideoElement | null>, bvid: string, cid: string, speed: number) {
  const [request, setRequest] = useState({ quality: 0, revision: 0 });
  const [playback, setPlayback] = useState<VideoPlayback | null>(null);
  const [quality, setQuality] = useState(0), [qualities, setQualities] = useState<VideoQuality[]>([]);
  const [loading, setLoading] = useState(true), [notice, setNotice] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [streamIndex, setStreamIndex] = useState(0), [time, setTime] = useState(0);
  const offset = useRef(0), resume = useRef<Resume>({ time: 0, playing: false });
  const ready = useRef(false), rate = useRef(speed), teardown = useRef(Promise.resolve());
  const segmentPicker = useRef<(index: number) => void>(() => {});
  rate.current = speed;
  const syncTime = useCallback(() => { if (ready.current && video.current) setTime(offset.current + video.current.currentTime); }, [video]);
  const capture = useCallback(() => {
    if (ready.current && video.current) resume.current = { time: offset.current + video.current.currentTime, playing: !video.current.paused && !video.current.ended };
  }, [video]);
  const chooseQuality = (next: number) => { capture(); setNotice(null); setQuality(next); setRequest(old => ({ quality: next, revision: old.revision + 1 })); };
  const reload = () => { capture(); setRequest(old => ({ ...old, revision: old.revision + 1 })); };

  // Discovery never owns the video element and cannot break compatible playback.
  useEffect(() => {
    let canceled = false;
    void platformBridge.getVideoPlayback({ bvid, cid, quality: 64 }).then(value => {
      try { if (!canceled) setQualities(supportedQualities(value, supported)); }
      finally { void release(value.handle); }
    }).catch(() => { if (!canceled) setQualities([]); });
    return () => { canceled = true; };
  }, [bvid, cid]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let canceled = false, failed = false, handle: string | undefined;
    let session: { ready: Promise<void>; dispose: () => Promise<void> } | undefined;
    let local: VideoPlayback | undefined, index = 0, initialized = false, dashLoaded = false, durations: number[] = [];
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let lastProgress = performance.now(), lastTime = -1;
    const priorTeardown = teardown.current;
    setLoading(true); setPlayError(null); ready.current = false;
    const fail = () => {
      if (canceled || failed) return;
      failed = true;
      if (deadline) clearTimeout(deadline);
      if (initialized) capture();
      element.pause();
      if (request.quality !== 0) {
        setNotice(RECOVERED); setQuality(0);
        setRequest(old => ({ quality: 0, revision: old.revision + 1 }));
      } else {
        setLoading(false); setPlayError('Playback stopped or the stream expired. Reload the player to try again.');
      }
    };
    const armDeadline = () => { if (deadline) clearTimeout(deadline); deadline = setTimeout(fail, 20000); };
    armDeadline();
    const metadata = () => {
      if (canceled || failed || !local) return;
      element.playbackRate = rate.current;
      if (!local.dash) {
        if (!durations[index] && Number.isFinite(element.duration)) durations[index] = element.duration;
        const target = Math.max(0, resume.current.time - offset.current);
        element.currentTime = Number.isFinite(element.duration) ? Math.min(target, Math.max(0, element.duration - 0.05)) : target;
        if (resume.current.playing) void element.play().catch(() => {});
      }
    };
    const loaded = () => {
      if (canceled || failed || !local || (local.dash && !dashLoaded)) return;
      initialized = true; ready.current = true;
      if (deadline) clearTimeout(deadline);
      lastProgress = performance.now(); lastTime = element.currentTime;
      setLoading(false); setQuality(request.quality === 0 ? 0 : local.quality); syncTime();
      if (request.quality && local.quality !== request.quality) setNotice('Requested quality unavailable. Playing {0}.');
    };
    const directSource = (next: number) => {
      if (!local || !local.sources[next]) return;
      index = next; initialized = false; ready.current = false;
      offset.current = durations.slice(0, next).reduce((sum, duration) => sum + duration, 0);
      setStreamIndex(next); setLoading(true); armDeadline();
      element.src = local.sources[next].url; element.load();
    };
    const ended = () => {
      if (!local || canceled || local.dash || index + 1 >= local.sources.length) return;
      resume.current = { time: offset.current + (durations[index] || element.currentTime), playing: true };
      directSource(index + 1);
    };
    const pickSegment = (next: number) => {
      if (canceled || failed || !local || local.dash || !Number.isInteger(next) || !local.sources[next]) return;
      capture(); resume.current.time = durations.slice(0, next).reduce((sum, duration) => sum + duration, 0);
      directSource(next);
    };
    segmentPicker.current = pickSegment;
    element.addEventListener('loadedmetadata', metadata);
    element.addEventListener('loadeddata', loaded);
    const mediaError = () => { if (local) fail(); };
    const intent = () => { if (initialized && !canceled && !failed && !element.error) resume.current.playing = !element.paused && !element.ended; };
    element.addEventListener('error', mediaError);
    element.addEventListener('ended', ended);
    element.addEventListener('play', intent); element.addEventListener('pause', intent);
    const stall = setInterval(() => {
      if (canceled || failed || !initialized || !request.quality || element.paused || element.ended || document.hidden || element.seeking) { lastProgress = performance.now(); return; }
      if (Math.abs(element.currentTime - lastTime) > 0.02) { lastTime = element.currentTime; lastProgress = performance.now(); }
      else if (performance.now() - lastProgress > 15000) fail();
    }, 1000);
    void (async () => {
      try {
        await priorTeardown;
        if (canceled || failed) return;
        const value = await platformBridge.getVideoPlayback(request.quality === 0 ? { bvid, cid, format: 'progressive' } : { bvid, cid, quality: request.quality });
        if (canceled || failed) { void release(value.handle); return; }
        local = value; handle = value.handle; durations = value.sources.map(source => source.durationSeconds);
        setPlayback(value);
        if (value.dash) {
          offset.current = 0; setStreamIndex(0);
          const { attachDash } = await import('./dash-player');
          if (canceled || failed) return;
          session = attachDash(element, value, resume.current.time, fail);
          await session.ready;
          dashLoaded = true;
          if (!canceled && !failed) { element.playbackRate = rate.current; if (element.readyState >= 2) loaded(); if (resume.current.playing) void element.play().catch(() => {}); }
        } else {
          if (!value.sources.length) throw new Error('No playable source.');
          let target = resume.current.time, next = 0;
          while (next + 1 < value.sources.length && durations[next] > 0 && target >= durations[next]) { target -= durations[next]; next++; }
          directSource(next);
        }
      } catch { fail(); }
    })();
    return () => {
      canceled = true; ready.current = false;
      if (segmentPicker.current === pickSegment) segmentPicker.current = () => {};
      if (deadline) clearTimeout(deadline); clearInterval(stall);
      element.removeEventListener('loadedmetadata', metadata); element.removeEventListener('loadeddata', loaded);
      element.removeEventListener('error', mediaError); element.removeEventListener('ended', ended);
      element.removeEventListener('play', intent); element.removeEventListener('pause', intent);
      element.pause();
      // Serialize destruction, not loading: a new selection can abort a pending load immediately.
      const destroyed = session ? session.dispose().catch(() => {}) : priorTeardown;
      teardown.current = destroyed.then(() => { element.removeAttribute('src'); element.load(); });
      if (handle) void release(handle);
    };
  }, [bvid, cid, request, video, capture, syncTime]);

  // Switching a legacy multi-file video is a seek, not a separate playback session.
  const selectSegment = (index: number) => segmentPicker.current(index);
  return { playback, quality, qualities, loading, notice, playError, setPlayError, streamIndex, time, syncTime,
    currentTime: () => offset.current + (video.current?.currentTime ?? 0), chooseQuality, reload, selectSegment };
}
