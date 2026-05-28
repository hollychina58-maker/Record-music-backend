import geoip from 'geoip-lite';

export interface GeoResult {
  countryCode: string | null;
  countryName: string | null;
}

export function lookupGeo(ip: string): GeoResult {
  // Normalize IPv6-mapped IPv4 or localhost
  const normalizedIp = ip === '::1' || ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip;

  const geo = geoip.lookup(normalizedIp);
  if (!geo) {
    return { countryCode: null, countryName: null };
  }
  return {
    countryCode: geo.country,
    countryName: geo.country,
  };
}

// Map country code to likely story language for homepage filtering
const COUNTRY_LANGUAGE: Record<string, string> = {
  CN: 'cmn', TW: 'cmn', HK: 'cmn', SG: 'cmn', MO: 'cmn',
  US: 'eng', GB: 'eng', AU: 'eng', CA: 'eng', NZ: 'eng', IE: 'eng',
  RU: 'rus', BY: 'rus', KZ: 'rus',
  FR: 'fra', BE: 'fra', LU: 'fra', MC: 'fra',
  DE: 'deu', AT: 'deu', LI: 'deu',
  SA: 'ara', AE: 'ara', EG: 'ara', QA: 'ara', KW: 'ara', OM: 'ara', BH: 'ara', MA: 'ara', DZ: 'ara', TN: 'ara',
  ES: 'spa', MX: 'spa', AR: 'spa', CO: 'spa', CL: 'spa', PE: 'spa',
  JP: 'jpn',
  KR: 'kor',
  BR: 'por', PT: 'por',
  IT: 'ita',
  NL: 'nld',
  PL: 'pol',
  TR: 'tur',
  VN: 'vie',
  TH: 'tha',
  ID: 'ind',
  IN: 'eng',
};

export function countryToLanguage(countryCode: string | null): string | null {
  if (!countryCode) return null;
  return COUNTRY_LANGUAGE[countryCode.toUpperCase()] || null;
}
