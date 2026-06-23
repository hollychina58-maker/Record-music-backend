import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { useGeoCurrency } from '../hooks/useGeoCurrency';
import { apiService } from '../services/api';
import QRCode from 'qrcode';
import './CheckoutPage.css';

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Plan feature copy — translation key references ─────────────────────────
const PLAN_FEATURES: Record<string, string[]> = {
  per_use: [
    'checkout.feature.per_use.1',
    'checkout.feature.per_use.2',
    'checkout.feature.per_use.3',
    'checkout.feature.per_use.4',
  ],
  monthly: [
    'checkout.feature.monthly.1',
    'checkout.feature.monthly.2',
    'checkout.feature.monthly.3',
    'checkout.feature.monthly.4',
  ],
  yearly: [
    'checkout.feature.yearly.1',
    'checkout.feature.yearly.2',
    'checkout.feature.yearly.3',
    'checkout.feature.yearly.4',
  ],
};

const PLAN_ICONS: Record<string, string> = {
  per_use: '🎵',
  monthly: '🔄',
  yearly: '♾️',
};

// ─── Payment provider config ──────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'alipay',  color: '#1677FF', live: true },
  { id: 'wechat',  color: '#07C160', live: false },
  { id: 'paypal',  color: '#003087', live: false },
] as const;

type ProviderId = typeof PROVIDERS[number]['id'];

function AlipayIcon() {
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" fill="none">
      <rect width="48" height="48" rx="10" fill="#1677FF" />
      <path
        d="M38.9 30.6c-3.4-1.1-5.6-1.9-7.7-2.7 1.8-2.8 3-6.2 3.3-9.9H27V15h8v-2H27v-3h-3.5v3H15v2h8.5v3h-9.4v2h15.3c-.3 2.7-1.2 5.2-2.6 7.2-3-1-5.9-1.7-7.8-1.7-4.4 0-7.4 2.4-7.4 5.7 0 3.4 3.1 5.4 7.4 5.4 4 0 7.8-2.1 10.2-5.6 3 1.2 6.4 2.7 9.3 4.2l1.4-2.6z"
        fill="white"
      />
      <path
        d="M19.3 33.6c-2.8 0-4.4-1.1-4.4-2.9 0-1.9 1.7-3.2 4.4-3.2 1.7 0 4 .6 6.6 1.5-1.9 2.8-4.2 4.6-6.6 4.6z"
        fill="#1677FF"
      />
    </svg>
  );
}

function WechatIcon() {
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" fill="none">
      <rect width="48" height="48" rx="10" fill="#07C160" />
      <path d="M19.5 12C13.15 12 8 16.48 8 22c0 3.1 1.6 5.88 4.1 7.8L11 33l4.2-2.1c1.4.4 2.8.6 4.3.6.3 0 .6 0 .9-.02-.1-.6-.15-1.2-.15-1.82 0-5.3 4.6-9.62 10.25-9.62.35 0 .7.02 1.04.05C30.5 15.9 25.4 12 19.5 12zm-3.5 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" fill="white" />
      <path d="M30.5 22.1c-4.7 0-8.5 3.32-8.5 7.4 0 4.1 3.8 7.42 8.5 7.42 1.1 0 2.15-.18 3.12-.52L37 38l-.9-2.88C37.8 33.6 39 31.48 39 29.5c0-4.08-3.8-7.4-8.5-7.4zm-3 5a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4zm6 0a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" fill="white" />
    </svg>
  );
}

function PaypalIcon() {
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" fill="none">
      <rect width="48" height="48" rx="10" fill="#003087" />
      <path d="M31 13h-9.5c-.7 0-1.3.5-1.4 1.2l-4 22.6c-.1.5.3 1 .8 1H21c.5 0 1-.4 1.1-.9l1.1-7c.1-.7.7-1.2 1.4-1.2h3c4.8 0 7.5-2.3 8.2-6.8.3-2-.1-3.6-1-4.7C33.9 13.8 32.6 13 31 13z" fill="#009cde" />
      <path d="M33.8 17.2c-.1.6-.3 1.2-.5 1.8C31.9 23 29 25 24.7 25h-1.9c-.7 0-1.3.5-1.4 1.2l-1.5 9.5c-.1.5.3.9.8.9h4.4c.6 0 1.1-.4 1.2-1l1-6.3c.1-.6.6-1 1.2-1h.8c4.1 0 6.5-2 7.2-6 .3-1.8 0-3.2-.7-4.1z" fill="white" />
    </svg>
  );
}

const PROVIDER_ICONS: Record<ProviderId, React.ReactNode> = {
  alipay: <AlipayIcon />,
  wechat: <WechatIcon />,
  paypal: <PaypalIcon />,
};

// ─── Component ────────────────────────────────────────────────────────────────
export function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { t } = useLanguage();
  const currency = useGeoCurrency();

  const [product, setProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState('');
  const [provider, setProvider] = useState<ProviderId>('alipay');
  const [unavailableToast, setUnavailableToast] = useState('');

  const [step, setStep] = useState<'review' | 'payment'>('review');
  const [orderId, setOrderId] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [polling, setPolling] = useState(false);
  const [pollStatusMsg, setPollStatusMsg] = useState('');

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);
  const creatingRef = useRef(false);
  const payingRef = useRef(false);
  const processedReturnRef = useRef<number | null>(null);
  const MAX_POLL_COUNT = 45;

  const productId = parseInt(searchParams.get('product') || '0', 10);
  const returnOrderIdStr = searchParams.get('order');
  const returnOrderId = returnOrderIdStr ? parseInt(returnOrderIdStr, 10) : null;

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  // ── Auth guard + route guard ──
  useEffect(() => {
    if (!isAuthenticated) { navigate('/login', { replace: true }); return; }
    if (!productId && !returnOrderId) { navigate('/payment', { replace: true }); return; }
    if (productId) {
      stopPoll();
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
      loadProduct();
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, productId, navigate]);

  // ── PayPal/redirect return handler ──
  useEffect(() => {
    if (!returnOrderId || !isAuthenticated) return;
    if (processedReturnRef.current === returnOrderId) return;
    processedReturnRef.current = returnOrderId;
    setStatusMsg(t('checkout.processing'));
    verifyAndActivate(returnOrderId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnOrderId, isAuthenticated]);

  function stopPoll() {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    pollCountRef.current = 0;
  }

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
      if (!found) { navigate('/payment', { replace: true }); return; }
      setProduct(found);
    } catch { /* network error — loading spinner stays */ }
    finally { setLoading(false); }
  };

  // ── Verify order after redirect return (PayPal etc.) ──
  const verifyAndActivate = async (id: number) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await apiService.clientPost(`/payments/orders/${id}/verify`);
        if (res.success) {
          stopPoll();
          setStatusMsg(t('checkout.paySuccess'));
          await useAuthStore.getState().fetchCurrentUser();
          const next = new URLSearchParams(searchParams);
          next.delete('order');
          setSearchParams(next, { replace: true });
          processedReturnRef.current = null;
          setTimeout(() => navigate('/my-space'), 1500);
          return;
        }
      } catch (err: any) {
        if (err?.response?.status === 404) {
          setError(err?.response?.data?.error || t('checkout.payFail'));
          return;
        }
      }
    }
    setError(t('checkout.payTimeout'));
  };

  // ── Step 1 → Step 2 ──
  const handleContinue = async () => {
    if (!product || creatingRef.current) return;
    creatingRef.current = true;
    setProcessing(true);
    setError('');
    try {
      setOrderId(null);
      setStep('payment');
    } finally {
      setProcessing(false);
      creatingRef.current = false;
    }
  };

  // ── Step 2: initiate payment ──
  const handlePay = async () => {
    if (!product || payingRef.current) return;
    payingRef.current = true;
    stopPoll();
    setProcessing(true);
    setError('');

    try {
      let activeOrderId = orderId;
      if (!activeOrderId) {
        let orderRes: any;
        try {
          orderRes = await apiService.clientPost('/payments/orders', {
            productId: product.id,
            quantity,
            provider,
            couponCode: couponCode.trim() || undefined,
          });
        } catch (err: any) {
          const msg = err?.response?.data?.error || t('checkout.createOrderFail');
          setError(msg);
          return;
        }
        if (!orderRes?.data?.orderId) { setError(t('checkout.createOrderFail')); return; }
        activeOrderId = orderRes.data.orderId;
        setOrderId(activeOrderId);
      }

      let payRes: any;
      try {
        payRes = await apiService.clientPost(`/payments/orders/${activeOrderId}/pay`);
      } catch (err: any) {
        const msg = err?.response?.data?.error || t('checkout.payFail');
        setError(msg);
        return;
      }

      if (payRes.data.redirectUrl) {
        window.location.href = payRes.data.redirectUrl;
        return;
      }

      if (payRes.data.qrCode) {
        setQrLoading(true);
        const dataUrl = await QRCode.toDataURL(payRes.data.qrCode, {
          width: 240, margin: 2,
          color: { dark: '#1a1a2e', light: '#ffffff' },
        });
        setQrDataUrl(dataUrl);
        setQrLoading(false);
        setShowQr(true);

        pollCountRef.current = 0;
        setPolling(true);

        const pollFn = async () => {
          pollCountRef.current++;
          if (pollCountRef.current > MAX_POLL_COUNT) {
            pollRef.current = null;
            setPolling(false);
            setProcessing(false);
            setError(t('checkout.payTimeout'));
            return;
          }
          try {
            const verifyRes = await apiService.clientPost(`/payments/orders/${activeOrderId}/verify`);
            if (verifyRes.success) {
              stopPoll();
              setPolling(false);
              setStatusMsg(t('checkout.paySuccess'));
              await useAuthStore.getState().fetchCurrentUser();
              setTimeout(() => navigate('/my-space'), 1500);
              return;
            }
            if (verifyRes.retryAfter) {
              pollRef.current = setTimeout(pollFn, verifyRes.retryAfter * 1000);
              return;
            }
          } catch (err: any) {
            const status = err?.response?.status;
            if (status === 404) {
              stopPoll();
              setPolling(false);
              setProcessing(false);
              setError(err?.response?.data?.error || t('checkout.payFail'));
              return;
            }
            if (status === 400) {
              const data = err?.response?.data;
              setPollStatusMsg(data?.notFound ? t('checkout.awaitingScan') : t('checkout.polling'));
            }
          }
          const delay = Math.min(4000 + (pollCountRef.current - 1) * 2000, 30000);
          pollRef.current = setTimeout(pollFn, delay);
        };
        pollRef.current = setTimeout(pollFn, 0);
        return;
      }

      setError(t('checkout.payFail'));
    } finally {
      setProcessing(false);
      payingRef.current = false;
    }
  };

  // ── Back button ──
  const handleBack = () => {
    if (step === 'review') {
      navigate('/payment');
    } else if (showQr) {
      stopPoll();
      setPolling(false);
      setShowQr(false);
      setQrDataUrl(null);
      setOrderId(null);
    } else {
      stopPoll();
      setOrderId(null);
      setStep('review');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  if (loading || !product) {
    return (
      <div className="checkout-page">
        <div className="loading">{t('common.loading')}</div>
      </div>
    );
  }

  const isUpgrade = !!(subscription?.planType === 'monthly' && product.type === 'yearly');
  const unitPriceCents = (() => {
    if (isUpgrade) {
      const mp = allProducts.find((p) => p.type === 'monthly');
      if (mp) return Math.max(0, product.priceCents - mp.priceCents);
    }
    return product.priceCents;
  })();
  const totalCents = unitPriceCents * (product.type === 'per_use' ? quantity : 1);
  const featureKeys = PLAN_FEATURES[product.type] || [];
  const isPerUse = product.type === 'per_use';
  const activeProviderCfg = PROVIDERS.find((p) => p.id === provider)!;
  const providerLabel = t(`checkout.${provider}`);

  const stepTitle = step === 'review'
    ? t('checkout.reviewStep')
    : showQr
      ? t('checkout.scanStep')
      : t('checkout.payStep');

  const periodLabel = product.type === 'monthly'
    ? t('pp.plan.period.monthly')
    : product.type === 'yearly'
      ? t('pp.plan.period.yearly')
      : t('pp.plan.period.per_use');

  return (
    <div className="checkout-page">
      {/* ── Header ── */}
      <header className="page-header">
        <button type="button" className="back-btn" onClick={handleBack} aria-label={t('common.back')}>
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{stepTitle}</h1>
      </header>

      <main className="checkout-content">
        {statusMsg && <div className="payment-status">{statusMsg}</div>}

        {/* ════════ Step 1: Review ════════ */}
        {step === 'review' && (
          <>
            {/* Plan detail card */}
            <section className="plan-detail-card">
              <div className="plan-detail-header">
                <div className="plan-badge">{t(`pp.plan.name.${product.type}`)}</div>
                {isUpgrade && <span className="upgrade-tag">{t('pp.badge.upgrade')}</span>}
              </div>

              <div className="plan-price-display">
                {isUpgrade && (
                  <span className="plan-price-original">
                    {currency.symbol}{currency.formatAmount(currency.toDisplayCents(product.priceCents))}
                  </span>
                )}
                <span className="plan-price-main">
                  {currency.symbol}{currency.formatAmount(currency.toDisplayCents(unitPriceCents))}
                </span>
                <span className="plan-price-unit">{periodLabel}</span>
              </div>

              <p className="plan-description">{product.description}</p>

              <ul className="plan-features">
                {featureKeys.map((fk, i) => (
                  <li key={i} className="plan-feature-item">
                    <span className="feature-icon">{PLAN_ICONS[product.type]}</span>
                    <span className="feature-text">{t(fk)}</span>
                  </li>
                ))}
              </ul>

              <div className="plan-limit-badge">
                {product.musicLimit === null
                  ? <span>{t('checkout.unlimitedGenerations')}</span>
                  : <span>{t('checkout.generationCount', { count: product.musicLimit })}</span>}
              </div>
            </section>

            {/* Quantity (per_use only) */}
            {isPerUse && (
              <section className="order-section">
                <div className="order-row">
                  <span className="order-label">{t('checkout.quantity')}</span>
                  <div className="qty-control">
                    <button type="button" className="qty-btn" disabled={quantity <= 1}
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
                    <span className="qty-value">{quantity}</span>
                    <button type="button" className="qty-btn" disabled={quantity >= 100}
                      onClick={() => setQuantity((q) => Math.min(100, q + 1))}>+</button>
                  </div>
                </div>
              </section>
            )}

            {/* Coupon */}
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

            {/* Total */}
            <div className="checkout-total-row">
              <span className="checkout-total-label">{t('checkout.amountDue')}</span>
              <span className="checkout-total-amount">
                {currency.symbol}{currency.formatAmount(currency.toDisplayCents(totalCents))}
              </span>
            </div>

            {error && <p className="payment-error">{error}</p>}

            <button className="checkout-btn" disabled={processing} onClick={handleContinue}>
              {t('checkout.payNow')}
            </button>

            <p className="payment-note">{t('checkout.note')}</p>
          </>
        )}

        {/* ════════ Step 2: Payment method ════════ */}
        {step === 'payment' && !showQr && (
          <>
            {/* Order recap */}
            <div className="payment-recap">
              <div className="payment-recap-name">{t(`pp.plan.name.${product.type}`)}</div>
              <div className="payment-recap-amount">
                {currency.symbol}{currency.formatAmount(currency.toDisplayCents(totalCents))}
              </div>
            </div>

            <section className="payment-method">
              <h3 className="section-title">{t('checkout.selectPayment')}</h3>
              <div className="provider-options">
                {PROVIDERS.map((p) => {
                  const isSelected = provider === p.id;
                  const isDisabled = !p.live;
                  const pLabel = t(`checkout.${p.id}`);
                  return (
                    <label
                      key={p.id}
                      className={[
                        'provider-option',
                        isSelected ? 'provider-option--active' : '',
                        isDisabled ? 'provider-option--disabled' : '',
                      ].filter(Boolean).join(' ')}
                      style={isSelected && !isDisabled ? { borderColor: p.color } : {}}
                      onClick={isDisabled ? () => {
                        setUnavailableToast(t('checkout.providerSoon', { provider: pLabel }));
                        setTimeout(() => setUnavailableToast(''), 3000);
                      } : undefined}
                    >
                      <input
                        type="radio"
                        name="provider"
                        value={p.id}
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => { if (!isDisabled) { setProvider(p.id); setShowQr(false); } }}
                      />
                      <span className="provider-icon">{PROVIDER_ICONS[p.id]}</span>
                      <span className="provider-name">{pLabel}</span>
                      {isDisabled && <span className="provider-soon">{t('checkout.soon')}</span>}
                      {isSelected && !isDisabled && (
                        <span className="provider-check" style={{ color: p.color }}>✓</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Unavailable toast */}
            {unavailableToast && (
              <div className="unavailable-toast">{unavailableToast}</div>
            )}

            {error && <p className="payment-error">{error}</p>}

            <button
              className="checkout-btn"
              disabled={processing || !activeProviderCfg.live}
              onClick={handlePay}
              style={!processing && activeProviderCfg.live ? { background: activeProviderCfg.color } : {}}
            >
              {processing
                ? t('checkout.processing')
                : <>
                    {PROVIDER_ICONS[provider]}
                    <span style={{ marginLeft: 8 }}>
                      {t('checkout.payWith', {
                        provider: providerLabel,
                        amount: `${currency.symbol}${currency.formatAmount(currency.toDisplayCents(totalCents))}`,
                      })}
                    </span>
                  </>
              }
            </button>

            <p className="payment-note">{t('checkout.note')}</p>
          </>
        )}

        {/* ════════ QR code ════════ */}
        {showQr && (
          <section className="qr-section">
            <div className="qr-placeholder">
              {qrDataUrl ? (
                <>
                  <div className="qr-provider-badge" style={{ background: activeProviderCfg.color }}>
                    {PROVIDER_ICONS[provider]}
                    <span>{providerLabel}</span>
                  </div>
                  <img src={qrDataUrl} alt={t('checkout.scanComplete')} className="qr-image" />
                  <p className="qr-title">{t('checkout.scanComplete')}</p>
                  <p className="qr-amount">{currency.symbol}{currency.formatAmount(currency.toDisplayCents(totalCents))}</p>
                  {polling && (
                    <p className="qr-hint">{pollStatusMsg || t('checkout.polling')}</p>
                  )}
                  <button className="qr-cancel-btn" onClick={handleBack}>
                    {t('checkout.cancelPay')}
                  </button>
                </>
              ) : qrLoading ? (
                <>
                  <div className="qr-loading-spinner" />
                  <p className="qr-hint">{t('checkout.qrLoading')}</p>
                </>
              ) : (
                <>
                  <div className="qr-icon-wrap">
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
                  <p className="qr-hint">{t('checkout.qrLoading')}</p>
                </>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
