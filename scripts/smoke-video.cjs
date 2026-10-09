// Production bridge/UI test: encrypted synthetic session and entirely local network fixtures.
// The playable WebM clip is generated from a canvas inside the isolated test window.
const assert = require('node:assert/strict');
const { app, safeStorage, protocol, net, shell, dialog } = require('electron');
const { mkdtemp, writeFile, readFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
protocol.registerSchemesAsPrivileged([{ scheme: 'bili-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
const BV = 'BV1xx411c7mD', EPISODE = 'BV1xx411c7mE';
const delay = value => new Promise(resolve => setTimeout(resolve, value));
const json = (data, code = 0) => new Response(JSON.stringify({ code, data }), { headers: { 'Content-Type': 'application/json' } });
const varint = value => { let rest = BigInt(value), result = []; do { let byte = Number(rest & 127n); rest >>= 7n; if (rest) byte |= 128; result.push(byte); } while (rest); return result; };
const field = (key, value) => typeof value === 'string' ? [key * 8 + 2, ...varint(Buffer.byteLength(value)), ...Buffer.from(value)] : [key * 8, ...varint(value)];
const dm = [...field(1, 12345), ...field(2, 0), ...field(3, 1), ...field(5, 16777215), ...field(7, 'SIMULATED Danmu · Hello 世界'), ...field(12, '12345')];
const danmu = new Uint8Array([10, ...varint(dm.length), ...dm]);
const comment = (id, text) => ({ rpid_str: id, member: { mid: '70002', uname: 'SIMULATED Viewer', avatar: '' }, content: { message: text }, like: 3, rcount: id === '100' ? 2 : 0, ctime: 1700000000, replies: id === '100' ? [comment('201', 'SIMULATED reply preview')] : [] });
const keys = { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' };
const archive = bvid => ({ type: 'DYNAMIC_TYPE_AV', modules: { module_author: { mid: 70002, name: 'SIMULATED Creator', following: true, pub_ts: 1700000000 }, module_dynamic: { major: { type: 'MAJOR_TYPE_ARCHIVE', archive: { bvid, title: 'SIMULATED Video ' + bvid, cover: '', duration_text: '00:05', stat: { play: 42 } } } } } });
const run = async (window, fn, ...args) => { try { return await window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`); } catch (error) { throw new Error(`Renderer test call failed: ${fn.toString().slice(0, 180)}\n${error.message}`); } };
async function until(window, fn, message, timeout = 15000) { const deadline = Date.now() + timeout; while (!await window.webContents.executeJavaScript(`(async () => Boolean(await (${fn.toString()})()))()`)) { if (Date.now() > deadline) { const details = await run(window, () => [...document.querySelectorAll('[role="alert"]')].map(item => item.textContent)); throw new Error(`${message}: ${details.join('; ')}`); } await delay(50); } }
async function input(window, selector, value) { await run(window, (selector, value) => { const item = document.querySelector(selector), prototype = item instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : item instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(item, value); item.dispatchEvent(new Event(item instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }, selector, value); await delay(70); }

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bili-focus-video-simulated-')); app.setPath('userData', directory); delete process.env.BILI_DEV_SERVER_URL;
  await app.whenReady(); assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true);
  const saveFolder = join(directory, 'saved-fixtures'); await mkdir(saveFolder);
  let pickedFolder = saveFolder;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pickedFolder] });
  const openedFiles = []; shell.openPath = async path => { openedFiles.push(path); return ''; };
  const coverBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5f8AAAAASUVORK5CYII=', 'base64');
  protocol.handle('https', request => new URL(request.url).hostname === 'fixture.hdslb.com' ? new Response(coverBytes, { headers: { 'Content-Type': 'image/png' } }) : new Response(null, { status: 403 }));
  const fake = { cookies: { SESSDATA: 'SIMULATED-NOT-A-REAL-SESSION', bili_jct: 'SIMULATED-CSRF', DedeUserID: '70001' }, refreshToken: '' };
  await writeFile(join(directory, 'session.enc'), (await safeStorage.encryptStringAsync(JSON.stringify(fake))).toString('base64'));
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ version: 1, lastTab: 'subscribe', appearance: 'light', compactCards: false }));
  await writeFile(join(directory, 'subscribe-groups-70001.json'), JSON.stringify({ version: 1, groups: [{ id: '11111111-1111-4111-8111-111111111111', name: 'SIMULATED Group', uploaderIds: ['70002'] }] }));
  const requests = [], posts = [], external = [], unexpected = [];
  let mediaBytes = new Uint8Array(), mediaMime = 'video/webm', lateStarted = false, releaseLate = null, delayEpisode = false;
  shell.openExternal = async url => { external.push(url); };
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input)); requests.push({ path: url.pathname, query: url.search });
    if (url.hostname === 'fixture.hdslb.com') { assert.equal(new Headers(init.headers).has('Cookie'), false); return new Response(coverBytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(coverBytes.length) } }); }
    if (url.hostname === 'fixture.bilivideo.com') {
      assert.equal(new Headers(init.headers).has('Cookie'), false); assert.equal(new Headers(init.headers).has('Authorization'), false);
      const data = mediaBytes;
      const range = new Headers(init.headers).get('Range'); let start = 0, end = data.length - 1;
      if (range) { const match = /^bytes=(\d+)-(\d*)$/.exec(range); assert.ok(match); start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      const body = data.slice(start, end + 1); return new Response(body, { status: range ? 206 : 200, headers: { 'Content-Type': mediaMime, 'Accept-Ranges': 'bytes', 'Content-Length': String(body.length), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) } });
    }
    if (url.origin === 'https://passport.bilibili.com' && url.pathname === '/login/exit/v2') return json({});
    if (url.origin !== 'https://api.bilibili.com') { unexpected.push(url.href); throw new Error('Unexpected network call'); }
    const cookie = new Headers(init.headers).get('Cookie');
    if (init.method === 'POST') { assert.ok(cookie?.includes(fake.cookies.SESSDATA)); const body = new URLSearchParams(init.body); assert.equal(body.get('csrf'), fake.cookies.bili_jct); posts.push({ path: url.pathname, body }); }
    switch (url.pathname) {
      case '/x/web-interface/nav': return json({ isLogin: !!cookie, mid: 70001, uname: 'SIMULATED Account', face: '', level_info: { current_level: 3 }, vipStatus: 0, vipType: 0, wbi_img: keys }, cookie ? 0 : -101);
      case '/x/polymer/web-dynamic/v1/feed/all': return json({ items: [archive(BV), archive(EPISODE)], has_more: false, offset: '' });
      case '/x/relation': return json({ mid: 70002, attribute: 2 });
      case '/x/relation/followings': return json({ total: 1, list: [{ mid: 70002, uname: 'SIMULATED Creator', face: '', attribute: 2 }] });
      case '/x/space/wbi/arc/search': return json({ page: { pn: 1, ps: 30, count: 2 }, list: { vlist: [BV, EPISODE].map((bvid, index) => ({ bvid, mid: 70002, title: 'SIMULATED Video ' + bvid, author: 'SIMULATED Creator', pic: '', length: '00:05', created: 1700000000 - index, play: 42 })) } });
      case '/x/web-interface/wbi/index/top/feed/rcmd': return json({ item: [] });
      case '/x/web-interface/view': {
        const bvid = url.searchParams.get('bvid');
        if (bvid === EPISODE && delayEpisode) { lateStarted = true; await new Promise(resolve => { releaseLate = resolve; }); }
        return json({ bvid, aid: bvid === BV ? 2 : 3, title: 'SIMULATED Video ' + bvid, desc: 'SIMULATED description\n<script>Never executed</script>', duration: 5, pic: 'https://fixture.hdslb.com/cover.png', pubdate: 1700000000, stat: { view: 42 }, owner: { mid: 70002, name: 'SIMULATED Creator', face: '' }, pages: [{ cid: 62131, page: 1, part: 'First part', duration: 5 }, { cid: 62132, page: 2, part: 'Second part', duration: 5 }], ugc_season: { sections: [{ title: 'SIMULATED Series', episodes: [{ bvid: BV, title: 'Episode one' }, { bvid: EPISODE, title: 'Episode two' }] }] } });
      }
      case '/x/tag/archive/tags': return json([{ tag_name: 'SIMULATED Science' }]);
      case '/x/player/wbi/playurl': {
        assert.match(url.searchParams.get('w_rid'), /^[a-f0-9]{32}$/);
        if (url.searchParams.get('fnval') !== '1') return json(null, -400); // Catalog failure must leave default playback intact.
        assert.equal(url.searchParams.get('fourk'), '0');
        assert.equal(url.searchParams.get('platform'), 'html5');
        assert.equal(url.searchParams.get('qn'), '64', 'The pre-selector default quality must be retained');
        return json({ quality: 16, durl: [{ url: 'https://fixture.bilivideo.com/clip.mp4', length: 2000 }] });
      }
      case '/x/v2/dm/web/seg.so': return new Response(danmu);
      case '/x/v2/reply': return json({ page: { num: Number(url.searchParams.get('pn')), count: 21 }, replies: url.searchParams.get('pn') === '1' ? [comment('100', 'SIMULATED Comment <img src=x onerror=alert(1)>')] : [comment('101', 'SIMULATED older comment')] });
      case '/x/v2/reply/reply': return json({ page: { num: Number(url.searchParams.get('pn')), count: 2 }, replies: [comment('201', 'SIMULATED first reply'), comment('202', 'SIMULATED second reply')] });
      case '/x/v2/dm/post': return json({ dmid_str: '12346', visible: true });
      case '/x/v2/reply/add': return json({ rpid_str: '203' });
      default: unexpected.push(url.pathname); throw new Error('Unexpected fixture path');
    }
  };
  const watchdog = setTimeout(() => { console.error('Video smoke timed out.'); app.exit(1); }, 90000); let checked = false;
  app.on('browser-window-created', (_event, window) => {
    if (checked || window.getParentWindow()) return; checked = true;
    window.webContents.setBackgroundThrottling(false); window.once('ready-to-show', () => setImmediate(() => window.hide()));
    window.webContents.once('did-finish-load', async () => {
      try {
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2, 'Fixture feed not loaded');
        await run(window, () => document.querySelector('.subscription-directory-toggle').click());
        await until(window, () => document.querySelector('[data-group-id]'), 'Fixture group not loaded');
        await run(window, () => document.querySelector('[data-group-id]').click());
        await until(window, () => document.querySelector('.subscription-selection')?.textContent.includes('SIMULATED Group') && document.querySelectorAll('.subscription-card').length === 2 && !document.querySelector('.loading-state'), 'Group library not loaded');
        const sourceSummary = await run(window, () => document.querySelector('.subscription-selection').textContent);
        const sourcePages = requests.filter(request => request.path === '/x/space/wbi/arc/search').length;
        const clips = await run(window, async () => {
          const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const context = canvas.getContext('2d');
          const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
          const mp4Mime = 'video/mp4;codecs=avc1.42001f,mp4a.40.2';
          if (!MediaRecorder.isTypeSupported(mp4Mime)) throw new Error('MP4 fixture recording is unsupported');
          const audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start(); await audio.resume();
          const combined = new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
          const mp4 = new MediaRecorder(combined, { mimeType: mp4Mime });
          const mp4Chunks = []; mp4.ondataavailable = event => mp4Chunks.push(event.data);
          const mp4Stopped = new Promise(resolve => { mp4.onstop = resolve; }); mp4.start();
          const chunks = []; recorder.ondataavailable = event => chunks.push(event.data); const stopped = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
          for (let i = 0; i < 20; i++) { context.fillStyle = i % 2 ? '#c9637c' : '#212126'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#fff'; context.font = '18px sans-serif'; context.fillText('SIMULATED LOCAL VIDEO', 40, 95); await new Promise(resolve => setTimeout(resolve, 100)); }
          recorder.stop(); mp4.stop(); await Promise.all([stopped, mp4Stopped]); oscillator.stop(); await audio.close(); stream.getTracks().forEach(track => track.stop()); return { webm: [...new Uint8Array(await new Blob(chunks).arrayBuffer())], mp4: [...new Uint8Array(await new Blob(mp4Chunks).arrayBuffer())] };
        });
        mediaBytes = new Uint8Array(clips.webm); assert.ok(mediaBytes.length > 100);
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2 && document.querySelector('[data-comment-id="100"]'), 'Production player/comments did not load');
        assert.equal(await run(window, () => document.querySelector('.watch-description script') === null && document.querySelector('.comment-content img') === null), true, 'Remote markup must render as plain text');
        assert.equal(await run(window, () => document.querySelectorAll('.watch-downloads button:not(:disabled)').length), 2);
        await window.webContents.executeJavaScript("document.querySelector('.watch-playback-tools button:last-child').click()", true);
        await until(window, () => document.fullscreenElement?.classList.contains('watch-player-stage'), 'Desktop fullscreen permission was denied');
        assert.equal(window.isFullScreen(), true);
        assert.equal(await run(window, () => document.querySelector('.watch-player-stage').clientHeight >= innerHeight - 1), true);
        assert.equal(await run(window, () => document.querySelector('.fullscreen-exit')), null);
        await run(window, () => document.exitFullscreen());
        await until(window, () => !document.fullscreenElement, 'Exit fullscreen failed');
        await run(window, () => document.querySelector('.watch-downloads button:first-child').click());
        await until(window, async () => (await window.bilibili.getDownloads()).jobs[0]?.state === 'completed', 'Video download failed');
        let downloaded = await run(window, async () => (await window.bilibili.getDownloads()).jobs[0]);
        assert.deepEqual(new Uint8Array(await readFile(downloaded.files[0])), mediaBytes);
        await run(window, () => document.querySelector('.watch-downloads button:nth-child(2)').click());
        await until(window, async () => (await window.bilibili.getDownloads()).jobs.filter(job => job.state === 'completed').length === 2, 'Cover download failed');
        downloaded = await run(window, async () => (await window.bilibili.getDownloads()).jobs.find(job => job.kind === 'cover'));
        assert.deepEqual(await readFile(downloaded.files[0]), coverBytes);
        const oldSource = await run(window, () => document.querySelector('.watch-page video').src);
        assert.match(oldSource, /^bili-media:\/\/stream\//);
        await run(window, async () => { await document.querySelector('.watch-page video').play(); });
        await until(window, () => document.querySelector('.watch-page video').currentTime > 0.8, 'Local video did not sustain playback');
        await run(window, () => document.querySelector('.watch-page video').pause());
        await until(window, () => document.querySelectorAll('.danmu-item').length > 0, 'Danmu not visible at playback time');
        await run(window, () => document.querySelector('.danmu-toggle input').click());
        assert.equal(await run(window, () => document.querySelectorAll('.danmu-item').length), 0);
        await run(window, () => document.querySelector('.danmu-toggle input').click());
        await input(window, 'input[aria-label="Danmu message"]', 'SIMULATED send at current time');
        await run(window, () => document.querySelector('.danmu-bar button').click());
        await until(window, () => document.querySelector('.watch-player-panel .watch-notice'), 'Danmu send not acknowledged');
        const sentDanmu = posts.find(post => post.path === '/x/v2/dm/post'); assert.ok(sentDanmu); assert.equal(sentDanmu.body.get('oid'), '62131'); assert.ok(Number(sentDanmu.body.get('progress')) > 0);
        await input(window, 'select[aria-label="Playback speed"]', '1.5'); assert.equal(await run(window, () => document.querySelector('.watch-page video').playbackRate), 1.5);
        await run(window, () => document.querySelector('.load-comments').click());
        await until(window, () => document.querySelector('[data-comment-id="101"]'), 'Older comments not appended');
        await input(window, 'select[aria-label="Comment ordering"]', 'newest');
        await until(window, () => document.querySelector('[data-comment-id="100"]') && !document.querySelector('[data-comment-id="101"]'), 'Comment sort must reset pages');
        await run(window, () => document.querySelector('.comment-thread-button').click());
        await until(window, () => document.querySelector('.thread-original') && document.querySelector('[data-comment-id="202"]'), 'Thread replies did not load');
        await run(window, () => document.querySelector('[data-comment-id="202"] .comment-meta button').click());
        await input(window, 'textarea[aria-label="Comment message"]', 'SIMULATED explicit reply');
        await run(window, () => document.querySelector('.comment-composer button[type="submit"], .comment-composer .button.primary').click());
        await until(window, () => document.querySelector('.watch-comments .watch-notice'), 'Reply send not acknowledged');
        const reply = posts.find(post => post.path === '/x/v2/reply/add'); assert.equal(reply.body.get('oid'), '2'); assert.equal(reply.body.get('root'), '100'); assert.equal(reply.body.get('parent'), '202');
        await run(window, () => { document.querySelector('.danmu-toggle input').click(); });
        await run(window, () => document.querySelectorAll('.watch-part-list button')[1].click());
        await until(window, () => document.querySelector('.watch-part-list button[aria-pressed="true"]')?.textContent.includes('Second part') && document.querySelector('.watch-page video')?.readyState >= 2, 'Part switching did not replace the stream');
        assert.ok(requests.some(request => request.path === '/x/player/wbi/playurl' && new URLSearchParams(request.query).get('cid') === '62132'));
        assert.equal(await run(window, () => document.querySelector('.danmu-toggle input').checked), false, 'Danmu visibility preference must survive part switching');
        assert.equal(await run(window, () => document.querySelector('.watch-page video').playbackRate), 1.5, 'Playback speed must survive part switching');
        assert.equal((await net.fetch(oldSource)).status, 410, 'Old part handles must be revoked');
        await run(window, () => document.querySelector('.watch-creator').click()); await delay(100); assert.deepEqual(external, ['https://space.bilibili.com/70002']);
        window.setContentSize(392, 840); await delay(150);
        assert.equal(await run(window, () => document.documentElement.scrollWidth <= innerWidth), true, 'Phone video page must not overflow');
        await run(window, () => document.querySelector('.watch-back').click());
        await until(window, () => !document.querySelector('.watch-page') && document.querySelectorAll('.subscription-card').length === 2 && !document.querySelector('.subscription-card').closest('[hidden]'), 'Back must restore the unchanged source feed');
        assert.equal(await run(window, () => document.querySelector('.subscription-selection').textContent), sourceSummary, 'Back must preserve the selected group');
        assert.equal(requests.filter(request => request.path === '/x/space/wbi/arc/search').length, sourcePages, 'Watching must not reload the underlying group library');
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2, 'Second video opening failed');
        await input(window, 'select[aria-label="Series episode"]', EPISODE);
        await until(window, () => document.querySelector('.watch-page h1')?.textContent.includes('BV1xx411c7mE') && document.querySelector('.watch-page video')?.readyState >= 2, 'Episode selection failed');
        await run(window, () => document.querySelector('.watch-back').click());
        await until(window, () => !document.querySelector('.watch-page'), 'Episode back must return to source, not create an extra watch history');
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2, 'Delayed selection setup failed');
        delayEpisode = true; lateStarted = false;
        await input(window, 'select[aria-label="Series episode"]', EPISODE);
        const deadline = Date.now() + 5000; while (!lateStarted) { if (Date.now() > deadline) throw new Error('Delayed episode fixture not reached'); await delay(20); }
        await run(window, () => document.querySelector('.watch-back').click());
        await until(window, () => !document.querySelector('.watch-page'), 'Back must work while episode details are pending');
        releaseLate(); delayEpisode = false; await delay(100);
        assert.equal(await run(window, () => document.querySelector('.watch-page') === null), true, 'Delayed episode details must not reopen the video page');
        await run(window, () => document.querySelectorAll('.bottom-nav button')[2].click());
        await until(window, () => document.querySelector('[data-testid="interface-language"]'), 'Language option missing');
        await until(window, () => document.querySelectorAll('.saved-file').length === 2, 'Saved video and cover must appear in the manager');
        const initialFolders = await run(window, () => window.bilibili.getSaveFolders()); assert.equal(initialFolders.folders.length, 1);
        const initialFolderId = initialFolders.activeFolderId;
        await input(window, 'input[aria-label="Search saved files"]', '.png');
        assert.equal(await run(window, () => document.querySelectorAll('.saved-file').length), 1);
        await input(window, 'input[aria-label="Search saved files"]', ''); await input(window, 'select[aria-label="File type"]', 'video');
        assert.equal(await run(window, () => document.querySelectorAll('.saved-file').length), 1);
        await run(window, () => document.querySelector('.saved-file button').click()); await delay(80); assert.equal(openedFiles.length, 1); assert.match(openedFiles[0], /\.(mp4|webm)$/);
        await assert.rejects(run(window, id => window.bilibili.openSavedFile({ folderId: id, fileId: '../../session.enc' }), initialFolderId), /Choose a video or cover/);
        await input(window, 'select[aria-label="File type"]', 'all');
        const otherFolder = join(directory, 'other-saved'); await mkdir(otherFolder); pickedFolder = otherFolder;
        await run(window, () => [...document.querySelectorAll('.save-folder-manager button')].find(button => button.textContent === 'Add save folder').click());
        await until(window, async () => (await window.bilibili.getSaveFolders()).folders.length === 2 && document.querySelector('.save-folder-label select')?.options.length === 2 && !document.querySelector('.saved-file'), 'Second folder selection did not refresh');
        await input(window, '.save-folder-label select', initialFolderId);
        await until(window, () => document.querySelectorAll('.saved-file').length === 2, 'Browsing the first folder failed');
        assert.equal((await run(window, () => window.bilibili.getDownloads())).folder, otherFolder, 'Browsing must not change the download destination');
        await run(window, () => [...document.querySelectorAll('.save-folder-manager button')].find(button => button.textContent === 'Use for new downloads').click());
        await until(window, async () => (await window.bilibili.getSaveFolders()).activeFolderId === document.querySelector('.save-folder-label select').value && !document.querySelector('.save-folder-manager button').disabled, 'Switching destination failed');
        await run(window, () => [...document.querySelectorAll('.save-folder-manager button')].find(button => button.textContent === 'Forget folder').click());
        await until(window, async () => (await window.bilibili.getSaveFolders()).folders.length === 1 && document.querySelector('.save-folder-label select')?.options.length === 1, 'Forgetting a shortcut failed');
        assert.equal((await run(window, () => window.bilibili.getDownloads())).folder, null); assert.deepEqual(await readFile(downloaded.files[0]), coverBytes);
        pickedFolder = saveFolder;
        await run(window, () => [...document.querySelectorAll('.save-folder-manager button')].find(button => button.textContent === 'Add save folder').click());
        await until(window, () => document.querySelectorAll('.saved-file').length === 2, 'Re-adding a forgotten folder must preserve files');
        assert.equal(await run(window, () => document.documentElement.scrollWidth <= innerWidth), true, 'Save-folder manager must fit phone width');
        await input(window, '[data-testid="interface-language"]', 'zh-CN');
        await until(window, async () => document.documentElement.lang === 'zh-CN' && (await window.bilibili.getSettings()).language === 'zh-CN', 'Chinese language preference not saved');
        assert.deepEqual(await run(window, () => [...document.querySelectorAll('.bottom-nav button')].map(button => button.textContent)), ['浏览', '订阅', '选项']);
        assert.equal(await run(window, () => document.querySelector('.theme-selector').textContent), '跟随系统浅色深色');
        assert.equal(await run(window, () => document.querySelector('.save-folder-manager button').textContent), '添加保存文件夹');
        assert.equal(await run(window, () => document.documentElement.scrollWidth <= innerWidth), true, 'Chinese Options must fit phone width');
        const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await reloaded;
        await until(window, () => document.querySelector('[data-testid="interface-language"]')?.value === 'zh-CN' && document.documentElement.lang === 'zh-CN', 'Chinese must survive restart');
        await until(window, () => document.querySelectorAll('.saved-file').length === 2 && document.querySelector('.save-folder-label select')?.options.length === 2, 'Saved folders must survive reload');
        await run(window, () => document.querySelectorAll('.bottom-nav button')[0].click());
        await until(window, () => document.querySelector('.feed-settings:not(:disabled)'), 'Chinese Browse did not load');
        await run(window, () => document.querySelector('.feed-settings').click());
        await until(window, () => document.querySelector('.preset-dialog')?.open, 'Chinese preset editor did not open');
        assert.equal(await run(window, () => document.querySelector('#preset-title').textContent), '推荐设置');
        await run(window, () => document.querySelector('.preset-dialog-heading .icon-button').click());
        await run(window, () => document.querySelectorAll('.bottom-nav button')[1].click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2, 'Chinese subscription feed missing');
        await run(window, () => document.querySelector('.subscription-directory-toggle').click());
        await until(window, () => document.querySelector('.new-subscription-group:not(:disabled)'), 'Chinese groups missing');
        assert.equal(await run(window, () => document.querySelector('.directory-heading h2').textContent), '订阅列表');
        await run(window, () => document.querySelector('.new-subscription-group').click());
        await until(window, () => document.querySelector('.subscription-group-dialog')?.open, 'Chinese group editor missing');
        assert.equal(await run(window, () => document.querySelector('.subscription-group-dialog h2').textContent), '创建分组');
        await run(window, () => document.querySelector('.subscription-group-dialog .icon-button').click());
        mediaBytes = new Uint8Array(clips.mp4); mediaMime = 'video/mp4';
        assert.ok(mediaBytes.length > 100);
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2, 'Direct MP4 video/audio did not load');
        assert.equal(await run(window, () => document.querySelector('#comments-title').textContent.startsWith('评论')), true);
        assert.equal(await run(window, () => document.querySelector('.watch-description').textContent.includes('SIMULATED description')), true, 'Source content must not be translated');
        assert.equal(await run(window, () => document.querySelector('select[aria-label="视频清晰度"]').value), '0', 'Compatible remains the safe default in Chinese');
        assert.match(await run(window, () => document.querySelector('.watch-page video').src), /^bili-media:\/\/stream\//, 'The player must use a direct native source rather than a DASH blob');
        assert.equal(await run(window, () => document.documentElement.scrollWidth <= innerWidth), true, 'Chinese player must fit phone width');
        await input(window, 'select[aria-label="播放倍速"]', '1.5');
        await run(window, async () => document.querySelector('.watch-page video').play());
        await until(window, () => document.querySelector('.watch-page video').currentTime > 0.7, 'Direct MP4 must sustain playback with audio');
        await run(window, () => document.querySelector('.watch-page video').pause());
        assert.equal(await run(window, () => document.querySelector('.watch-page video').playbackRate), 1.5);
        await run(window, () => document.querySelectorAll('.watch-part-list button')[1].click());
        await until(window, () => document.querySelector('.watch-part-list button[aria-pressed="true"]')?.textContent.includes('Second part') && document.querySelector('.watch-page video')?.readyState >= 2, 'MP4 part selection must replace the stream');
        assert.equal(await run(window, () => document.querySelector('.watch-page video').playbackRate), 1.5, 'Speed must survive MP4 part selection');
        await run(window, () => document.querySelector('.watch-playback-tools button:first-of-type').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2, 'MP4 reload must work');
        assert.equal(await run(window, () => document.querySelector('select[aria-label="视频清晰度"]').value), '0');
        await run(window, () => document.querySelectorAll('.bottom-nav button')[2].click());
        await input(window, '[data-testid="interface-language"]', 'en');
        await until(window, async () => (await window.bilibili.getSettings()).language === 'en', 'English language preference not saved');
        assert.deepEqual(await run(window, () => [...document.querySelectorAll('.bottom-nav button')].map(button => button.textContent)), ['Browse', 'Subscribe', 'Options']);
        await run(window, () => document.querySelectorAll('.bottom-nav button')[1].click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2, 'English feed did not restore');
        await run(window, () => document.querySelector('.subscription-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page video')?.readyState >= 2, 'Final video opening failed');
        assert.equal(await run(window, () => document.querySelector('select[aria-label="Video quality"]').value), '0', 'Compatible remains the safe default in English');
        const authenticatedSource = await run(window, () => document.querySelector('.watch-page video').src);
        await run(window, async () => { await window.bilibili.signOut(); });
        await until(window, () => document.querySelector('input[aria-label="Danmu message"]')?.disabled && document.querySelector('.watch-page video')?.readyState >= 2, 'Guest viewing must work and disable social sends after sign-out');
        assert.ok([403, 410].includes((await net.fetch(authenticatedSource)).status), 'MP4 handles must be revoked on account change');
        await assert.rejects(run(window, async () => window.bilibili.sendDanmu({ bvid: 'BV1xx411c7mD', cid: '62131', text: 'must not send', timeSeconds: 0 })), /Sign in/);
        assert.equal(posts.length, 2, 'Only the explicit fixture Danmu/reply submissions may post');
        assert.deepEqual(unexpected, []);
        console.log(JSON.stringify({ simulatedFixturesOnly: true, productionBridgeAndUi: true, locallyGeneratedWebmAndAvcAacMp4DecodedAndPlayed: true, compatibleDefaultSurvivesCatalogFailure: true, chineseAndEnglishUiAndSavedPreference: true, desktopFullscreenAndExitWithoutExtraButton: true, videoAndCoverDownloadedAndBytesVerified: true, nativeRangeProxy: true, detailsTagsPartsEpisodes: true, mp4ReloadAndPartSelection: true, danmuToggleAndSend: true, commentsOrderingPagingAndReplies: true, explicitPostsOnly: posts.length, nativeCsrfOnly: true, oldPartAndAccountHandlesRevoked: true, creatorProfileFixedUrl: true, returnRestoresSourceFeedAndGroup: true, delayedEpisodeDoesNotReopenPage: true, phoneWidth: 392, guestPlaybackAndSignedOutSendGate: true, unexpectedNetworkCalls: unexpected.length }, null, 2));
        clearTimeout(watchdog); app.exit(0);
      } catch (error) { console.error(error.stack); clearTimeout(watchdog); app.exit(1); }
    });
  });
  require(process.argv.includes('--packaged') ? '../release/win-unpacked/resources/app.asar/dist-electron/main.cjs' : '../dist-electron/main.cjs');
})().catch(error => { console.error(error.stack); app.exit(1); });
