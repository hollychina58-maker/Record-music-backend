import express, { Router, Request, Response } from 'express';
import { dbGet, dbAll, dbRun, dbBatch } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getPaymentProvider } from '../services/payment/index.js';
import { AlipaySdk } from 'alipay-sdk';

const router = Router();

// ─── Supported payment providers ────────────────────────────────────────────
// Only alipay is live. wechat/paypal stubs throw — client must never submit them.
const ALLOWED_PROVIDERS = ['alipay'] as const;
type ProviderName = typeof ALLOWED_PROVIDERS[number];

// ─── Types ───────────────────────────────────────────────────────────────────
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
  metadata: string | null;
}

// ─── GET /products ───────────────────────────────────────────────────────────
router.get('/products', async (_req: Request, res: Response) => {
  const products = await dbAll<ProductRow>(
    'SELECT * FROM products WHERE is_active = 1 ORDER BY price_cents ASC'
  );
  res.json({
    success: true,
    data: products.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      priceCents: p.price_cents,
      musicLimit: p.music_limit,
      description: p.description,
    })),
  });
});

// ─── GET /subscription ───────────────────────────────────────────────────────
router.get('/subscription', authMiddleware, async (req: AuthRequest, res: Response) => {
  const sub = await dbGet<any>(
    `SELECT s.*, p.name as plan_name, p.type as plan_type, p.music_limit
     FROM subscriptions s JOIN products p ON s.product_id = p.id
     WHERE s.user_id = ? AND s.status = 'active' ORDER BY s.expires_at DESC LIMIT 1`,
    [req.userId]
  );
  if (!sub || new Date(sub.expires_at) < new Date()) {
    res.json({ success: true, data: null });
    return;
  }
  res.json({
    success: true,
    data: {
      planName: sub.plan_name,
      planType: sub.plan_type,
      expiresAt: sub.expires_at,
      musicRemaining: sub.music_remaining,
    },
  });
});

// ─── POST /orders ────────────────────────────────────────────────────────────
router.post('/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { productId, provider, quantity = 1, couponCode } = req.body;
    const userId = req.userId!;

    // 1. Validate provider — only alipay is live
    if (!provider || !ALLOWED_PROVIDERS.includes(provider as ProviderName)) {
      res.status(400).json({ error: `支付方式不支持，目前仅支持支付宝 (alipay)` });
      return;
    }

    // 2. Validate product
    const product = await dbGet<ProductRow>(
      'SELECT * FROM products WHERE id = ? AND is_active = 1',
      [productId]
    );
    if (!product) {
      res.status(400).json({ error: '商品不存在或已下架' });
      return;
    }

    const qty = Math.max(1, Math.min(100, parseInt(String(quantity), 10) || 1));
    let totalCents = product.price_cents * (product.type === 'per_use' ? qty : 1);
    let isUpgrade = false;

    // 3. Check per-use blocked by unlimited subscription
    if (product.type === 'per_use') {
      const unlimitedSub = await dbGet(
        `SELECT id FROM subscriptions
         WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now') AND music_remaining IS NULL`,
        [userId]
      );
      if (unlimitedSub) {
        res.status(400).json({ error: '年度会员已享无限次生成，无需按次购买' });
        return;
      }
    }

    // 4. Validate subscription state for plan upgrades
    if (product.type !== 'per_use') {
      const activeSub = await dbGet<any>(
        `SELECT s.*, p.name as plan_name, p.type as plan_type, p.price_cents
         FROM subscriptions s JOIN products p ON s.product_id = p.id
         WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
         ORDER BY s.expires_at DESC LIMIT 1`,
        [userId]
      );

      if (activeSub) {
        if (product.type === 'yearly' && activeSub.plan_type === 'monthly') {
          // Monthly → yearly upgrade: deduct the price already paid for monthly
          const lastMonthlyOrder = await dbGet<{ total_cents: number | null; amount: number }>(
            `SELECT total_cents, amount FROM orders
             WHERE user_id = ? AND plan_type IN ('monthly','monthly:upgrade') AND status = 'completed'
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
          );
          const rawPaid = lastMonthlyOrder
            ? (lastMonthlyOrder.total_cents ?? Math.round(lastMonthlyOrder.amount * 100))
            : activeSub.price_cents;
          // Cap deduction at undiscounted monthly price to prevent coupon-stacking exploit
          const paidMonthly = Math.min(rawPaid, activeSub.price_cents);
          // Minimum charge 1 CNY (100 cents) to prevent free upgrades via coupon abuse
          totalCents = Math.max(100, totalCents - paidMonthly);
          isUpgrade = true;
        } else {
          res.status(400).json({
            error: `已有 ${activeSub.plan_name} 订阅（至 ${activeSub.expires_at.slice(0, 10)}），到期后可续费`,
          });
          return;
        }
      }
    }

    // 5. Apply coupon (validate strictly — reject invalid codes explicitly)
    let appliedCouponCode: string | null = null;
    if (couponCode && couponCode.trim()) {
      const coupon = await dbGet<any>(
        `SELECT * FROM coupons
         WHERE code = ? AND is_active = 1
           AND (max_uses IS NULL OR used_count < max_uses)
           AND (valid_from IS NULL OR valid_from <= datetime('now'))
           AND (valid_until IS NULL OR valid_until >= datetime('now'))`,
        [couponCode.trim()]
      );
      if (!coupon) {
        res.status(400).json({ error: '优惠码无效或已过期' });
        return;
      }
      const discountPercent = Math.min(99, Math.max(0, coupon.discount_percent || 0));
      if (discountPercent > 0) totalCents = Math.round(totalCents * (100 - discountPercent) / 100);
      if (coupon.discount_cents > 0) totalCents = Math.max(0, totalCents - coupon.discount_cents);
      appliedCouponCode = coupon.code;
    }

    const planType = isUpgrade ? `${product.type}:upgrade` : product.type;
    const purchasedQty = product.type === 'per_use' ? qty : 1;

    const result = await dbRun(
      `INSERT INTO orders (user_id, plan_type, amount, currency, total_cents, payment_provider, status, coupon_code, metadata)
       VALUES (?, ?, ?, 'CNY', ?, ?, 'pending', ?, ?)`,
      [
        userId,
        planType,
        totalCents / 100,
        totalCents,
        provider,
        appliedCouponCode,
        JSON.stringify({ quantity: purchasedQty }),
      ]
    );

    res.json({
      success: true,
      data: {
        orderId: result.lastInsertRowid,
        productName: product.name,
        amountCents: totalCents,
        provider,
      },
    });
  } catch (err: any) {
    console.error('[Payment] Create order error:', err.message);
    res.status(500).json({ error: '创建订单失败，请稍后重试' });
  }
});

// ─── POST /orders/:id/pay ────────────────────────────────────────────────────
router.post('/orders/:id/pay', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.id);
  const order = await dbGet<OrderRow>(
    'SELECT * FROM orders WHERE id = ? AND user_id = ?',
    [orderId, req.userId]
  );
  if (!order) { res.status(404).json({ error: '订单不存在' }); return; }
  if (order.status !== 'pending') { res.status(400).json({ error: '订单已处理' }); return; }

  const providerName = (order.payment_provider || '') as ProviderName;
  if (!ALLOWED_PROVIDERS.includes(providerName)) {
    res.status(400).json({ error: '该支付方式暂不支持' });
    return;
  }

  try {
    const payProvider = getPaymentProvider(providerName);
    const amountCents = order.total_cents ?? Math.round(order.amount * 100);
    const result = await payProvider.createPayment({
      orderId: order.id,
      amountCents,
      currency: 'CNY',
      description: `墨韵 - ${order.plan_type}`,
    });

    await dbRun('UPDATE orders SET payment_id = ? WHERE id = ?', [result.providerOrderId, orderId]);

    res.json({
      success: true,
      data: {
        redirectUrl: result.redirectUrl,
        qrCode: result.qrCode,
        providerOrderId: result.providerOrderId,
      },
    });
  } catch (err: any) {
    console.error('[Payment] Pay error:', err.message);
    res.status(400).json({ error: '支付发起失败，请稍后重试' });
  }
});

// ─── activateOrder ───────────────────────────────────────────────────────────
// Uses an atomic status-guard UPDATE to prevent duplicate activation.
// Returns true if this call was the one that activated the order.
async function activateOrder(order: OrderRow): Promise<boolean> {
  // Atomic claim: only one concurrent caller can flip status from 'pending' → 'completing'
  const claimed = await dbRun(
    "UPDATE orders SET status = 'completing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    [order.id]
  );
  if (claimed.changes === 0) {
    // Already activated or being activated by another request
    return false;
  }

  try {
    const baseType = order.plan_type.replace(':upgrade', '');
    const product = await dbGet<ProductRow>(
      'SELECT * FROM products WHERE type = ? AND is_active = 1 LIMIT 1',
      [baseType]
    );

    const stmts: { sql: string; args?: unknown[] }[] = [];

    if (product) {
      if (product.type === 'per_use') {
        // Credit free_music_count
        const meta = (() => {
          try { return JSON.parse(order.metadata || '{}'); }
          catch { return {}; }
        })();
        const qty = Math.max(1, parseInt(String(meta.quantity ?? 1), 10));
        const creditsToAdd = (product.music_limit || 1) * qty;
        stmts.push({
          sql: 'UPDATE users SET free_music_count = free_music_count + ? WHERE id = ?',
          args: [creditsToAdd, order.user_id],
        });
        console.log(`[Payment] Activate per_use: +${creditsToAdd} credits → user ${order.user_id}`);
      } else {
        // Subscription plan (monthly / yearly)
        const days = product.type === 'yearly' ? 365 : 30;
        const existing = await dbGet(
          "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active'",
          [order.user_id]
        );
        // Carry over any remaining free credits into the new subscription limit
        const userRow = await dbGet<{ free_music_count: number }>(
          'SELECT free_music_count FROM users WHERE id = ?',
          [order.user_id]
        );
        const carryOver = Math.max(0, userRow?.free_music_count || 0);
        // For yearly (unlimited): music_remaining = null
        const musicRemaining = product.music_limit !== null
          ? product.music_limit + carryOver
          : null;

        if (existing) {
          stmts.push({
            sql: `UPDATE subscriptions
                  SET product_id = ?, starts_at = datetime('now'),
                      expires_at = datetime('now', '+${days} days'),
                      music_remaining = ?, status = 'active'
                  WHERE user_id = ?`,
            args: [product.id, musicRemaining, order.user_id],
          });
        } else {
          stmts.push({
            sql: `INSERT INTO subscriptions (user_id, product_id, starts_at, expires_at, music_remaining)
                  VALUES (?, ?, datetime('now'), datetime('now', '+${days} days'), ?)`,
            args: [order.user_id, product.id, musicRemaining],
          });
        }
        // Zero out free credits — they've been rolled into the subscription
        stmts.push({
          sql: 'UPDATE users SET free_music_count = 0 WHERE id = ?',
          args: [order.user_id],
        });
        console.log(`[Payment] Activate ${product.type}: ${days}d subscription, remaining=${musicRemaining ?? '∞'} → user ${order.user_id}`);
      }
    }

    // Consume coupon (safe: idempotent with max_uses guard)
    if (order.coupon_code) {
      stmts.push({
        sql: 'UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND (max_uses IS NULL OR used_count < max_uses)',
        args: [order.coupon_code],
      });
    }

    // Final status → completed (batch is atomic)
    stmts.push({
      sql: "UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [order.id],
    });

    await dbBatch(stmts);
    return true;
  } catch (err) {
    // Roll back the status claim so the order can be retried
    await dbRun(
      "UPDATE orders SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [order.id]
    );
    throw err;
  }
}

// ─── POST /orders/:id/verify ─────────────────────────────────────────────────
router.post('/orders/:id/verify', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.id);
  const order = await dbGet<OrderRow>(
    'SELECT * FROM orders WHERE id = ? AND user_id = ?',
    [orderId, req.userId]
  );
  if (!order) { res.status(404).json({ error: '订单不存在' }); return; }

  // Already completed — idempotent success
  if (order.status === 'completed') {
    res.json({ success: true, data: { orderId, status: 'completed' } });
    return;
  }
  if (order.status === 'completing') {
    // Being activated in a concurrent request — tell client to retry shortly
    res.status(202).json({ success: false, error: '激活处理中，请稍候', retryAfter: 2 });
    return;
  }
  if (order.status !== 'pending') {
    res.status(400).json({ error: '订单状态异常' });
    return;
  }
  if (!order.payment_id) {
    res.status(400).json({ error: '支付未发起', notFound: true });
    return;
  }

  const providerName = (order.payment_provider || '') as ProviderName;
  if (!ALLOWED_PROVIDERS.includes(providerName)) {
    res.status(400).json({ error: '该支付方式暂不支持' });
    return;
  }

  try {
    const payProvider = getPaymentProvider(providerName);
    const verified = await payProvider.verifyPayment(order.payment_id);

    if (verified.verified) {
      const activated = await activateOrder(order);
      if (!activated) {
        // Concurrent activation already ran — re-read to confirm completed
        const latest = await dbGet<{ status: string }>(
          'SELECT status FROM orders WHERE id = ?',
          [orderId]
        );
        if (latest?.status === 'completed') {
          res.json({ success: true, data: { orderId, status: 'completed' } });
        } else {
          res.status(202).json({ success: false, error: '激活处理中，请稍候', retryAfter: 2 });
        }
        return;
      }
      res.json({ success: true, data: { orderId, status: 'completed' } });
    } else {
      res.status(400).json({
        success: false,
        error: '支付未完成',
        notFound: verified.notFound || false,
        tradeStatus: verified.status,
      });
    }
  } catch (err: any) {
    console.error('[Payment] Verify error:', err.message);
    res.status(502).json({ error: '支付查询失败，请稍后重试' });
  }
});

// ─── POST /alipay/notify  (async server-side callback from Alipay) ────────────
// Must respond "success" within 10 s or Alipay will retry (up to 8 times).
router.post(
  '/alipay/notify',
  express.raw({ type: 'application/x-www-form-urlencoded' }),
  async (req: Request, res: Response) => {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : '';
    if (!rawBody) { res.status(400).send('fail'); return; }

    try {
      const { appId, privateKey, alipayPublicKey } = {
        appId: process.env.ALIPAY_APP_ID,
        privateKey: process.env.ALIPAY_PRIVATE_KEY,
        alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
      };
      if (!appId || !privateKey || !alipayPublicKey) {
        console.error('[Alipay Notify] Missing env vars');
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

      const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

      // Verify signature with the v2 method only (RSA2); never fall back to the old v1
      const signOk = alipay.checkNotifySignV2(params);
      if (!signOk) {
        console.warn('[Alipay Notify] Signature verification failed');
        res.status(400).send('fail');
        return;
      }

      const { trade_status: tradeStatus, out_trade_no: outTradeNo } = params;

      // Only handle terminal success states
      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        res.send('success');
        return;
      }

      const order = await dbGet<OrderRow>(
        "SELECT * FROM orders WHERE payment_id = ? AND status = 'pending'",
        [outTradeNo]
      );
      if (!order) {
        // Already activated or unknown order — still return success to stop Alipay retries
        res.send('success');
        return;
      }

      const activated = await activateOrder(order);
      console.log(`[Alipay Notify] Order ${order.id} — activated=${activated}`);
      res.send('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown';
      console.error('[Alipay Notify] Error:', message);
      res.status(500).send('fail');
    }
  }
);

export default router;
