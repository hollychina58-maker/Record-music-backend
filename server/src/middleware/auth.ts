import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { dbGet } from '../models/database.js';

export interface AuthRequest extends Request {
  userId?: number;
}

/** Read a cookie value from the raw Cookie header (no cookie-parser dependency). */
export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Cookie options for the auth token (httpOnly — never readable by JS). */
export function authCookieOptions(): Record<string, unknown> {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 3-16: token only via Authorization header or httpOnly cookie — never accept it
  // from the URL query string (query tokens leak into browser history, Referer and logs).
  // 3-4: httpOnly cookie fallback keeps sessions working after a page refresh
  // without exposing the JWT to JavaScript.
  const secret = process.env.JWT_SECRET;
  const authHeader = req.headers.authorization;
  const rawToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : secret ? getCookie(req, 'token') : null;

  if (!rawToken) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  if (!secret) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  let decoded: { userId: number };
  try {
    decoded = jwt.verify(rawToken, secret, { algorithms: ['HS256'] }) as { userId: number };
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
  const secret = process.env.JWT_SECRET;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (secret ? getCookie(req, 'token') : null);
  if (token && secret) {
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { userId: number };
      req.userId = decoded.userId;
    } catch (err) {
      console.warn('[Auth] Optional auth token invalid:', err instanceof Error ? err.message : err);
      // Invalid token — continue as anonymous
    }
  }
  next();
}