// Deterministic build/export only: no image generation, network, account, or device access.
const { app, BrowserWindow } = require('electron');
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const artwork = require('./icon-artwork.cjs');
const root = join(__dirname, '..');
const branding = join(root, 'assets', 'branding'), res = join(root, 'android', 'app', 'src', 'main', 'res');
async function save(path, bytes) { await mkdir(require('node:path').dirname(path), { recursive: true }); await writeFile(path, bytes); }
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, i) => { const at = 6 + i * 16; header[at] = header[at + 1] = size === 256 ? 0 : size; header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(bytes.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += bytes.length; });
  return Buffer.concat([header, ...images.map(i => i.bytes)]);
}
(async () => {
  await mkdir(join(root, '.gradle-cache'), { recursive: true });
  app.setPath('userData', await mkdtemp(join(root, '.gradle-cache', 'icon-export-')));
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }));
  await window.loadURL('data:text/html,<meta charset="utf-8"><title>Local icon export</title>');
  async function render(size, kind = 'square') {
    const source = artwork.svg(kind);
    const result = await window.webContents.executeJavaScript(`(async () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size}; const image = new Image(); image.src = 'data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}'; await image.decode(); const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, ${size}, ${size}); return canvas.toDataURL('image/png').split(',')[1]; })()`);
    return Buffer.from(result, 'base64');
  }
  await save(join(branding, 'app-icon.svg'), artwork.svg());
  await save(join(branding, 'app-icon.png'), await render(1024));
  await save(join(branding, 'app-icon.ico'), ico(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async size => ({ size, bytes: await render(size) })))));
  for (const [density, factor] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    await save(join(res, `mipmap-${density}`, 'ic_launcher.png'), await render(48 * factor));
    await save(join(res, `mipmap-${density}`, 'ic_launcher_round.png'), await render(48 * factor, 'round'));
    await save(join(res, `mipmap-${density}`, 'ic_launcher_foreground.png'), await render(108 * factor, 'foreground'));
  }
  await save(join(res, 'drawable', 'ic_launcher_background.xml'), artwork.backgroundXml);
  await save(join(res, 'drawable-v24', 'ic_launcher_foreground.xml'), artwork.foregroundXml());
  await save(join(res, 'drawable', 'bili_launcher_monochrome.xml'), artwork.foregroundXml(true));
  await save(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), artwork.adaptiveXml);
  await save(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), artwork.adaptiveXml);
  // Preview the Android circular mask at the same 72/108 viewport scale used by launchers.
  const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1254 1254"><defs><clipPath id="circle"><circle cx="627" cy="627" r="418"/></clipPath></defs><g clip-path="url(#circle)"><rect width="1254" height="1254" fill="#FFF"/><g transform="translate(627 627) scale(0.60) translate(-627 -627)">${artwork.paths.map(d=>`<path d="${d}" fill="${artwork.BLUE}"/>`).join('')}</g></g></svg>`;
  const preview = await window.webContents.executeJavaScript(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;const i=new Image();i.src='data:image/svg+xml;base64,${Buffer.from(previewSvg).toString('base64')}';await i.decode();c.getContext('2d').drawImage(i,0,0);return c.toDataURL('image/png').split(',')[1];})()`);
  await save(join(root, '.gradle-cache', 'android-icon-circle.png'), Buffer.from(preview,'base64'));
  window.destroy(); console.log('Exported Windows ICO, shared brand PNG/SVG, and all Android launcher layers/densities.'); app.exit(0);
})().catch(error => { console.error(error.stack); app.exit(1); });
