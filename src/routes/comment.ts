import { Router, Request, Response } from 'express';
import { getDatabase } from '../models/database.js';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/stories/:storyId/comments', (req: Request, res: Response) => {
  const { storyId } = req.params;
  const db = getDatabase();

  const burned = db.prepare(
    'SELECT id FROM burned_stories WHERE story_id = ?'
  ).get(storyId);

  if (burned) {
    const comments = db.prepare(
      'SELECT * FROM comments WHERE story_id = ? ORDER BY created_at ASC'
    ).all(storyId);

    const processedComments = comments.length > 1
      ? [comments[0]]
      : comments;

    res.json({ data: processedComments });
    return;
  }

  const comments = db.prepare(
    'SELECT * FROM comments WHERE story_id = ? AND is_hidden = 0 ORDER BY created_at DESC'
  ).all(storyId);

  res.json({ data: comments });
});

router.post('/stories/:storyId/comments', optionalAuthMiddleware, (req: AuthRequest, res: Response) => {
  const { storyId } = req.params;
  const { content } = req.body;

  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const db = getDatabase();

  const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(storyId);
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }

  const user = db.prepare('SELECT nickname FROM users WHERE id = ?').get(req.userId as number) as { nickname: string } | undefined;
  const authorName = user?.nickname || '匿名';

  const result = db.prepare(
    'INSERT INTO comments (story_id, author_name, content) VALUES (?, ?, ?)'
  ).run(storyId, authorName, content);

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json({ data: comment });
});

router.delete('/comments/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as { user_id: number | null } | undefined;
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }

  if (comment.user_id === null) {
    res.status(403).json({ error: 'Guest comments cannot be deleted by users' });
    return;
  }

  if (comment.user_id !== req.userId) {
    res.status(403).json({ error: 'You can only delete your own comments' });
    return;
  }

  const result = db.prepare('DELETE FROM comments WHERE id = ?').run(id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }

  res.json({ message: 'Comment deleted successfully' });
});

export default router;