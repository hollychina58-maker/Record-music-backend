import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbRun } from '../models/database.js';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Block / unblock a user
router.post('/users/:id/block', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const blockerId = req.userId as number;
  const blockedId = parseInt(req.params.id, 10);
  if (!Number.isFinite(blockedId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  if (blockerId === blockedId) { res.status(400).json({ error: 'Cannot block yourself' }); return; }

  const user = await dbGet('SELECT id FROM users WHERE id = ?', [blockedId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  // H6: idempotent toggle — no check-then-act race
  const del = await dbRun('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);
  if (del.changes > 0) {
    res.json({ success: true, blocked: false });
    return;
  }
  await dbRun('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)', [blockerId, blockedId]);
  res.json({ success: true, blocked: true });
}));

// Check if blocked
router.get('/users/:id/is-blocked', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId as number;
  const otherId = parseInt(req.params.id, 10);
  if (!Number.isFinite(otherId)) { res.status(400).json({ error: 'Invalid user id' }); return; }
  const row = await dbGet('SELECT id FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', [userId, otherId]);
  res.json({ blocked: !!row });
}));

export default router;