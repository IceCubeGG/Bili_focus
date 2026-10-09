// Optional real-network production UI probe. Uses a fresh guest profile and one
// fixed Browse card; details, metadata, DASH/progressive media are all live.
// Never reads an existing profile, signs in, posts, or downloads a saved file.
const assert = require('node:assert/strict');
const { app, protocol } = require('electron');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

protocol.registerSchemesAsPrivileged([{ scheme: 'bili-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const BV = 'BV1xx411c7mD';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const nativeFetch = global.fetch;
const evidence = { guestOnly: true, fixedBrowseCardOnly: true, liveDetailsAndPlayurlAndMedia: true,
  nativeRequests: 0, rangeRequests: 0, posts: 0, authenticatedRequests: 0, checks: [] };
global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  const headers = new Headers(init.headers);
  if (headers.has('Cookie') || headers.has('Authorization')) {
    evidence.authenticatedRequests++;
    throw new Error('Guest probe must not send credentials.');
  }
  if (init.method && !['GET', 'HEAD'].includes(init.method)) {
    evidence.posts++;
    throw new Error('Guest probe only allows read requests.');
  }
  if (url.hostname === 'api.bilibili.com' && url.pathname === '/x/web-interface/wbi/index/top/feed/rcmd') {
    return new Response(JSON.stringify({ code: 0, data: { item: [{ bvid: BV, title: 'Guest live quality probe',
      owner: { mid: 1, name: 'Public video' }, duration: 2056, pic: '', stat: { view: 0 } }] } }),
    { headers: { 'Content-Type': 'application/json' } });
  }
  evidence.nativeRequests++;
  if (headers.has('Range')) evidence.rangeRequests++;
  return nativeFetch(input, init);
};

(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bili-focus-quality-live-'));
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  app.commandLine.appendSwitch('disk-cache-dir', join(directory, 'cache'));
  delete process.env.BILI_DEV_SERVER_URL;
  const watchdog = setTimeout(() => { console.error('Guest live quality probe timed out.'); app.exit(1); }, 150000);
  let checked = false;
  app.on('browser-window-created', (_event, window) => {
    if (checked || window.getParentWindow()) return;
    checked = true;
    window.webContents.setBackgroundThrottling(false);
    window.once('ready-to-show', () => setImmediate(() => window.hide()));
    const run = (fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
    const until = async (fn, message, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await run(fn);
        if (value) return value;
        await delay(100);
      }
      const alerts = await run(() => [...document.querySelectorAll('[role="alert"]')].map(item => item.textContent));
      throw new Error(`${message}. ${alerts.join('; ')}`);
    };
    const sample = () => run(() => {
      const video = document.querySelector('.watch-page video');
      return { time: video.currentTime, paused: video.paused, width: video.videoWidth, height: video.videoHeight,
        frames: video.getVideoPlaybackQuality().totalVideoFrames,
        audioBytes: video.webkitAudioDecodedByteCount ?? 0,
        quality: document.querySelector('select[aria-label="Video quality"]').value,
        dash: video.currentSrc.startsWith('blob:') || Boolean(video.srcObject), error: video.error?.code ?? null };
    });
    const sustained = async label => {
      const before = await sample();
      await delay(2500);
      const after = await sample();
      assert.equal(after.error, null, `${label} media element error`);
      assert.ok(after.time - before.time > 1.2, `${label} time must advance`);
      assert.ok(after.frames > before.frames + 10, `${label} video frames must decode`);
      assert.ok(after.audioBytes > before.audioBytes, `${label} audio must decode`);
      evidence.checks.push({ label, quality: after.quality, dash: after.dash,
        width: after.width, height: after.height,
        secondsAdvanced: +(after.time - before.time).toFixed(2),
        decodedFrames: after.frames - before.frames, decodedAudioBytes: after.audioBytes - before.audioBytes });
      console.log(JSON.stringify(evidence.checks.at(-1)));
    };
    const choose = quality => run(quality => {
      const select = document.querySelector('select[aria-label="Video quality"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, String(quality));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, quality);
    window.webContents.once('did-finish-load', async () => {
      try {
        await until(() => document.querySelector('.live-video-card .video-open'), 'Fixed public Browse card did not load');
        const account = await run(() => window.bilibili.getAccount());
        assert.equal(account.status, 'signed-out'); assert.equal(account.profile, null);
        await run(() => document.querySelector('.live-video-card .video-open').click());
        await until(() => document.querySelector('.watch-page video')?.readyState >= 2, 'Compatible media did not load');
        assert.equal((await sample()).quality, '0');
        await run(() => document.querySelector('.watch-page video').play());
        await sustained('compatible-default');
        await until(() => [...document.querySelectorAll('select[aria-label="Video quality"] option')].some(option => option.value === '32'), 'Guest 480p quality unavailable');
        const position = (await sample()).time;
        await choose(32);
        await until(() => {
          const video = document.querySelector('.watch-page video');
          return video && (video.currentSrc.startsWith('blob:') || Boolean(video.srcObject)) && video.readyState >= 2 && !video.paused &&
            document.querySelector('select[aria-label="Video quality"]').value === '32' &&
            !document.querySelector('.watch-player-panel')?.textContent.includes('Switching playback');
        }, 'Live 480p DASH did not play');
        assert.ok((await sample()).time >= position - 0.5, 'Playing quality switch must preserve position');
        await sustained('dash-480p');
        await run(() => document.querySelector('.watch-page video').pause());
        const pausedAt = (await sample()).time;
        await choose(16);
        await until(() => {
          const video = document.querySelector('.watch-page video');
          return video && (video.currentSrc.startsWith('blob:') || Boolean(video.srcObject)) && video.readyState >= 2 &&
            document.querySelector('select[aria-label="Video quality"]').value === '16' &&
            !document.querySelector('.watch-player-panel')?.textContent.includes('Switching playback');
        }, 'Live 360p DASH did not load');
        await delay(500);
        const paused = await sample();
        assert.equal(paused.paused, true, 'Paused quality switch must stay paused');
        assert.ok(Math.abs(paused.time - pausedAt) < 0.6, 'Paused quality switch must preserve position');
        await run(() => document.querySelector('.watch-page video').play());
        await sustained('dash-360p');
        await choose(0);
        await until(() => {
          const video = document.querySelector('.watch-page video');
          return video?.src.startsWith('bili-media:') && video.readyState >= 2 && !video.paused &&
            document.querySelector('select[aria-label="Video quality"]').value === '0';
        }, 'Switching back to Compatible did not play');
        await sustained('compatible-after-dash');
        assert.equal(evidence.posts, 0); assert.equal(evidence.authenticatedRequests, 0);
        console.log(JSON.stringify({ ...evidence, sustainedVideoAndAudioDecoded: true,
          playingAndPausedPositionRetained: true, switchedBackToCompatible: true }, null, 2));
        clearTimeout(watchdog); app.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Guest live quality probe failed.');
        try {
          console.error(JSON.stringify({ diagnostic: await run(() => {
            const video = document.querySelector('.watch-page video');
            const select = document.querySelector('select[aria-label="Video quality"]');
            return { readyState: video?.readyState, networkState: video?.networkState, paused: video?.paused,
              time: video?.currentTime, error: video?.error?.code ?? null,
              sourceKind: video?.src.startsWith('blob:') ? 'dash-blob' : video?.src.startsWith('bili-media:') ? 'native-progressive' : 'empty',
              currentSourceKind: video?.currentSrc.startsWith('blob:') ? 'dash-blob' : video?.currentSrc.startsWith('bili-media:') ? 'native-progressive' : 'empty',
              sourceObject: video?.srcObject ? Object.prototype.toString.call(video.srcObject) : null,
              quality: select?.value, choices: [...(select?.options ?? [])].map(option => ({ value: option.value, label: option.textContent })),
              notices: [...document.querySelectorAll('.watch-player-panel .watch-notice')].map(item => item.textContent) };
          }), nativeRequests: evidence.nativeRequests, rangeRequests: evidence.rangeRequests }));
        } catch { /* The renderer may already be shutting down. */ }
        clearTimeout(watchdog); app.exit(1);
      }
    });
  });
  require('../dist-electron/main.cjs');
})().catch(error => { console.error(error instanceof Error ? error.message : 'Guest live quality startup failed.'); app.exit(1); });
