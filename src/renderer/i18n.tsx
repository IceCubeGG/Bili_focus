import { createContext, useContext } from 'react';
import type { InterfaceLanguage } from '../shared/contracts';
import { translator } from '../core/i18n';
export const LanguageContext = createContext<InterfaceLanguage>('en');
export function useI18n() { const language = useContext(LanguageContext); return { t: translator(language), locale: language === 'zh-CN' ? 'zh-CN' : 'en-US' }; }
