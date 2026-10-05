// Exercise the production app with corrupt Browse preferences in a new profile.
// Every bridge call reaches the real native host; account sign-in is never started.
const assert = require('node:assert/strict');
const { app } = require('electron');
const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bili-focus-feed-fail-closed-'));
  const corrupt = '{"version":1,"activePresetId":"saved-strict-preset","presets":[';
  const browsePath = join(directory, 'browse-presets.json');
  await writeFile(browsePath, corrupt, 'utf8');
  app.setPath('userData', directory);
  delete process.env.BILI_DEV_SERVER_URL;
  let checked = false;
  const watchdog = setTimeout(() => {
    console.error('Corrupt-preset production smoke check timed out.');
    app.exit(1);
  }, 55000);
  app.on('browser-window-created', (_event, window) => {
    window.once('ready-to-show', () => setImmediate(() => window.hide()));
    if (window.getParentWindow() || checked) return;
    checked = true;
    window.webContents.once('did-finish-load', async () => {
      try {
        assert.equal(new URL(window.webContents.getURL()).protocol, 'file:', 'Must test the production renderer.');
        const result = await window.webContents.executeJavaScript(`(async () => {
          const ensure = (value, message) => { if (!value) throw new Error(message); };
          const until = async (check, message, timeout = 25000) => {
            const deadline = Date.now() + timeout;
            while (!check()) {
              if (Date.now() > deadline) throw new Error(message);
              await new Promise(resolve => setTimeout(resolve, 40));
            }
          };
          ensure(window.bilibili, 'Production preload bridge is missing.');
          let maximumCards = document.querySelectorAll('.live-video-card').length;
          const observer = new MutationObserver(() => {
            maximumCards = Math.max(maximumCards, document.querySelectorAll('.live-video-card').length);
          });
          observer.observe(document.documentElement, { subtree: true, childList: true });
          try {
            const platform = await window.bilibili.getPlatform();
            const account = await window.bilibili.getAccount();
            ensure(platform.kind === 'desktop', 'The real desktop bridge was not exposed.');
            ensure(account.status === 'signed-out' && account.profile === null, 'The isolated test profile must be signed out.');
            let settingsRejected = false;
            try { await window.bilibili.getBrowseSettings(); }
            catch { settingsRejected = true; }
            ensure(settingsRejected, 'Corrupt saved presets must reject instead of returning unrestricted defaults.');
            await until(() => document.querySelector('.tab-browse .feed-error[role="alert"]'), 'Browse did not display the saved-settings error.');
            ensure(document.querySelector('.feed-settings')?.disabled, 'Settings editor must be disabled while saved rules cannot load.');
            ensure(document.querySelector('select[aria-label="Active recommendation preset"]')?.disabled, 'Preset selection must be disabled while saved rules cannot load.');
            ensure(document.querySelector('.tab-browse .loading-state')?.textContent.includes('Recommendations are hidden'), 'The feed must explain why recommendations are hidden.');

            // This is an actual public guest API request through the production host.
            // Its successful response ensures an empty page cannot mask a rendering leak.
            const page = await window.bilibili.getRecommendationPage({ cursor: null });
            ensure(page.videos.length > 0, 'Live Bilibili returned no candidates; this check needs real candidates.');
            await until(() => {
              const counts = document.querySelector('.feed-count')?.textContent.match(/(\\d+) shown.*?(\\d+) candidates checked/);
              return counts && Number(counts[2]) > 0;
            }, 'The Browse request did not load real candidates behind the saved-settings gate.');
            const candidatesChecked = Number(document.querySelector('.feed-count').textContent.match(/(\\d+) candidates checked/)[1]);
            await new Promise(resolve => setTimeout(resolve, 150));
            ensure(document.querySelectorAll('.live-video-card').length === 0 && maximumCards === 0, 'A recommendation card appeared despite corrupt saved allowlist rules.');

            const options = [...document.querySelectorAll('.bottom-nav button')].find(button => button.textContent.includes('Options'));
            ensure(options && !options.disabled, 'Options navigation must remain available.');
            options.click();
            await until(() => document.querySelector('.tab-options .account-card') && options.getAttribute('aria-current') === 'page', 'Options did not remain usable after the Browse settings failure.', 5000);
            ensure((await window.bilibili.getAccount()).status === 'signed-out', 'The test must never authenticate an account.');
            return { productionRenderer: true, isolatedSignedOutProfile: true, corruptSettingsRejected: true, hiddenFeedMessage: true, presetEditingBlocked: true, liveGuestCandidates: page.videos.length, candidatesChecked, maximumRenderedCards: maximumCards, optionsNavigationWorks: true };
          } finally { observer.disconnect(); }
        })()`);
        assert.equal(await readFile(browsePath, 'utf8'), corrupt, 'The app must preserve the corrupt file for repair.');
        result.corruptPreferencesPreserved = true;
        console.log(JSON.stringify(result, null, 2));
        console.log('Corrupt-preset production smoke check passed. Isolated preferences: ' + directory);
        clearTimeout(watchdog);
        app.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Corrupt-preset production smoke check failed.');
        clearTimeout(watchdog);
        app.exit(1);
      }
    });
  });
  require('../dist-electron/main.cjs');
})().catch(error => {
  console.error(error instanceof Error ? error.message : 'Corrupt-preset production smoke check failed before startup.');
  app.exit(1);
});
