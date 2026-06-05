import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { countryToUILanguage, isSupportedLanguage } from './geoToUILanguage';
import zh from './locales/zh.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

const translations: Record<string, Record<string, string>> = { zh, en, fr, de, ru, ar, ja, ko };

const RTL_LANGUAGES = new Set(['ar']);

interface LanguageContextType {
  language: string;
  setLanguage: (lang: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'zh',
  setLanguage: () => {},
  t: (key: string) => key,
  dir: 'ltr',
});

const STORAGE_KEY = 'mo_ui_lang';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupportedLanguage(stored)) return stored;
    return '';
  });

  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (language) { setResolved(true); return; }

    const controller = new AbortController();
    const apiBase = import.meta.env.VITE_API_URL || '';

    fetch(`${apiBase}/api/geo`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        const lang = countryToUILanguage(data?.data?.countryCode);
        setLanguageState(lang);
        localStorage.setItem(STORAGE_KEY, lang);
      })
      .catch(() => {
        setLanguageState('en');
      })
      .finally(() => {
        if (!controller.signal.aborted) setResolved(true);
      });

    return () => controller.abort();
  }, [language]);

  const setLanguage = useCallback((lang: string) => {
    if (!isSupportedLanguage(lang)) return;
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    setResolved(true);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const table = translations[language] || translations.en;
      let result = table[key] || translations.zh[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
      }
      return result;
    },
    [language],
  );

  const dir: 'ltr' | 'rtl' = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';

  return (
    <LanguageContext.Provider value={{ language: language || 'en', setLanguage, t, dir }}>
      {resolved ? children : null}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext);
}
