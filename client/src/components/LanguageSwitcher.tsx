import { useLanguage } from '../i18n/LanguageContext';
import './LanguageSwitcher.css';

const LANGUAGES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
];

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <select
      className="lang-switcher"
      value={language}
      onChange={(e) => setLanguage(e.target.value)}
      aria-label="Language"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
