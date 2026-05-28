import { PaymentProvider, CreatePaymentInput, PaymentResult, VerificationResult } from './types.js';

export function createWeChatProvider(): PaymentProvider {
  return {
    name: 'wechat',

    async createPayment(_input: CreatePaymentInput): Promise<PaymentResult> {
      throw new Error('微信支付即将上线，请使用 PayPal 支付');
    },

    async verifyPayment(_providerOrderId: string): Promise<VerificationResult> {
      throw new Error('微信支付即将上线，请使用 PayPal 支付');
    },
  };
}
