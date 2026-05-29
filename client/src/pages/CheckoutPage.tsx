import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { apiService } from '../services/api';
import QRCode from 'qrcode';
import './CheckoutPage.css';

interface Product {
  id: number;
  name: string;
  type: string;
  priceCents: number;
  musicLimit: number | null;
  description: string;
}

interface SubscriptionInfo {
  planName: string;
  planType: string;
  expiresAt: string;
  musicRemaining: number | null;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { t } = useLanguage();
  const [product, setProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState('');
  const [provider, setProvider] = useState<'alipay' | 'wechat' | 'paypal'>('alipay');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLL_COUNT = 45; // 45 × up-to-30s ≈ ~3-4 minutes max
  const [polling, setPolling] = useState(false);
  const [pollStatusMsg, setPollStatusMsg] = useState('');

  // Two-step flow: review → payment
  const [step, setStep] = useState<'review' | 'payment'>('review');
  const [orderId, setOrderId] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);

  const productId = parseInt(searchParams.get('product') || '0', 10);
  const returnOrderIdStr = searchParams.get('order');
  const returnOrderId = returnOrderIdStr ? parseInt(returnOrderIdStr, 10) : null;
  const processedReturnRef = useRef<number | null>(null);

  // Clear all payment state when starting a new checkout session
  const resetPaymentState = () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    pollCountRef.current = 0;
    payingRef.current = false;
    setOrderId(null);
    setStep('review');
    setShowQr(false);
    setQrDataUrl(null);
    setQrLoading(false);
    setPolling(false);
    setPollStatusMsg('');
    setError('');
    setStatusMsg('');
    setProcessing(false);
    setProvider('alipay');
    setQuantity(1);
    setCouponCode('');
  };

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Handle return from payment gateway: URL has ?order=xxx
  useEffect(() => {
    if (!returnOrderId || !isAuthenticated) return;
    // Prevent reprocessing the same return order
    if (processedReturnRef.current === returnOrderId) return;
    processedReturnRef.current = returnOrderId;

    setStatusMsg(t('checkout.processing'));
    verifyAndActivate(returnOrderId);
  }, [returnOrderId, isAuthenticated]);

  // Load product for new checkout: URL has ?product=xxx
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    if (!productId && !returnOrderId) {
      navigate('/payment', { replace: true });
      return;
    }
    if (productId) {
      resetPaymentState();
      loadProduct();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, productId, navigate]);

  const loadProduct = async () => {
    try {
      const [productsRes, subRes] = await Promise.all([
        apiService.clientGet('/payments/products'),
        apiService.clientGet('/payments/subscription'),
      ]);
      const products = productsRes.data as Product[];
      setAllProducts(products);
      setSubscription(subRes.data);
      const found = products.find((p) => p.id === productId);
      if (!found) {
        navigate('/payment', { replace: true });
        return;
      }
      setProduct(found);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  const verifyAndActivate = async (id: number) => {
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      try {
        const res = await apiService.clientPost('/payments/orders/' + id + '/verify');
        if (res.success) {
          if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
          setStatusMsg(t('checkout.paySuccess'));
          const { fetchCurrentUser } = useAuthStore.getState();
          await fetchCurrentUser();
          // Clean the order param from URL so it doesn't interfere with future checkouts
          const next = new URLSearchParams(searchParams);
          next.delete('order');
          setSearchParams(next, { replace: true });
          processedReturnRef.current = null;
          setTimeout(() => navigate('/my-space'), 1500);
          return;
        }
      } catch (err: any) {
        const status = err?.response?.status;
        // 404 = order not found, terminal error
        if (status === 404) {
          setError(err?.response?.data?.error || t('checkout.payFail'));
          return;
        }
        // 400 = not paid yet (transient), continue retrying
        // Network/5xx errors: continue retrying
      }
    }
    // Exhausted retries
    setError(t('checkout.payFail'));
  };

  const creatingRef = useRef(false);
  const payingRef = useRef(false);

  const handleCreateOrder = async () => {
    if (!product || creatingRef.current) return;
    creatingRef.current = true;
    setProcessing(true);
    setError('');

    try {
      const orderRes = await apiService.clientPost('/payments/orders', {
        productId: product.id,
        quantity,
        provider,
        couponCode: couponCode.trim() || undefined,
      });
      if (!orderRes?.data?.orderId) {
        setError(t('checkout.createOrderFail'));
        return;
      }
      setOrderId(orderRes.data.orderId);
      setStep('payment');
    } catch (err: any) {
      setError(err?.response?.data?.error || t('checkout.createOrderFail'));
    } finally {
      setProcessing(false);
      creatingRef.current = false;
    }
  };

  const handlePay = async () => {
    if (!orderId) return;
    if (!product) return;
    if (payingRef.current) return;
    payingRef.current = true;
    // Clear any leftover polling from a previous order
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    setProcessing(true);
    setError('');

    try {
      const payRes = await apiService.clientPost('/payments/orders/' + orderId + '/pay');

      if (payRes.data.redirectUrl) {
        window.location.href = payRes.data.redirectUrl;
        return;
      }

      if (payRes.data.qrCode) {
        setQrLoading(true);
        const dataUrl = await QRCode.toDataURL(payRes.data.qrCode, {
          width: 240,
          margin: 2,
          color: { dark: '#1a1a2e', light: '#ffffff' },
        });
        setQrDataUrl(dataUrl);
        setQrLoading(false);
        setShowQr(true);

        // Poll for payment status (recursive setTimeout, max ~2 minutes)
        pollCountRef.current = 0;
        setPolling(true);
        const poll = async () => {
          pollCountRef.current++;
          if (pollCountRef.current > MAX_POLL_COUNT) {
            pollRef.current = null;
            setPolling(false);
            setProcessing(false);
            setError(t('checkout.payTimeout'));
            return;
          }
          try {
            const verifyRes = await apiService.clientPost('/payments/orders/' + orderId + '/verify');
            if (verifyRes.success) {
              pollRef.current = null;
              setPolling(false);
              setStatusMsg(t('checkout.paySuccess'));
              const { fetchCurrentUser } = useAuthStore.getState();
              await fetchCurrentUser();
              setTimeout(() => navigate('/my-space'), 1500);
              return;
            }
            // Non-success response — could be "not paid yet", keep polling
          } catch (err: any) {
            const status = err?.response?.status;
            // Only 404 (order not found) is terminal; 400 (not paid yet) keeps polling
            if (status === 404) {
              pollRef.current = null;
              setPolling(false);
              setProcessing(false);
              setError(err?.response?.data?.error || t('checkout.payFail'));
              return;
            }
            // 400: not paid yet — check if trade not found (haven't scanned) vs processing
            if (status === 400) {
              const data = err?.response?.data;
              setPollStatusMsg(data?.notFound ? t('checkout.awaitingScan') : t('checkout.polling'));
            }
            // Network or 5xx errors: keep retrying
          }
          const delay = Math.min(4000 + (pollCountRef.current - 1) * 2000, 30000);
          pollRef.current = setTimeout(poll, delay);
        };
        pollRef.current = setTimeout(poll, 0);
        return;
      }

      setError(t('checkout.payFail'));
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error || err?.message || t('checkout.payFail');
      // 404 = order not found (possibly deleted or wrong user)
      // 400 = order already processed or payment not initiated
      setError(status === 404 ? `${t('checkout.createOrderFail')} — ${msg}` : msg);
    } finally {
      setProcessing(false);
      payingRef.current = false;
    }
  };

  const providerLabels: Record<string, string> = {
    alipay: '支付宝',
    wechat: '微信支付',
    paypal: 'PayPal',
  };

  if (loading || !product) {
    return (
      <div className="checkout-page">
        <div className="loading">{t('common.loading')}</div>
      </div>
    );
  }

  const isUpgrade = !!(subscription && subscription.planType === 'monthly' && product.type === 'yearly');

  const unitPriceCents = (() => {
    if (isUpgrade) {
      const monthlyProduct = allProducts.find(p => p.type === 'monthly');
      if (monthlyProduct) {
        return Math.max(0, product.priceCents - monthlyProduct.priceCents);
      }
    }
    return product.priceCents;
  })();

  const totalCents = unitPriceCents * quantity;

  return (
    <div className="checkout-page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => {
          if (step === 'review') { navigate('/payment'); } else {
            if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
            setStep('review');
          }
        }} aria-label={t('common.back')}>
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{step === 'review' ? t('checkout.title') : t('checkout.selectPayment')}</h1>
      </header>

      <main className="checkout-content">
        {statusMsg && <div className="payment-status">{statusMsg}</div>}

        {/* Order summary — always visible */}
        <section className="order-summary">
          <h3 className="section-title">{t('checkout.title')}</h3>
          <div className="order-card">
            <div className="order-row">
              <span className="order-label">{t('checkout.product')}</span>
              <span className="order-value">{product.name}</span>
            </div>
            <div className="order-row">
              <span className="order-label">{t('checkout.description')}</span>
              <span className="order-value order-desc">{product.description}</span>
            </div>
            <div className="order-row">
              <span className="order-label">{t('checkout.quantity')}</span>
              <div className="qty-control">
                <button
                  type="button"
                  className="qty-btn"
                  disabled={quantity <= 1 || step === 'payment'}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  −
                </button>
                <span className="qty-value">{quantity}</span>
                <button
                  type="button"
                  className="qty-btn"
                  disabled={step === 'payment'}
                  onClick={() => setQuantity((q) => q + 1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="order-row">
              <span className="order-label">{t('checkout.unitPrice')}</span>
              <span className="order-value">
                {isUpgrade && (
                  <span style={{ textDecoration: 'line-through', color: 'var(--ink-wash)', marginRight: '8px', fontSize: '0.8rem' }}>
                    ¥{(product.priceCents / 100).toFixed(2)}
                  </span>
                )}
                ¥{(unitPriceCents / 100).toFixed(2)}
              </span>
            </div>
            <div className="order-row order-row--total">
              <span className="order-label">{t('checkout.total')}</span>
              <span className="order-total">¥{(totalCents / 100).toFixed(2)}</span>
            </div>
          </div>
        </section>

        {/* Coupon — only in review step */}
        {step === 'review' && (
          <div className="coupon-row">
            <input
              className="coupon-input"
              type="text"
              placeholder={t('checkout.coupon')}
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              maxLength={30}
            />
          </div>
        )}

        {error && <p className="payment-error">{error}</p>}

        {/* Step 1: Review — show pay button */}
        {step === 'review' && (
          <button
            className="checkout-btn"
            disabled={processing}
            onClick={handleCreateOrder}
          >
            {processing ? t('checkout.processing') : t('checkout.payBtn')}
          </button>
        )}

        {/* Step 2: Payment — show provider selector + QR / pay button */}
        {step === 'payment' && !showQr && (
          <>
            <section className="payment-method">
              <h3 className="section-title">{t('checkout.selectPayment')}</h3>
              <div className="provider-options">
                <label className={`provider-option${provider === 'alipay' ? ' provider-option--active' : ''}`}>
                  <input type="radio" name="provider" value="alipay" checked={provider === 'alipay'} onChange={() => { setProvider('alipay'); setShowQr(false); }} />
                  <span className="provider-name">支付宝</span>
                </label>
                <label className={`provider-option${provider === 'wechat' ? ' provider-option--active' : ''}`}>
                  <input type="radio" name="provider" value="wechat" checked={provider === 'wechat'} onChange={() => { setProvider('wechat'); setShowQr(false); }} />
                  <span className="provider-name">微信支付</span>
                </label>
                <label className={`provider-option${provider === 'paypal' ? ' provider-option--active' : ''}`}>
                  <input type="radio" name="provider" value="paypal" checked={provider === 'paypal'} onChange={() => { setProvider('paypal'); setShowQr(false); }} />
                  <span className="provider-name">PayPal</span>
                </label>
              </div>
            </section>

            <button
              className="checkout-btn"
              disabled={processing}
              onClick={handlePay}
            >
              {processing ? t('checkout.processing') : `${t('checkout.confirmPay')} ¥${(totalCents / 100).toFixed(2)}`}
            </button>
          </>
        )}

        {/* QR code area (Alipay / WeChat) */}
        {showQr && (
          <section className="qr-section">
            <div className="qr-placeholder">
              {qrDataUrl ? (
                <>
                  <img src={qrDataUrl} alt={t('checkout.qrTitle', { provider: providerLabels[provider] })} className="qr-image" />
                  <p className="qr-title">{t('checkout.qrTitle', { provider: providerLabels[provider] })}</p>
                  <p className="qr-amount">¥{(totalCents / 100).toFixed(2)}</p>
                  {polling && (
                    <p className="qr-hint">
                      {pollStatusMsg || t('checkout.polling')}
                      {pollCountRef.current > 0 && (
                        <span className="poll-counter"> ({pollCountRef.current}/{MAX_POLL_COUNT})</span>
                      )}
                    </p>
                  )}
                </>
              ) : qrLoading ? (
                <>
                  <div className="qr-loading-spinner" />
                  <p className="qr-hint">{t('checkout.qrLoading')}</p>
                </>
              ) : (
                <>
                  <div className="qr-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="3" height="3" rx="0.5" />
                      <rect x="18" y="18" width="3" height="3" rx="0.5" />
                      <rect x="14" y="18" width="3" height="3" rx="0.5" />
                      <rect x="18" y="14" width="3" height="3" rx="0.5" />
                    </svg>
                  </div>
                  <p className="qr-title">{t('checkout.qrTitle', { provider: providerLabels[provider] })}</p>
                  <p className="qr-amount">¥{(totalCents / 100).toFixed(2)}</p>
                  <p className="qr-hint">{t('checkout.qrLoading')}</p>
                </>
              )}
            </div>
          </section>
        )}

        {step !== 'payment' && (
          <p className="payment-note">{t('checkout.note')}</p>
        )}
      </main>
    </div>
  );
}
