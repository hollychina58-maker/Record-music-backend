import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';

import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.get('/coupons', authMiddleware, adminMiddleware, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const coupons = await dbAll('SELECT * FROM coupons ORDER BY id DESC');
  res.json({ success: true, data: coupons });
}));

router.post('/coupons', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { code, discountPercent, discountCents, validFrom, validUntil, maxUses } = req.body;
  if (!code) { res.status(400).json({ error: 'code is required' }); return; }

  const existing = await dbGet('SELECT id FROM coupons WHERE code = ?', [code]);
  if (existing) { res.status(400).json({ error: 'Coupon code already exists' }); return; }

  await dbRun(
    'INSERT INTO coupons (code, discount_percent, discount_cents, valid_from, valid_until, max_uses) VALUES (?, ?, ?, ?, ?, ?)',
    [code, discountPercent ?? null, discountCents ?? null, validFrom || null, validUntil || null, maxUses ?? null]
  );
  res.json({ success: true, data: { code } });
}));

router.put('/coupons/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { discountPercent, discountCents, validFrom, validUntil, maxUses, isActive } = req.body;

  const coupon = await dbGet<any>('SELECT * FROM coupons WHERE id = ?', [id]);
  if (!coupon) { res.status(404).json({ error: 'Coupon not found' }); return; }

  await dbRun(
    'UPDATE coupons SET discount_percent = ?, discount_cents = ?, valid_from = ?, valid_until = ?, max_uses = ?, is_active = ? WHERE id = ?',
    [
      discountPercent ?? coupon.discount_percent,
      discountCents ?? coupon.discount_cents,
      validFrom !== undefined ? validFrom : coupon.valid_from,
      validUntil !== undefined ? validUntil : coupon.valid_until,
      maxUses !== undefined ? maxUses : coupon.max_uses,
      isActive !== undefined ? isActive : coupon.is_active,
      id,
    ]
  );
  res.json({ success: true, data: { id } });
}));

router.delete('/coupons/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  await dbRun('DELETE FROM coupons WHERE id = ?', [id]);
  res.json({ success: true, data: { id } });
}));

export default router;