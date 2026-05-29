import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { apiService } from '../services/api';
import './PaymentPage.css';

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

export function PaymentPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [products, setProducts] = useState<Product[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showAllPlans, setShowAllPlans] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    loadData();
  }, [isAuthenticated, navigate]);

  const loadData = async () => {
    try {
      const [productsData, subData] = await Promise.all([
        apiService.clientGet('/payments/products'),
        apiService.clientGet('/payments/subscription'),
      ]);
      setProducts(productsData.data);
      setSubscription(subData.data);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  if (loading) {
    return (
      <div className="payment-page">
        <div className="loading">{t('common.loading')}</div>
      </div>
    );
  }

  const showPlans = !subscription || showAllPlans;

  const canPurchase = (product: Product): boolean => {
    if (!subscription) return true;
    // Per-use is only blocked when subscriber has unlimited (yearly)
    if (product.type === 'per_use') return subscription.musicRemaining !== null;
    // monthly subscribers can only upgrade to yearly
    if (subscription.planType === 'monthly' && product.type === 'yearly') return true;
    return false;
  };

  const isUpgrade = (product: Product): boolean => {
    return !!subscription && subscription.planType === 'monthly' && product.type === 'yearly';
  };

  const upgradePrice = (product: Product): number => {
    // yearly price minus monthly price
    if (subscription && subscription.planType === 'monthly' && product.type === 'yearly') {
      const monthlyProduct = products.find(p => p.type === 'monthly');
      if (monthlyProduct) {
        return Math.max(0, product.priceCents - monthlyProduct.priceCents);
      }
    }
    return product.priceCents;
  };

  return (
    <div className="payment-page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{t('payment.title')}</h1>
      </header>

      <main className="payment-content">
        {subscription && !showAllPlans && (
          <section className="current-plan">
            <h3 className="current-plan-title">{t('payment.currentPlan')}</h3>
            <div className="current-plan-card">
              <span className="current-plan-name">{subscription.planName}</span>
              <span className="current-plan-detail">
                {subscription.musicRemaining !== null
                  ? t('payment.remaining', { count: subscription.musicRemaining })
                  : t('payment.unlimited')}
                &nbsp;&middot;&nbsp;
                {t('profile.validUntil')} {new Date(subscription.expiresAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
            <button
              type="button"
              className="show-all-btn"
              onClick={() => setShowAllPlans(true)}
            >
              {t('payment.viewAll')}
            </button>
          </section>
        )}

        {showPlans && (
          <>
            {subscription && (
              <p className="section-hint">{t('payment.renewHint')}</p>
            )}

            <div className="plans-grid">
              {products.map((product) => {
                const available = canPurchase(product);
                const upgrade = isUpgrade(product);
                const showPrice = upgrade ? upgradePrice(product) : product.priceCents;

                return (
                  <div
                    key={product.id}
                    className={`plan-card ${selectedProduct?.id === product.id ? 'plan-card--selected' : ''} ${!available ? 'plan-card--disabled' : ''}`}
                    onClick={() => available && setSelectedProduct(product)}
                  >
                    {upgrade && <span className="plan-badge">{t('payment.upgrade')}</span>}
                    {!available && <span className="plan-badge plan-badge--current">{t('payment.current')}</span>}
                    <h3 className="plan-name">{product.name}</h3>
                    <p className="plan-desc">{product.description}</p>
                    <div className="plan-price">
                      <span className="plan-currency">¥</span>
                      <span className="plan-amount">{(showPrice / 100).toFixed(0)}</span>
                      {product.type !== 'per_use' && (
                        <span className="plan-period">/{product.type === 'yearly' ? t('payment.perYear') : t('payment.perMonth')}</span>
                      )}
                    </div>
                    {upgrade && (
                      <div className="plan-upgrade-price">
                        {t('payment.originalPrice')} ¥{(product.priceCents / 100).toFixed(0)}
                      </div>
                    )}
                    <div className="plan-limit">
                      {product.musicLimit === null ? t('payment.unlimitedMusic') : t('payment.musicCount', { count: product.musicLimit })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              className="checkout-btn"
              disabled={!selectedProduct}
              onClick={() => {
                if (selectedProduct) {
                  navigate(`/checkout?product=${selectedProduct.id}`);
                }
              }}
            >
              {t('payment.buyNow')}
            </button>
          </>
        )}
      </main>
    </div>
  );
}
