import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';

import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.get('/products', authMiddleware, adminMiddleware, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const products = await dbAll('SELECT * FROM products ORDER BY price_cents ASC');
  res.json({ success: true, data: products });
}));

router.post('/products', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, type, priceCents, musicLimit, description } = req.body;
  if (!name || !type || priceCents == null) { res.status(400).json({ error: 'name, type, and priceCents are required' }); return; }
  if (!['per_use', 'monthly', 'yearly'].includes(type)) { res.status(400).json({ error: 'Invalid type' }); return; }

  const result = await dbRun(
    'INSERT INTO products (name, type, price_cents, music_limit, description) VALUES (?, ?, ?, ?, ?)',
    [name, type, priceCents, musicLimit ?? null, description || '']
  );
  res.json({ success: true, data: { id: result.lastInsertRowid } });
}));

router.put('/products/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { name, type, priceCents, musicLimit, description, isActive } = req.body;

  const product = await dbGet<any>('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

  await dbRun(
    `UPDATE products SET name = ?, type = ?, price_cents = ?, music_limit = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      name ?? product.name, type ?? product.type, priceCents ?? product.price_cents,
      musicLimit !== undefined ? musicLimit : product.music_limit,
      description ?? product.description,
      isActive !== undefined ? isActive : product.is_active,
      id,
    ]
  );
  res.json({ success: true, data: { id } });
}));

router.delete('/products/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const subs = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM subscriptions WHERE product_id = ?', [id]);
  if ((subs?.count ?? 0) > 0) { res.status(400).json({ error: 'Cannot delete product with active subscriptions' }); return; }
  await dbRun('DELETE FROM products WHERE id = ?', [id]);
  res.json({ success: true, data: { id } });
}));

export default router;