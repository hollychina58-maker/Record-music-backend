import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/users', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countSql = q
    ? "SELECT COUNT(*) as total FROM users WHERE email LIKE ? OR nickname LIKE ?"
    : 'SELECT COUNT(*) as total FROM users';
  const countParams = q ? [`%${q}%`, `%${q}%`] : [];
  const { total } = db.prepare(countSql).get(...countParams) as any;

  const dataSql = q
    ? `SELECT u.id, u.email, u.nickname, u.role, u.banned_until, u.created_at,
       (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count
       FROM users u
       WHERE u.email LIKE ? OR u.nickname LIKE ?
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
    : `SELECT u.id, u.email, u.nickname, u.role, u.banned_until, u.created_at,
       (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count
       FROM users u
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
  const dataParams = q ? [`%${q}%`, `%${q}%`, limit, offset] : [limit, offset];
  const users = db.prepare(dataSql).all(...dataParams);

  res.json({ success: true, data: users, meta: { total, page, limit } });
});

router.put('/users/:id/ban', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);
  const { bannedUntil } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  db.prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(bannedUntil || null, id);

  res.json({ success: true, data: { id, bannedUntil: bannedUntil || null } });
});

router.delete('/users/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = parseInt(req.params.id, 10);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.role === 'admin') { res.status(400).json({ error: 'Cannot delete admin users' }); return; }

  const cascade = db.transaction(() => {
    const stories = db.prepare('SELECT id FROM stories WHERE user_id = ?').all(id) as any[];
    for (const s of stories) {
      db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').run('comment', s.id);
      db.prepare('DELETE FROM comments WHERE story_id = ?').run(s.id);
      db.prepare('DELETE FROM music WHERE story_id = ?').run(s.id);
      db.prepare('DELETE FROM music_usage WHERE story_id = ?').run(s.id);
      db.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').run('story', s.id);
    }
    db.prepare('DELETE FROM stories WHERE user_id = ?').run(id);
    const comments = db.prepare('SELECT id FROM comments WHERE author_name = (SELECT nickname FROM users WHERE id = ?)').get(id);
    if (comments) {
      db.prepare("DELETE FROM comments WHERE author_name = (SELECT nickname FROM users WHERE id = ?)").run(id);
    }
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM likes WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM music_usage WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  cascade();

  res.json({ success: true, data: { id } });
});

export default router;
