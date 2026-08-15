import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbAll, dbRun } from '../models/database.js';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Send a message
router.post('/messages', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const fromId = req.userId as number;
  const { toUserId, content } = req.body;
  if (!toUserId || !content?.trim()) { res.status(400).json({ error: 'toUserId and content are required' }); return; }
  if (fromId === toUserId) { res.status(400).json({ error: 'Cannot message yourself' }); return; }
  // 3-6: message length limit
  if (typeof content !== 'string' || content.trim().length > 5000) {
    res.status(400).json({ error: '私信内容不能超过 5000 个字符' }); return;
  }

  // Check if sender is blocked by receiver
  const blocked = await dbGet(
    'SELECT id FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
    [toUserId, fromId]
  );
  if (blocked) {
    res.status(403).json({ error: '对方已将你拉黑，无法发送私信', code: 'blocked' });
    return;
  }

  const toUser = await dbGet('SELECT id FROM users WHERE id = ?', [toUserId]);
  if (!toUser) { res.status(404).json({ error: 'User not found' }); return; }

  const result = await dbRun(
    'INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)',
    [fromId, toUserId, content.trim()]
  );

  // Create notification for receiver
  await dbRun(
    'INSERT INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
    [toUserId, 'new_message', result.lastInsertRowid, fromId]
  );

  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
}));

// Get conversation list (latest message per user, grouped)
router.get('/messages', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const list = await dbAll<any>(
    `SELECT u.id, u.nickname, u.avatar,
            (SELECT content FROM messages WHERE
              (from_user_id = u.id AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = u.id)
              ORDER BY created_at DESC LIMIT 1) as last_content,
            (SELECT created_at FROM messages WHERE
              (from_user_id = u.id AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = u.id)
              ORDER BY created_at DESC LIMIT 1) as last_time,
            (SELECT COUNT(*) FROM messages WHERE from_user_id = u.id AND to_user_id = ? AND is_read = 0) as unread
     FROM (SELECT DISTINCT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END as other_id
           FROM messages WHERE from_user_id = ? OR to_user_id = ?) m
     JOIN users u ON u.id = m.other_id
     ORDER BY last_time DESC`,
    [userId, userId, userId, userId, userId, userId, userId]
  );
  res.json({ data: list });
}));

// Get conversation with a specific user
router.get('/messages/:userId', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const otherId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(otherId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const limit = Math.min(50, Math.max(1, Number.isFinite(parseInt(String(req.query.limit || ''), 10)) ? parseInt(String(req.query.limit), 10) : 30));
  const before = Number.isFinite(parseInt(String(req.query.before || ''), 10)) ? parseInt(String(req.query.before), 10) : 0;

  // Only check if OTHER blocked CURRENT user (prevent sending if you're blocked)
  const blockedByOther = await dbGet(
    'SELECT id FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
    [otherId, userId]
  );
  const isBlocked = !!blockedByOther;

  let query = `SELECT m.*, uf.nickname as from_nickname, ut.nickname as to_nickname
               FROM messages m
               LEFT JOIN users uf ON m.from_user_id = uf.id
               LEFT JOIN users ut ON m.to_user_id = ut.id
               WHERE ((m.from_user_id = ? AND m.to_user_id = ?) OR (m.from_user_id = ? AND m.to_user_id = ?))`;
  const params: (number | string)[] = [userId, otherId, otherId, userId];
  if (before) { query += ' AND m.id < ?'; params.push(before); }
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const messages = await dbAll<any>(query, params);
  res.json({ data: messages.reverse(), isBlocked });
}));

// Mark messages from a specific user as read
router.post('/messages/:userId/read', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const fromId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(fromId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  await dbRun('UPDATE messages SET is_read = 1 WHERE to_user_id = ? AND from_user_id = ? AND is_read = 0', [userId, fromId]);
  res.json({ success: true, ok: true });
}));

export default router;