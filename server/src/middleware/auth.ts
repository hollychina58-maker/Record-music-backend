import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../models/database.js';

export interface AuthRequest extends Request {
  userId?: number;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as { userId: number };
    const db = getDatabase();
    const user = db.prepare('SELECT id, banned_until FROM users WHERE id = ?').get(decoded.userId) as { id: number; banned_until: string | null } | undefined;
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      res.status(403).json({ error: 'Account is banned' });
      return;
    }
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function optionalAuthMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET;

    if (secret) {
      try {
        const decoded = jwt.verify(token, secret) as { userId: number };
        req.userId = decoded.userId;
      } catch {
        // Token invalid, continue as anonymous
      }
    }
  }

  next();
}
