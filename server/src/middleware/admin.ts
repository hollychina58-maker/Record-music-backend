import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { dbGet } from '../models/database.js';

export async function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await dbGet<{ role: string; banned_until: string | null }>(
      'SELECT role, banned_until FROM users WHERE id = ?',
      [req.userId]
    );

    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      res.status(403).json({ error: 'Account is banned' });
      return;
    }

    next();
  } catch (err) {
    console.error('[Admin] Database lookup failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Database error' });
  }
}
