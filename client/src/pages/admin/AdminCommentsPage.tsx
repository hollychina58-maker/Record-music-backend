import { useEffect, useState, useCallback } from 'react';
import { apiService } from '../../services/api';
import './AdminTable.css';

interface CommentRow {
  id: number;
  content: string;
  author_name: string;
  story_id: number;
  story_title: string;
  like_count: number;
  is_hidden: number;
  created_at: string;
}

export function AdminCommentsPage() {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchComments = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (q) params.set('q', q);
      const r = await apiService.clientGet(`/admin/comments?${params}`);
      setComments(r.data);
      setTotal(r.meta.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchComments(page, search);
  }, [page, search, fetchComments]);

  const handleToggleHide = async (c: CommentRow) => {
    const newHidden = !c.is_hidden;
    try {
      await apiService.clientPut(`/admin/comments/${c.id}/hide`, { isHidden: newHidden });
      setComments((prev) => prev.map((item) =>
        item.id === c.id ? { ...item, is_hidden: newHidden ? 1 : 0 } : item
      ));
    } catch (err: any) {
      alert(err?.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(`确定要删除评论 #${id} 吗？`)) return;
    try {
      await apiService.clientDelete(`/admin/comments/${id}`);
      fetchComments(page, search);
    } catch (err: any) {
      alert(err?.response?.data?.error || '删除失败');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="admin-table-page">
      <h1 className="admin-page-title">评论管理</h1>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          type="text"
          placeholder="搜索评论内容或作者..."
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
                <th>内容</th>
                <th>作者</th>
                <th>所属故事</th>
                <th>点赞</th>
                <th>状态</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {comments.map((c) => (
                <tr key={c.id} style={c.is_hidden ? { opacity: 0.55 } : undefined}>
                  <td>{c.id}</td>
                  <td className="td-content">{c.content}</td>
                  <td>{c.author_name}</td>
                  <td className="td-title">
                    <a href={`/story/${c.story_id}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'underline dotted' }}>
                      {c.story_title}
                    </a>
                  </td>
                  <td>{c.like_count}</td>
                  <td>
                    <span className={`status-badge ${c.is_hidden ? 'status-banned' : 'status-active'}`}>
                      {c.is_hidden ? '已隐藏' : '显示中'}
                    </span>
                  </td>
                  <td>{new Date(c.created_at).toLocaleDateString('zh-CN')}</td>
                  <td className="td-actions">
                    <button
                      className={`admin-btn admin-btn-sm ${c.is_hidden ? '' : 'admin-btn-warn'}`}
                      onClick={() => handleToggleHide(c)}
                    >
                      {c.is_hidden ? '显示' : '隐藏'}
                    </button>
                    <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => handleDelete(c.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {comments.length === 0 && (
                <tr><td colSpan={8} className="td-empty">暂无数据</td></tr>
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
