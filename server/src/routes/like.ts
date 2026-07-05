import { Router, Response } from 'express';
import { dbGet, dbAll, dbRun } from '../models/database.js';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { targetType, targetId } = req.body;
  const userId = req.userId!;

  if (!targetType || !targetId) { res.status(400).json({ error: 'targetType and targetId are required' }); return; }
  if (!['story', 'comment'].includes(targetType)) { res.status(400).json({ error: 'targetType must be story or comment' }); return; }

  // Burned stories cannot be interacted with
  if (targetType === 'story') {
    const burned = await dbGet('SELECT id FROM burned_stories WHERE story_id = ?', [targetId]);
    if (burned) { res.status(403).json({ error: 'This story has been burned' }); return; }
  }

  const table = targetType === 'story' ? 'stories' : 'comments';

  const existing = await dbGet<{ id: number }>(
    'SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?',
    [userId, targetType, targetId]
  );

  if (existing) {
    await dbRun('DELETE FROM likes WHERE id = ?', [existing.id]);
    await dbRun(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`, [targetId]);
    const updated = await dbGet<{ like_count: number }>(`SELECT like_count FROM ${table} WHERE id = ?`, [targetId]);
    res.json({ liked: false, likeCount: updated?.like_count ?? 0 });
  } else {
    await dbRun('INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)', [userId, targetType, targetId]);
    await dbRun(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`, [targetId]);
    const updated = await dbGet<{ like_count: number }>(`SELECT like_count FROM ${table} WHERE id = ?`, [targetId]);
    res.json({ liked: true, likeCount: updated?.like_count ?? 0 });

    // Notify story author (async, fire-and-forget)
    if (targetType === 'story') {
      setImmediate(async () => {
        const storyRow = await dbGet<{ user_id: number; title: string }>('SELECT user_id, title FROM stories WHERE id = ?', [targetId]);
        if (storyRow && storyRow.user_id !== userId) {
          await dbRun('INSERT INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
            [storyRow.user_id, 'like_story', targetId, userId]);
        }
      });
    }
  }
});

router.get('/story/:storyId', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  const { storyId } = req.params;
  const userId = req.userId;

  const story = await dbGet<{ like_count: number }>('SELECT like_count FROM stories WHERE id = ?', [storyId]);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }

  let storyLiked = false;
  const commentLikes: Record<number, boolean> = {};

  if (userId) {
    const storyLike = await dbGet("SELECT id FROM likes WHERE user_id = ? AND target_type = 'story' AND target_id = ?", [userId, storyId]);
    storyLiked = !!storyLike;

    const likedComments = await dbAll<{ target_id: number }>(
      "SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE story_id = ?)",
      [userId, storyId]
    );
    for (const lc of likedComments) commentLikes[lc.target_id] = true;
  }

  res.json({ data: { storyLikes: story.like_count, storyLiked, commentLikes, storyId: Number(storyId) } });
});

export default router;
