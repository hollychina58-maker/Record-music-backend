import { AlipaySdk } from 'alipay-sdk';
import { PaymentProvider, CreatePaymentInput, PaymentResult, VerificationResult } from './types.js';

function getClient(): AlipaySdk {
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = process.env.ALIPAY_PRIVATE_KEY;
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error('Alipay not configured: missing ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, or ALIPAY_PUBLIC_KEY');
  }

  const isSandbox = process.env.ALIPAY_SANDBOX === 'true';

  return new AlipaySdk({
    appId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    alipayPublicKey: alipayPublicKey.replace(/\\n/g, '\n'),
    gateway: isSandbox
      ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
      : 'https://openapi.alipay.com/gateway.do',
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
        body: `墨韵订单 #${input.orderId}`,
        timeout_express: '15h',
      };

      const params: Record<string, unknown> = { bizContent };
      const notifyUrl = process.env.ALIPAY_NOTIFY_URL;
      if (notifyUrl) {
        params.notifyUrl = notifyUrl;
      }

      console.log('[Alipay] Creating precreate payment:', {
        outTradeNo,
        amount: bizContent.total_amount,
        subject: bizContent.subject,
        sandbox: process.env.ALIPAY_SANDBOX === 'true',
      });

      const result = await alipay.exec('alipay.trade.precreate', params);

      console.log('[Alipay] Precreate response:', {
        code: result.code,
        msg: result.msg,
        subCode: result.subCode,
        subMsg: result.subMsg,
        outTradeNo: result.outTradeNo,
        qrCode: result.qrCode,
      });

      if (result.code !== '10000') {
        throw new Error(`Alipay error: ${result.subMsg || result.msg}`);
      }

      const qrCode = result.qrCode || result.qr_code;

      if (!qrCode) {
        console.error('[Alipay] No qrCode in response. Raw keys:', Object.keys(result));
        throw new Error('Alipay returned success but no QR code URL');
      }

      return { providerOrderId: result.outTradeNo, qrCode };
    },

    async verifyPayment(providerOrderId: string): Promise<VerificationResult> {
      const alipay = getClient();

      console.log('[Alipay] Querying trade:', providerOrderId);

      const result = await alipay.exec('alipay.trade.query', {
        bizContent: { out_trade_no: providerOrderId },
      });

      const code = result.code;
      const subCode = result.subCode || result.subMsg;
      const subMsg = result.subMsg;
      const tradeStatus = (result.tradeStatus || result.trade_status || 'UNKNOWN') as string;

      console.log('[Alipay] Trade query result:', {
        code,
        msg: result.msg,
        subCode,
        subMsg,
        tradeStatus,
        tradeNo: result.tradeNo || result.trade_no,
        totalAmount: result.totalAmount || result.total_amount,
      });

      if (code !== '10000') {
        return {
          verified: false,
          providerOrderId,
          status: subCode || subMsg || 'ERROR',
          notFound: subCode === 'ACQ.TRADE_NOT_EXIST',
        };
      }

      const verified = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';

      return { verified, providerOrderId, status: tradeStatus };
    },
  };
}
