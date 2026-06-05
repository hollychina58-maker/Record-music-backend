import { useEffect, useState, useCallback } from 'react';
import { apiService } from '../../services/api';
import './AdminTable.css';

interface OrderRow {
  id: number;
  planType: string;
  totalCents: number;
  currency: string;
  status: string;
  provider: string | null;
  paymentId: string | null;
  couponCode: string | null;
  createdAt: string;
  updatedAt: string | null;
  userId: number;
  userEmail: string;
  userNickname: string;
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成', pending: '待支付', cancelled: '已取消', refunded: '已退款',
};
const PLAN_LABEL: Record<string, string> = {
  per_use: '按次', monthly: '月卡', yearly: '年卡',
  'monthly:upgrade': '月卡升级', 'yearly:upgrade': '年卡升级',
};

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchOrders = useCallback(async (p: number, q: string, s: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (q) params.set('q', q);
      if (s) params.set('status', s);
      const r = await apiService.clientGet(`/admin/orders?${params}`);
      setOrders(r.data);
      setTotal(r.meta.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders(page, search, statusFilter);
  }, [page, search, statusFilter, fetchOrders]);

  const handleStatusChange = async (id: number, status: string) => {
    if (!window.confirm(`确定将订单 #${id} 状态改为「${STATUS_LABEL[status] || status}」？`)) return;
    try {
      await apiService.clientPut(`/admin/orders/${id}/status`, { status });
      fetchOrders(page, search, statusFilter);
    } catch (err: any) {
      alert(err?.response?.data?.error || '操作失败');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="admin-table-page">
      <h1 className="admin-page-title">订单管理</h1>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          type="text"
          placeholder="搜索邮箱、昵称或支付ID..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="admin-filter"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">全部状态</option>
          <option value="pending">待支付</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
          <option value="refunded">已退款</option>
        </select>
      </div>

      {loading ? <div className="admin-loading">加载中...</div> : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>用户</th>
                <th>套餐</th>
                <th>金额</th>
                <th>支付方式</th>
                <th>优惠码</th>
                <th>状态</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>
                    <div>{o.userNickname || '-'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>{o.userEmail}</div>
                  </td>
                  <td>{PLAN_LABEL[o.planType] || o.planType}</td>
                  <td>¥{(o.totalCents / 100).toFixed(2)}</td>
                  <td>{o.provider || '-'}</td>
                  <td>{o.couponCode || '-'}</td>
                  <td>
                    <span className={`status-badge status-${o.status}`}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="td-actions">
                    {o.status === 'pending' && (
                      <button className="admin-btn admin-btn-sm admin-btn-warn"
                        onClick={() => handleStatusChange(o.id, 'cancelled')}>取消</button>
                    )}
                    {o.status === 'completed' && (
                      <button className="admin-btn admin-btn-sm admin-btn-danger"
                        onClick={() => handleStatusChange(o.id, 'refunded')}>退款</button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={9} className="td-empty">暂无订单</td></tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
              <span className="page-info">{page} / {totalPages}（共 {total} 条）</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
