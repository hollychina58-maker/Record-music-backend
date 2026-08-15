import express, { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { dbGet, dbAll, dbRun, dbBatch } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getPaymentProvider } from '../services/payment/index.js';
import { AlipaySdk } from 'alipay-sdk';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// 3-20: dedicated rate limit for payment verification polling (10/min/IP, trusted IP)
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.PAY_VERIFY_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator((req.ip || '127.0.0.1').replace(/^::ffff:/, '')),
  message: { error: 'Too many payment verification attempts, please try again later' },
});

// ─── Supported payment providers ────────────────────────────────────────────
// Only alipay is live. wechat/paypal stubs throw — client must never submit them.
const ALLOWED_PROVIDERS = ['alipay'] as const;
type ProviderName = typeof ALLOWED_PROVIDERS[number];

// 定价基准：1 美金 = 100 分（products.price_cents 现为美金分）。
// 支付宝按人民币结算，入单/支付时按此汇率把美金分折算成人民币分。
const USD_TO_CNY_RATE = 7.2; // 1 USD ≈ 7.2 CNY（可按需调整）

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
router.get('/products', asyncHandler(async (_req: Request, res: Response) => {
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
}));

// ─── GET /subscription ───────────────────────────────────────────────────────
router.get('/subscription', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// ─── POST /orders ────────────────────────────────────────────────────────────
router.post('/orders', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  let appliedCouponCode: string | null = null;
  let couponClaimed = false;
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
    // price_cents 为美金分，先在美金分域完成全部价格计算，入单时再折算成人民币分
    let totalCentsUsd = product.price_cents * (product.type === 'per_use' ? qty : 1);
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
          // 历史订单 total_cents 是人民币分，除以汇率折算回美金分再对比
          const rawPaidUsd = lastMonthlyOrder
            ? Math.round((lastMonthlyOrder.total_cents ?? Math.round(lastMonthlyOrder.amount * 100)) / USD_TO_CNY_RATE)
            : activeSub.price_cents;
          // Cap deduction at undiscounted monthly price to prevent coupon-stacking exploit
          const paidMonthlyUsd = Math.min(rawPaidUsd, activeSub.price_cents);
          // Minimum charge $1 (100 cents) to prevent free upgrades via coupon abuse
          totalCentsUsd = Math.max(100, totalCentsUsd - paidMonthlyUsd);
          isUpgrade = true;
        } else {
          res.status(400).json({
            error: `已有 ${activeSub.plan_name} 订阅（至 ${activeSub.expires_at.slice(0, 10)}），到期后可续费`,
          });
          return;
        }
      }
    }

    // 5. Apply coupon — 原子占用名额（防并发绕过 max_uses）。
    // 之前只 SELECT 校验、真正记账在激活时，两个订单可同时通过校验拿到折扣，
    // 激活时第二个超限导致「付了折扣价却拿不到权益」。改为下单即原子 claim。
    if (couponCode && couponCode.trim()) {
      const code = couponCode.trim();
      const claim = await dbRun(
        "UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND is_active = 1 AND (max_uses IS NULL OR used_count < max_uses) AND (valid_from IS NULL OR valid_from <= datetime('now')) AND (valid_until IS NULL OR valid_until >= datetime('now'))",
        [code]
      );
      if (claim.changes === 0) {
        res.status(400).json({ error: '优惠码无效或已过期' });
        return;
      }
      couponClaimed = true;
      const coupon = await dbGet<any>('SELECT * FROM coupons WHERE code = ?', [code]);
      if (!coupon) {
        await dbRun('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?', [code]);
        res.status(400).json({ error: '优惠码无效或已过期' });
        return;
      }
      const discountPercent = Math.min(99, Math.max(0, coupon.discount_percent || 0));
      if (discountPercent > 0) totalCentsUsd = Math.round(totalCentsUsd * (100 - discountPercent) / 100);
      if (coupon.discount_cents > 0) totalCentsUsd = Math.max(0, totalCentsUsd - coupon.discount_cents);
      appliedCouponCode = code;
    }

    // 最低 $1（100 美金分）：防止优惠券把订单打到 0 金额（支付宝拒绝 0 元订单，订单永久 pending）
    totalCentsUsd = Math.max(100, totalCentsUsd);

    const planType = isUpgrade ? `${product.type}:upgrade` : product.type;
    const purchasedQty = product.type === 'per_use' ? qty : 1;

    // 美金分 → 人民币分（支付宝按 CNY 结算，订单历史 total_cents 保持人民币分）
    const totalCentsCny = Math.round(totalCentsUsd * USD_TO_CNY_RATE);

    const result = await dbRun(
      `INSERT INTO orders (user_id, plan_type, amount, currency, total_cents, payment_provider, status, coupon_code, metadata)
       VALUES (?, ?, ?, 'CNY', ?, ?, 'pending', ?, ?)`,
      [
        userId,
        planType,
        totalCentsCny / 100,
        totalCentsCny,
        provider,
        appliedCouponCode,
        JSON.stringify({ quantity: purchasedQty, productId: product.id, musicLimit: product.music_limit ?? null }),
      ]
    );

    res.json({
      success: true,
      data: {
        orderId: result.lastInsertRowid,
        productName: product.name,
        amountCents: totalCentsCny,
        provider,
      },
    });
  } catch (err: any) {
    // 订单创建失败时释放已占用的优惠券名额（避免名额被僵尸占用）
    if (couponClaimed && appliedCouponCode) {
      await dbRun('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?', [appliedCouponCode]).catch(() => {});
    }
    console.error('[Payment] Create order error:', err.message);
    res.status(500).json({ error: '创建订单失败，请稍后重试' });
  }
}));

// ─── POST /orders/:id/pay ────────────────────────────────────────────────────
router.post('/orders/:id/pay', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
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
    // S5: if this order already has a pending Alipay trade, reuse it — re-creating would
    // overwrite payment_id and orphan the previously generated (possibly already paid) QR.
    if (order.payment_id) {
      res.json({
        success: true,
        data: { providerOrderId: order.payment_id, qrCode: (() => { try { return JSON.parse(order.metadata || '{}').qrCode; } catch { return null; } })() },
      });
      return;
    }

    const payProvider = getPaymentProvider(providerName);
    const amountCents = order.total_cents ?? Math.round(order.amount * 100);
    const result = await payProvider.createPayment({
      orderId: order.id,
      amountCents,
      currency: 'CNY',
      description: `墨韵 - ${order.plan_type}`,
    });

    // S5: persist the QR code so a re-opened pay page can return it without a new trade
    const meta = (() => { try { return JSON.parse(order.metadata || '{}'); } catch { return {}; } })();
    meta.qrCode = result.qrCode || null;
    await dbRun('UPDATE orders SET payment_id = ?, metadata = ? WHERE id = ?', [result.providerOrderId, JSON.stringify(meta), orderId]);

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
}));

// ─── activateOrder ───────────────────────────────────────────────────────────
// Uses an atomic status-guard UPDATE to prevent duplicate activation.
// Returns true if this call was the one that activated the order.
export async function activateOrder(order: OrderRow): Promise<boolean> {
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
    // 优惠券名额已在创建订单时原子占用（POST /orders），这里不再重复消耗，
    // 避免「创建时占用 + 激活时再占用」导致 used_count 被记两次。

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
        const existing = await dbGet<{ id: number; music_remaining: number | null }>(
          "SELECT id, music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active'",
          [order.user_id]
        );
        // Carry over any remaining free credits into the new subscription limit
        const userRow = await dbGet<{ free_music_count: number }>(
          'SELECT free_music_count FROM users WHERE id = ?',
          [order.user_id]
        );
        const carryOver = Math.max(0, userRow?.free_music_count || 0);
        // 3-3: also carry over the remaining quota of the expiring subscription
        // (monthly -> yearly upgrades previously lost the old subscription's leftovers)
        const subRemaining = existing?.music_remaining != null ? Math.max(0, existing.music_remaining) : 0;
        // For yearly (unlimited): music_remaining = null
        const musicRemaining = product.music_limit !== null
          ? product.music_limit + carryOver + subRemaining
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
router.post('/orders/:id/verify', verifyLimiter, authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
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
    // 3-1: recover orders stuck in 'completing' (process crashed between claim and batch)
    const stuck = await dbRun(
      "UPDATE orders SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'completing' AND updated_at < datetime('now', '-5 minutes')",
      [orderId]
    );
    if (stuck.changes > 0) {
      console.warn('[Payment] Recovered stuck completing order', orderId);
      // fall through to re-verify below
    } else {
      // Still being activated by a concurrent request — tell client to retry shortly
      res.status(202).json({ success: false, error: '激活处理中，请稍候', retryAfter: 2 });
      return;
    }
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
}));

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

      // 3-17: verify the notification belongs to our app (defense in depth — signature already checked)
      if (params.app_id && params.app_id !== appId) {
        console.warn('[Alipay Notify] app_id mismatch — ignoring:', params.app_id);
        res.status(400).send('fail');
        return;
      }

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

      // 3-17: amount must match the order (reject tampered notifications)
      const expectedAmount = ((order.total_cents ?? Math.round(order.amount * 100)) / 100).toFixed(2);
      const paidAmount = params.total_amount;
      if (paidAmount !== undefined && Math.abs(parseFloat(paidAmount) - parseFloat(expectedAmount)) > 0.01) {
        console.warn(`[Alipay Notify] Amount mismatch for order ${order.id}: expected ${expectedAmount}, got ${paidAmount}`);
        res.status(400).send('fail');
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