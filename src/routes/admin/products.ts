import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/products', authMiddleware, adminMiddleware, (_req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const products = db.prepare('SELECT * FROM products ORDER BY price_cents ASC').all();
  res.json({ success: true, data: products });
});

router.post('/products', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const { name, type, priceCents, musicLimit, description } = req.body;

  if (!name || !type || priceCents == null) {
    res.status(400).json({ error: 'name, type, and priceCents are required' });
    return;
  }
  if (!['per_use', 'monthly', 'yearly'].includes(type)) {
    res.status(400).json({ error: 'type must be per_use, monthly, or yearly' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO products (name, type, price_cents, music_limit, description) VALUES (?, ?, ?, ?, ?)'
  ).run(name, type, priceCents, musicLimit ?? null, description || '');

  res.json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.put('/products/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);
  const { name, type, priceCents, musicLimit, description, isActive } = req.body;

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

  db.prepare(`
    UPDATE products SET name = ?, type = ?, price_cents = ?, music_limit = ?,
      description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name ?? (product as any).name,
    type ?? (product as any).type,
    priceCents ?? (product as any).price_cents,
    musicLimit !== undefined ? musicLimit : (product as any).music_limit,
    description ?? (product as any).description,
    isActive !== undefined ? isActive : (product as any).is_active,
    id
  );

  res.json({ success: true, data: { id } });
});

router.delete('/products/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);

  const subs = db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE product_id = ?').get(id) as any;
  if (subs.count > 0) {
    res.status(400).json({ error: 'Cannot delete product with active subscriptions' });
    return;
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ success: true, data: { id } });
});

export default router;
