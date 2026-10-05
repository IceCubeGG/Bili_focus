// Production Subscribe checks using an isolated OS-encrypted synthetic account.
// Native fetch is replaced before app startup and never forwards a request.
// The UI and preload bridge themselves are unchanged. Optional screenshots are simulated.
const assert = require('node:assert/strict');
const { app, safeStorage } = require('electron');
const { mkdtemp, mkdir, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const captureRequested = process.argv.includes('--screenshots');

const API = 'https://api.bilibili.com';
const PASSPORT = 'https://passport.bilibili.com';
const ACCOUNT_UID = 70001;
const FOLLOWED_UID = 70002;
const MUTUAL_UID = 70003;
const UNFOLLOWED_UID = 70004;
const FAILED_UID = 70005;
const BV = { newest: 'BV1Miao6oE3a', older: 'BV1Miao6oE3b', oldest: 'BV1Miao6oE3c', unrelated: 'BV1Miao6oE3d', repost: 'BV1Miao6oE3e', advert: 'BV1Miao6oE3f', unverified: 'BV1Miao6oE3g', explicitlyUnfollowed: 'BV1Miao6oE3h' };
const BASE_TIME = Date.UTC(2026, 9, 4, 12, 0, 0) / 1000;
const CURSOR = '222222222222222222';
const json = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function upload(bvid, uid, seconds, title, patch = {}) {
  return {
    id_str: String(100000000000000000n + BigInt(seconds)), type: 'DYNAMIC_TYPE_AV', visible: true,
    modules: {
      module_author: { mid: uid, name: uid === MUTUAL_UID ? 'SIMULATED Mutual creator' : 'SIMULATED Followed creator', face: '', ...(uid === MUTUAL_UID ? {} : { following: true }), pub_ts: BASE_TIME + seconds, pub_action: '投稿了视频' },
      module_dynamic: { major: { type: 'MAJOR_TYPE_ARCHIVE', archive: {
        aid: seconds + 1000, bvid, title, cover: '', duration_text: '1:01:05', duration: 3665, pubdate: BASE_TIME + seconds, jump_url: '//www.bilibili.com/video/' + bvid,
        owner: { mid: uid, name: 'SIMULATED Followed creator' }, stat: { play: '42', view: 42, danmaku: '0' },
      } } },
      module_stat: {},
    },
    ...patch,
  };
}

const explicitlyUnfollowed = () => {
  const item = upload(BV.explicitlyUnfollowed, FOLLOWED_UID, 800, 'SIMULATED — Must never show: explicit unfollow');
  item.modules.module_author.following = false;
  return item;
};
const firstPage = () => ({ has_more: true, offset: CURSOR, update_baseline: '333333333333333333', items: [
  upload(BV.older, MUTUAL_UID, 300, 'SIMULATED — Followed older upload'),
  upload(BV.unrelated, UNFOLLOWED_UID, 400, 'SIMULATED — Must never show: unrelated creator'),
  upload(BV.newest, FOLLOWED_UID, 500, 'SIMULATED — Followed newest upload'),
  upload(BV.repost, FOLLOWED_UID, 600, 'SIMULATED — Must never show: repost', { type: 'DYNAMIC_TYPE_FORWARD', orig: upload(BV.unrelated, UNFOLLOWED_UID, 400, 'SIMULATED Original of repost') }),
  upload(BV.advert, FOLLOWED_UID, 700, 'SIMULATED — Must never show: advertisement', { is_ad: true, ad_info: { advertiser: 'simulated' }, business_info: { is_ad: true } }),
  explicitlyUnfollowed(),
  { id_str: '199999999999999999', type: 'DYNAMIC_TYPE_LIVE_RCMD', modules: { module_author: { mid: FOLLOWED_UID } } },
] });
const secondPage = () => ({ has_more: false, offset: '', update_baseline: '333333333333333333', items: [
  upload(BV.oldest, FOLLOWED_UID, 100, 'SIMULATED — Followed oldest upload'),
  upload(BV.newest, FOLLOWED_UID, 500, 'SIMULATED — Followed newest upload'),
] });

async function inPage(window, operation, ...args) {
  return window.webContents.executeJavaScript(`(${operation.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`);
}

async function until(window, condition, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (!(await inPage(window, condition))) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(40);
  }
}

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bili-focus-subscribe-simulated-'));
  app.setPath('userData', directory);
  delete process.env.BILI_DEV_SERVER_URL;
  await app.whenReady();
  assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true, 'OS encryption is required for the isolated synthetic session.');
  const fake = { cookies: { SESSDATA: 'SIMULATED-SESSION-NOT-A-REAL-ACCOUNT', bili_jct: 'SIMULATED-CSRF', DedeUserID: String(ACCOUNT_UID) }, refreshToken: '' };
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(fake));
  await writeFile(join(directory, 'session.enc'), encrypted.toString('base64'), 'utf8');
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ version: 1, lastTab: 'subscribe', appearance: 'light', compactCards: false }), 'utf8');
  await writeFile(join(directory, 'browse-presets.json'), JSON.stringify({ version: 1, activePresetId: 'exclude-subscribe-fixtures', presets: [{
    id: 'exclude-subscribe-fixtures', name: 'SIMULATED — Exclude these uploads', labels: ['Never matches these fixtures'], uploaders: [{ id: '99999', name: 'SIMULATED Different creator' }], match: 'all',
  }] }), 'utf8');
  const unexpected = [];
  const requests = [];
  let mode = 'normal';
  let releaseDelayed = null;
  let delayedStarted = false;
  let verificationFailed = false;
  let libraryDelayedStarted = false, releaseLibraryDelayed = null;
  const libraryTotal = 415;
  global.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    requests.push({ origin: url.origin, path: url.pathname, query: url.search });
    const cookie = new Headers(options.headers).get('Cookie');
    const permitted = url.origin === API && ['/x/web-interface/nav', '/x/polymer/web-dynamic/v1/feed/all', '/x/relation', '/x/relation/relations', '/x/relation/followings', '/x/space/wbi/arc/search', '/x/web-interface/wbi/index/top/feed/rcmd'].includes(url.pathname)
      || url.origin === PASSPORT && url.pathname === '/login/exit/v2';
    if (!permitted) { unexpected.push(url.origin + url.pathname); throw new Error('Unexpected URL rejected by the isolated simulation.'); }
    if (url.pathname !== '/x/web-interface/wbi/index/top/feed/rcmd') {
      assert.ok(cookie?.includes(fake.cookies.SESSDATA), 'Synthetic authenticated native calls must use only the fixture session.');
    }
    if (url.pathname === '/x/web-interface/nav') return json({ isLogin: true, mid: ACCOUNT_UID, uname: 'SIMULATED account', face: '', level_info: { current_level: 1 }, vipStatus: 0, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } });
    if (url.pathname === '/x/space/wbi/arc/search') {
      const mid = Number(url.searchParams.get('mid')), page = Number(url.searchParams.get('pn'));
      assert.ok([FOLLOWED_UID, MUTUAL_UID, 70006].includes(mid));
      assert.equal(url.searchParams.get('ps'), '30'); assert.equal(url.searchParams.get('order'), 'pubdate');
      assert.match(url.searchParams.get('w_rid'), /^[a-f0-9]{32}$/);
      if (['library-retry', 'group-library-retry'].includes(mode) && mid === FOLLOWED_UID && page === 2) throw new Error('SIMULATED catalog outage');
      if (mode === 'library-delayed' && mid === FOLLOWED_UID && page === 3 || mode === 'group-library-delayed' && mid === FOLLOWED_UID && page === 2) { libraryDelayedStarted = true; await new Promise(resolve => { releaseLibraryDelayed = resolve; }); }
      const count = mid === FOLLOWED_UID ? libraryTotal : mid === MUTUAL_UID ? 2 : 0;
      return json({ page: { pn: page, ps: 30, count }, list: { vlist: Array.from({ length: Math.min(30, Math.max(0, count - (page - 1) * 30)) }, (_, index) => {
        const number = (page - 1) * 30 + index + 1;
        return { mid, bvid: 'BV' + String(mid * 10000 + number).padStart(10, '0'), author: 'SIMULATED Library creator ' + mid, title: 'SIMULATED Full library video ' + number, created: BASE_TIME - number * 86400, pic: '', length: '01:01', play: number };
      }) } });
    }
    if (url.pathname === '/x/relation/followings') {
      assert.equal(url.searchParams.get('vmid'), String(ACCOUNT_UID));
      return json({ total: 4, list: [
        { mid: FOLLOWED_UID, uname: 'SIMULATED Followed creator', face: '', attribute: 2 },
        { mid: MUTUAL_UID, uname: 'SIMULATED Mutual creator', face: '', attribute: 6 },
        { mid: 70006, uname: 'SIMULATED Creator with no uploads', face: '', attribute: 2 },
        { mid: UNFOLLOWED_UID, uname: 'SIMULATED Not followed', face: '', attribute: 0 },
      ] });
    }
    if (url.pathname === '/x/web-interface/wbi/index/top/feed/rcmd') return json({ item: [] });
    if (url.pathname === '/login/exit/v2') return json({});
    if (url.pathname === '/x/polymer/web-dynamic/v1/feed/all') {
      assert.equal(url.searchParams.get('type'), 'video', 'Subscribe must request the followed video feed.');
      if (mode === 'delayed') {
        delayedStarted = true;
        await new Promise(resolve => { releaseDelayed = resolve; });
      }
      if (mode === 'verification-failure') return json({ has_more: false, offset: '', items: [upload(BV.unverified, FAILED_UID, 900, 'SIMULATED — Must never show: unverified creator')] });
      if (mode.startsWith('empty-first-older-')) {
        if (url.searchParams.get('offset') !== CURSOR) return json({ has_more: true, offset: CURSOR, items: [] });
        return json(mode === 'empty-first-older-failure'
          ? { has_more: false, offset: '', items: [upload(BV.unverified, FAILED_UID, 900, 'SIMULATED — Must never show: unverified older creator')] }
          : secondPage());
      }
      return json(url.searchParams.get('offset') === CURSOR ? secondPage() : firstPage());
    }
    const relation = id => {
      if (Number(id) === FAILED_UID) { verificationFailed = true; throw new Error('SIMULATED relation verification outage'); }
      return { mid: Number(id), attribute: [FOLLOWED_UID, 70006].includes(Number(id)) ? 2 : Number(id) === MUTUAL_UID ? 6 : 0 };
    };
    if (url.pathname === '/x/relation') return json(relation(url.searchParams.get('fid')));
    const relations = {};
    for (const id of (url.searchParams.get('fids') ?? '').split(',').filter(Boolean)) relations[id] = relation(id);
    return json(relations);
  };
  const outputDirectory = join(__dirname, '..', '.gradle-cache');
  await mkdir(outputDirectory, { recursive: true });
  let checked = false;
  const watchdog = setTimeout(() => { console.error('Simulated Subscribe production check timed out.'); app.exit(1); }, 60000);
  app.on('browser-window-created', (_event, window) => {
    window.once('ready-to-show', () => setImmediate(() => window.hide()));
    if (window.getParentWindow() || checked) return;
    checked = true;
    // Hidden test windows still need compositor frames for screenshot QA.
    window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', async () => {
      try {
        assert.equal(new URL(window.webContents.getURL()).protocol, 'file:', 'The test must run the production renderer.');
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && !document.querySelector('.tab-subscribe .loading-state'), 'Simulated followed uploads did not render.');
        const initial = await inPage(window, async () => ({
          bvids: [...document.querySelectorAll('.subscription-card')].map(card => card.dataset.bvid),
          account: await window.bilibili.getAccount(), presets: await window.bilibili.getBrowseSettings(),
          durations: [...document.querySelectorAll('.subscription-card .video-duration')].map(value => value.textContent),
        }));
        assert.deepEqual(initial.bvids, [BV.newest, BV.older], 'Only verified followed original uploads may render, newest first.');
        assert.equal(initial.account.profile.uid, ACCOUNT_UID);
        assert.equal(initial.account.status, 'signed-in');
        assert.equal(initial.presets.activePresetId, 'exclude-subscribe-fixtures', 'Browse preset fixture must remain active.');
        assert.deepEqual(initial.durations, ['1:01:05', '1:01:05']);
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        await until(window, () => document.querySelectorAll('[data-followed-uid]').length === 3 && !document.querySelector('.new-subscription-group:disabled'), 'The full followed roster and group settings must load.');
        await inPage(window, () => document.querySelector('[data-followed-uid="70002"]').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 30 && [...document.querySelectorAll('.subscription-card')].every(card => card.dataset.uploaderId === '70002'), 'Uploader selection must load a full creator-library page.');
        assert.equal(await inPage(window, () => document.querySelector('.subscription-summary').textContent.includes('415 videos')), true);
        mode = 'library-retry';
        await inPage(window, () => document.querySelector('.subscription-pagination button').click());
        await until(window, () => document.querySelector('.feed-error') && !document.querySelector('.loading-state'), 'A library page failure must offer retry.');
        mode = 'normal';
        await inPage(window, () => document.querySelector('.feed-error button').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 60 && !document.querySelector('.loading-state'), 'Retry must load page two, not refresh page one.');
        mode = 'library-delayed';
        await inPage(window, () => document.querySelector('.subscription-pagination button').click());
        const libraryDeadline = Date.now() + 5000;
        while (!libraryDelayedStarted) { if (Date.now() >= libraryDeadline) throw new Error('Delayed library fixture not reached'); await delay(20); }
        await inPage(window, () => document.querySelector('[data-followed-uid="70003"]').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && [...document.querySelectorAll('.subscription-card')].every(card => card.dataset.uploaderId === '70003') && !document.querySelector('.loading-state'), 'Switching creators must start their own catalog.');
        releaseLibraryDelayed(); await delay(100);
        assert.equal(await inPage(window, () => [...document.querySelectorAll('.subscription-card')].every(card => card.dataset.uploaderId === '70003')), true, 'Delayed previous-creator videos must not leak into the selection.');
        mode = 'normal';
        await inPage(window, () => document.querySelector('[data-followed-uid="70002"]').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 30 && !document.querySelector('.loading-state'), 'Reselecting the creator must start a fresh catalog.');
        for (let page = 2; page <= 14; page++) {
          await inPage(window, () => document.querySelector('.subscription-pagination button').click());
          await until(window, () => !document.querySelector('.loading-state') && !document.querySelector('.feed-error'), 'Catalog pagination must finish without errors.');
          assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), Math.min(page * 30, libraryTotal));
        }
        assert.equal(await inPage(window, () => !!document.querySelector('.subscription-pagination button')), false, 'The catalog must continue past 400 and end after all 415 uploads.');
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        assert.equal(await inPage(window, () => !!document.querySelector('.subscription-directory')), false);
        assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), libraryTotal, 'Hiding the list must preserve the creator library.');
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        await until(window, () => document.querySelectorAll('[data-followed-uid]').length === 3 && !document.querySelector('.new-subscription-group:disabled'), 'The toggle must reopen the list.');
        await inPage(window, () => document.querySelector('[data-followed-uid="70006"]').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 0 && document.querySelector('.feed-empty'), 'A followed creator without loaded uploads must stay empty.');
        await inPage(window, () => document.querySelector('.new-subscription-group').click());
        await until(window, () => document.querySelector('.subscription-group-dialog[open]'), 'The group editor must open.');
        await inPage(window, () => { const input = document.querySelector('.subscription-group-dialog .field-label input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'SIMULATED Science'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelectorAll('.group-member-choices input')[1].click(); });
        await until(window, () => !document.querySelector('.save-subscription-group:disabled'), 'Group name must update before saving.');
        await inPage(window, () => document.querySelector('.save-subscription-group').click());
        await until(window, () => !document.querySelector('.subscription-group-dialog[open]') && document.querySelector('[data-group-id]'), 'Saved groups must appear in the list.');
        const savedGroups = await inPage(window, () => window.bilibili.getSubscriptionGroups());
        assert.equal(savedGroups.groups[0].name, 'SIMULATED Science'); assert.deepEqual(savedGroups.groups[0].uploaderIds, [String(MUTUAL_UID)]);
        await inPage(window, () => document.querySelector('[data-group-id]').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && [...document.querySelectorAll('.subscription-card')].every(card => card.dataset.uploaderId === '70003') && !document.querySelector('.loading-state'), 'Groups must show the complete member library, including videos absent from recent dynamics.');
        await inPage(window, () => document.querySelector('.edit-subscription-group').click());
        await until(window, () => document.querySelector('.subscription-group-dialog[open]'), 'Saved group must be editable.');
        await inPage(window, () => { const input = document.querySelector('.subscription-group-dialog .field-label input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'SIMULATED Favorites'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelectorAll('.group-member-choices input')[0].click(); });
        await until(window, () => document.querySelector('.subscription-group-dialog .field-label input').value === 'SIMULATED Favorites', 'Edited group name must commit.');
        await inPage(window, () => document.querySelector('.save-subscription-group').click());
        await until(window, () => !document.querySelector('.subscription-group-dialog[open]') && document.querySelectorAll('.subscription-card').length === 30 && !document.querySelector('.loading-state'), 'Updating selected group membership must load the combined libraries.');
        assert.equal(await inPage(window, () => document.querySelector('.subscription-summary').textContent.includes('417 videos')), true, 'Group total must include every member library.');
        mode = 'group-library-retry';
        await inPage(window, () => document.querySelector('.subscription-pagination button').click());
        await until(window, () => document.querySelector('.feed-error') && !document.querySelector('.loading-state'), 'A failed group member page must display a retry.');
        assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), 30, 'Failed group pagination must not discard loaded videos.');
        mode = 'normal';
        await inPage(window, () => document.querySelector('.feed-error button').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 60 && !document.querySelector('.loading-state') && !document.querySelector('.feed-error'), 'Group retry must resume the failed member page without skipping or duplicating videos.');
        for (let page = 3; page <= 14; page++) {
          await inPage(window, () => document.querySelector('.subscription-pagination button').click());
          await until(window, () => !document.querySelector('.loading-state') && !document.querySelector('.feed-error'), 'Older group pages must load successfully.');
          assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), Math.min(page * 30, libraryTotal + 2));
        }
        assert.equal(await inPage(window, () => !!document.querySelector('.subscription-pagination button')), false, 'The group must end only after all 417 member uploads, beyond the old cap.');
        const groupVideos = await inPage(window, () => [...document.querySelectorAll('.subscription-card')].map(card => ({ id: card.dataset.bvid, uploader: card.dataset.uploaderId, time: Number(card.dataset.publishedAt) })));
        assert.equal(new Set(groupVideos.map(video => video.id)).size, libraryTotal + 2);
        assert.ok(groupVideos.every((video, index) => [String(FOLLOWED_UID), String(MUTUAL_UID)].includes(video.uploader) && (index === 0 || groupVideos[index - 1].time >= video.time)), 'Combined group libraries must stay member-only and newest first.');
        await inPage(window, () => document.querySelector('.subscription-refresh').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 30 && !document.querySelector('.loading-state'), 'Refreshing a group must restart all member library cursors.');
        mode = 'group-library-delayed'; libraryDelayedStarted = false;
        await inPage(window, () => document.querySelector('.subscription-pagination button').click());
        const groupDeadline = Date.now() + 5000;
        while (!libraryDelayedStarted) { if (Date.now() >= groupDeadline) throw new Error('Delayed group fixture not reached'); await delay(20); }
        await inPage(window, () => document.querySelector('.edit-subscription-group').click());
        await until(window, () => document.querySelector('.subscription-group-dialog[open]'), 'A group must remain editable while a member page is pending.');
        await inPage(window, () => { document.querySelectorAll('.group-member-choices input')[0].click(); document.querySelector('.save-subscription-group').click(); });
        await until(window, () => !document.querySelector('.subscription-group-dialog[open]') && document.querySelectorAll('.subscription-card').length === 2 && [...document.querySelectorAll('.subscription-card')].every(card => card.dataset.uploaderId === '70003') && !document.querySelector('.loading-state'), 'Removing a group member must replace their library immediately.');
        releaseLibraryDelayed(); await delay(100); mode = 'normal';
        assert.equal(await inPage(window, () => [...document.querySelectorAll('.subscription-card')].every(card => card.dataset.uploaderId === '70003')), true, 'A delayed removed member must not reappear.');
        assert.equal((await inPage(window, () => window.bilibili.getSubscriptionGroups())).groups[0].name, 'SIMULATED Favorites');
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        await until(window, () => document.querySelector('[data-group-id]')?.textContent.includes('SIMULATED Favorites'), 'Groups must restore when the list is reopened.');
        await inPage(window, () => document.querySelector('.all-followed').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && !document.querySelector('.loading-state'), 'All followed must return to the recent feed.');
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        await inPage(window, () => document.querySelector('.subscription-pagination button').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 3 && !document.querySelector('.tab-subscribe .loading-state'), 'Loading older uploads did not finish.');
        assert.deepEqual(await inPage(window, () => [...document.querySelectorAll('.subscription-card')].map(card => card.dataset.bvid)), [BV.newest, BV.older, BV.oldest], 'Pagination must deduplicate uploads and retain publication ordering.');
        const desktopImage = join(outputDirectory, 'subscribe-simulated-desktop.png');
        const phoneImage = join(outputDirectory, 'subscribe-simulated-phone.png');
        // Screenshot availability depends on the desktop compositor. Functional
        // and responsive-layout checks must also run on headless test hosts.
        if (captureRequested) await writeFile(desktopImage, (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG());
        window.setContentSize(390, 844);
        // Windows can round native window bounds by a few CSS pixels at
        // fractional display scaling; assert the phone range and actual layout.
        await until(window, () => innerWidth >= 380 && innerWidth <= 400 && getComputedStyle(document.querySelector('.subscription-grid')).gridTemplateColumns.split(' ').length === 1, 'Subscribe must use one column at phone width.');
        const phoneLayout = await inPage(window, () => ({
          viewport: innerWidth, content: document.documentElement.scrollWidth,
          cards: [...document.querySelectorAll('.subscription-card')].map(card => ({ left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right })),
        }));
        assert.ok(phoneLayout.content <= phoneLayout.viewport, 'The phone layout must not overflow horizontally.');
        assert.ok(phoneLayout.cards.every(card => card.left >= 0 && card.right <= phoneLayout.viewport), 'Phone cards must fit inside the viewport.');
        await inPage(window, () => document.querySelector('.subscription-directory-toggle').click());
        await until(window, () => document.querySelectorAll('[data-followed-uid]').length === 3 && document.querySelector('[data-group-id]'), 'Phone subscription list must load saved groups.');
        assert.equal(await inPage(window, () => document.documentElement.scrollWidth <= innerWidth), true, 'Open phone directory must not overflow.');
        await inPage(window, () => document.querySelector('.edit-subscription-group').click());
        await until(window, () => document.querySelector('.subscription-group-dialog[open]'), 'Phone group editor must open.');
        assert.equal(await inPage(window, () => { const bounds = document.querySelector('.subscription-group-dialog').getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth; }), true, 'Group editor must fit at phone width.');
        await inPage(window, () => { window.__fixtureConfirm = window.confirm; window.confirm = () => true; document.querySelector('.delete-subscription-group').click(); });
        await until(window, () => !document.querySelector('.subscription-group-dialog[open]') && !document.querySelector('[data-group-id]'), 'Deleting the local group must remove it without changing follows.');
        assert.equal((await inPage(window, () => window.bilibili.getSubscriptionGroups())).groups.length, 0);
        assert.equal(await inPage(window, () => document.querySelectorAll('[data-followed-uid]').length), 3);
        await inPage(window, () => { window.confirm = window.__fixtureConfirm; delete window.__fixtureConfirm; document.querySelector('.subscription-directory-toggle').click(); });
        if (captureRequested) await writeFile(phoneImage, (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG());
        window.setContentSize(1180, 840);
        await inPage(window, () => document.querySelector('.subscription-refresh').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && !document.querySelector('.tab-subscribe .loading-state'), 'Refresh must replace the accumulated pages.');
        assert.deepEqual(await inPage(window, () => [...document.querySelectorAll('.subscription-card')].map(card => card.dataset.bvid)), [BV.newest, BV.older]);

        mode = 'verification-failure';
        await inPage(window, () => document.querySelector('.subscription-refresh').click());
        await until(window, () => document.querySelector('.tab-subscribe .feed-error[role="alert"]') && !document.querySelector('.tab-subscribe .loading-state'), 'Failed relation verification must produce a visible error.');
        assert.equal(verificationFailed, true);
        assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), 0, 'Unverified creators must never render.');
        mode = 'empty-first-older-failure';
        await inPage(window, () => document.querySelector('.subscription-refresh').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 0 && document.querySelector('.subscription-pagination button') && !document.querySelector('.tab-subscribe .loading-state') && !document.querySelector('.tab-subscribe .feed-error'), 'An empty admitted batch must still offer older uploads.');
        assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), 0);
        await inPage(window, () => document.querySelector('.subscription-pagination button').click());
        await until(window, () => document.querySelector('.tab-subscribe .feed-error[role="alert"]') && !document.querySelector('.tab-subscribe .loading-state'), 'Older-page verification failure must display an error.');
        mode = 'empty-first-older-recovered';
        await inPage(window, () => document.querySelector('.tab-subscribe .feed-error button').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && !document.querySelector('.tab-subscribe .loading-state'), 'Retry with zero admitted uploads must reuse the failed older cursor.');
        assert.deepEqual(await inPage(window, () => [...document.querySelectorAll('.subscription-card')].map(card => card.dataset.bvid)), [BV.newest, BV.oldest]);
        mode = 'normal';
        await inPage(window, () => document.querySelector('.subscription-refresh').click());
        await until(window, () => document.querySelectorAll('.subscription-card').length === 2 && document.querySelectorAll('.subscription-card')[1]?.dataset.bvid === 'BV1Miao6oE3b' && !document.querySelector('.tab-subscribe .loading-state'), 'The feed must recover after verification succeeds.');

        mode = 'delayed';
        await inPage(window, () => document.querySelector('.subscription-refresh').click());
        const deadline = Date.now() + 5000;
        while (!delayedStarted) { if (Date.now() >= deadline) throw new Error('The delayed native feed fixture was not reached.'); await delay(20); }
        const signedOut = await inPage(window, () => window.bilibili.signOut());
        assert.equal(signedOut.status, 'signed-out');
        await until(window, () => document.querySelector('.subscription-sign-in') && document.querySelectorAll('.subscription-card').length === 0, 'Sign-out must hide all account uploads.');
        releaseDelayed();
        await delay(250);
        assert.equal(await inPage(window, () => document.querySelectorAll('.subscription-card').length), 0, 'A delayed previous-session response must not restore account uploads.');
        assert.equal((await inPage(window, () => window.bilibili.getAccount())).status, 'signed-out');
        await assert.rejects(inPage(window, () => window.bilibili.getSubscriptionGroups()), /Sign in/);
        await assert.rejects(readFile(join(directory, 'session.enc'), 'utf8'), error => error.code === 'ENOENT');
        assert.deepEqual(unexpected, [], 'All native network requests must be covered by isolated local fixtures.');
        assert.ok(requests.some(request => request.path === '/x/relation' || request.path === '/x/relation/relations'), 'Authoritative outgoing relations must have been verified.');
        console.log(JSON.stringify({ simulatedFixturesOnly: true, productionBridgeAndUi: true, isolatedEncryptedSyntheticSession: true, completeUploaderLibrary: true, uploaderCatalogVideos: libraryTotal, libraryPaginationBeyond400: true, libraryRetryKeepsPage: true, delayedPreviousUploaderIgnored: true, followedUploaderDirectory: true, exactUploaderSelection: true, togglePreservesSelection: true, groupCreateEditRestoreDelete: true, phoneDirectoryAndEditorFit: true, newestFirst: true, followedOnly: true, missingFollowingFlagUsesRelation: true, explicitUnfollowRemainsExcluded: true, originalUploadsOnly: true, paginationDeduplicates: true, refreshResetsPages: true, emptyBatchRetryKeepsOlderCursor: true, browsePresetIndependent: true, verificationFailureVisible: true, phoneLayoutFits: true, phoneViewport: phoneLayout.viewport, unverifiedCards: 0, delayedSignOutResponseIgnored: true, sessionFileRemoved: true, unexpectedNetworkCalls: unexpected.length, fixtureRequestCount: requests.length, screenshots: captureRequested ? { desktopImage, phoneImage } : 'not requested' }, null, 2));
        console.log('Simulated Subscribe production check passed. Isolated preferences: ' + directory);
        clearTimeout(watchdog);
        app.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.stack : 'Simulated Subscribe production check failed.');
        clearTimeout(watchdog);
        app.exit(1);
      }
    });
  });
  require('../dist-electron/main.cjs');
})().catch(error => { console.error(error instanceof Error ? error.stack : 'Simulated Subscribe check failed before startup.'); app.exit(1); });
