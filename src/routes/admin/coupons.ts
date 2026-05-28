import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/coupons', authMiddleware, adminMiddleware, (_req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
  res.json({ success: true, data: coupons });
});

router.post('/coupons', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const { code, discountPercent, discountCents, validFrom, validUntil, maxUses } = req.body;

  if (!code) { res.status(400).json({ error: 'code is required' }); return; }

  const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code);
  if (existing) { res.status(400).json({ error: 'Coupon code already exists' }); return; }

  db.prepare(`
    INSERT INTO coupons (code, discount_percent, discount_cents, valid_from, valid_until, max_uses)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, discountPercent ?? null, discountCents ?? null, validFrom || null, validUntil || null, maxUses ?? null);

  res.json({ success: true, data: { code } });
});

router.put('/coupons/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);
  const { discountPercent, discountCents, validFrom, validUntil, maxUses, isActive } = req.body;

  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as any;
  if (!coupon) { res.status(404).json({ error: 'Coupon not found' }); return; }

  db.prepare(`
    UPDATE coupons SET discount_percent = ?, discount_cents = ?, valid_from = ?,
      valid_until = ?, max_uses = ?, is_active = ?
    WHERE id = ?
  `).run(
    discountPercent ?? coupon.discount_percent,
    discountCents ?? coupon.discount_cents,
    validFrom !== undefined ? validFrom : coupon.valid_from,
    validUntil !== undefined ? validUntil : coupon.valid_until,
    maxUses !== undefined ? maxUses : coupon.max_uses,
    isActive !== undefined ? isActive : coupon.is_active,
    id
  );

  res.json({ success: true, data: { id } });
});

router.delete('/coupons/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);

  db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
  res.json({ success: true, data: { id } });
});

export default router;
