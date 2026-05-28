import { Router, Request, Response } from 'express';
import { getDatabase } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

const BURNED_CONTENT = '悲伤往事，没入尘烟，万载空悠，徒留悲伤';

interface StoryRow {
  id: number;
  user_id: number | null;
  title: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

interface BurnedRow {
  id: number;
  story_id: number;
  burned_at: string;
}

interface CommentRow {
  id: number;
  story_id: number;
  user_id: number | null;
  content: string;
  created_at: string;
}

router.post('/stories/:id/burn', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();

  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined;
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }

  if (story.user_id !== req.userId) {
    res.status(403).json({ error: 'You can only burn your own stories' });
    return;
  }

  const existingBurned = db.prepare(
    'SELECT id FROM burned_stories WHERE story_id = ?'
  ).get(id) as { id: number } | undefined;

  if (existingBurned) {
    res.status(400).json({ error: 'Story already burned' });
    return;
  }

  db.prepare(
    'UPDATE stories SET content = ? WHERE id = ?'
  ).run(BURNED_CONTENT, id);

  db.prepare(
    'INSERT INTO burned_stories (story_id) VALUES (?)'
  ).run(id);

  db.prepare(
    "DELETE FROM comments WHERE story_id = ? AND id NOT IN (SELECT id FROM comments WHERE story_id = ? ORDER BY created_at ASC LIMIT 1)"
  ).run(id, id);

  const remainingComments = db.prepare(
    'SELECT * FROM comments WHERE story_id = ?'
  ).all(id) as CommentRow[];

  if (remainingComments.length > 0) {
    db.prepare(
      'UPDATE comments SET content = ? WHERE id = ?'
    ).run('曾经来过的足迹，已入尘烟！', remainingComments[0].id);
  }

  const burnedStory = db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined;
  const burnedRecord = db.prepare(
    'SELECT * FROM burned_stories WHERE story_id = ?'
  ).get(id) as BurnedRow | undefined;

  res.json({
    data: {
      ...burnedStory,
      isBurned: true,
      burnedAt: burnedRecord?.burned_at,
    },
  });
});

export default router;