import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('safe default playback with optional quality selection', () => {
  const source = readFileSync(new URL('../src/renderer/VideoPage.tsx', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/renderer/use-video-playback.ts', import.meta.url), 'utf8');
  it('retains the legacy MP4 default and recovery route', () => {
    expect(controller).toContain('useState({ quality: 0, revision: 0 })');
    expect(controller).toContain("request.quality === 0 ? { bvid, cid, format: 'progressive' }");
    expect(controller).toContain('Selected quality could not play. Switched to Compatible playback.');
  });
  it('offers manual quality selection on a persistent player without the old fullscreen overlay', () => {
    expect(source).toContain('<video ref={video} hidden={!playback}');
    expect(source).toContain('aria-label={t("Video quality")}');
    expect(source).toContain('<option value={0}>{t("Compatible")}</option>');
    expect(source).not.toContain('fullscreen-exit');
  });
  it('retains the language selector and translated video UI', () => {
    expect(source).toContain('useI18n');
    const options = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    expect(options).toContain('interface-language');
    expect(options).toContain('zh-CN');
  });
});
