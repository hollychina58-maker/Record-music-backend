import { Router, Response } from 'express';
import { getDatabase } from '../models/database.js';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/likes — toggle like
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const { targetType, targetId } = req.body;
  const userId = req.userId!;

  if (!targetType || !targetId) {
    res.status(400).json({ error: 'targetType and targetId are required' });
    return;
  }

  if (!['story', 'comment'].includes(targetType)) {
    res.status(400).json({ error: 'targetType must be story or comment' });
    return;
  }

  const db = getDatabase();

  const existing = db.prepare(
    'SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?'
  ).get(userId, targetType, targetId) as { id: number } | undefined;

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    const table = targetType === 'story' ? 'stories' : 'comments';
    db.prepare(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`).run(targetId);
    const updated = db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).get(targetId) as { like_count: number };
    res.json({ liked: false, likeCount: updated.like_count });
  } else {
    db.prepare(
      'INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)'
    ).run(userId, targetType, targetId);
    const table = targetType === 'story' ? 'stories' : 'comments';
    db.prepare(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`).run(targetId);
    const updated = db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).get(targetId) as { like_count: number };
    res.json({ liked: true, likeCount: updated.like_count });
  }
});

// GET /api/likes/story/:storyId — get like info for story + comments
router.get('/story/:storyId', optionalAuthMiddleware, (req: AuthRequest, res: Response) => {
  const { storyId } = req.params;
  const userId = req.userId;
  const db = getDatabase();

  const story = db.prepare('SELECT like_count FROM stories WHERE id = ?').get(storyId) as { like_count: number } | undefined;
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }

  let storyLiked = false;
  const commentLikes: Record<number, boolean> = {};

  if (userId) {
    const storyLike = db.prepare(
      "SELECT id FROM likes WHERE user_id = ? AND target_type = 'story' AND target_id = ?"
    ).get(userId, storyId);
    storyLiked = !!storyLike;

    const likedComments = db.prepare(
      "SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE story_id = ?)"
    ).all(userId, storyId) as { target_id: number }[];
    for (const lc of likedComments) {
      commentLikes[lc.target_id] = true;
    }
  }

  res.json({
    data: {
      storyLikes: story.like_count,
      storyLiked,
      commentLikes,
      storyId: Number(storyId),
    },
  });
});

export default router;
