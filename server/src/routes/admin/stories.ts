import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/stories', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countSql = q
    ? "SELECT COUNT(*) as total FROM stories WHERE title LIKE ? OR content LIKE ?"
    : 'SELECT COUNT(*) as total FROM stories';
  const countParams = q ? [`%${q}%`, `%${q}%`] : [];
  const { total } = db.prepare(countSql).get(...countParams) as any;

  const dataSql = q
    ? `SELECT s.id, s.title, s.user_id, s.language, s.like_count, s.created_at,
       u.nickname, u.email,
       (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comment_count,
       (SELECT COUNT(*) FROM burned_stories WHERE story_id = s.id) as is_burned
       FROM stories s LEFT JOIN users u ON s.user_id = u.id
       WHERE s.title LIKE ? OR s.content LIKE ?
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    : `SELECT s.id, s.title, s.user_id, s.language, s.like_count, s.created_at,
       u.nickname, u.email,
       (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comment_count,
       (SELECT COUNT(*) FROM burned_stories WHERE story_id = s.id) as is_burned
       FROM stories s LEFT JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
  const dataParams = q ? [`%${q}%`, `%${q}%`, limit, offset] : [limit, offset];
  const stories = db.prepare(dataSql).all(...dataParams);

  res.json({ success: true, data: stories, meta: { total, page, limit } });
});

router.delete('/stories/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);

  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }

  const cascade = db.transaction(() => {
    db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').run('comment', id);
    db.prepare('DELETE FROM comments WHERE story_id = ?').run(id);
    db.prepare('DELETE FROM music WHERE story_id = ?').run(id);
    db.prepare('DELETE FROM music_usage WHERE story_id = ?').run(id);
    db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').run('story', id);
    db.prepare('DELETE FROM stories WHERE id = ?').run(id);
  });
  cascade();

  res.json({ success: true, data: { id } });
});

export default router;
