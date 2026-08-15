import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';
import { activateOrder } from '../payment.js';

import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// 3-10: escape LIKE wildcards in search params so user input cannot broaden the match set
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => '\\' + m);
}

router.get('/orders', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || '';
  const status = (req.query.status as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q) { conditions.push('(u.email LIKE ? OR u.nickname LIKE ? OR o.payment_id LIKE ?)'); params.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`); }
  if (status) { conditions.push('o.status = ?'); params.push(status); }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = await dbGet<{ total: number }>(
    `SELECT COUNT(*) as total FROM orders o JOIN users u ON o.user_id = u.id ${where}`,
    params
  );
  const total = countRow?.total ?? 0;

  const orders = await dbAll<any>(
    `SELECT o.id, o.plan_type, o.total_cents, o.amount, o.currency, o.status,
            o.payment_provider, o.payment_id, o.coupon_code, o.created_at, o.updated_at,
            u.id as user_id, u.email, u.nickname
     FROM orders o JOIN users u ON o.user_id = u.id
     ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    success: true,
    data: orders.map((o) => ({
      id: o.id, planType: o.plan_type,
      totalCents: o.total_cents ?? Math.round(o.amount * 100),
      currency: o.currency, status: o.status,
      provider: o.payment_provider, paymentId: o.payment_id, couponCode: o.coupon_code,
      createdAt: o.created_at, updatedAt: o.updated_at,
      userId: o.user_id, userEmail: o.email, userNickname: o.nickname,
    })),
    meta: { total, page, limit },
  });
}));

router.put('/orders/:id/status', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (!['pending', 'completed', 'cancelled', 'refunded'].includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }

  const order = await dbGet<any>('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  // 状态机白名单：禁止非法转换——
  //   completed→pending 会再次 activateOrder 重复发权益；
  //   completed→cancelled 不撤销已发权益；
  //   refunded→completed 会绕过退款撤销逻辑反复套现。
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    pending: ['completed', 'cancelled'],
    completed: ['refunded'],
    cancelled: [],
    refunded: [],
  };
  if (!ALLOWED_TRANSITIONS[order.status]?.includes(status)) {
    res.status(400).json({ error: `Illegal status transition: ${order.status} → ${status}` });
    return;
  }

  // 3-2: manual 'completed' must actually grant the entitlement (subscription/credits),
  // exactly like the payment-activation path — otherwise the user pays but gets nothing.
  if (status === 'completed' && order.status !== 'completed') {
    const activated = await activateOrder(order);
    console.log(`[Admin] Manual order completion: order ${id}, activated=${activated}`);
    if (!activated) {
      res.status(409).json({ success: false, error: '订单已被其他请求激活' });
      return;
    }
    res.json({ success: true, data: { id, status: 'completed' } });
    return;
  }

  // 'refunded': revoke previously granted entitlements (best-effort, admin tool)
  if (status === 'refunded' && order.status === 'completed') {
    const baseType = String(order.plan_type || '').replace(':upgrade', '');
    if (baseType === 'per_use') {
      const meta = (() => { try { return JSON.parse(order.metadata || '{}'); } catch { return {}; } })();
      const qty = Math.max(1, parseInt(String(meta.quantity ?? 1), 10));
      const product = await dbGet<{ music_limit: number | null }>('SELECT music_limit FROM products WHERE type = ? AND is_active = 1 LIMIT 1', [baseType]);
      const credits = (product?.music_limit || 1) * qty;
      await dbRun('UPDATE users SET free_music_count = MAX(0, free_music_count - ?) WHERE id = ?', [credits, order.user_id]);
    } else if (baseType) {
      await dbRun("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'", [order.user_id]);
    }
  }

  await dbRun("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id]);
  res.json({ success: true, data: { id, status } });
}));

export default router;