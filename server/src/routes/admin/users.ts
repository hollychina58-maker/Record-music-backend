import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';

const router = Router();

router.get('/users', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countRow = q
    ? await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM users WHERE email LIKE ? OR nickname LIKE ?', [`%${q}%`, `%${q}%`])
    : await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM users');
  const total = countRow?.total ?? 0;

  const rows = q
    ? await dbAll<any>(
        `SELECT u.id, u.email, u.nickname, u.role, u.banned_until, u.free_music_count, u.created_at,
                (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count,
                (SELECT s.expires_at || '|' || p.name || '|' || COALESCE(CAST(s.music_remaining AS TEXT), 'null')
                 FROM subscriptions s JOIN products p ON s.product_id = p.id
                 WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > datetime('now')
                 ORDER BY s.expires_at DESC LIMIT 1) as sub_info
         FROM users u WHERE u.email LIKE ? OR u.nickname LIKE ?
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        [`%${q}%`, `%${q}%`, limit, offset]
      )
    : await dbAll<any>(
        `SELECT u.id, u.email, u.nickname, u.role, u.banned_until, u.free_music_count, u.created_at,
                (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count,
                (SELECT s.expires_at || '|' || p.name || '|' || COALESCE(CAST(s.music_remaining AS TEXT), 'null')
                 FROM subscriptions s JOIN products p ON s.product_id = p.id
                 WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > datetime('now')
                 ORDER BY s.expires_at DESC LIMIT 1) as sub_info
         FROM users u ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );

  const users = rows.map((u: any) => {
    let subscription = null;
    if (u.sub_info) {
      const [expiresAt, planName, musicRemaining] = u.sub_info.split('|');
      subscription = { expiresAt, planName, musicRemaining: musicRemaining === 'null' ? null : parseInt(musicRemaining) };
    }
    return { ...u, sub_info: undefined, subscription };
  });

  res.json({ success: true, data: users, meta: { total, page, limit } });
});

router.put('/users/:id/ban', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { bannedUntil } = req.body;
  const user = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  await dbRun('UPDATE users SET banned_until = ? WHERE id = ?', [bannedUntil || null, id]);
  res.json({ success: true, data: { id, bannedUntil: bannedUntil || null } });
});

router.post('/users/:id/credits', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const delta = parseInt(String(req.body.amount), 10);
  if (!delta || isNaN(delta)) { res.status(400).json({ error: 'amount must be a non-zero integer' }); return; }

  const user = await dbGet<{ free_music_count: number }>('SELECT id, free_music_count FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const newCount = Math.max(0, (user.free_music_count || 0) + delta);
  await dbRun('UPDATE users SET free_music_count = ? WHERE id = ?', [newCount, id]);
  res.json({ success: true, data: { id, freeMusicCount: newCount } });
});

router.put('/users/:id/role', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) { res.status(400).json({ error: 'role must be admin or user' }); return; }
  if (req.userId === id) { res.status(400).json({ error: 'Cannot change your own role' }); return; }

  const user = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  await dbRun('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  res.json({ success: true, data: { id, role } });
});

router.delete('/users/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const user = await dbGet<any>('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.role === 'admin') { res.status(400).json({ error: 'Cannot delete admin users' }); return; }

  await dbRun(
    "DELETE FROM likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?))",
    [id]
  );
  await dbRun('DELETE FROM comments WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
  await dbRun('DELETE FROM music_usage WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
  await dbRun('DELETE FROM music WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
  await dbRun("DELETE FROM likes WHERE target_type = 'story' AND target_id IN (SELECT id FROM stories WHERE user_id = ?)", [id]);
  await dbRun('DELETE FROM stories WHERE user_id = ?', [id]);
  await dbRun('DELETE FROM comments WHERE user_id = ?', [id]);
  await dbRun('DELETE FROM subscriptions WHERE user_id = ?', [id]);
  await dbRun('DELETE FROM orders WHERE user_id = ?', [id]);
  await dbRun('DELETE FROM likes WHERE user_id = ?', [id]);
  await dbRun('DELETE FROM music_usage WHERE user_id = ?', [id]);
  await dbRun('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [id, id]);
  await dbRun('DELETE FROM messages WHERE from_user_id = ? OR to_user_id = ?', [id, id]);
  await dbRun('DELETE FROM follows WHERE follower_id = ? OR followed_id = ?', [id, id]);
  await dbRun('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?', [id, id]);
  await dbRun('DELETE FROM users WHERE id = ?', [id]);

  res.json({ success: true, data: { id } });
});

export default router;
