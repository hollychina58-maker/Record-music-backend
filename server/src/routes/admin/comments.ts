import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';

import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// 3-10: escape LIKE wildcards in search params so user input cannot broaden the match set
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => '\\' + m);
}

router.get('/comments', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countRow = q
    ? await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM comments WHERE content LIKE ? OR author_name LIKE ?', [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`])
    : await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM comments');
  const total = countRow?.total ?? 0;

  const data = q
    ? await dbAll(
        `SELECT c.id, c.content, c.author_name, c.is_hidden, c.created_at, c.story_id, c.like_count, s.title as story_title
         FROM comments c JOIN stories s ON c.story_id = s.id
         WHERE c.content LIKE ? OR c.author_name LIKE ?
         ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`, limit, offset]
      )
    : await dbAll(
        `SELECT c.id, c.content, c.author_name, c.is_hidden, c.created_at, c.story_id, c.like_count, s.title as story_title
         FROM comments c JOIN stories s ON c.story_id = s.id
         ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );

  res.json({ success: true, data, meta: { total, page, limit } });
}));

router.put('/comments/:id/hide', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { isHidden } = req.body;

  const comment = await dbGet('SELECT id FROM comments WHERE id = ?', [id]);
  if (!comment) { res.status(404).json({ error: 'Comment not found' }); return; }

  await dbRun('UPDATE comments SET is_hidden = ? WHERE id = ?', [isHidden ? 1 : 0, id]);
  res.json({ success: true, data: { id, isHidden: !!isHidden } });
}));

router.delete('/comments/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const comment = await dbGet('SELECT id FROM comments WHERE id = ?', [id]);
  if (!comment) { res.status(404).json({ error: 'Comment not found' }); return; }

  await dbRun("DELETE FROM likes WHERE target_type = 'comment' AND target_id = ?", [id]);
  await dbRun('DELETE FROM comments WHERE id = ?', [id]);
  res.json({ success: true, data: { id } });
}));

export default router;