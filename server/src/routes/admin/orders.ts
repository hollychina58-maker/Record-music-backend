import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/orders', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const q = (req.query.q as string) || '';
  const status = (req.query.status as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (q) {
    conditions.push('(u.email LIKE ? OR u.nickname LIKE ? OR o.payment_id LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    conditions.push('o.status = ?');
    params.push(status);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM orders o JOIN users u ON o.user_id = u.id ${where}`
  ).get(...params) as any;

  const orders = db.prepare(`
    SELECT o.id, o.plan_type, o.total_cents, o.amount, o.currency, o.status,
           o.payment_provider, o.payment_id, o.coupon_code, o.created_at, o.updated_at,
           u.id as user_id, u.email, u.nickname
    FROM orders o JOIN users u ON o.user_id = u.id
    ${where}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  res.json({
    success: true,
    data: orders.map((o: any) => ({
      id: o.id,
      planType: o.plan_type,
      totalCents: o.total_cents ?? Math.round(o.amount * 100),
      currency: o.currency,
      status: o.status,
      provider: o.payment_provider,
      paymentId: o.payment_id,
      couponCode: o.coupon_code,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      userId: o.user_id,
      userEmail: o.email,
      userNickname: o.nickname,
    })),
    meta: { total, page, limit },
  });
});

// Manual refund / cancel an order
router.put('/orders/:id/status', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;

  if (!['pending', 'completed', 'cancelled', 'refunded'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

  db.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  res.json({ success: true, data: { id, status } });
});

export default router;
