import { AlipaySdk } from 'alipay-sdk';
import { PaymentProvider, CreatePaymentInput, PaymentResult, VerificationResult } from './types.js';

function getClient(): AlipaySdk {
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = process.env.ALIPAY_PRIVATE_KEY;
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error('Alipay not configured: missing ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, or ALIPAY_PUBLIC_KEY');
  }

  const gateway = process.env.ALIPAY_SANDBOX === 'true'
    ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    : 'https://openapi.alipay.com/gateway.do';

  return new AlipaySdk({
    appId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    alipayPublicKey: alipayPublicKey.replace(/\\n/g, '\n'),
    gateway,
    signType: 'RSA2',
    timeout: 15000,
  });
}

export function createAlipayProvider(): PaymentProvider {
  return {
    name: 'alipay',

    async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
      const alipay = getClient();

      const outTradeNo = `ORDER_${input.orderId}_${Date.now()}`;
      const bizContent: Record<string, unknown> = {
        out_trade_no: outTradeNo,
        total_amount: (input.amountCents / 100).toFixed(2),
        subject: input.description,
        product_code: 'FAST_INSTANT_TRADE_PAY',
      };

      const pageParams: Record<string, unknown> = {
        bizContent,
        method: 'GET',
      };

      const notifyUrl = process.env.ALIPAY_NOTIFY_URL;
      if (notifyUrl) {
        pageParams.notifyUrl = notifyUrl;
      }

      const returnUrl = process.env.ALIPAY_RETURN_URL;
      if (returnUrl) {
        pageParams.returnUrl = returnUrl.replace('{orderId}', String(input.orderId));
      }

      console.log('[Alipay] Creating page pay:', {
        outTradeNo,
        amount: bizContent.total_amount,
        subject: bizContent.subject,
        sandbox: process.env.ALIPAY_SANDBOX === 'true',
      });

      const redirectUrl = alipay.pageExecute('alipay.trade.page.pay', 'GET', pageParams);

      console.log('[Alipay] Page pay URL generated:', outTradeNo);

      return {
        providerOrderId: outTradeNo,
        redirectUrl,
      };
    },

    async verifyPayment(providerOrderId: string): Promise<VerificationResult> {
      const alipay = getClient();

      console.log('[Alipay] Querying trade:', providerOrderId);

      const result = await alipay.exec('alipay.trade.query', {
        bizContent: {
          out_trade_no: providerOrderId,
        },
      });

      const tradeStatus = (result.tradeStatus || result.trade_status || 'UNKNOWN') as string;

      console.log('[Alipay] Trade query result:', {
        code: result.code,
        msg: result.msg,
        subCode: result.subCode,
        subMsg: result.subMsg,
        tradeStatus,
        tradeNo: result.tradeNo || result.trade_no,
        totalAmount: result.totalAmount || result.total_amount,
      });

      if (result.code !== '10000') {
        const subCode = result.subCode || result.subMsg || 'ERROR';
        return { verified: false, providerOrderId, status: subCode, notFound: subCode === 'ACQ.TRADE_NOT_EXIST' };
      }

      const verified = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';

      return { verified, providerOrderId, status: tradeStatus };
    },
  };
}
