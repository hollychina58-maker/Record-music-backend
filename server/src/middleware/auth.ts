import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { dbGet } from '../models/database.js';

export interface AuthRequest extends Request {
  userId?: number;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!rawToken) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  let decoded: { userId: number };
  try {
    decoded = jwt.verify(rawToken, secret) as { userId: number };
  } catch (err) {
    console.warn('[Auth] JWT verification failed:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  try {
    const user = await dbGet<{ id: number; banned_until: string | null }>(
      'SELECT id, banned_until FROM users WHERE id = ?',
      [decoded.userId]
    );
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
  } catch (err) {
    console.error('[Auth] Database lookup failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Database error' });
  }
}

export async function optionalAuthMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (secret) {
      try {
        const decoded = jwt.verify(token, secret) as { userId: number };
        req.userId = decoded.userId;
      } catch (err) {
        console.warn('[Auth] Optional auth token invalid:', err instanceof Error ? err.message : err);
        // Invalid token — continue as anonymous
      }
    }
  }
  next();
}
