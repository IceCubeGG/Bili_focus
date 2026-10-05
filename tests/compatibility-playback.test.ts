import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('saved progressive playback compatibility variant', () => {
  const source = readFileSync(new URL('../src/renderer/VideoPage.tsx', import.meta.url), 'utf8');
  it('always requests the legacy MP4 route rather than the default DASH route', () => {
    expect(source).toContain("getVideoPlayback({ bvid: details.bvid, cid: part.cid, format: 'progressive' })");
    expect(source).not.toContain('attachDash');
    expect(source).not.toContain('setQuality');
  });
  it('uses a direct video source without a quality selector or fullscreen exit overlay', () => {
    expect(source).toContain('src={playback.sources[streamIndex]?.url}');
    expect(source).not.toContain('aria-label={t("Video quality")}');
    expect(source).not.toContain('fullscreen-exit');
  });
  it('retains the language selector and translated video UI', () => {
    expect(source).toContain('useI18n');
    const options = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    expect(options).toContain('interface-language');
    expect(options).toContain('zh-CN');
  });
});
