import shaka from 'shaka-player/dist/shaka-player.compiled';
import { dashManifest } from '../core/playback';
import type { VideoPlayback } from '../shared/contracts';

shaka.polyfill.installAll();
// Only opaque native handles use this scheme; the renderer never sees signed CDN URLs.
shaka.net.NetworkingEngine.registerScheme('bili-media', shaka.net.HttpFetchPlugin.parse);
export const supportsMedia = (mime: string): boolean => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime);

/** Dispose is available immediately, including while attach/load is still pending. */
export function attachDash(video: HTMLVideoElement, playback: VideoPlayback, start: number, failed: () => void) {
  const manifest = dashManifest(playback, supportsMedia);
  const url = URL.createObjectURL(new Blob([manifest], { type: 'application/dash+xml' }));
  const player = new shaka.Player();
  let stopped = false, disposing: Promise<void> | undefined;
  const error = () => { if (!stopped) failed(); };
  player.addEventListener('error', error);
  const dispose = () => {
    if (!disposing) {
      stopped = true; player.removeEventListener('error', error);
      disposing = player.destroy().finally(() => URL.revokeObjectURL(url));
    }
    return disposing;
  };
  const ready = (async () => {
    await player.attach(video);
    if (stopped) return;
    const retryParameters = { maxAttempts: 2, timeout: 15000, connectionTimeout: 8000, stallTimeout: 5000 };
    player.configure({ abr: { enabled: false }, manifest: { retryParameters },
      streaming: { bufferingGoal: 20, bufferBehind: 15, rebufferingGoal: 1, loadTimeout: 20, retryParameters } });
    await player.load(url, start, 'application/dash+xml');
  })();
  // The owner also observes ready. This prevents a canceled load from becoming unhandled.
  void ready.catch(() => {});
  return { ready, dispose };
}
