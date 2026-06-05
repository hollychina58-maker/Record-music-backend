import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/comments', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countSql = q
    ? "SELECT COUNT(*) as total FROM comments WHERE content LIKE ? OR author_name LIKE ?"
    : 'SELECT COUNT(*) as total FROM comments';
  const countParams = q ? [`%${q}%`, `%${q}%`] : [];
  const { total } = db.prepare(countSql).get(...countParams) as any;

  const dataSql = q
    ? `SELECT c.id, c.content, c.author_name, c.is_hidden, c.created_at, c.story_id, c.like_count,
       s.title as story_title
       FROM comments c JOIN stories s ON c.story_id = s.id
       WHERE c.content LIKE ? OR c.author_name LIKE ?
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    : `SELECT c.id, c.content, c.author_name, c.is_hidden, c.created_at, c.story_id, c.like_count,
       s.title as story_title
       FROM comments c JOIN stories s ON c.story_id = s.id
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
  const dataParams = q ? [`%${q}%`, `%${q}%`, limit, offset] : [limit, offset];
  const comments = db.prepare(dataSql).all(...dataParams);

  res.json({ success: true, data: comments, meta: { total, page, limit } });
});

router.put('/comments/:id/hide', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);
  const { isHidden } = req.body;

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!comment) { res.status(404).json({ error: 'Comment not found' }); return; }

  db.prepare('UPDATE comments SET is_hidden = ? WHERE id = ?').run(isHidden ? 1 : 0, id);
  res.json({ success: true, data: { id, isHidden: !!isHidden } });
});

router.delete('/comments/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!comment) { res.status(404).json({ error: 'Comment not found' }); return; }

  db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').run('comment', id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);

  res.json({ success: true, data: { id } });
});

export default router;
