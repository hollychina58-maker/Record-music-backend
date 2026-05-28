import { franc } from 'franc-min';

// Map franc ISO 639-3 codes to our stored language codes
// franc returns ISO 639-3, we store the same
export function detectLanguage(text: string): string {
  // Use first 500 chars for detection (franc works better with shorter texts)
  const sample = text.slice(0, 500);
  const lang = franc(sample, { minLength: 3 });
  // 'und' = undetermined, default to 'cmn' (Chinese)
  return lang === 'und' ? 'cmn' : lang;
}
