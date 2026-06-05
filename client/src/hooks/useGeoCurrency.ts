import { useMemo } from 'react';
import { useGeo } from './useGeo';

// Countries billed in USD: North America, EU, AU, NZ, JP, KR
const USD_COUNTRIES = new Set([
  // North America
  'US', 'CA', 'MX',
  // European Union (27 members)
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  // Other English-speaking developed markets
  'GB', 'AU', 'NZ',
  // Asia Pacific developed
  'JP', 'KR',
]);

// USD prices are a fixed conversion: 1 CNY ≈ 0.14 USD, rounded to clean amounts
// These map priceCents (CNY) to USD cents. Kept here to avoid backend changes.
const CNY_TO_USD_CENTS: Record<number, number> = {
  100:   199,   // ¥1  → $1.99  (per-use)
  299:   299,   // kept as placeholder
  500:   699,   // ¥5  → $6.99
  1000:  149,   // ¥10 → $1.49
  2000:  299,   // ¥20 → $2.99
  2900:  399,   // ¥29 → $3.99
  4900:  699,   // ¥49 → $6.99
  5800:  799,   // ¥58 → $7.99
  9800:  1399,  // ¥98 → $13.99
  19800: 2799,  // ¥198→ $27.99
  29800: 3999,  // ¥298→ $39.99
};

function cnyCentsToUsdCents(cnyCents: number): number {
  if (CNY_TO_USD_CENTS[cnyCents] !== undefined) return CNY_TO_USD_CENTS[cnyCents];
  // Fallback: 1 CNY = 0.14 USD, round to nearest 50 cents
  const raw = Math.round(cnyCents * 0.14);
  return Math.round(raw / 50) * 50 || 99;
}

export interface CurrencyInfo {
  code: 'CNY' | 'USD';
  symbol: '¥' | '$';
  loading: boolean;
  /** Convert a CNY cents value to display cents in the active currency */
  toDisplayCents: (cnyCents: number) => number;
  /** Format display cents to a user-facing price string (no symbol) */
  formatAmount: (displayCents: number) => string;
}

export function useGeoCurrency(): CurrencyInfo {
  const { countryCode, loading } = useGeo();

  return useMemo<CurrencyInfo>(() => {
    const isUSD = !loading && countryCode !== null && USD_COUNTRIES.has(countryCode);
    const code = isUSD ? 'USD' : 'CNY';
    const symbol = isUSD ? '$' : '¥';

    const toDisplayCents = (cnyCents: number) =>
      isUSD ? cnyCentsToUsdCents(cnyCents) : cnyCents;

    const formatAmount = (cents: number) => {
      if (isUSD) {
        return (cents / 100).toFixed(2);
      }
      // CNY: show integers (¥29, ¥198), keep .xx only if fractional
      const val = cents / 100;
      return Number.isInteger(val) ? val.toFixed(0) : val.toFixed(2);
    };

    return { code, symbol, loading, toDisplayCents, formatAmount };
  }, [countryCode, loading]);
}
