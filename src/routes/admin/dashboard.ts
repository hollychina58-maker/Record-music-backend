import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/stats', authMiddleware, adminMiddleware, (_req: AuthRequest, res: Response) => {
  const db = getDatabase();

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const storyCount = db.prepare('SELECT COUNT(*) as count FROM stories').get() as any;
  const musicCount = db.prepare("SELECT COUNT(*) as count FROM music WHERE status = 'completed'").get() as any;
  const musicFailCount = db.prepare("SELECT COUNT(*) as count FROM music WHERE status = 'failed'").get() as any;
  const todayRevenue = db.prepare(
    "SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed' AND date(created_at) = date('now')"
  ).get() as any;
  const commentCount = db.prepare('SELECT COUNT(*) as count FROM comments').get() as any;

  const musicTrend = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM music_usage
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all() as any[];

  res.json({
    success: true,
    data: {
      userCount: userCount.count,
      storyCount: storyCount.count,
      commentCount: commentCount.count,
      musicCount: musicCount.count,
      musicFailCount: musicFailCount.count,
      todayRevenueCents: todayRevenue.total,
      musicTrend: musicTrend.map((r: any) => ({ day: r.day, count: r.count })),
    },
  });
});

export default router;
