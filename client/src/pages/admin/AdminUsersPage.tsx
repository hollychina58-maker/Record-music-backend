import { useEffect, useState, useCallback } from 'react';
import { apiService } from '../../services/api';
import './AdminTable.css';

interface SubInfo {
  expiresAt: string;
  planName: string;
  musicRemaining: number | null;
}

interface UserRow {
  id: number;
  email: string;
  nickname: string;
  role: string;
  banned_until: string | null;
  free_music_count: number;
  story_count: number;
  created_at: string;
  subscription: SubInfo | null;
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Credits modal
  const [creditUser, setCreditUser] = useState<UserRow | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  // Ban modal
  const [banUser, setBanUser] = useState<UserRow | null>(null);
  const [banDays, setBanDays] = useState('');
  const limit = 20;

  const fetchUsers = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (q) params.set('q', q);
      const r = await apiService.clientGet(`/admin/users?${params}`);
      setUsers(r.data);
      setTotal(r.meta.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(page, search); }, [page, search, fetchUsers]);

  const handleUnban = async (id: number) => {
    await apiService.clientPut(`/admin/users/${id}/ban`, { bannedUntil: null });
    fetchUsers(page, search);
  };

  const handleBan = async () => {
    if (!banUser) return;
    const days = parseInt(banDays);
    if (!days || days <= 0) { alert('请输入有效天数'); return; }
    const until = new Date(Date.now() + days * 86400000).toISOString();
    await apiService.clientPut(`/admin/users/${banUser.id}/ban`, { bannedUntil: until });
    setBanUser(null);
    setBanDays('');
    fetchUsers(page, search);
  };

  const handleAddCredits = async () => {
    if (!creditUser) return;
    const amount = parseInt(creditAmount);
    if (!amount || isNaN(amount)) { alert('请输入有效数量'); return; }
    try {
      await apiService.clientPost(`/admin/users/${creditUser.id}/credits`, { amount });
      setCreditUser(null);
      setCreditAmount('');
      fetchUsers(page, search);
    } catch (err: any) {
      alert(err?.response?.data?.error || '操作失败');
    }
  };

  const handleRoleToggle = async (u: UserRow) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    if (!window.confirm(`确定将 ${u.email} 的角色改为「${newRole === 'admin' ? '管理员' : '普通用户'}」？`)) return;
    try {
      await apiService.clientPut(`/admin/users/${u.id}/role`, { role: newRole });
      fetchUsers(page, search);
    } catch (err: any) {
      alert(err?.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(`确定删除用户 #${id}？此操作不可撤销，将级联删除其所有内容。`)) return;
    try {
      await apiService.clientDelete(`/admin/users/${id}`);
      fetchUsers(page, search);
    } catch (err: any) {
      alert(err?.response?.data?.error || '删除失败');
    }
  };

  const isBanned = (u: UserRow) => u.banned_until && new Date(u.banned_until) > new Date();
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="admin-table-page">
      <h1 className="admin-page-title">用户管理</h1>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          type="text"
          placeholder="搜索邮箱或昵称..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {loading ? <div className="admin-loading">加载中...</div> : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>邮箱 / 昵称</th>
                <th>角色</th>
                <th>故事数</th>
                <th>免费额度</th>
                <th>订阅</th>
                <th>状态</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>
                    <div>{u.nickname || '-'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>{u.email}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${u.role === 'admin' ? 'status-admin' : 'status-active'}`}>
                      {u.role === 'admin' ? '管理员' : '用户'}
                    </span>
                  </td>
                  <td>{u.story_count}</td>
                  <td>{u.free_music_count}</td>
                  <td>
                    {u.subscription ? (
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{u.subscription.planName}</div>
                        <div style={{ fontSize: '0.72rem', color: '#888' }}>
                          到期：{new Date(u.subscription.expiresAt).toLocaleDateString('zh-CN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#888' }}>
                          余量：{u.subscription.musicRemaining === null ? '无限' : u.subscription.musicRemaining}
                        </div>
                      </div>
                    ) : <span style={{ color: '#bbb' }}>无</span>}
                  </td>
                  <td>
                    <span className={`status-badge ${isBanned(u) ? 'status-banned' : 'status-active'}`}>
                      {isBanned(u) ? `封禁至 ${new Date(u.banned_until!).toLocaleDateString('zh-CN')}` : '正常'}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
                  <td className="td-actions">
                    <button className="admin-btn admin-btn-sm" title="调整额度"
                      onClick={() => { setCreditUser(u); setCreditAmount(''); }}>
                      加额度
                    </button>
                    {isBanned(u) ? (
                      <button className="admin-btn admin-btn-sm" onClick={() => handleUnban(u.id)}>解封</button>
                    ) : (
                      <button className="admin-btn admin-btn-sm admin-btn-warn"
                        onClick={() => { setBanUser(u); setBanDays(''); }}>封禁</button>
                    )}
                    {u.role !== 'admin' && (
                      <button className="admin-btn admin-btn-sm admin-btn-warn" onClick={() => handleRoleToggle(u)}>
                        设为管理员
                      </button>
                    )}
                    {u.role === 'admin' && (
                      <button className="admin-btn admin-btn-sm" onClick={() => handleRoleToggle(u)}>
                        降为用户
                      </button>
                    )}
                    {u.role !== 'admin' && (
                      <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => handleDelete(u.id)}>
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={9} className="td-empty">暂无数据</td></tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
              <span className="page-info">{page} / {totalPages}（共 {total} 人）</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
            </div>
          )}
        </>
      )}

      {/* Credits modal */}
      {creditUser && (
        <div className="modal-overlay" onClick={() => setCreditUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>调整免费额度 — {creditUser.nickname || creditUser.email}</h3>
            <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: 12 }}>
              当前额度：{creditUser.free_music_count} 次。正数为增加，负数为扣减。
            </p>
            <label>变化量（次）</label>
            <input
              type="number"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              placeholder="例：5 或 -3"
              autoFocus
            />
            <div className="modal-actions">
              <button className="admin-btn" onClick={handleAddCredits}>确认</button>
              <button className="admin-btn admin-btn-cancel" onClick={() => setCreditUser(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Ban modal */}
      {banUser && (
        <div className="modal-overlay" onClick={() => setBanUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>封禁用户 — {banUser.nickname || banUser.email}</h3>
            <label>封禁天数</label>
            <input
              type="number"
              value={banDays}
              onChange={(e) => setBanDays(e.target.value)}
              placeholder="例：7（永久请输入 36500）"
              min="1"
              autoFocus
            />
            <div className="modal-actions">
              <button className="admin-btn admin-btn-warn" onClick={handleBan}>确认封禁</button>
              <button className="admin-btn admin-btn-cancel" onClick={() => setBanUser(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
