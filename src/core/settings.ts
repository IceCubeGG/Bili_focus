import { DEFAULT_SETTINGS, type AppSettings } from '../shared/contracts';

export function sanitizeSettings(value: unknown): AppSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    version: 1,
    lastTab: typeof data.lastTab === 'string' && ['browse', 'subscribe', 'options'].includes(data.lastTab) ? data.lastTab as AppSettings['lastTab'] : DEFAULT_SETTINGS.lastTab,
    appearance: typeof data.appearance === 'string' && ['system', 'light', 'dark'].includes(data.appearance) ? data.appearance as AppSettings['appearance'] : DEFAULT_SETTINGS.appearance,
    compactCards: typeof data.compactCards === 'boolean' ? data.compactCards : DEFAULT_SETTINGS.compactCards,
    language: data.language === 'zh-CN' ? 'zh-CN' : DEFAULT_SETTINGS.language,
  };
}
