import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';
import { deleteFromR2 } from '../../services/r2.js';

const router = Router();

router.get('/stories', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countRow = q
    ? await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM stories s WHERE s.title LIKE ? OR s.content LIKE ?', [`%${q}%`, `%${q}%`])
    : await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM stories s');
  const total = countRow?.total ?? 0;

  const data = q
    ? await dbAll(
        `SELECT s.id, s.title, s.user_id, s.language, s.like_count, s.created_at,
                u.nickname, u.email,
                (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id) as comment_count,
                (SELECT COUNT(*) FROM burned_stories b WHERE b.story_id = s.id) as is_burned
         FROM stories s LEFT JOIN users u ON s.user_id = u.id
         WHERE s.title LIKE ? OR s.content LIKE ?
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
        [`%${q}%`, `%${q}%`, limit, offset]
      )
    : await dbAll(
        `SELECT s.id, s.title, s.user_id, s.language, s.like_count, s.created_at,
                u.nickname, u.email,
                (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id) as comment_count,
                (SELECT COUNT(*) FROM burned_stories b WHERE b.story_id = s.id) as is_burned
         FROM stories s LEFT JOIN users u ON s.user_id = u.id
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );

  res.json({ success: true, data, meta: { total, page, limit } });
});

router.delete('/stories/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const story = await dbGet<{ cover_image: string | null }>('SELECT id, cover_image FROM stories WHERE id = ?', [id]);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }

  // R2 cleanup before DB (need file_path before DELETE music)
  const musicFiles = await dbAll<{ file_path: string }>(
    'SELECT file_path FROM music WHERE story_id = ? AND file_path IS NOT NULL', [id]
  );
  for (const m of musicFiles) {
    deleteFromR2(m.file_path).catch(err => console.error('[Admin Delete] R2 music delete failed:', err));
  }
  if (story.cover_image) {
    deleteFromR2(story.cover_image).catch(err => console.error('[Admin Delete] R2 cover delete failed:', err));
  }

  // Cascade: deepest FK first
  await dbRun('DELETE FROM likes WHERE target_type = ? AND target_id IN (SELECT id FROM comments WHERE story_id = ?)', ['comment', id]);
  await dbRun('DELETE FROM comments WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM likes WHERE target_type = ? AND target_id = ?', ['story', id]);
  await dbRun('DELETE FROM music_usage WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM music WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM burned_stories WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM stories WHERE id = ?', [id]);

  res.json({ success: true, data: { id } });
});

export default router;
