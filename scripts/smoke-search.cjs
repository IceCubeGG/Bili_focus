// Isolated production bridge/UI, no real account and no external writes.
const assert = require('node:assert/strict');
const { app, protocol } = require('electron');
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const BV = 'BV1xx411c7mD', BV2 = 'BV1EMp46wE12';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (data, code = 0) => new Response(JSON.stringify({ code, data }));
const run = (window, fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function until(window, fn, message) { const end = Date.now() + 15000; while (!await window.webContents.executeJavaScript(`Boolean((${fn.toString()})())`)) { if (Date.now() > end) throw Error(message); await delay(40); } }
(async () => {
  app.setPath('userData', await mkdtemp(join(tmpdir(), 'bili-focus-search-'))); delete process.env.BILI_DEV_SERVER_URL;
  const live = process.argv.includes('--live'), unexpected = [], requests = [];
  let releaseSlow, slowWaiting = false, failRetry = true;
  if (!live) global.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    if (url.pathname === '/x/web-interface/nav') return json({ isLogin: false }, -101);
    if (url.pathname.endsWith('/feed/rcmd')) return json({ item: [] });
    if (url.pathname.endsWith('/finger/spi')) return json({ b_3: 'ISSUED-TEST-BUVID' });
    if (url.pathname === '/x/web-interface/search/type') {
      assert.equal(new Headers(init.headers).get('Cookie'), 'buvid3=ISSUED-TEST-BUVID');
      const keyword = url.searchParams.get('keyword'), page = Number(url.searchParams.get('page'));
      if (keyword === 'slow') { slowWaiting = true; await new Promise(resolve => { releaseSlow = resolve; }); }
      if (keyword === 'retry' && failRetry) { failRetry = false; return new Response('', { status: 503 }); }
      const item = bvid => ({ type: 'video', bvid, title: `<em>${keyword}</em> &amp; test`, mid: 123, author: 'Creator', duration: '1:02', play: 42, pubdate: 1700000000 });
      return json({ page, numResults: 2, numPages: 2, result: page === 1 ? [item(BV)] : [item(BV), item(BV2)] });
    }
    if (url.pathname === '/x/web-interface/view') return json({ bvid: BV, aid: 170001, cid: 62131, title: 'Exact BV video', desc: 'Description', duration: 30, pubdate: 1700000000, owner: { mid: 123, name: 'Creator' }, stat: { view: 42 }, pages: [{ cid: 62131, page: 1, part: 'Part 1', duration: 30 }] });
    if (url.pathname === '/x/tag/archive/tags') return json([{ tag_name: '科技' }]);
    if (url.pathname === '/x/player/playurl') return json(null, -404); // Player exercised independently by video/quality checks.
    if (url.pathname === '/x/v2/reply') return json({ replies: [], page: { num: 1, count: 0 } });
    unexpected.push(url.pathname); return new Response('', { status: 403 });
  };
  const watchdog = setTimeout(() => { console.error('Search smoke timed out'); app.exit(1); }, 120000);
  app.on('browser-window-created', (_event, window) => {
    if (window.getParentWindow()) return;
    window.once('ready-to-show', () => setImmediate(() => window.hide()));
    window.webContents.once('did-finish-load', async () => {
      const submit = async keyword => {
        await run(window, keyword => { const input = document.querySelector('[data-testid="video-search-input"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, keyword); input.dispatchEvent(new Event('input', { bubbles: true })); }, keyword);
        await delay(80); await run(window, () => document.querySelector('.video-search-form').requestSubmit());
      };
      try {
        await until(window, () => document.querySelector('.open-search:not(:disabled)'), 'Search entry missing');
        await until(window, () => { const image = document.querySelector('.brand-mark img'); return image?.complete && image.naturalWidth > 0; }, 'Packaged branding image missing');
        assert.ok(await run(window, () => document.querySelector('link[rel="icon"]')?.href.includes('app-icon')));
        assert.equal((await run(window, () => window.bilibili.getAccount())).status, 'signed-out');
        await run(window, () => document.querySelector('.open-search').click());
        await until(window, () => document.querySelector('.search-page'), 'Search page missing');
        await submit(live ? '科技' : '科学 & music');
        await until(window, () => document.querySelector('.search-card'), 'Keyword results missing');
        assert.equal(await run(window, () => document.querySelector('.search-card h3 em') === null), true);
        await run(window, () => document.querySelector('.search-page .feed-pagination button').click());
        await until(window, () => document.querySelectorAll('.search-card').length > 1, 'More search results missing');
        if (!live) {
          assert.equal(await run(window, () => document.querySelectorAll('.search-card').length), 2);
          await submit('slow'); while (!slowWaiting) await delay(20);
          await submit('latest'); await until(window, () => document.querySelector('.search-card h3')?.textContent.includes('latest'), 'Latest request missing');
          releaseSlow(); await delay(120); assert.ok(await run(window, () => document.querySelector('.search-card h3').textContent.includes('latest')));
          await submit('retry'); await until(window, () => document.querySelector('.search-page [role="alert"]'), 'Failure state missing');
          await run(window, () => document.querySelector('.search-page [role="alert"] button').click());
          await until(window, () => document.querySelector('.search-card h3')?.textContent.includes('retry'), 'Retry missing');
        }
        await submit(BV); await until(window, () => document.querySelector('.search-card')?.dataset.bvid === 'BV1xx411c7mD' && document.querySelectorAll('.search-card').length === 1, 'Exact BV missing');
        await run(window, () => document.querySelector('.search-card .video-open').click());
        await until(window, () => document.querySelector('.watch-page h1'), 'Search result did not open video');
        await run(window, () => document.querySelector('.watch-back').click());
        await until(window, () => !document.querySelector('.watch-page'), 'Video Back missing');
        assert.equal(await run(window, () => document.querySelectorAll('.search-card').length), 1);
        assert.equal(await run(window, () => document.querySelector('[data-testid="video-search-input"]').value), BV);
        await run(window, () => document.querySelector('.search-back').click()); await until(window, () => !document.querySelector('.search-page'), 'Search Back missing');
        await run(window, () => document.querySelector('.bottom-nav button:last-child').click());
        await until(window, () => document.querySelector('[data-testid="interface-language"]'), 'Language settings missing');
        await run(window, () => { const select = document.querySelector('[data-testid="interface-language"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'zh-CN'); select.dispatchEvent(new Event('change', { bubbles: true })); });
        await until(window, () => document.documentElement.lang === 'zh-CN', 'Chinese missing');
        await run(window, () => document.querySelector('.open-search').click()); await until(window, () => document.querySelector('#search-title')?.textContent === '搜索视频', 'Chinese search missing');
        window.setContentSize(392, 840); await delay(150);
        assert.equal(await run(window, () => document.documentElement.scrollWidth <= innerWidth), true);
        await submit('科技'); await until(window, () => document.querySelector('.search-card'), 'Chinese results missing');
        const target = join(__dirname, '..', '.gradle-cache', 'search-phone.png'); await mkdir(join(__dirname, '..', '.gradle-cache'), { recursive: true }); window.showInactive(); await delay(200); await writeFile(target, (await Promise.race([window.webContents.capturePage(), delay(10000).then(() => { throw Error('Screenshot timed out'); })])).toPNG()); window.hide();
        assert.deepEqual(unexpected, []);
        console.log(JSON.stringify({ liveGuestSearch: live, keywordAndExactBv: true, paginationAndDedup: true, videoBackPreservesSearch: true, latestRequestWins: !live, retry: !live, chineseAndPhoneWidth: true, screenshot: target }));
        clearTimeout(watchdog); app.exit(0);
      } catch (error) { console.error(error.stack); clearTimeout(watchdog); app.exit(1); }
    });
  });
  require(process.argv.includes('--packaged') ? '../release/win-unpacked/resources/app.asar/dist-electron/main.cjs' : '../dist-electron/main.cjs');
})().catch(error => { console.error(error.stack); app.exit(1); });
