import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { getAppStrings, type AppLanguage, type AppStrings } from '../utils/i18n';

interface LanguageContextValue {
  language: AppLanguage;
  strings: AppStrings;
  setLanguage: (lang: AppLanguage) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'vi',
  strings: getAppStrings('vi'),
  setLanguage: () => {},
});

export const LanguageProvider: React.FC<{
  language: AppLanguage;
  onChangeLanguage: (lang: AppLanguage) => void;
  children: React.ReactNode;
}> = ({ language, onChangeLanguage, children }) => {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language === 'zh' ? 'zh-CN' : language === 'en' ? 'en' : 'vi';
    }
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      strings: getAppStrings(language),
      setLanguage: onChangeLanguage,
    }),
    [language, onChangeLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useI18n(): LanguageContextValue {
  return useContext(LanguageContext);
}
