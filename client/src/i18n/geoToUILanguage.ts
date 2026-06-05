const COUNTRY_TO_UI_LANGUAGE: Record<string, string> = {
  CN: 'zh', TW: 'zh', HK: 'zh', SG: 'zh', MO: 'zh',
  US: 'en', GB: 'en', AU: 'en', CA: 'en', NZ: 'en', IE: 'en', IN: 'en',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', CH_FR: 'fr',
  DE: 'de', AT: 'de', LI: 'de', CH_DE: 'de',
  RU: 'ru', BY: 'ru', KZ: 'ru',
  SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', OM: 'ar', BH: 'ar',
  MA: 'ar', DZ: 'ar', TN: 'ar', LB: 'ar', JO: 'ar', IQ: 'ar', SY: 'ar',
  YE: 'ar', LY: 'ar', SD: 'ar', PS: 'ar',
  JP: 'ja',
  KR: 'ko',
};

const SUPPORTED_LANGUAGES = ['zh', 'en', 'fr', 'de', 'ru', 'ar', 'ja', 'ko'];

export function countryToUILanguage(countryCode: string | undefined | null): string {
  if (!countryCode) return 'en';
  const lang = COUNTRY_TO_UI_LANGUAGE[countryCode];
  return lang || 'en';
}

export function isSupportedLanguage(lang: string): boolean {
  return SUPPORTED_LANGUAGES.includes(lang);
}
