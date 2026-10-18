import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const art = require('../scripts/icon-artwork.cjs') as { paths: string[]; ADAPTIVE_SCALE: number; foregroundXml: (mono?: boolean) => string; backgroundXml: string; adaptiveXml: string; svg: (kind?: string) => string };
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url));
const dimensions = (file: Buffer) => { expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); return [file.readUInt32BE(16), file.readUInt32BE(20)]; };
describe('approved lightning packaging', () => {
  it('preserves the exact approved reference', () => {
    expect(createHash('sha256').update(read('assets/branding/approved-lightning-reference.png')).digest('hex')).toBe('d19a32dc8d766e395ccc2989bef360b0e8639e660b61590bbe008f311b7d1656');
    expect(dimensions(read('assets/branding/app-icon.png'))).toEqual([1024, 1024]);
    expect(read('assets/branding/app-icon.svg').toString()).toBe(art.svg());
  });
  it('embeds all Windows icon sizes as bounded PNG frames', () => {
    const ico = read('assets/branding/app-icon.ico');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 7]);
    for (const [i, size] of [16, 24, 32, 48, 64, 128, 256].entries()) {
      const entry = 6 + i * 16, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
      expect(offset).toBeGreaterThanOrEqual(118); expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect(ico.readUInt16LE(entry + 6)).toBe(32);
      expect(dimensions(ico.subarray(offset, offset + length))).toEqual([size, size]);
    }
  });
  it('ships every Android density and reproducible adaptive layers', () => {
    for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) expect(dimensions(read(`android/app/src/main/res/mipmap-${density}/${name}.png`))).toEqual([size, size]);
    }
    const res = 'android/app/src/main/res/';
    expect(read(res + 'drawable-v24/ic_launcher_foreground.xml').toString()).toBe(art.foregroundXml());
    expect(read(res + 'drawable/bili_launcher_monochrome.xml').toString()).toBe(art.foregroundXml(true));
    expect(read(res + 'drawable/ic_launcher_background.xml').toString()).toBe(art.backgroundXml);
    for (const name of ['ic_launcher', 'ic_launcher_round']) expect(read(res + `mipmap-anydpi-v26/${name}.xml`).toString()).toBe(art.adaptiveXml);
  });
  it('keeps the whole adaptive mark inside the 66dp circular safe zone', () => {
    for (const path of art.paths) {
      const numbers = path.match(/\d+/g)!.map(Number);
      for (let i = 0; i < numbers.length; i += 2) expect(Math.hypot(numbers[i] - 627, numbers[i + 1] - 627) * art.ADAPTIVE_SCALE / 1254 * 108).toBeLessThanOrEqual(33);
    }
  });
  it('keeps Android and package versions consistent', () => {
    const pkg = JSON.parse(read('package.json').toString());
    expect(pkg.version).toBe('0.4.2');
    expect(read('android/app/build.gradle').toString()).toContain('versionName "0.4.2"');
    expect(read('android/app/build.gradle').toString()).toContain('versionCode 6');
    expect(pkg.build.win.icon).toBe('assets/branding/app-icon.ico');
    expect(pkg.build.files).toContain('assets/branding/app-icon.png');
  });
});
