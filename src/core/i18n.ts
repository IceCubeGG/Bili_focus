import chinese from './zh-CN.json';
import type { InterfaceLanguage } from '../shared/contracts';
export const translations: Readonly<Record<string, string>> = chinese;
export type TranslationValues = Record<string, string | number>;
export const translator = (language: InterfaceLanguage) => (source: string | null, values: TranslationValues = {}): string => {
  const key = source ?? '';
  const phrase = language === 'zh-CN' ? translations[key] ?? key : key;
  return phrase.replace(/\{(\d+)\}/g, (match, index: string) => Object.hasOwn(values, index) ? String(values[index]) : match);
};
