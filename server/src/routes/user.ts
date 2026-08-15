import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { dbGet, dbAll, dbRun } from '../models/database.js';
import { authMiddleware, authCookieOptions } from '../middleware/auth.js';
import { lookupGeo } from '../services/geoip.js';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/auth/register', asyncHandler(async (req: Request, res: Response) => {
  const { email, password, nickname } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'Email and password are required' }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'Invalid email format' }); return; }
  if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }
  if (nickname !== undefined && nickname !== null && String(nickname).length > 30) {
    res.status(400).json({ error: '昵称不能超过 30 个字符' }); return;
  }

  const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) { res.status(409).json({ error: 'Email already exists' }); return; }

  const passwordHash = await bcrypt.hash(password, 10);

  const ip = (req.ip || '127.0.0.1').replace(/^::ffff:/, '').replace('::1', '127.0.0.1'); // H3: trusted IP
  const geo = lookupGeo(ip);

  // Atomic first-user admin promotion — CASE WHEN inside the INSERT avoids the COUNT+INSERT race condition
  const result = await dbRun(
    `INSERT INTO users (email, password_hash, nickname, free_music_count, role, country_code)
     SELECT ?, ?, ?, 3,
       CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'admin' ELSE 'user' END,
       ?`,
    [email, passwordHash, nickname || email.split('@')[0], geo.countryCode || null]
  );
  const userId = result.lastInsertRowid;

  const insertedUser = await dbGet<{ role: string }>('SELECT role FROM users WHERE id = ?', [userId]);
  const role = insertedUser?.role ?? 'user';

  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).json({ error: 'Server configuration error' }); return; }
  const token = jwt.sign({ userId }, secret, { expiresIn: '7d' as const });
  // 3-4: httpOnly cookie session (JWT stays out of localStorage / JS scope)
  res.cookie('token', token, authCookieOptions());
  res.status(201).json({
    success: true,
    data: { userId, email, nickname: nickname || email.split('@')[0], role, freeMusicCount: 3, token },
  });
}));

router.post('/auth/login', asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'Email and password are required' }); return; }

  const user = await dbGet<any>('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).json({ error: 'Server configuration error' }); return; }
  const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '7d' as const });
  // 3-4: httpOnly cookie session
  res.cookie('token', token, authCookieOptions());

  const sub = await dbGet<{ music_remaining: number | null }>(
    "SELECT music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
    [user.id]
  );

  res.json({
    success: true,
    data: {
      userId: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar,
      role: user.role, freeMusicCount: user.free_music_count,
      hasActiveSubscription: !!sub, subscriptionMusicRemaining: sub?.music_remaining ?? null, token,
    },
  });
}));

// 3-4: clear the httpOnly session cookie on logout
router.post('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});

router.get('/users/me', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const user = await dbGet<any>('SELECT id, email, nickname, avatar, free_music_count, role, created_at FROM users WHERE id = ?', [userId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const sub = await dbGet<{ music_remaining: number | null }>(
    "SELECT music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
    [userId]
  );

  res.json({
    success: true,
    data: {
      id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar,
      role: user.role, freeMusicCount: user.free_music_count, createdAt: user.created_at,
      hasActiveSubscription: !!sub, subscriptionMusicRemaining: sub?.music_remaining ?? null,
    },
  });
}));

router.get('/users/me/usage', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const user = await dbGet<any>('SELECT free_music_count FROM users WHERE id = ?', [userId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const usageHistory = await dbAll<any>(
    `SELECT mu.*, s.title as story_title, m.id as music_id
     FROM music_usage mu JOIN stories s ON mu.story_id = s.id JOIN music m ON mu.music_id = m.id
     WHERE mu.user_id = ? AND mu.used_at >= ? ORDER BY mu.used_at DESC LIMIT 50`,
    [userId, thirtyDaysAgo]
  );
  const totalRow = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM music_usage WHERE user_id = ?', [userId]);

  res.json({
    success: true,
    data: {
      freeMusicCount: user.free_music_count,
      totalUsageCount: totalRow?.count ?? 0,
      usageHistory: usageHistory.map((u: any) => ({
        id: u.id, storyId: u.story_id, storyTitle: u.story_title, musicId: u.music_id, usedAt: u.used_at,
      })),
    },
  });
}));

router.get('/users/me/profile', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const user = await dbGet<any>(
    'SELECT id, email, nickname, avatar, free_music_count, role, bio, created_at FROM users WHERE id = ?', [userId]
  );
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const subscription = await dbGet<any>(`
    SELECT s.*, p.name as plan_name, p.type as plan_type
    FROM subscriptions s JOIN products p ON s.product_id = p.id
    WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
  `, [userId]);

  const storyCountRow = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM stories WHERE user_id = ?', [userId]);
  const totalLikesRow = await dbGet<{ total: number }>('SELECT COALESCE(SUM(like_count), 0) as total FROM stories WHERE user_id = ?', [userId]);
  const musicCountRow = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM music_usage WHERE user_id = ?', [userId]);

  res.json({
    success: true,
    data: {
      id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar,
      bio: user.bio, role: user.role, freeMusicCount: user.free_music_count, createdAt: user.created_at,
      subscription: subscription ? {
        planName: subscription.plan_name, planType: subscription.plan_type,
        expiresAt: subscription.expires_at, musicRemaining: subscription.music_remaining,
      } : null,
      stats: {
        storyCount: storyCountRow?.count ?? 0,
        totalLikes: totalLikesRow?.total ?? 0,
        musicCount: musicCountRow?.count ?? 0,
      },
    },
  });
}));

router.put('/users/me/profile', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { nickname, bio } = req.body;
  const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  // 3-6: length limits
  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.length > 30) {
      res.status(400).json({ error: '昵称不能超过 30 个字符' }); return;
    }
    await dbRun('UPDATE users SET nickname = ? WHERE id = ?', [nickname, userId]);
  }
  if (bio !== undefined) {
    if (typeof bio !== 'string' || bio.length > 500) {
      res.status(400).json({ error: '个人简介不能超过 500 个字符' }); return;
    }
    await dbRun('UPDATE users SET bio = ? WHERE id = ?', [bio, userId]);
  }
  res.json({ success: true, data: { message: 'Profile updated' } });
}));

router.get('/users/me/stories', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const stories = await dbAll(
    `SELECT s.*, COUNT(c.id) as comment_count FROM stories s
     LEFT JOIN comments c ON s.id = c.story_id
     LEFT JOIN burned_stories bs ON s.id = bs.story_id
     WHERE s.user_id = ? AND bs.story_id IS NULL
     GROUP BY s.id ORDER BY s.created_at DESC`,
    [userId]
  );
  res.json({ success: true, data: stories });
}));

router.get('/users/me/liked-stories', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stories = await dbAll(
    `SELECT s.*, COUNT(c.id) as comment_count, l.created_at as liked_at
     FROM likes l JOIN stories s ON l.target_id = s.id
     LEFT JOIN comments c ON s.id = c.story_id
     LEFT JOIN burned_stories bs ON s.id = bs.story_id
     WHERE l.user_id = ? AND l.target_type = 'story' AND l.created_at >= ? AND bs.story_id IS NULL
     GROUP BY s.id ORDER BY l.created_at DESC`,
    [userId, sevenDaysAgo]
  );
  res.json({ success: true, data: stories });
}));

router.get('/users/me/stats', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const [storyCountRow, totalLikesRow, musicCountRow, commentCountRow] = await Promise.all([
    dbGet<{ count: number }>('SELECT COUNT(*) as count FROM stories WHERE user_id = ?', [userId]),
    dbGet<{ total: number }>('SELECT COALESCE(SUM(like_count), 0) as total FROM stories WHERE user_id = ?', [userId]),
    dbGet<{ count: number }>('SELECT COUNT(*) as count FROM music_usage WHERE user_id = ?', [userId]),
    dbGet<{ count: number }>('SELECT COUNT(*) as count FROM comments c JOIN stories s ON c.story_id = s.id WHERE s.user_id = ?', [userId]),
  ]);
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentMusicRow = await dbGet<{ count: number }>(
    'SELECT COUNT(*) as count FROM music_usage WHERE user_id = ? AND used_at >= ?', [userId, last30Days]
  );

  res.json({
    success: true,
    data: {
      storyCount: storyCountRow?.count ?? 0,
      totalLikes: totalLikesRow?.total ?? 0,
      musicCount: musicCountRow?.count ?? 0,
      commentCount: commentCountRow?.count ?? 0,
      recentMusicCount: recentMusicRow?.count ?? 0,
    },
  });
}));

// ── Public: user profile ──
router.get('/users/:id/profile', asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const user = await dbGet<any>(
    `SELECT id, nickname, avatar, bio, created_at,
            (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count
     FROM users u WHERE id = ?`, [userId]
  );
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ data: user });
}));

// ── Public: user's stories ──
router.get('/users/:id/stories', asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const limit = Math.min(20, Math.max(1, Number.isFinite(parseInt(String(req.query.limit || ''), 10)) ? parseInt(String(req.query.limit), 10) : 6));
  const stories = await dbAll<any>(
    `SELECT s.*, u.nickname as author_nickname,
            (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comment_count,
            (SELECT status FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_status
     FROM stories s
     LEFT JOIN users u ON s.user_id = u.id
     LEFT JOIN burned_stories bs ON s.id = bs.story_id
     WHERE s.user_id = ? AND bs.story_id IS NULL
     ORDER BY s.created_at DESC LIMIT ?`,
    [userId, limit]
  );
  res.json({ data: stories.map((s: any) => ({ ...s, tags: tryParseTags(s.tags) })) });
}));

function tryParseTags(raw: string | null): string[] | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return []; }
}

export default router;