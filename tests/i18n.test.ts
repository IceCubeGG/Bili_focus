import { describe, expect, it } from 'vitest';
import { translator, translations } from '../src/core/i18n';
import { sanitizeSettings } from '../src/core/settings';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
describe('interface languages', () => {
  it('migrates old preferences to English and accepts only supported languages', () => { expect(sanitizeSettings({ compactCards: true }).language).toBe('en'); expect(sanitizeSettings({ language: 'zh-CN' }).language).toBe('zh-CN'); expect(sanitizeSettings({ language: ['zh-CN'] }).language).toBe('en'); expect(sanitizeSettings({ language: 'fr' }).language).toBe('en'); });
  it('translates navigation and interpolates without translating user content', () => { const t = translator('zh-CN'); expect(t('Browse')).toBe('浏览'); expect(t('Watch {0}', { 0: '<script>My video 科学</script>' })).toBe('观看 <script>My video 科学</script>'); expect(t('Unrecognized diagnostic')).toBe('Unrecognized diagnostic'); expect(translator('en')('Watch {0}', { 0: 'Video' })).toBe('Watch Video'); });
  it('preserves placeholders in every dictionary entry', () => { for (const [english, chinese] of Object.entries(translations)) { expect(chinese.trim()).not.toBe(''); expect([...chinese.matchAll(/\{\d+\}/g)].map(item => item[0]).sort()).toEqual([...english.matchAll(/\{\d+\}/g)].map(item => item[0]).sort()); } });
  it('has no untranslated static JSX text apart from language names, branding and UID', () => {
    const missed: string[] = [];
    function visit(node: any, file: string) { if (!node || !node.type) return; if (node.type === 'JSXText') { const value = node.value.trim(); if (/[a-zA-Z]{2}/.test(value) && !['Bili', 'Focus', 'Bili Focus', 'English', 'UID'].includes(value)) missed.push(`${file}: ${value}`); } for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(item => visit(item, file)); else if (value && typeof value === 'object' && 'type' in value) visit(value, file); } }
    for (const name of ['App', 'BrowsePage', 'SubscribePage', 'SubscriptionDirectory', 'VideoPage', 'DownloadsPanel']) visit(parse(readFileSync(`src/renderer/${name}.tsx`, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] }), name);
    expect(missed).toEqual([]);
  });
  it('does not translate semantic state comparisons', () => {
    for (const name of ['App', 'BrowsePage', 'SubscribePage', 'SubscriptionDirectory', 'VideoPage', 'DownloadsPanel']) {
      const source = readFileSync(`src/renderer/${name}.tsx`, 'utf8'); expect(source).not.toMatch(/(?:===|!==)\s*t\(/);
    }
  });
});
