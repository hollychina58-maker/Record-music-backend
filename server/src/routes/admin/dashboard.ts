import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { getDatabase } from '../../models/database.js';

const router = Router();

router.get('/stats', authMiddleware, adminMiddleware, (_req: AuthRequest, res: Response) => {
  const db = getDatabase();

  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  const storyCount = (db.prepare('SELECT COUNT(*) as count FROM stories').get() as any).count;
  const musicCount = (db.prepare("SELECT COUNT(*) as count FROM music WHERE status = 'completed'").get() as any).count;
  const musicFailCount = (db.prepare("SELECT COUNT(*) as count FROM music WHERE status = 'failed'").get() as any).count;
  const commentCount = (db.prepare('SELECT COUNT(*) as count FROM comments').get() as any).count;
  const activeSubCount = (db.prepare(
    "SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active' AND expires_at > datetime('now')"
  ).get() as any).count;
  const pendingOrderCount = (db.prepare(
    "SELECT COUNT(*) as count FROM orders WHERE status = 'pending'"
  ).get() as any).count;

  const todayRevenueCents = (db.prepare(
    "SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed' AND date(created_at) = date('now')"
  ).get() as any).total;
  const monthRevenueCents = (db.prepare(
    "SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed' AND created_at >= datetime('now', 'start of month')"
  ).get() as any).total;
  const totalRevenueCents = (db.prepare(
    "SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed'"
  ).get() as any).total;

  const musicTrend = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM music_usage
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all() as any[];

  const revenueTrend = db.prepare(`
    SELECT date(created_at) as day, COALESCE(SUM(total_cents), 0) as total
    FROM orders
    WHERE status = 'completed' AND created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all() as any[];

  const recentOrders = db.prepare(`
    SELECT o.id, o.plan_type, o.total_cents, o.status, o.created_at,
           u.email, u.nickname
    FROM orders o JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC LIMIT 8
  `).all() as any[];

  res.json({
    success: true,
    data: {
      userCount, storyCount, commentCount, musicCount, musicFailCount,
      activeSubCount, pendingOrderCount,
      todayRevenueCents, monthRevenueCents, totalRevenueCents,
      musicTrend: musicTrend.map((r: any) => ({ day: r.day, count: r.count })),
      revenueTrend: revenueTrend.map((r: any) => ({ day: r.day, totalCents: r.total })),
      recentOrders: recentOrders.map((o: any) => ({
        id: o.id, planType: o.plan_type, totalCents: o.total_cents,
        status: o.status, createdAt: o.created_at,
        userEmail: o.email, userNickname: o.nickname,
      })),
    },
  });
});

export default router;
