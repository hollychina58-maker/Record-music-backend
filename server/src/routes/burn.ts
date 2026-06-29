import { Router, Response } from 'express';
import { dbGet, dbAll, dbRun, dbBatch } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { deleteFromR2 } from '../services/r2.js';

const router = Router();

const BURNED_CONTENT = '悲伤往事，没入尘烟，万载空悠，徒留悲伤';
const MEMORIAL_COMMENT = '曾经来过的足迹，已入尘烟！';

router.post('/stories/:id/burn', authMiddleware, async (req: AuthRequest, res: Response) => {
  const storyId = parseInt(req.params.id, 10);

  const story = await dbGet<{ id: number; user_id: number | null; cover_image: string | null }>(
    'SELECT id, user_id, cover_image FROM stories WHERE id = ?', [storyId]
  );
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  if (story.user_id !== req.userId) { res.status(403).json({ error: 'You can only burn your own stories' }); return; }

  const existingBurned = await dbGet('SELECT id FROM burned_stories WHERE story_id = ?', [storyId]);
  if (existingBurned) { res.status(400).json({ error: 'Story already burned' }); return; }

  // ── 1. Delete R2 files (fire-and-forget — best effort) ──
  // Music files
  const musicRecords = await dbAll<{ file_path: string }>(
    'SELECT file_path FROM music WHERE story_id = ? AND file_path IS NOT NULL', [storyId]
  );
  for (const m of musicRecords) {
    deleteFromR2(m.file_path).catch(err => console.error('[Burn] R2 music delete failed:', err instanceof Error ? err.message : err));
  }
  if (story.cover_image) {
    deleteFromR2(story.cover_image).catch(err => console.error('[Burn] R2 cover delete failed:', err instanceof Error ? err.message : err));
  }

  // ── 2. Keep one memorial comment, then clean up DB ──
  const firstComment = await dbGet<{ id: number }>(
    'SELECT id FROM comments WHERE story_id = ? ORDER BY created_at ASC LIMIT 1', [storyId]
  );

  // Comment-related likes
  await dbRun(
    'DELETE FROM likes WHERE target_type = ? AND target_id IN (SELECT id FROM comments WHERE story_id = ?)',
    ['comment', storyId]
  );
  // Delete all but first comment
  await dbRun(
    'DELETE FROM comments WHERE story_id = ? AND id IS NOT ?',
    [storyId, firstComment?.id ?? 0]
  );
  // Story likes
  await dbRun("DELETE FROM likes WHERE target_type = 'story' AND target_id = ?", [storyId]);
  // Music usage
  await dbRun('DELETE FROM music_usage WHERE story_id = ?', [storyId]);
  // Music records
  await dbRun('DELETE FROM music WHERE story_id = ?', [storyId]);

  // ── 3. Execute burn atomically as a batch ──
  const stmts: { sql: string; args: unknown[] }[] = [
    { sql: 'UPDATE stories SET content = ?, cover_image = NULL, cover_prompt = NULL WHERE id = ?', args: [BURNED_CONTENT, storyId] },
    { sql: 'INSERT INTO burned_stories (story_id) VALUES (?)', args: [storyId] },
  ];

  if (firstComment) {
    stmts.push({
      sql: 'UPDATE comments SET content = ?, author_name = ?, is_hidden = 0 WHERE id = ?',
      args: [MEMORIAL_COMMENT, '岁月', firstComment.id],
    });
  } else {
    stmts.push({
      sql: "INSERT INTO comments (story_id, author_name, content) VALUES (?, '岁月', ?)",
      args: [storyId, MEMORIAL_COMMENT],
    });
  }

  await dbBatch(stmts);

  res.json({ data: { id: storyId, isBurned: true } });
});

export default router;
