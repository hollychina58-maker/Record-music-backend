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

const PLAN_META: Record<string, {
  icon: string;
  tagline: string;
  color: string;
  features: string[];
  period: string;
  recommended?: boolean;
}> = {
  per_use: {
    icon: '✦',
    tagline: '按需取用',
    color: '#4f4f4f',
    period: '/ 次',
    features: ['每次生成一首专属配乐', 'AI 情感风格匹配', '即时到账，无需订阅', '永久有效，随时使用'],
  },
  monthly: {
    icon: '◈',
    tagline: '月度无忧',
    color: '#3a4f8b',
    period: '/ 月',
    features: ['每月 60 次音乐生成', '全风格解锁', '30 天持续有效', '可随时升级年度会员'],
  },
  yearly: {
    icon: '❋',
    tagline: '年度臻享',
    color: '#8b4513',
    period: '/ 年',
    recommended: true,
    features: ['无限次音乐生成', '365 天持续有效', '全风格 · 全情绪解锁', '专属年度会员标识'],
  },
};

function DaysLeft({ expiresAt }: { expiresAt: string }) {
  const days = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
  return <>{days} 天</>;
}

export function PaymentPage() {
  const navigate = useNavigate();
  useLanguage();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [products, setProducts] = useState<Product[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAllPlans, setShowAllPlans] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login', { replace: true }); return; }
    loadData();
  }, [isAuthenticated, navigate]);

  const loadData = async () => {
    try {
      const [productsData, subData] = await Promise.all([
        apiService.clientGet('/payments/products'),
        apiService.clientGet('/payments/subscription'),
      ]);
      const prods: Product[] = productsData.data;
      setProducts(prods);
      setSubscription(subData.data);
      // default-select the recommended (yearly) plan if not subscribed
      if (!subData.data) {
        const yearly = prods.find((p) => p.type === 'yearly');
        if (yearly) setSelectedId(yearly.id);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  };

  if (loading) {
    return (
      <div className="pp-page">
        <div className="pp-loading">
          <span className="pp-loading-char">卷</span>
          <span className="pp-loading-text">载入中</span>
        </div>
      </div>
    );
  }

  const canPurchase = (p: Product) => {
    if (!subscription) return true;
    if (p.type === 'per_use') return subscription.musicRemaining !== null;
    if (subscription.planType === 'monthly' && p.type === 'yearly') return true;
    return false;
  };

  const isUpgrade = (p: Product) =>
    !!subscription && subscription.planType === 'monthly' && p.type === 'yearly';

  const displayPrice = (p: Product) => {
    if (isUpgrade(p)) {
      const mp = products.find((x) => x.type === 'monthly');
      return mp ? Math.max(0, p.priceCents - mp.priceCents) : p.priceCents;
    }
    return p.priceCents;
  };

  const showPlans = !subscription || showAllPlans;
  const selectedProduct = products.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="pp-page">
      {/* ── Header ── */}
      <header className="pp-header">
        <button type="button" className="pp-back" onClick={() => navigate(-1)} aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="pp-header-label">会员套餐</span>
      </header>

      {/* ── Hero ── */}
      <section className="pp-hero">
        <div className="pp-hero-seal">音</div>
        <h1 className="pp-hero-title">为你的故事<br />配上专属的旋律</h1>
        <p className="pp-hero-sub">AI 驱动的情感音乐生成 · 每一刻都值得被铭记</p>
        <div className="pp-hero-divider"><span /></div>
      </section>

      <main className="pp-content">
        {/* ── Current subscription banner ── */}
        {subscription && !showAllPlans && (
          <div className="pp-sub-banner">
            <div className="pp-sub-banner-left">
              <span className="pp-sub-icon">◈</span>
              <div>
                <div className="pp-sub-name">{subscription.planName}</div>
                <div className="pp-sub-meta">
                  {subscription.musicRemaining !== null
                    ? `剩余 ${subscription.musicRemaining} 次`
                    : '无限生成'}
                  &ensp;·&ensp;还剩&ensp;<DaysLeft expiresAt={subscription.expiresAt} />
                </div>
              </div>
            </div>
            <button className="pp-sub-upgrade" onClick={() => setShowAllPlans(true)}>
              查看套餐 →
            </button>
          </div>
        )}

        {/* ── Plans ── */}
        {showPlans && (
          <>
            {subscription && (
              <p className="pp-renew-hint">续费或升级你的套餐</p>
            )}

            <div className="pp-plans">
              {products.map((product) => {
                const available = canPurchase(product);
                const upgrade = isUpgrade(product);
                const price = displayPrice(product);
                const meta = PLAN_META[product.type] ?? PLAN_META['per_use'];
                const isSelected = selectedId === product.id;
                const isRecommended = meta.recommended && !subscription;
                const isCurrent = !available && !!subscription;

                return (
                  <div
                    key={product.id}
                    className={[
                      'pp-plan',
                      isSelected ? 'pp-plan--selected' : '',
                      isCurrent ? 'pp-plan--current' : '',
                      isRecommended ? 'pp-plan--recommended' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ '--plan-color': meta.color } as React.CSSProperties}
                    onClick={() => available && setSelectedId(product.id)}
                    role={available ? 'button' : undefined}
                    tabIndex={available ? 0 : undefined}
                    onKeyDown={(e) => e.key === 'Enter' && available && setSelectedId(product.id)}
                  >
                    {/* Top strip */}
                    <div className="pp-plan-strip" />

                    {/* Badges */}
                    {isRecommended && <div className="pp-plan-badge pp-plan-badge--rec">推荐</div>}
                    {upgrade && <div className="pp-plan-badge pp-plan-badge--up">升级优惠</div>}
                    {isCurrent && <div className="pp-plan-badge pp-plan-badge--cur">当前套餐</div>}

                    {/* Icon + name */}
                    <div className="pp-plan-head">
                      <span className="pp-plan-icon">{meta.icon}</span>
                      <div>
                        <div className="pp-plan-name">{product.name}</div>
                        <div className="pp-plan-tagline">{meta.tagline}</div>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="pp-plan-price-wrap">
                      {upgrade && (
                        <span className="pp-plan-price-orig">¥{(product.priceCents / 100).toFixed(0)}</span>
                      )}
                      <span className="pp-plan-currency">¥</span>
                      <span className="pp-plan-amount">{(price / 100).toFixed(0)}</span>
                      <span className="pp-plan-period">{meta.period}</span>
                    </div>

                    {/* Limit pill */}
                    <div className="pp-plan-limit">
                      {product.musicLimit === null ? '♾ 无限次生成' : `🎵 ${product.musicLimit} 次 / 周期`}
                    </div>

                    {/* Divider */}
                    <div className="pp-plan-sep" />

                    {/* Features */}
                    <ul className="pp-plan-features">
                      {meta.features.map((f, i) => (
                        <li key={i} className="pp-plan-feature">
                          <span className="pp-feature-dot" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* Selection indicator */}
                    {isSelected && (
                      <div className="pp-plan-check">
                        <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                          <path d="M4 10l5 5 7-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* CTA */}
            <div className="pp-cta-wrap">
              <button
                className="pp-cta"
                disabled={!selectedProduct}
                onClick={() => selectedProduct && navigate(`/checkout?product=${selectedProduct.id}`)}
              >
                {selectedProduct
                  ? `选择「${selectedProduct.name}」· 去支付`
                  : '请选择一个套餐'}
              </button>
              <p className="pp-cta-note">支持支付宝 · 微信支付 · PayPal，随时可取消</p>
            </div>
          </>
        )}

        {/* ── Trust strip ── */}
        <div className="pp-trust">
          <div className="pp-trust-item">
            <span className="pp-trust-icon">🔒</span>
            <span>安全加密</span>
          </div>
          <div className="pp-trust-dot" />
          <div className="pp-trust-item">
            <span className="pp-trust-icon">⚡</span>
            <span>即时生效</span>
          </div>
          <div className="pp-trust-dot" />
          <div className="pp-trust-item">
            <span className="pp-trust-icon">💬</span>
            <span>随时客服</span>
          </div>
        </div>
      </main>
    </div>
  );
}
