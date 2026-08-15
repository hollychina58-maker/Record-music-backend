import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll, dbRun } from '../../models/database.js';
import { deleteFromR2 } from '../../services/r2.js';

import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// 3-10: escape LIKE wildcards in search params so user input cannot broaden the match set
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => '\\' + m);
}

router.get('/users', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const countRow = q
    ? await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM users WHERE email LIKE ? OR nickname LIKE ?', [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`])
    : await dbGet<{ total: number }>('SELECT COUNT(*) as total FROM users');
  const total = countRow?.total ?? 0;

  const rows = q
    ? await dbAll<any>(
        `SELECT u.id, u.email, u.nickname, u.role, u.banned_until, u.free_music_count, u.created_at,
                (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count,
                (SELECT json_object('expires_at', s.expires_at, 'plan_name', p.name,
                                   'music_remaining', COALESCE(CAST(s.music_remaining AS TEXT), 'null'))
                 FROM subscriptions s JOIN products p ON s.product_id = p.id
                 WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > datetime('now')
                 ORDER BY s.expires_at DESC LIMIT 1) as sub_info
         FROM users u WHERE u.email LIKE ? OR u.nickname LIKE ?
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`, limit, offset]
      )
    : await dbAll<any>(
        `SELECT u.id, u.email, u.nickname, u.role, u.banned_until, u.free_music_count, u.created_at,
                (SELECT COUNT(*) FROM stories WHERE user_id = u.id) as story_count,
                (SELECT json_object('expires_at', s.expires_at, 'plan_name', p.name,
                                   'music_remaining', COALESCE(CAST(s.music_remaining AS TEXT), 'null'))
                 FROM subscriptions s JOIN products p ON s.product_id = p.id
                 WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > datetime('now')
                 ORDER BY s.expires_at DESC LIMIT 1) as sub_info
         FROM users u ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );

  const users = rows.map((u: any) => {
    let subscription = null;
    if (u.sub_info) {
      // 3-18: parse structured JSON (previously fragile '|' concatenation)
      try {
        const info = JSON.parse(u.sub_info);
        subscription = {
          expiresAt: info.expires_at,
          planName: info.plan_name,
          musicRemaining: info.music_remaining === 'null' ? null : parseInt(info.music_remaining),
        };
      } catch { subscription = null; }
    }
    return { ...u, sub_info: undefined, subscription };
  });

  res.json({ success: true, data: users, meta: { total, page, limit } });
}));

router.put('/users/:id/ban', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { bannedUntil } = req.body;
  const user = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  // 3-13: validate ISO datetime in the future (an invalid date silently disables the ban)
  if (bannedUntil) {
    const parsed = new Date(bannedUntil);
    if (isNaN(parsed.getTime())) {
      res.status(400).json({ error: '封禁时间必须是有效日期' }); return;
    }
    if (parsed.getTime() <= Date.now()) {
      res.status(400).json({ error: '封禁时间必须晚于当前时间' }); return;
    }
  }

  await dbRun('UPDATE users SET banned_until = ? WHERE id = ?', [bannedUntil || null, id]);
  res.json({ success: true, data: { id, bannedUntil: bannedUntil || null } });
}));

router.post('/users/:id/credits', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const delta = parseInt(String(req.body.amount), 10);
  if (!delta || isNaN(delta)) { res.status(400).json({ error: 'amount must be a non-zero integer' }); return; }

  const user = await dbGet<{ free_music_count: number }>('SELECT id, free_music_count FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const newCount = Math.max(0, (user.free_music_count || 0) + delta);
  await dbRun('UPDATE users SET free_music_count = ? WHERE id = ?', [newCount, id]);
  res.json({ success: true, data: { id, freeMusicCount: newCount } });
}));

router.put('/users/:id/role', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) { res.status(400).json({ error: 'role must be admin or user' }); return; }
  if (req.userId === id) { res.status(400).json({ error: 'Cannot change your own role' }); return; }

  const user = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  await dbRun('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  res.json({ success: true, data: { id, role } });
}));

router.delete('/users/:id', authMiddleware, adminMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const user = await dbGet<any>('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.role === 'admin') { res.status(400).json({ error: 'Cannot delete admin users' }); return; }

  // S4: delete the user's R2 files (music + cover images) BEFORE removing DB rows
  const r2Files = await dbAll<{ file_path: string | null }>(
    `SELECT m.file_path FROM music m JOIN stories s ON m.story_id = s.id
     WHERE s.user_id = ? AND m.file_path IS NOT NULL`, [id]
  );
  const covers = await dbAll<{ cover_image: string | null }>(
    'SELECT cover_image FROM stories WHERE user_id = ? AND cover_image IS NOT NULL', [id]
  );
  for (const r of [...r2Files, ...covers]) {
    const url = (r as { file_path?: string | null; cover_image?: string | null }).file_path
      ?? (r as { cover_image?: string | null }).cover_image;
    if (url) deleteFromR2(url).catch(err => console.error('[Admin Delete User] R2 delete failed:', err instanceof Error ? err.message : err));
  }

  await dbRun(
    "DELETE FROM likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?))",
    [id]
  );
  await dbRun('DELETE FROM comments WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
  await dbRun('DELETE FROM music_usage WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
  await dbRun('DELETE FROM music WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
  await dbRun("DELETE FROM likes WHERE target_type = 'story' AND target_id IN (SELECT id FROM stories WHERE user_id = ?)", [id]);
  // S4: burned_stories must be removed before stories (FK dependency) — previously omitted,
  // which made DELETE FROM stories fail with a foreign-key violation for users with burned stories.
  await dbRun('DELETE FROM burned_stories WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?)', [id]);
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
}));

export default router;