import { useEffect, useState, useCallback } from 'react';
import { apiService } from '../../services/api';
import './AdminTable.css';

interface StoryRow {
  id: number;
  title: string;
  user_id: number;
  nickname: string;
  email: string;
  language: string;
  like_count: number;
  comment_count: number;
  is_burned: number;
  created_at: string;
}

export function AdminStoriesPage() {
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchStories = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (q) params.set('q', q);
      const r = await apiService.clientGet(`/admin/stories?${params}`);
      setStories(r.data);
      setTotal(r.meta.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStories(page, search); }, [page, search, fetchStories]);

  const handleDelete = async (id: number) => {
    if (!window.confirm(`确定删除故事 #${id}？此操作不可撤销。`)) return;
    try {
      await apiService.clientDelete(`/admin/stories/${id}`);
      fetchStories(page, search);
    } catch (err: any) {
      alert(err?.response?.data?.error || '删除失败');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="admin-table-page">
      <h1 className="admin-page-title">故事管理</h1>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          type="text"
          placeholder="搜索故事标题或内容..."
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
                <th>标题</th>
                <th>作者</th>
                <th>语言</th>
                <th>点赞</th>
                <th>评论</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {stories.map((s) => (
                <tr key={s.id} className={s.is_burned ? 'row-burned' : ''}>
                  <td>{s.id}</td>
                  <td className="td-title">
                    <a href={`/story/${s.id}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'underline dotted' }}>
                      {s.title}
                    </a>
                  </td>
                  <td>
                    <div>{s.nickname || '-'}</div>
                    <div style={{ fontSize: '0.72rem', color: '#888' }}>{s.email}</div>
                  </td>
                  <td>{s.language || '-'}</td>
                  <td>{s.like_count}</td>
                  <td>{s.comment_count}</td>
                  <td>
                    {s.is_burned ? (
                      <span className="status-badge status-banned">已焚烧</span>
                    ) : (
                      <span className="status-badge status-active">正常</span>
                    )}
                  </td>
                  <td>{new Date(s.created_at).toLocaleDateString('zh-CN')}</td>
                  <td>
                    <button className="admin-btn admin-btn-danger" onClick={() => handleDelete(s.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {stories.length === 0 && (
                <tr><td colSpan={9} className="td-empty">暂无数据</td></tr>
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
