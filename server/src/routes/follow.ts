import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbRun, dbAll } from '../models/database.js';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Follow / unfollow a user
router.post('/users/:id/follow', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const followerId = req.userId as number;
  const followedId = parseInt(req.params.id, 10);
  if (!Number.isFinite(followedId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  if (followerId === followedId) { res.status(400).json({ error: 'Cannot follow yourself' }); return; }

  const user = await dbGet('SELECT id FROM users WHERE id = ?', [followedId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  // H6: idempotent toggle — no check-then-act race
  const del = await dbRun('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', [followerId, followedId]);
  if (del.changes > 0) {
    res.json({ success: true, following: false });
    return;
  }
  const ins = await dbRun('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)', [followerId, followedId]);
  // 3-15: notify only on actual new follow
  if (ins.changes > 0) {
    setImmediate(() => {
      dbRun('INSERT OR IGNORE INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
        [followedId, 'follow', followerId, followerId])
        .catch(err => console.error('[Follow] Notification insert failed:', err));
    });
  }
  res.json({ success: true, following: true });
}));

// Check if following
router.get('/users/:id/is-following', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const followerId = req.userId as number;
  const followedId = parseInt(req.params.id, 10);
  if (!Number.isFinite(followedId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const row = await dbGet('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?', [followerId, followedId]);
  res.json({ following: !!row });
}));

// Get followers count
router.get('/users/:id/followers-count', asyncHandler(async (req, res: Response) => {
  const followedId = parseInt(req.params.id, 10);
  if (!Number.isFinite(followedId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const row = await dbGet<{ cnt: number }>('SELECT COUNT(*) as cnt FROM follows WHERE followed_id = ?', [followedId]);
  res.json({ count: row?.cnt ?? 0 });
}));

// Get following list
router.get('/users/:id/following', asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  // 3-8: cap list size
  const limit = Math.min(50, Math.max(1, Number.isFinite(parseInt(String(req.query.limit || ''), 10)) ? parseInt(String(req.query.limit), 10) : 20));
  const list = await dbAll(
    'SELECT u.id, u.nickname, u.avatar FROM users u JOIN follows f ON u.id = f.followed_id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT ?',
    [userId, limit]
  );
  res.json({ success: true, data: list });
}));

export default router;