import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbRun, dbAll } from '../models/database.js';

const router = Router();

// Follow / unfollow a user
router.post('/users/:id/follow', authMiddleware, async (req: AuthRequest, res: Response) => {
  const followerId = req.userId as number;
  const followedId = parseInt(req.params.id, 10);
  if (followerId === followedId) { res.status(400).json({ error: 'Cannot follow yourself' }); return; }

  const user = await dbGet('SELECT id FROM users WHERE id = ?', [followedId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const existing = await dbGet('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?', [followerId, followedId]);
  if (existing) {
    await dbRun('DELETE FROM follows WHERE id = ?', [existing.id]);
    res.json({ following: false });
  } else {
    await dbRun('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)', [followerId, followedId]);
    // Notify followed user (async)
    setImmediate(() => {
      dbRun('INSERT INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
        [followedId, 'follow', followerId, followerId])
        .catch(err => console.error('[Follow] Notification insert failed:', err));
    });
    res.json({ following: true });
  }
});

// Check if following
router.get('/users/:id/is-following', authMiddleware, async (req: AuthRequest, res: Response) => {
  const followerId = req.userId as number;
  const followedId = parseInt(req.params.id, 10);
  const row = await dbGet('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?', [followerId, followedId]);
  res.json({ following: !!row });
});

// Get followers count
router.get('/users/:id/followers-count', async (req, res: Response) => {
  const followedId = parseInt(req.params.id, 10);
  const row = await dbGet<{ cnt: number }>('SELECT COUNT(*) as cnt FROM follows WHERE followed_id = ?', [followedId]);
  res.json({ count: row?.cnt ?? 0 });
});

// Get following list
router.get('/users/:id/following', async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  const list = await dbAll(
    'SELECT u.id, u.nickname, u.avatar FROM users u JOIN follows f ON u.id = f.followed_id WHERE f.follower_id = ? ORDER BY f.created_at DESC',
    [userId]
  );
  res.json({ data: list });
});

export default router;
