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
    endpoint: isSandbox
      ? 'https://openapi-sandbox.dl.alipaydev.com'
      : undefined,
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
      const body: Record<string, unknown> = {
        out_trade_no: outTradeNo,
        total_amount: (input.amountCents / 100).toFixed(2),
        subject: input.description,
      };

      const curlOptions: Record<string, unknown> = { body };
      const notifyUrl = process.env.ALIPAY_NOTIFY_URL;
      if (notifyUrl) {
        (curlOptions as any).query = { notify_url: notifyUrl };
      }

      console.log('[Alipay] Creating precreate (V3):', {
        outTradeNo,
        amount: body.total_amount,
        subject: body.subject,
        sandbox: process.env.ALIPAY_SANDBOX === 'true',
      });

      const { data } = await alipay.curl('POST', '/v3/alipay/trade/precreate', curlOptions as any);

      console.log('[Alipay] Precreate (V3) response:', {
        code: (data as any).code,
        msg: (data as any).msg,
        subCode: (data as any).sub_code,
        subMsg: (data as any).sub_msg,
        outTradeNo: (data as any).out_trade_no,
        qrCode: (data as any).qr_code,
      });

      const code = (data as any).code || (data as any).Code;
      if (code !== '10000') {
        throw new Error(`Alipay error: ${(data as any).sub_msg || (data as any).msg}`);
      }

      const qrCode = (data as any).qr_code;
      if (!qrCode) {
        console.error('[Alipay] No qr_code in response:', JSON.stringify(data));
        throw new Error('Alipay returned success but no QR code');
      }

      return {
        providerOrderId: outTradeNo,
        qrCode,
      };
    },

    async verifyPayment(providerOrderId: string): Promise<VerificationResult> {
      const alipay = getClient();

      console.log('[Alipay] Querying trade (V3):', providerOrderId);

      const { data } = await alipay.curl('POST', '/v3/alipay/trade/query', {
        body: { out_trade_no: providerOrderId },
      });

      const code = (data as any).code || (data as any).Code;
      const subCode = (data as any).sub_code || (data as any).subCode;
      const subMsg = (data as any).sub_msg || (data as any).subMsg;
      const tradeStatus = ((data as any).trade_status || (data as any).tradeStatus || 'UNKNOWN') as string;

      console.log('[Alipay] Trade query (V3) result:', {
        code,
        msg: (data as any).msg,
        subCode,
        subMsg,
        tradeStatus,
        tradeNo: (data as any).trade_no,
        totalAmount: (data as any).total_amount,
        buyerLogonId: (data as any).buyer_logon_id,
        buyerUserId: (data as any).buyer_user_id,
      });

      if (code !== '10000') {
        return { verified: false, providerOrderId, status: subCode || subMsg || 'ERROR', notFound: subCode === 'ACQ.TRADE_NOT_EXIST' };
      }

      const verified = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';

      return { verified, providerOrderId, status: tradeStatus };
    },
  };
}
