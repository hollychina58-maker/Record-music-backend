import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { getDatabase } from '../models/database.js';

export function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const db = getDatabase();
  const user = db.prepare('SELECT role, banned_until FROM users WHERE id = ?').get(req.userId) as any;

  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    res.status(403).json({ error: 'Account is banned' });
    return;
  }

  next();
}
