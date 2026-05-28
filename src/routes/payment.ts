import { Router, Request, Response } from 'express';
import { getDatabase } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getPaymentProvider } from '../services/payment/index.js';

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
  status: string;
  payment_provider: string | null;
  payment_id: string | null;
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
    const { productId, provider = 'paypal' } = req.body;
    const userId = req.userId!;
    const db = getDatabase();

    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(productId) as ProductRow | undefined;
    if (!product) {
      res.status(400).json({ error: 'Invalid product' });
      return;
    }

    let totalCents = product.price_cents;

    // Apply coupon if provided
    if (req.body.couponCode) {
      const coupon = db.prepare(
        "SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND used_count < max_uses AND valid_from <= datetime('now') AND valid_until >= datetime('now')"
      ).get(req.body.couponCode) as any;

      if (coupon) {
        if (coupon.discount_percent) {
          totalCents = Math.round(totalCents * (100 - coupon.discount_percent) / 100);
        }
        if (coupon.discount_cents) {
          totalCents = Math.max(0, totalCents - coupon.discount_cents);
        }
        db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
      }
    }

    const result = db.prepare(`
      INSERT INTO orders (user_id, plan_type, amount, currency, total_cents, payment_provider, status)
      VALUES (?, ?, ?, 'CNY', ?, ?, 'pending')
    `).run(userId, product.type, totalCents / 100, totalCents, provider);

    res.json({ success: true, data: {
      orderId: Number(result.lastInsertRowid),
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

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.userId) as OrderRow | undefined;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  if (order.status !== 'pending') { res.status(400).json({ error: 'Order already processed' }); return; }

  const providerName = order.payment_provider || 'paypal';
  try {
    const provider = getPaymentProvider(providerName);
    const result = await provider.createPayment({
      orderId: order.id,
      amountCents: order.amount * 100,
      currency: 'CNY',
      description: `墨韵 - ${order.plan_type}`,
    });

    db.prepare('UPDATE orders SET payment_id = ? WHERE id = ?').run(result.providerOrderId, orderId);

    res.json({ success: true, data: { redirectUrl: result.redirectUrl, providerOrderId: result.providerOrderId } });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Payment initiation failed' });
  }
});

// POST /api/payments/orders/:id/verify — Verify and activate
router.post('/orders/:id/verify', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.id);
  const db = getDatabase();

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.userId) as OrderRow & { payment_id: string | null } | undefined;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  if (order.status !== 'pending') { res.status(400).json({ error: 'Order already processed' }); return; }
  if (!order.payment_id) { res.status(400).json({ error: 'Payment not initiated' }); return; }

  const providerName = order.payment_provider || 'paypal';
  const provider = getPaymentProvider(providerName);

  try {
    const verified = await provider.verifyPayment(order.payment_id);

    if (verified.verified) {
      db.prepare(
        "UPDATE orders SET status = 'completed', payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(verified.providerOrderId, orderId);

      // Get the product associated with this order
      // The order stores plan_type as the product type (per_use, monthly, yearly)
      const product = db.prepare(
        "SELECT * FROM products WHERE type = ? AND is_active = 1 LIMIT 1"
      ).get(order.plan_type) as ProductRow | undefined;

      if (product) {
        if (product.type === 'per_use') {
          const limit = product.music_limit || 1;
          db.prepare('UPDATE users SET free_music_count = free_music_count + ? WHERE id = ?').run(limit, order.user_id);
        } else {
          // monthly or yearly — create subscription
          const days = product.type === 'yearly' ? 365 : 30;
          const existing = db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').get(order.user_id) as any;

          if (existing) {
            db.prepare(`
              UPDATE subscriptions SET product_id = ?, starts_at = datetime('now'),
                expires_at = datetime('now', '+${days} days'), music_remaining = ?, status = 'active'
              WHERE user_id = ?
            `).run(product.id, product.music_limit, order.user_id);
          } else {
            db.prepare(`
              INSERT INTO subscriptions (user_id, product_id, starts_at, expires_at, music_remaining)
              VALUES (?, ?, datetime('now'), datetime('now', '+${days} days'), ?)
            `).run(order.user_id, product.id, product.music_limit);
          }
        }
      }

      res.json({ success: true, data: { orderId, status: 'completed' } });
    } else {
      db.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(verified.status, orderId);
      res.status(400).json({ success: false, error: 'Payment not completed' });
    }
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Payment verification failed' });
  }
});

export default router;
