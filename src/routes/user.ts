import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../models/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { lookupGeo } from '../services/geoip.js';

const router = Router();

// POST /api/auth/register - Register new user (email + password)
router.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, nickname } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  // Password strength check (minimum 6 characters)
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const db = getDatabase();
  const existingUser = db.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).get(email);

  if (existingUser) {
    res.status(409).json({ error: 'Email already exists' });
    return;
  }

  // First registered user becomes admin
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  const role = userCount === 0 ? 'admin' : 'user';

  const passwordHash = await bcrypt.hash(password, 10);

  const ip = req.headers['x-forwarded-for'] as string || req.ip || '127.0.0.1';
  const clientIp = ip.split(',')[0].trim();
  const geo = lookupGeo(clientIp);

  const result = db.prepare(
    'INSERT INTO users (email, password_hash, nickname, free_music_count, role, country_code) VALUES (?, ?, ?, 3, ?, ?)'
  ).run(email, passwordHash, nickname || email.split('@')[0], role, geo.countryCode || null);

  const token = jwt.sign(
    { userId: Number(result.lastInsertRowid) },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' as const }
  );

  res.status(201).json({
    success: true,
    data: {
      userId: Number(result.lastInsertRowid),
      email,
      nickname: nickname || email.split('@')[0],
      role,
      freeMusicCount: 3,
      token,
    },
  });
});

// POST /api/auth/login - Login with email and password
router.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' as const }
  );

  res.json({
    success: true,
    data: {
      userId: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      freeMusicCount: user.free_music_count,
      token,
    },
  });
});

// GET /api/users/me - Get current user info
router.get('/users/me', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;

  const db = getDatabase();
  const user = db.prepare(
    'SELECT id, email, nickname, avatar, free_music_count, created_at FROM users WHERE id = ?'
  ).get(userId) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      freeMusicCount: user.free_music_count,
      createdAt: user.created_at,
    },
  });
});

// GET /api/users/me/usage - Get usage statistics (free music count)
router.get('/users/me/usage', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;

  const db = getDatabase();

  // Get user free music count
  const user = db.prepare(
    'SELECT free_music_count FROM users WHERE id = ?'
  ).get(userId) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Get usage history (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const usageHistory = db.prepare(`
    SELECT mu.*, s.title as story_title, m.id as music_id
    FROM music_usage mu
    JOIN stories s ON mu.story_id = s.id
    JOIN music m ON mu.music_id = m.id
    WHERE mu.user_id = ? AND mu.used_at >= ?
    ORDER BY mu.used_at DESC
  `).all(userId, thirtyDaysAgo.toISOString()) as any[];

  // Get total usage count
  const totalUsage = db.prepare(
    'SELECT COUNT(*) as count FROM music_usage WHERE user_id = ?'
  ).get(userId) as any;

  res.json({
    success: true,
    data: {
      freeMusicCount: user.free_music_count,
      totalUsageCount: totalUsage.count,
      usageHistory: usageHistory.map(u => ({
        id: u.id,
        storyId: u.story_id,
        storyTitle: u.story_title,
        musicId: u.music_id,
        usedAt: u.used_at,
      })),
    },
  });
});

// GET /api/users/me/profile — Full profile with subscription + stats
router.get('/users/me/profile', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const db = getDatabase();

  const user = db.prepare(
    'SELECT id, email, nickname, avatar, free_music_count, role, bio, created_at FROM users WHERE id = ?'
  ).get(userId) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const subscription = db.prepare(`
    SELECT s.*, p.name as plan_name, p.type as plan_type
    FROM subscriptions s
    JOIN products p ON s.product_id = p.id
    WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
  `).get(userId) as any;

  const storyCount = (db.prepare('SELECT COUNT(*) as count FROM stories WHERE user_id = ?').get(userId) as any).count;
  const totalLikes = (db.prepare('SELECT COALESCE(SUM(like_count), 0) as total FROM stories WHERE user_id = ?').get(userId) as any).total;
  const musicCount = (db.prepare('SELECT COUNT(*) as count FROM music_usage WHERE user_id = ?').get(userId) as any).count;

  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role,
      freeMusicCount: user.free_music_count,
      createdAt: user.created_at,
      subscription: subscription ? {
        planName: subscription.plan_name,
        planType: subscription.plan_type,
        expiresAt: subscription.expires_at,
        musicRemaining: subscription.music_remaining,
      } : null,
      stats: {
        storyCount,
        totalLikes,
        musicCount,
      },
    },
  });
});

// PUT /api/users/me/profile — Edit nickname / bio
router.put('/users/me/profile', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { nickname, bio } = req.body;
  const db = getDatabase();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (nickname !== undefined) {
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, userId);
  }
  if (bio !== undefined) {
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, userId);
  }

  res.json({ success: true, data: { message: 'Profile updated' } });
});

// GET /api/users/me/stories
router.get('/users/me/stories', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const db = getDatabase();

  const stories = db.prepare(`
    SELECT s.*, COUNT(c.id) as comment_count
    FROM stories s
    LEFT JOIN comments c ON s.id = c.story_id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all(userId);

  res.json({ success: true, data: stories });
});

// GET /api/users/me/liked-stories — Stories liked in the last 7 days
router.get('/users/me/liked-stories', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const db = getDatabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const stories = db.prepare(`
    SELECT s.*, COUNT(c.id) as comment_count, l.created_at as liked_at
    FROM likes l
    JOIN stories s ON l.target_id = s.id
    LEFT JOIN comments c ON s.id = c.story_id
    LEFT JOIN burned_stories bs ON s.id = bs.story_id
    WHERE l.user_id = ? AND l.target_type = 'story' AND l.created_at >= ?
      AND bs.story_id IS NULL
    GROUP BY s.id
    ORDER BY l.created_at DESC
  `).all(userId, sevenDaysAgo);

  res.json({ success: true, data: stories });
});

// GET /api/users/me/stats — Detailed statistics
router.get('/users/me/stats', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const db = getDatabase();

  const storyCount = (db.prepare('SELECT COUNT(*) as count FROM stories WHERE user_id = ?').get(userId) as any).count;
  const totalLikes = (db.prepare('SELECT COALESCE(SUM(like_count), 0) as total FROM stories WHERE user_id = ?').get(userId) as any).total;
  const musicCount = (db.prepare('SELECT COUNT(*) as count FROM music_usage WHERE user_id = ?').get(userId) as any).count;
  const commentCount = (db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN stories s ON c.story_id = s.id
    WHERE s.user_id = ?
  `).get(userId) as any).count;

  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentMusic = db.prepare(`
    SELECT COUNT(*) as count FROM music_usage WHERE user_id = ? AND used_at >= ?
  `).get(userId, last30Days) as any;

  res.json({
    success: true,
    data: {
      storyCount,
      totalLikes,
      musicCount,
      commentCount,
      recentMusicCount: recentMusic.count,
    },
  });
});

export default router;