import { PaymentProvider } from './types.js';
import { createPayPalProvider } from './paypal.js';
import { createWeChatProvider } from './wechat.js';
import { createAlipayProvider } from './alipay.js';

const providers: Record<string, () => PaymentProvider> = {
  paypal: createPayPalProvider,
  wechat: createWeChatProvider,
  alipay: createAlipayProvider,
};

export function getPaymentProvider(name: string): PaymentProvider {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown payment provider: ${name}`);
  return factory();
}

export function getAvailableProviders(): string[] {
  return Object.keys(providers);
}
