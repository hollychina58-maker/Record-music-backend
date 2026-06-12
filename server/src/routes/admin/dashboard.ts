import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbAll } from '../../models/database.js';

const router = Router();

router.get('/stats', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  const [
    userCountRow, storyCountRow, musicCountRow, musicFailCountRow, commentCountRow,
    activeSubCountRow, pendingOrderCountRow,
    todayRevenueRow, monthRevenueRow, totalRevenueRow,
    musicTrend, revenueTrend, recentOrders,
  ] = await Promise.all([
    dbGet<{ count: number }>('SELECT COUNT(*) as count FROM users'),
    dbGet<{ count: number }>('SELECT COUNT(*) as count FROM stories'),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM music WHERE status = 'completed'"),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM music WHERE status = 'failed'"),
    dbGet<{ count: number }>('SELECT COUNT(*) as count FROM comments'),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active' AND expires_at > datetime('now')"),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'"),
    dbGet<{ total: number }>("SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed' AND date(created_at) = date('now')"),
    dbGet<{ total: number }>("SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed' AND created_at >= datetime('now', 'start of month')"),
    dbGet<{ total: number }>("SELECT COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'completed'"),
    dbAll<any>("SELECT date(used_at) as day, COUNT(*) as count FROM music_usage WHERE used_at >= datetime('now', '-30 days') GROUP BY date(used_at) ORDER BY day ASC"),
    dbAll<any>("SELECT date(created_at) as day, COALESCE(SUM(total_cents), 0) as totalCents FROM orders WHERE status = 'completed' AND created_at >= datetime('now', '-30 days') GROUP BY date(created_at) ORDER BY day ASC"),
    dbAll<any>("SELECT o.id, o.plan_type, o.total_cents, o.status, o.created_at, u.email, u.nickname FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 8"),
  ]);

  res.json({
    success: true,
    data: {
      userCount: userCountRow?.count ?? 0,
      storyCount: storyCountRow?.count ?? 0,
      commentCount: commentCountRow?.count ?? 0,
      musicCount: musicCountRow?.count ?? 0,
      musicFailCount: musicFailCountRow?.count ?? 0,
      activeSubCount: activeSubCountRow?.count ?? 0,
      pendingOrderCount: pendingOrderCountRow?.count ?? 0,
      todayRevenueCents: todayRevenueRow?.total ?? 0,
      monthRevenueCents: monthRevenueRow?.total ?? 0,
      totalRevenueCents: totalRevenueRow?.total ?? 0,
      musicTrend: musicTrend.map((r) => ({ day: r.day, count: r.count })),
      revenueTrend: revenueTrend.map((r) => ({ day: r.day, totalCents: r.totalCents })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id, planType: o.plan_type, totalCents: o.total_cents,
        status: o.status, createdAt: o.created_at,
        userEmail: o.email, userNickname: o.nickname,
      })),
    },
  });
});

export default router;
