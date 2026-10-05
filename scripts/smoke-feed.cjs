// Exercise the packaged desktop feed using a separate, temporary guest profile.
const assert = require('node:assert/strict');
const { app } = require('electron');
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bili-focus-feed-smoke-'));
  app.setPath('userData', directory);
  const assertions = [];
  const passed = (name) => { assertions.push(name); console.log(`PASS ${name}`); };
  const watchdog = setTimeout(() => { console.error('Feed smoke check timed out.'); app.exit(1); }, 180000);
  let checked = false;
  app.on('browser-window-created', (_event, window) => {
    if (checked || window.getParentWindow()) return;
    checked = true;
    window.once('ready-to-show', () => setImmediate(() => window.hide()));
    window.webContents.once('did-finish-load', async () => {
      const run = (fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
      const waitFor = async (fn, description, timeout = 30000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const result = await run(fn);
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Timed out waiting for ${description}.`);
      };
      const setInput = async (selector, value) => {
        await run((selector, value) => {
          const input = document.querySelector(selector);
          if (!input) throw new Error(`Missing field ${selector}`);
          const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
        }, selector, value);
        // React commits the dispatched change before a separate renderer task clicks Save.
        await new Promise(resolve => setTimeout(resolve, 100));
      };
      const openEditor = async () => {
        await run(() => document.querySelector('.feed-settings').click());
        await waitFor(() => Boolean(document.querySelector('dialog.preset-dialog[open]')), 'Feed settings dialog');
      };
      const capture = async (name, width, height) => {
        console.log(`Capturing ${name}`);
        window.showInactive();
        window.setContentSize(width, height);
        await new Promise(resolve => setTimeout(resolve, 300));
        const imageMetrics = await run(async () => {
          const visible = Array.from(document.querySelectorAll('.live-thumbnail img')).filter(img => {
            const bounds = img.getBoundingClientRect();
            return bounds.bottom > 0 && bounds.top < window.innerHeight;
          }).slice(0, 3);
          await Promise.race([
            Promise.all(visible.map(async img => { try { await img.decode(); } catch {} })),
            new Promise(resolve => setTimeout(resolve, 8000)),
          ]);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return visible.map(img => {
            const bounds = img.getBoundingClientRect();
            const parent = img.parentElement.getBoundingClientRect();
            const style = getComputedStyle(img);
            return { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: bounds.width, height: bounds.height, parentWidth: parent.width, parentHeight: parent.height, objectFit: style.objectFit, position: style.position };
          });
        });
        if (name.endsWith('feed.png')) console.log(JSON.stringify({ capture: name, images: imageMetrics }));
        await new Promise(resolve => setTimeout(resolve, 100));
        const target = join(__dirname, '..', '.gradle-cache', name);
        await mkdir(join(__dirname, '..', '.gradle-cache'), { recursive: true });
        const screenshot = await Promise.race([
          window.webContents.capturePage(undefined, { stayAwake: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out capturing ${name}`)), 10000)),
        ]);
        await writeFile(target, screenshot.toPNG());
        window.hide();
      };
      const saveEditor = async () => {
        await run(() => {
          const button = Array.from(document.querySelectorAll('.preset-editor-actions button')).find(value => value.textContent.includes('Save and apply'));
          if (!button) throw new Error('Save and apply action is missing.');
          button.click();
        });
        await waitFor(() => !document.querySelector('dialog.preset-dialog'), 'saved editor to close');
        const result = await run(() => window.bilibili.getBrowseSettings());
        return result;
      };
      try {
        await waitFor(() => Boolean(window.bilibili && document.querySelector('.feed-settings:not(:disabled)')), 'production feed bridge and Browse settings');
        const account = await run(() => window.bilibili.getAccount());
        assert.equal(account.status, 'signed-out');
        assert.equal(account.profile, null);
        passed('isolated profile starts as a guest');

        const first = await run(() => window.bilibili.getRecommendationPage({ cursor: null }));
        assert.ok(first.videos.length > 0, 'Live guest recommendations should contain videos.');
        assert.ok(first.hasMore && first.cursor, 'Live recommendation cursor should permit a next page.');
        assert.equal(new Set(first.videos.map(value => value.bvid)).size, first.videos.length);
        assert.ok(first.videos.every(value => /^BV[0-9A-Za-z]{10}$/.test(value.bvid) && /^[1-9]\d*$/.test(value.uploader.id)));
        assert.ok(first.videos.every(value => value.cover === '' || value.cover.startsWith('https://')));
        passed(`live guest bridge feed contains ${first.videos.length} safe, unique videos`);

        const next = await run(cursor => window.bilibili.getRecommendationPage({ cursor }), first.cursor);
        assert.ok(next.videos.length > 0, 'The next live recommendation page should contain videos.');
        assert.notEqual(next.cursor, first.cursor, 'The recommendation cursor must advance.');
        passed(`live pagination advances and returns ${next.videos.length} videos`);

        const sample = first.videos.slice(0, 3).map(value => value.bvid);
        const tags = await run(bvids => window.bilibili.getVideoLabels({ bvids }), sample);
        assert.equal(tags.length, sample.length);
        assert.ok(tags.every(value => sample.includes(value.bvid) && ['ready', 'unavailable'].includes(value.status)));
        assert.ok(tags.some(value => value.status === 'ready' && value.labels.length > 0), 'At least one sampled live video should return verified tags.');
        passed('actual video tags are verified through the native bridge');

        const initial = await run(() => window.bilibili.getBrowseSettings());
        assert.deepEqual(initial, { version: 1, activePresetId: null, presets: [] });
        const preset = { id: 'smoke-roundtrip', name: 'Smoke roundtrip', labels: tags.find(value => value.status === 'ready').labels.slice(0, 1), uploaders: [first.videos[0].uploader], match: 'all' };
        const preferences = { version: 1, activePresetId: preset.id, presets: [preset] };
        assert.deepEqual(await run(settings => window.bilibili.updateBrowseSettings(settings), preferences), preferences);
        assert.deepEqual(await run(() => window.bilibili.getBrowseSettings()), preferences);
        assert.deepEqual(JSON.parse(await readFile(join(directory, 'browse-presets.json'), 'utf8')), preferences);
        await run(settings => window.bilibili.updateBrowseSettings(settings), initial);
        passed('preset and active selection roundtrip through bridge and disk');

        await waitFor(() => document.querySelector('.live-video-card[data-uploader-id]')?.dataset.uploaderId, 'live visible card with uploader UID');
        await capture('desktop-feed.png', 1180, 840);
        await capture('phone-feed.png', 430, 932);
        window.setContentSize(1180, 840);
        const selectedUid = await run(() => document.querySelector('.live-video-card').dataset.uploaderId);
        await run(() => document.querySelector('.live-video-card .video-uploader button').click());
        await waitFor(() => Boolean(document.querySelector('dialog.preset-dialog[open]')), 'card uploader preset editor');
        await setInput('.preset-form .field-label input', 'Guest uploader check');
        await capture('desktop-preset-editor.png', 1180, 840);
        await capture('phone-preset-editor.png', 430, 932);
        window.setContentSize(1180, 840);
        let saved = await saveEditor();
        let active = saved.presets.find(value => value.id === saved.activePresetId);
        assert.equal(active.name, 'Guest uploader check');
        assert.deepEqual(active.uploaders.map(value => value.id), [selectedUid]);
        assert.equal(active.labels.length, 0);
        await waitFor(() => document.querySelectorAll('.live-video-card').length > 0, 'uploader preset matches');
        assert.ok(await run(uid => Array.from(document.querySelectorAll('.live-video-card')).every(value => value.dataset.uploaderId === uid), selectedUid));
        passed('visible settings dialog saves and applies the card uploader preset');

        await openEditor();
        const impossibleLabel = `BiliFocusSmokeAbsentLabel${Date.now()}`;
        await setInput('[aria-label="Label name"]', impossibleLabel);
        await run(() => document.querySelector('[aria-label="Label name"]').closest('.entry-row').querySelector('button').click());
        await waitFor(() => document.querySelectorAll('.preset-field .selected-rules button[aria-label^="Remove label"]').length === 1, 'added exact label');
        saved = await saveEditor();
        active = saved.presets.find(value => value.id === saved.activePresetId);
        assert.equal(active.match, 'all');
        assert.deepEqual(active.labels, [impossibleLabel]);
        await waitFor(() => !Array.from(document.querySelectorAll('[role="status"]')).some(value => value.textContent.includes('Checking video labels')) && document.querySelector('.feed-empty h2')?.textContent.includes('No matches'), 'completed strict AND filter', 60000);
        assert.equal(await run(() => document.querySelectorAll('.live-video-card').length), 0);
        passed('AND requires both exact tag and selected UID; no matching tag shows zero videos');

        await openEditor();
        await setInput('.preset-form .field-label select', 'any');
        saved = await saveEditor();
        active = saved.presets.find(value => value.id === saved.activePresetId);
        assert.equal(active.match, 'any');
        await waitFor(() => document.querySelectorAll('.live-video-card').length > 0, 'OR uploader matches');
        assert.ok(await run(uid => Array.from(document.querySelectorAll('.live-video-card')).every(value => value.dataset.uploaderId === uid), selectedUid));
        passed('OR allows selected UID while retaining exact tag filtering');

        await setInput('[aria-label="Active recommendation preset"]', '');
        await waitFor(() => document.querySelector('[aria-label="Active recommendation preset"]').value === '' && document.querySelectorAll('.live-video-card').length > 1, 'all recommendations selection');
        await setInput('[aria-label="Active recommendation preset"]', active.id);
        await waitFor(() => document.querySelector('[aria-label="Active recommendation preset"]').value !== '' && document.querySelectorAll('.live-video-card').length > 0, 'saved preset selection');
        assert.ok(await run(uid => Array.from(document.querySelectorAll('.live-video-card')).every(value => value.dataset.uploaderId === uid), selectedUid));
        assert.equal(JSON.parse(await readFile(join(directory, 'browse-presets.json'), 'utf8')).activePresetId, active.id);
        passed('visible preset selector restores the strict uploader allowlist and persists selection');

        console.log(JSON.stringify({ assertions: assertions.length, guestVideos: first.videos.length, nextPageVideos: next.videos.length, verifiedTagVideos: tags.filter(value => value.status === 'ready').length, isolatedPreferences: directory }, null, 2));
        clearTimeout(watchdog);
        app.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Feed smoke check failed.');
        clearTimeout(watchdog);
        app.exit(1);
      }
    });
  });
  require('../dist-electron/main.cjs');
})().catch(error => { console.error(error.message); app.exit(1); });
