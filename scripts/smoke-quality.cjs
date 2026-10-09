// Production Electron bridge + UI, with an isolated synthetic account and local AVC/AAC media.
// Quality names/dimensions are synthetic metadata; the small recorded clip tests actual decoding.
const assert = require('node:assert/strict');
const { app, safeStorage, protocol, shell } = require('electron');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const indexedMp4 = require('./mp4-fixture.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'bili-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
const BV = 'BV1xx411c7mD', CID = '62131', DURATION = 6;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (data, code = 0) => new Response(JSON.stringify({ code, data }), { headers: { 'Content-Type': 'application/json' } });
const run = async (window, fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function until(window, fn, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!await run(window, fn)) {
    if (Date.now() > deadline) {
      const state = await run(window, () => {
        const video = document.querySelector('.watch-page video'), selector = document.querySelector('select[aria-label="Video quality"]');
        return { quality: selector?.value, disabled: selector?.disabled, options: selector && [...selector.options].map(option => option.value), src: video?.src, time: video?.currentTime, ready: video?.readyState, paused: video?.paused, error: video?.error?.message, text: document.querySelector('.watch-player-panel')?.textContent };
      });
      throw new Error(`${message}: ${JSON.stringify(state)}`);
    }
    await delay(40);
  }
}
async function select(window, value, label = 'Video quality') {
  await run(window, (value, label) => {
    const item = document.querySelector(`select[aria-label="${label}"]`);
    if (!item) throw new Error(`Missing ${label} selector`);
    if (item.disabled) throw new Error(`${label} selector disabled`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(item, String(value));
    item.dispatchEvent(new Event('change', { bubbles: true }));
  }, value, label);
}
async function setPosition(window, seconds, playing = false) {
  await run(window, async (seconds, playing) => {
    const video = document.querySelector('.watch-page video'); video.pause(); video.currentTime = seconds;
    if (playing) await video.play();
  }, seconds, playing);
  await until(window, () => !document.querySelector('.watch-page video').seeking, 'Local seek did not finish');
}
async function playableQuality(window, value, message) {
  await run(window, value => { window.__qualityExpected = value; }, value);
  await until(window, () => {
    const selector = document.querySelector('select[aria-label="Video quality"]'), video = document.querySelector('.watch-page video');
    return selector?.value === String(window.__qualityExpected) && video?.readyState >= 2 && !video.error && !selector.disabled && !document.querySelector('.watch-player-panel')?.textContent.includes('Switching playback…');
  }, message);
}

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bili-focus-quality-simulated-'));
  app.setPath('userData', directory); delete process.env.BILI_DEV_SERVER_URL;
  await app.whenReady(); assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true);
  protocol.handle('https', () => new Response(null, { status: 403 }));
  shell.openExternal = async () => { throw new Error('Quality test must not open external sites'); };
  const fake = { cookies: { SESSDATA: 'SIMULATED-QUALITY-NOT-A-REAL-SESSION', bili_jct: 'SIMULATED-CSRF', DedeUserID: '70001' }, refreshToken: '' };
  await writeFile(join(directory, 'session.enc'), (await safeStorage.encryptStringAsync(JSON.stringify(fake))).toString('base64'));
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ version: 1, lastTab: 'subscribe', appearance: 'light', compactCards: false, language: 'en' }));
  const requests = [], unexpected = [], mediaRequests = [];
  let progressiveBytes, dashVideo, dashAudio, corruptVideo;
  let holdCatalog = true, catalogWaiting = false, releaseCatalog, catalogFailure = false, qualityFailure = null, corruptQuality = null, unsupportedQuality = null;
  let delayedQuality = null, delayedWaiting = false, releaseDelayed;
  const keys = { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' };
  const track = (id, fixture, audio = false, corrupt = false) => ({
    id, baseUrl: `https://fixture.bilivideo.com/${audio ? 'audio' : corrupt ? 'corrupt-video' : 'video'}.mp4`, mimeType: `${audio ? 'audio' : 'video'}/mp4`, codecs: !audio && unsupportedQuality === id ? 'avc1.ffffff' : fixture.codecs,
    bandwidth: audio ? 64000 : 500000, width: audio ? 0 : id === 120 ? 3840 : id === 80 ? 1920 : id === 64 ? 1280 : 640,
    height: audio ? 0 : id === 120 ? 2160 : id === 80 ? 1080 : id === 64 ? 720 : 360,
    SegmentBase: { Initialization: fixture.initialization, indexRange: fixture.indexRange },
  });
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    requests.push({ path: url.pathname, query: url.search });
    if (url.hostname === 'fixture.bilivideo.com') {
      assert.equal(new Headers(init.headers).has('Cookie'), false); assert.equal(new Headers(init.headers).has('Authorization'), false);
      const data = url.pathname === '/video.mp4' ? dashVideo.bytes : url.pathname === '/audio.mp4' ? dashAudio.bytes : url.pathname === '/corrupt-video.mp4' ? corruptVideo : progressiveBytes;
      assert.ok(data?.length, 'Media must be generated before playback');
      const range = new Headers(init.headers).get('Range'); let start = 0, end = data.length - 1;
      if (range) { const match = /^bytes=(\d+)-(\d*)$/.exec(range); assert.ok(match, `Unexpected fixture range ${range}`); start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      mediaRequests.push({ path: url.pathname, range });
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.length}` } });
      const body = data.slice(start, end + 1);
      return new Response(init.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers: {
        'Content-Type': url.pathname === '/audio.mp4' ? 'audio/mp4' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(body.length),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
      } });
    }
    if (url.origin !== 'https://api.bilibili.com') { unexpected.push(url.href); throw new Error('Unexpected fixture network call'); }
    switch (url.pathname) {
      case '/x/web-interface/nav': return json({ isLogin: true, mid: 70001, uname: 'SIMULATED Quality Account', face: '', level_info: { current_level: 3 }, vipStatus: 0, vipType: 0, wbi_img: keys });
      case '/x/polymer/web-dynamic/v1/feed/all': return json({ items: [{ type: 'DYNAMIC_TYPE_AV', modules: { module_author: { mid: 70002, name: 'SIMULATED Creator', following: true, pub_ts: 1700000000 }, module_dynamic: { major: { type: 'MAJOR_TYPE_ARCHIVE', archive: { bvid: BV, title: 'SIMULATED Quality Video', cover: '', duration_text: '00:06', stat: { play: 42 } } } } } }], has_more: false, offset: '' });
      case '/x/relation': return json({ mid: 70002, attribute: 2 });
      case '/x/relation/followings': return json({ total: 1, list: [{ mid: 70002, uname: 'SIMULATED Creator', face: '', attribute: 2 }] });
      case '/x/web-interface/wbi/index/top/feed/rcmd': return json({ item: [] });
      case '/x/web-interface/view': return json({ bvid: BV, aid: 2, title: 'SIMULATED Quality Video', desc: 'Locally generated video; quality dimensions are metadata fixtures.', duration: DURATION, pic: '', pubdate: 1700000000, stat: { view: 42 }, owner: { mid: 70002, name: 'SIMULATED Creator', face: '' }, pages: [{ cid: Number(CID), page: 1, part: 'First part', duration: DURATION }] });
      case '/x/tag/archive/tags': return json([]);
      case '/x/v2/dm/web/seg.so': return new Response(new Uint8Array());
      case '/x/v2/reply': return json({ page: { num: 1, count: 0 }, replies: [] });
      case '/x/player/wbi/playurl': {
        assert.match(url.searchParams.get('w_rid'), /^[a-f0-9]{32}$/);
        if (url.searchParams.get('fnval') === '1') {
          assert.equal(url.searchParams.get('fourk'), '0'); assert.equal(url.searchParams.get('platform'), 'html5');
          return json({ quality: 64, durl: [{ url: 'https://fixture.bilivideo.com/progressive.mp4', length: DURATION * 1000 }] });
        }
        const quality = Number(url.searchParams.get('qn'));
        if (holdCatalog) { catalogWaiting = true; await new Promise(resolve => { releaseCatalog = resolve; }); }
        if (catalogFailure || qualityFailure === quality) return json(null, -403);
        if (delayedQuality === quality) { delayedWaiting = true; await new Promise(resolve => { releaseDelayed = resolve; }); }
        return json({ quality, dash: { duration: DURATION, video: [120, 80, 64, 16].map(id => track(id, dashVideo, false, corruptQuality === id)), audio: [track(30280, dashAudio, true)] } });
      }
      default: unexpected.push(url.pathname); throw new Error('Unexpected fixture API path');
    }
  };
  const watchdog = setTimeout(() => { console.error('Quality smoke timed out.'); app.exit(1); }, 150000);
  let checked = false;
  app.on('browser-window-created', (_event, window) => {
    if (checked || window.getParentWindow()) return; checked = true;
    window.webContents.setBackgroundThrottling(false); window.once('ready-to-show', () => setImmediate(() => window.hide()));
    window.webContents.once('did-finish-load', async () => {
      try {
        await until(window, () => document.querySelector('.subscription-card .video-open'), 'Synthetic feed missing');
        const clips = await run(window, async () => {
          const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const context = canvas.getContext('2d');
          const stream = canvas.captureStream(10), audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
          oscillator.connect(destination); oscillator.start(); await audio.resume();
          const combined = new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
          const recorders = [new MediaRecorder(combined, { mimeType: 'video/mp4;codecs=avc1.42001f,mp4a.40.2' }), new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.42001f' }), new MediaRecorder(destination.stream, { mimeType: 'audio/mp4;codecs=mp4a.40.2' })];
          const chunks = recorders.map(() => []), stopped = recorders.map((recorder, index) => {
            recorder.ondataavailable = event => chunks[index].push(event.data); const promise = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start(); return promise;
          });
          for (let i = 0; i < 60; i++) { context.fillStyle = i % 2 ? '#c9637c' : '#212126'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#fff'; context.font = '18px sans-serif'; context.fillText(`LOCAL AVC/AAC ${i}`, 40, 95); await new Promise(resolve => setTimeout(resolve, 100)); }
          recorders.forEach(recorder => recorder.stop()); await Promise.all(stopped); oscillator.stop(); await audio.close(); stream.getTracks().forEach(track => track.stop());
          return Promise.all(chunks.map(async parts => [...new Uint8Array(await new Blob(parts).arrayBuffer())]));
        });
        progressiveBytes = new Uint8Array(clips[0]); dashVideo = indexedMp4(clips[1], DURATION * 1000); dashAudio = indexedMp4(clips[2], DURATION * 1000);
        corruptVideo = Buffer.from(dashVideo.bytes); const payload = corruptVideo.indexOf(Buffer.from('mdat')); assert.ok(payload > 0); corruptVideo.fill(0, payload + 4);
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2, 'Compatible MP4 did not load while catalog was pending');
        await until(window, () => document.querySelector('select[aria-label="Video quality"]')?.value === '0', 'Compatible must be the default');
        await run(window, async () => document.querySelector('.watch-page video').play());
        await until(window, () => document.querySelector('.watch-page video').currentTime > 0.45, 'Pending catalog interrupted default playback');
        assert.equal(catalogWaiting, true, 'Quality catalog should load in the background');
        const directSource = await run(window, () => document.querySelector('.watch-page video').src); assert.match(directSource, /^bili-media:\/\/stream\//);
        holdCatalog = false; releaseCatalog();
        await until(window, () => document.querySelector('select[aria-label="Video quality"] option[value="120"]'), 'Quality catalog did not populate');
        assert.equal(await run(window, () => document.querySelector('.watch-page video').src), directSource, 'Catalog discovery must not attach DASH');
        assert.equal(await run(window, () => document.querySelector('.watch-page video').paused), false, 'Catalog discovery must not pause direct playback');
        assert.deepEqual(await run(window, () => [...document.querySelector('select[aria-label="Video quality"]').options].map(option => option.value)), ['0', '120', '80', '64', '16']);
        assert.equal(mediaRequests.some(request => request.path === '/audio.mp4' || request.path === '/video.mp4'), false, 'Background discovery must not download DASH media');
        await setPosition(window, 0.7); await select(window, 1.5, 'Playback speed');
        await run(window, () => { window.__qualityExpected = 80; }); await select(window, 80); await playableQuality(window, 80, '1080p DASH failed');
        assert.equal(await run(window, () => { const video = document.querySelector('.watch-page video'); return Boolean(video.srcObject) || (video.currentSrc || video.src).startsWith('blob:'); }), true, 'DASH must attach a media source');
        assert.ok(await run(window, () => Math.abs(document.querySelector('.watch-page video').currentTime - 0.7) < 0.2), 'Paused quality switch lost position');
        assert.equal(await run(window, () => document.querySelector('.watch-page video').paused), true, 'Paused quality switch resumed unexpectedly');
        assert.equal(await run(window, () => document.querySelector('.watch-page video').playbackRate), 1.5);
        await run(window, async () => document.querySelector('.watch-page video').play());
        await until(window, () => document.querySelector('.watch-page video').currentTime > 1.1, 'AVC/AAC DASH did not sustain playback');
        assert.ok(mediaRequests.some(request => request.path === '/audio.mp4' && request.range), 'AAC stream must be requested through native range proxy');
        const decoded = await run(window, () => { const video = document.querySelector('.watch-page video'); return { video: video.webkitVideoDecodedByteCount, audio: video.webkitAudioDecodedByteCount, frames: video.getVideoPlaybackQuality().totalVideoFrames }; });
        assert.ok(decoded.frames > 0, 'DASH must decode actual AVC frames'); if (typeof decoded.audio === 'number') assert.ok(decoded.audio > 0, 'DASH must decode AAC audio');
        await setPosition(window, 0.6, true); const before4k = await run(window, () => document.querySelector('.watch-page video').currentTime);
        await run(window, () => { window.__qualityExpected = 120; }); await select(window, 120); await playableQuality(window, 120, '4K metadata selection failed');
        await until(window, () => !document.querySelector('.watch-page video').paused && document.querySelector('.watch-page video').currentTime > 0.7, 'Playing quality switch did not resume');
        assert.ok(await run(window, () => document.querySelector('.watch-page video').currentTime) >= before4k - 0.2);
        assert.equal(await run(window, () => document.querySelector('.watch-page video').playbackRate), 1.5);
        await setPosition(window, 0.7); qualityFailure = 64;
        await run(window, () => { window.__qualityExpected = 0; }); await select(window, 64); await playableQuality(window, 0, 'Rejected quality did not recover compatible MP4');
        assert.match(await run(window, () => document.querySelector('.watch-page video').src), /^bili-media:\/\/stream\//);
        assert.ok(await run(window, () => document.querySelector('.watch-player-panel .watch-notice')?.textContent.length > 0), 'Fallback must explain recovery');
        assert.ok(await run(window, () => Math.abs(document.querySelector('.watch-page video').currentTime - 0.7) < 0.2));
        qualityFailure = null; corruptQuality = 16;
        await select(window, 16);
        const corruptDeadline = Date.now() + 20000; while (!mediaRequests.some(request => request.path === '/corrupt-video.mp4')) { if (Date.now() > corruptDeadline) throw new Error('Corrupt stream fixture was not reached'); await delay(20); }
        await playableQuality(window, 0, 'Corrupt DASH media did not recover compatible MP4');
        assert.ok(mediaRequests.some(request => request.path === '/corrupt-video.mp4'), 'Corrupt stream fixture was not reached');
        assert.ok(await run(window, () => document.querySelector('.watch-player-panel .watch-notice')?.textContent.length > 0));
        corruptQuality = null; unsupportedQuality = 120;
        await run(window, () => { window.__fallbackNotice = document.querySelector('.watch-player-panel .watch-notice'); });
        await select(window, 120);
        await until(window, () => document.querySelector('.watch-player-panel .watch-notice') && document.querySelector('.watch-player-panel .watch-notice') !== window.__fallbackNotice, 'Unsupported codec did not report compatible recovery');
        await playableQuality(window, 0, 'Unsupported codec prevented compatible recovery');
        unsupportedQuality = null; delayedQuality = 64;
        await select(window, 64);
        const deadline = Date.now() + 5000; while (!delayedWaiting) { if (Date.now() > deadline) throw new Error('Delayed quality fixture not reached'); await delay(20); }
        await run(window, () => { window.__qualityExpected = 80; }); await select(window, 80); await playableQuality(window, 80, 'Latest quality did not replace pending request');
        releaseDelayed(); delayedQuality = null; await delay(300);
        assert.equal(await run(window, () => document.querySelector('select[aria-label="Video quality"]').value), '80', 'Stale quality response overrode latest selection');
        delayedQuality = 64; delayedWaiting = false;
        await select(window, 64);
        const backDeadline = Date.now() + 5000; while (!delayedWaiting) { if (Date.now() > backDeadline) throw new Error('Pending quality/back fixture not reached'); await delay(20); }
        await run(window, () => document.querySelector('.watch-back').click());
        await until(window, () => !document.querySelector('.watch-page'), 'Back did not close player');
        releaseDelayed(); delayedQuality = null; await delay(150);
        assert.equal(await run(window, () => document.querySelector('.watch-page') === null), true, 'Canceled quality request reopened the player');
        catalogFailure = true;
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2 && document.querySelector('select[aria-label="Video quality"]')?.value === '0', 'Failed catalog prevented compatible playback');
        await run(window, async () => document.querySelector('.watch-page video').play());
        await until(window, () => document.querySelector('.watch-page video').currentTime > 0.5, 'Catalog error interrupted compatible playback');
        assert.equal(await run(window, () => document.querySelector('.watch-player-panel [role="alert"]')), null, 'Catalog failure must not replace playable video with fatal error');
        window.setContentSize(392, 840); await delay(100);
        assert.equal(await run(window, () => document.documentElement.scrollWidth <= innerWidth), true, 'Quality selector must fit phone width');
        assert.deepEqual(unexpected, []);
        console.log(JSON.stringify({ simulatedFixturesOnly: true, productionBridgeAndUi: true, compatibleMp4BeforeCatalog: true, backgroundCatalogDoesNotPauseOrAttachDash: true, locallyRecordedAvcAacDashDecoded: decoded, synthetic1080pAnd4kSelection: true, preservedPausedAndPlayingPositionAndSpeed: true, rejectedQualityRecoversProgressive: true, corruptDashRecoversProgressive: true, unsupportedCodecRecoversProgressive: true, latestQualityRequestWins: true, backCancelsPendingQuality: true, catalogFailureLeavesVideoPlayable: true, nativeRangeProxyWithoutCredentials: true, phoneWidth: 392, unexpectedNetworkCalls: unexpected.length }, null, 2));
        clearTimeout(watchdog); app.exit(0);
      } catch (error) { console.error(error.stack); clearTimeout(watchdog); app.exit(1); }
    });
  });
  require(process.argv.includes('--packaged') ? '../release/win-unpacked/resources/app.asar/dist-electron/main.cjs' : '../dist-electron/main.cjs');
})().catch(error => { console.error(error.stack); app.exit(1); });
