import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbAll, dbRun } from '../models/database.js';

const router = Router();

// Get unread notification count
router.get('/notifications/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const row = await dbGet<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0', [userId]
  );
  res.json({ count: row?.cnt ?? 0 });
});

// Get notification list
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const limit = Math.min(30, parseInt(String(req.query.limit || '20'), 10));
  const list = await dbAll<any>(
    `SELECT n.id, n.type, n.source_id, n.actor_id, n.is_read, n.created_at,
            u.nickname as actor_nickname
     FROM notifications n
     LEFT JOIN users u ON n.actor_id = u.id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC LIMIT ?`,
    [userId, limit]
  );
  res.json({ data: list });
});

// Mark notification as read
router.post('/notifications/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const id = parseInt(req.params.id, 10);
  await dbRun('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
  res.json({ ok: true });
});

// Mark all notifications as read
router.post('/notifications/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  await dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
  res.json({ ok: true });
});

export default router;
