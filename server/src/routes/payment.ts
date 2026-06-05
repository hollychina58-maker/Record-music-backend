import express, { Router, Request, Response } from 'express';
import { getDatabase } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getPaymentProvider } from '../services/payment/index.js';
import { AlipaySdk } from 'alipay-sdk';

const router = Router();

interface ProductRow {
  id: number;
  name: string;
  type: string;
  price_cents: number;
  music_limit: number | null;
  description: string;
}

interface OrderRow {
  id: number;
  user_id: number;
  plan_type: string;
  amount: number;
  total_cents: number | null;
  status: string;
  payment_provider: string | null;
  payment_id: string | null;
  coupon_code: string | null;
}

interface ActiveSubRow {
  id: number;
  product_id: number;
  user_id: number;
  plan_name: string;
  plan_type: string;
  price_cents: number;
  expires_at: string;
}

// GET /api/payments/products — List active products
router.get('/products', (_req: Request, res: Response) => {
  const db = getDatabase();
  const products = db.prepare(
    'SELECT * FROM products WHERE is_active = 1 ORDER BY price_cents ASC'
  ).all() as ProductRow[];
  res.json({ success: true, data: products.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    priceCents: p.price_cents,
    musicLimit: p.music_limit,
    description: p.description,
  })) });
});

// GET /api/payments/subscription — Current user subscription
router.get('/subscription', authMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const sub = db.prepare(`
    SELECT s.*, p.name as plan_name, p.type as plan_type, p.music_limit
    FROM subscriptions s
    JOIN products p ON s.product_id = p.id
    WHERE s.user_id = ? AND s.status = 'active'
    ORDER BY s.expires_at DESC LIMIT 1
  `).get(req.userId) as any;

  if (!sub || new Date(sub.expires_at) < new Date()) {
    res.json({ success: true, data: null });
    return;
  }

  res.json({ success: true, data: {
    planName: sub.plan_name,
    planType: sub.plan_type,
    expiresAt: sub.expires_at,
    musicRemaining: sub.music_remaining,
  } });
});

// POST /api/payments/orders — Create order
router.post('/orders', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { productId, provider = 'paypal', quantity = 1 } = req.body;
    const userId = req.userId!;
    const db = getDatabase();

    console.log('[CreateOrder] Request:', { userId, productId, provider, quantity, couponCode: req.body.couponCode || null });

    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(productId) as ProductRow | undefined;
    if (!product) {
      console.warn('[CreateOrder] Product not found:', { productId, userId });
      res.status(400).json({ error: 'Invalid product' });
      return;
    }

    console.log('[CreateOrder] Product found:', { productId, name: product.name, type: product.type, priceCents: product.price_cents });

    let totalCents = product.price_cents * Math.max(1, parseInt(String(quantity), 10) || 1);
    let isUpgrade = false;

    // Block per_use purchase when user has unlimited subscription (yearly)
    if (product.type === 'per_use') {
      const unlimitedSub = db.prepare(
        "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now') AND music_remaining IS NULL"
      ).get(userId);
      if (unlimitedSub) {
        console.warn('[CreateOrder] Blocked per_use — user has unlimited subscription:', { userId });
        res.status(400).json({ error: '年度会员无限使用，无需按次购买' });
        return;
      }
    }

    // Check active subscription for non-per_use products
    if (product.type !== 'per_use') {
      const activeSub = db.prepare(`
        SELECT s.*, p.name as plan_name, p.type as plan_type, p.price_cents
        FROM subscriptions s
        JOIN products p ON s.product_id = p.id
        WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
        ORDER BY s.expires_at DESC LIMIT 1
      `).get(userId) as ActiveSubRow | undefined;

      console.log('[CreateOrder] Subscription check:', { userId, hasActiveSub: !!activeSub, activeSubPlanType: activeSub?.plan_type || null });

      if (activeSub) {
        // Monthly → Yearly upgrade: discount by the price the user actually paid for monthly
        // Use the order amount actually charged, not the current product price (which may have changed)
        if (product.type === 'yearly' && activeSub.plan_type === 'monthly') {
          const lastMonthlyOrder = db.prepare(
            "SELECT total_cents, amount FROM orders WHERE user_id = ? AND plan_type IN ('monthly', 'monthly:upgrade') AND status = 'completed' ORDER BY created_at DESC LIMIT 1"
          ).get(userId) as { total_cents: number | null; amount: number } | undefined;
          const paidMonthly = lastMonthlyOrder
            ? (lastMonthlyOrder.total_cents ?? Math.round(lastMonthlyOrder.amount * 100))
            : activeSub.price_cents;
          totalCents = Math.max(0, totalCents - paidMonthly);
          isUpgrade = true;
          console.log('[CreateOrder] Upgrade detected:', { userId, fromPlan: activeSub.plan_type, toPlan: product.type, originalCents: product.price_cents, discountCents: activeSub.price_cents, finalCents: totalCents });
        } else {
          console.warn('[CreateOrder] Blocked — active subscription exists:', { userId, activePlanType: activeSub.plan_type, requestedPlanType: product.type });
          res.status(400).json({
            error: `已有 ${activeSub.plan_name} 订阅（至 ${activeSub.expires_at.slice(0, 10)}），到期后可续费`,
          });
          return;
        }
      }
    }

    // Validate coupon but DO NOT consume it yet — consumed only after payment is confirmed
    let appliedCouponCode: string | null = null;
    if (req.body.couponCode) {
      const coupon = db.prepare(
        "SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (max_uses IS NULL OR used_count < max_uses) AND (valid_from IS NULL OR valid_from <= datetime('now')) AND (valid_until IS NULL OR valid_until >= datetime('now'))"
      ).get(req.body.couponCode) as any;

      if (coupon) {
        const discountPercent = Math.min(99, Math.max(0, coupon.discount_percent || 0));
        if (discountPercent > 0) {
          totalCents = Math.round(totalCents * (100 - discountPercent) / 100);
        }
        if (coupon.discount_cents > 0) {
          totalCents = Math.max(0, totalCents - coupon.discount_cents);
        }
        appliedCouponCode = coupon.code;
      }
    }

    const planType = isUpgrade ? `${product.type}:upgrade` : product.type;
    const purchasedQuantity = product.type === 'per_use' ? Math.max(1, parseInt(String(quantity), 10) || 1) : 1;

    // Wrap in transaction so the order record is atomic
    let newOrderId!: number;
    db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO orders (user_id, plan_type, amount, currency, total_cents, payment_provider, status, coupon_code, metadata)
        VALUES (?, ?, ?, 'CNY', ?, ?, 'pending', ?, ?)
      `).run(userId, planType, totalCents / 100, totalCents, provider, appliedCouponCode, JSON.stringify({ quantity: purchasedQuantity }));
      newOrderId = Number(result.lastInsertRowid);
    })();

    console.log('[CreateOrder] Order created:', { orderId: newOrderId, userId, planType, totalCents, provider });

    res.json({ success: true, data: {
      orderId: newOrderId,
      productName: product.name,
      amountCents: totalCents,
      provider,
    } });
  } catch (err: any) {
    console.error('[Payment] Create order error:', err.message);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/payments/orders/:id/pay — Initiate payment
router.post('/orders/:id/pay', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.id);
  const db = getDatabase();

  console.log('[Pay] Looking up order:', { orderId, userId: req.userId });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.userId) as OrderRow | undefined;
  if (!order) {
    // Check if order exists at all (regardless of user)
    const anyOrder = db.prepare('SELECT id, user_id, status FROM orders WHERE id = ?').get(orderId) as any;
    console.error('[Pay] Order not found:', { orderId, userId: req.userId, existsAtAll: !!anyOrder, ownerUserId: anyOrder?.user_id, ownerStatus: anyOrder?.status });
    res.status(404).json({ error: 'Order not found' }); return;
  }
  if (order.status !== 'pending') {
    console.warn('[Pay] Order not pending:', { orderId, status: order.status });
    res.status(400).json({ error: 'Order already processed' }); return;
  }

  const providerName = order.payment_provider || 'paypal';
  try {
    const provider = getPaymentProvider(providerName);
    const amountCents = order.total_cents ?? Math.round(order.amount * 100);
    console.log('[Pay] Order details:', { orderId, planType: order.plan_type, totalCents: order.total_cents, amount: order.amount, amountCents, provider: providerName });
    const result = await provider.createPayment({
      orderId: order.id,
      amountCents,
      currency: 'CNY',
      description: `墨韵 - ${order.plan_type}`,
    });

    db.prepare('UPDATE orders SET payment_id = ? WHERE id = ?').run(result.providerOrderId, orderId);

    res.json({ success: true, data: { redirectUrl: result.redirectUrl, qrCode: result.qrCode, providerOrderId: result.providerOrderId } });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Payment initiation failed' });
  }
});

// POST /api/payments/orders/:id/verify — Verify and activate
router.post('/orders/:id/verify', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.id);
  const db = getDatabase();

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.userId) as OrderRow & { payment_id: string | null } | undefined;
  if (!order) {
    console.error('[Verify] Order not found:', { orderId, userId: req.userId });
    res.status(404).json({ error: 'Order not found' }); return;
  }
  if (order.status === 'completed') { res.json({ success: true, data: { orderId, status: 'completed' } }); return; }
  if (order.status !== 'pending') {
    console.warn('[Verify] Order not pending:', { orderId, status: order.status });
    res.status(400).json({ error: 'Order already processed' }); return;
  }
  if (!order.payment_id) {
    console.warn('[Verify] No payment_id on order:', { orderId });
    res.status(400).json({ error: 'Payment not initiated' }); return;
  }

  const providerName = order.payment_provider || 'paypal';
  const provider = getPaymentProvider(providerName);

  try {
    const verified = await provider.verifyPayment(order.payment_id);

    if (verified.verified) {
      // Wrap entire activation in a transaction — order + subscription + coupon must all succeed
      db.transaction(() => {
        db.prepare(
          "UPDATE orders SET status = 'completed', payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(verified.providerOrderId, orderId);

        const baseType = order.plan_type.replace(':upgrade', '');
        const product = db.prepare(
          "SELECT * FROM products WHERE type = ? AND is_active = 1 LIMIT 1"
        ).get(baseType) as ProductRow | undefined;

        if (product) {
          if (product.type === 'per_use') {
            const limit = product.music_limit || 1;
            // Use quantity stored at order creation time — not price arithmetic (breaks with coupons)
            const meta = (() => { try { return JSON.parse((order as any).metadata || '{}'); } catch { return {}; } })();
            const qty = Math.max(1, parseInt(String(meta.quantity ?? 1), 10));
            db.prepare('UPDATE users SET free_music_count = free_music_count + ? WHERE id = ?')
              .run(limit * qty, order.user_id);
          } else {
            const days = product.type === 'yearly' ? 365 : 30;
            const existing = db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').get(order.user_id) as any;
            const userRow = db.prepare('SELECT free_music_count FROM users WHERE id = ?').get(order.user_id) as any;
            const carryOver = Math.max(0, userRow?.free_music_count || 0);
            const musicRemaining = product.music_limit !== null ? (product.music_limit + carryOver) : null;

            if (existing) {
              db.prepare(`
                UPDATE subscriptions SET product_id = ?, starts_at = datetime('now'),
                  expires_at = datetime('now', '+${days} days'), music_remaining = ?, status = 'active'
                WHERE user_id = ?
              `).run(product.id, musicRemaining, order.user_id);
            } else {
              db.prepare(`
                INSERT INTO subscriptions (user_id, product_id, starts_at, expires_at, music_remaining)
                VALUES (?, ?, datetime('now'), datetime('now', '+${days} days'), ?)
              `).run(order.user_id, product.id, musicRemaining);
            }
            db.prepare('UPDATE users SET free_music_count = 0 WHERE id = ?').run(order.user_id);
          }
        }

        // Consume coupon now that payment is confirmed
        if (order.coupon_code) {
          db.prepare(
            "UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND (max_uses IS NULL OR used_count < max_uses)"
          ).run(order.coupon_code);
        }
      })();

      res.json({ success: true, data: { orderId, status: 'completed' } });
    } else {
      // Don't overwrite order status — keep it 'pending' so polling can retry
      console.log('[Verify] Payment not yet completed — will keep polling:', {
        orderId,
        providerOrderId: order.payment_id,
        tradeStatus: verified.status,
        notFound: verified.notFound || false,
      });
      res.status(400).json({
        success: false,
        error: 'Payment not completed',
        notFound: verified.notFound || false,
        tradeStatus: verified.status,
      });
    }
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Payment verification failed' });
  }
});

// POST /api/payments/alipay/notify — Alipay async payment notification (no auth — called by Alipay)
router.post('/alipay/notify', express.raw({ type: 'application/x-www-form-urlencoded' }), (req: Request, res: Response) => {
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : '';

  if (!rawBody) {
    console.error('[Alipay Notify] No raw body');
    res.status(400).send('fail');
    return;
  }

  try {
    const appId = process.env.ALIPAY_APP_ID;
    const privateKey = process.env.ALIPAY_PRIVATE_KEY;
    const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

    if (!appId || !privateKey || !alipayPublicKey) {
      console.error('[Alipay Notify] Alipay not configured');
      res.status(500).send('fail');
      return;
    }

    const isSandbox = process.env.ALIPAY_SANDBOX === 'true';
    const alipay = new AlipaySdk({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      alipayPublicKey: alipayPublicKey.replace(/\\n/g, '\n'),
      gateway: isSandbox
        ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
        : 'https://openapi.alipay.com/gateway.do',
      signType: 'RSA2',
      timeout: 15000,
    });

    // Parse raw URL-encoded body — URLSearchParams handles = in base64 values correctly
    const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

    // Try V2 signature first, fall back to V2 raw
    const signOk = alipay.checkNotifySignV2(params) || alipay.checkNotifySign(rawBody, true);
    if (!signOk) {
      console.warn('[Alipay Notify] Signature verification failed');
      res.status(400).send('fail');
      return;
    }

    const tradeStatus = params.trade_status;
    const outTradeNo = params.out_trade_no;

    console.log('[Alipay Notify] Verified:', { outTradeNo, tradeStatus });

    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      console.log('[Alipay Notify] Status not terminal:', tradeStatus);
      res.send('success');
      return;
    }

    const db = getDatabase();
    const order = db.prepare(
      'SELECT * FROM orders WHERE payment_id = ? AND status = ?'
    ).get(outTradeNo, 'pending') as OrderRow | undefined;

    if (!order) {
      console.log('[Alipay Notify] Order not found or already processed:', outTradeNo);
      res.send('success');
      return;
    }

    // All activation operations in one transaction — no partial state on failure
    db.transaction(() => {
      db.prepare(
        "UPDATE orders SET status = 'completed', payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(outTradeNo, order.id);

      const baseType = order.plan_type.replace(':upgrade', '');
      const product = db.prepare(
        'SELECT * FROM products WHERE type = ? AND is_active = 1 LIMIT 1'
      ).get(baseType) as ProductRow | undefined;

      if (product) {
        if (product.type === 'per_use') {
          const limit = product.music_limit || 1;
          const meta = (() => { try { return JSON.parse((order as any).metadata || '{}'); } catch { return {}; } })();
          const qty = Math.max(1, parseInt(String(meta.quantity ?? 1), 10));
          db.prepare('UPDATE users SET free_music_count = free_music_count + ? WHERE id = ?')
            .run(limit * qty, order.user_id);
        } else {
          const days = product.type === 'yearly' ? 365 : 30;
          const existing = db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').get(order.user_id) as any;
          const userRow = db.prepare('SELECT free_music_count FROM users WHERE id = ?').get(order.user_id) as any;
          const carryOver = Math.max(0, userRow?.free_music_count || 0);
          const musicRemaining = product.music_limit !== null ? (product.music_limit + carryOver) : null;

          if (existing) {
            db.prepare(`
              UPDATE subscriptions SET product_id = ?, starts_at = datetime('now'),
                expires_at = datetime('now', '+${days} days'), music_remaining = ?, status = 'active'
              WHERE user_id = ?
            `).run(product.id, musicRemaining, order.user_id);
          } else {
            db.prepare(`
              INSERT INTO subscriptions (user_id, product_id, starts_at, expires_at, music_remaining)
              VALUES (?, ?, datetime('now'), datetime('now', '+${days} days'), ?)
            `).run(order.user_id, product.id, musicRemaining);
          }
          db.prepare('UPDATE users SET free_music_count = 0 WHERE id = ?').run(order.user_id);
        }
      }

      // Consume coupon now that payment is confirmed
      if (order.coupon_code) {
        db.prepare(
          "UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND (max_uses IS NULL OR used_count < max_uses)"
        ).run(order.coupon_code);
      }
    })();

    console.log('[Alipay Notify] Order activated:', order.id);
    res.send('success');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    console.error('[Alipay Notify] Error:', message);
    res.status(500).send('fail');
  }
});

export default router;
