export interface CreatePaymentInput {
  orderId: number;
  amountCents: number;
  currency: string;
  description: string;
}

export interface PaymentResult {
  providerOrderId: string;
  redirectUrl?: string;
}

export interface VerificationResult {
  verified: boolean;
  providerOrderId: string;
  status: string;
}

export interface PaymentProvider {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  verifyPayment(providerOrderId: string): Promise<VerificationResult>;
}
