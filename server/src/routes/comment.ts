import { Router, Request, Response } from 'express';
import { dbGet, dbAll, dbRun } from '../models/database.js';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/stories/:storyId/comments', async (req: Request, res: Response) => {
  const { storyId } = req.params;

  const burned = await dbGet('SELECT id FROM burned_stories WHERE story_id = ?', [storyId]);
  if (burned) {
    const comments = await dbAll('SELECT * FROM comments WHERE story_id = ? ORDER BY created_at ASC', [storyId]);
    res.json({ data: comments.length > 1 ? [comments[0]] : comments });
    return;
  }

  const comments = await dbAll(
    'SELECT * FROM comments WHERE story_id = ? AND is_hidden = 0 ORDER BY created_at DESC',
    [storyId]
  );
  res.json({ data: comments });
});

const MAX_COMMENT_LENGTH = 2000;

router.post('/stories/:storyId/comments', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  const { storyId } = req.params;
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  if (typeof content !== 'string' || content.length > MAX_COMMENT_LENGTH) {
    res.status(400).json({ error: `评论内容不能超过 ${MAX_COMMENT_LENGTH} 个字符` }); return;
  }

  const story = await dbGet<{ id: number; user_id: number | null }>('SELECT id, user_id FROM stories WHERE id = ?', [storyId]);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }

  const user = req.userId
    ? await dbGet<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', [req.userId])
    : undefined;
  const authorName = user?.nickname || '匿名';

  const result = await dbRun(
    'INSERT INTO comments (story_id, user_id, author_name, content) VALUES (?, ?, ?, ?)',
    [storyId, req.userId ?? null, authorName, content]
  );
  const comment = await dbGet('SELECT * FROM comments WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json({ data: comment });

  // Notify story author (async)
  if (req.userId && story.user_id && story.user_id !== req.userId) {
    setImmediate(async () => {
      await dbRun('INSERT INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
        [story.user_id, 'comment_story', parseInt(storyId, 10), req.userId!]);
    });
  }
});

router.delete('/comments/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const comment = await dbGet<{ user_id: number | null }>('SELECT user_id FROM comments WHERE id = ?', [id]);
  if (!comment) { res.status(404).json({ error: 'Comment not found' }); return; }
  if (comment.user_id === null) { res.status(403).json({ error: 'Guest comments cannot be deleted by users' }); return; }
  if (comment.user_id !== req.userId) { res.status(403).json({ error: 'You can only delete your own comments' }); return; }

  const result = await dbRun('DELETE FROM comments WHERE id = ?', [id]);
  if (result.changes === 0) { res.status(404).json({ error: 'Comment not found' }); return; }
  res.json({ message: 'Comment deleted successfully' });
});

export default router;
