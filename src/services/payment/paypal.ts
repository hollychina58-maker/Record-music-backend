import { PaymentProvider, CreatePaymentInput, PaymentResult, VerificationResult } from './types.js';

export function createPayPalProvider(): PaymentProvider {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const apiUrl = process.env.PAYPAL_API_URL || 'https://api-m.paypal.com';

  async function getAccessToken(): Promise<string> {
    const res = await fetch(`${apiUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error('PayPal auth failed');
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  return {
    name: 'paypal',

    async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
      if (!clientId || !clientSecret) throw new Error('PayPal not configured');

      const token = await getAccessToken();
      const res = await fetch(`${apiUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: String(input.orderId),
            amount: {
              currency_code: input.currency,
              value: (input.amountCents / 100).toFixed(2),
            },
            description: input.description,
          }],
          application_context: {
            return_url: process.env.FRONTEND_URL + '/payment?order=' + input.orderId,
            cancel_url: process.env.FRONTEND_URL + '/payment?cancelled=1',
          },
        }),
      });

      if (!res.ok) throw new Error('PayPal order creation failed');
      const data = await res.json() as { id: string; links: { rel: string; href: string }[] };
      const approveLink = data.links.find((l) => l.rel === 'payer-action')?.href;

      return { providerOrderId: data.id, redirectUrl: approveLink };
    },

    async verifyPayment(providerOrderId: string): Promise<VerificationResult> {
      if (!clientId || !clientSecret) throw new Error('PayPal not configured');

      const token = await getAccessToken();
      const res = await fetch(`${apiUrl}/v2/checkout/orders/${providerOrderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('PayPal verification failed');
      const data = await res.json() as { status: string; id: string };

      return {
        verified: data.status === 'COMPLETED' || data.status === 'APPROVED',
        providerOrderId: data.id,
        status: data.status,
      };
    },
  };
}
