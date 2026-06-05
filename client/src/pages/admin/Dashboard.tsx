import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiService } from '../../services/api';
import './Dashboard.css';

interface Stats {
  userCount: number;
  storyCount: number;
  commentCount: number;
  musicCount: number;
  musicFailCount: number;
  activeSubCount: number;
  pendingOrderCount: number;
  todayRevenueCents: number;
  monthRevenueCents: number;
  totalRevenueCents: number;
  musicTrend: { day: string; count: number }[];
  revenueTrend: { day: string; totalCents: number }[];
  recentOrders: {
    id: number; planType: string; totalCents: number;
    status: string; createdAt: string; userEmail: string; userNickname: string;
  }[];
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成', pending: '待支付', cancelled: '已取消', refunded: '已退款',
};
const PLAN_LABEL: Record<string, string> = {
  per_use: '按次', monthly: '月卡', yearly: '年卡',
  'monthly:upgrade': '月卡升级', 'yearly:upgrade': '年卡升级',
};

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiService.clientGet('/admin/stats')
      .then((r) => setStats(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="admin-loading">加载中...</div>;
  if (!stats) return null;

  const maxMusic = Math.max(1, ...stats.musicTrend.map((d) => d.count));
  const maxRevenue = Math.max(1, ...stats.revenueTrend.map((d) => d.totalCents));

  return (
    <div className="dashboard">
      <h1 className="admin-page-title">仪表盘</h1>

      {/* Primary stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.userCount}</div>
          <div className="stat-label">用户总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.activeSubCount}</div>
          <div className="stat-label">活跃订阅</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.storyCount}</div>
          <div className="stat-label">故事总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.musicCount}</div>
          <div className="stat-label">音乐生成数</div>
        </div>
        <div className="stat-card stat-card--warn">
          <div className="stat-value">{stats.musicFailCount}</div>
          <div className="stat-label">生成失败</div>
        </div>
        <div className="stat-card stat-card--warn">
          <div className="stat-value">{stats.pendingOrderCount}</div>
          <div className="stat-label">待支付订单</div>
        </div>
      </div>

      {/* Revenue */}
      <div className="revenue-row">
        <div className="revenue-card">
          <div className="revenue-label">今日收入</div>
          <div className="revenue-value">¥{(stats.todayRevenueCents / 100).toFixed(2)}</div>
        </div>
        <div className="revenue-card">
          <div className="revenue-label">本月收入</div>
          <div className="revenue-value">¥{(stats.monthRevenueCents / 100).toFixed(2)}</div>
        </div>
        <div className="revenue-card revenue-card--total">
          <div className="revenue-label">累计收入</div>
          <div className="revenue-value">¥{(stats.totalRevenueCents / 100).toFixed(2)}</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="charts-row">
        <div className="trend-section">
          <h2 className="trend-title">近30天音乐生成</h2>
          <div className="trend-chart">
            {stats.musicTrend.map((d) => (
              <div key={d.day} className="trend-bar-wrapper" title={`${d.day}: ${d.count}次`}>
                <div className="trend-bar" style={{ height: `${Math.max(4, (d.count / maxMusic) * 100)}%` }} />
                <div className="trend-bar-label">{d.day.slice(5)}</div>
              </div>
            ))}
            {stats.musicTrend.length === 0 && <p className="trend-empty">暂无数据</p>}
          </div>
        </div>

        <div className="trend-section">
          <h2 className="trend-title">近30天收入（元）</h2>
          <div className="trend-chart">
            {stats.revenueTrend.map((d) => (
              <div key={d.day} className="trend-bar-wrapper" title={`${d.day}: ¥${(d.totalCents / 100).toFixed(2)}`}>
                <div className="trend-bar trend-bar--revenue" style={{ height: `${Math.max(4, (d.totalCents / maxRevenue) * 100)}%` }} />
                <div className="trend-bar-label">{d.day.slice(5)}</div>
              </div>
            ))}
            {stats.revenueTrend.length === 0 && <p className="trend-empty">暂无数据</p>}
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div className="recent-section">
        <div className="recent-header">
          <h2 className="trend-title">最近订单</h2>
          <Link to="/admin/orders" className="admin-btn admin-btn-sm">查看全部</Link>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>订单ID</th>
              <th>用户</th>
              <th>套餐</th>
              <th>金额</th>
              <th>状态</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentOrders.map((o) => (
              <tr key={o.id}>
                <td>#{o.id}</td>
                <td>{o.userNickname || o.userEmail}</td>
                <td>{PLAN_LABEL[o.planType] || o.planType}</td>
                <td>¥{(o.totalCents / 100).toFixed(2)}</td>
                <td>
                  <span className={`status-badge status-${o.status}`}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </td>
                <td>{new Date(o.createdAt).toLocaleDateString('zh-CN')}</td>
              </tr>
            ))}
            {stats.recentOrders.length === 0 && (
              <tr><td colSpan={6} className="td-empty">暂无订单</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
