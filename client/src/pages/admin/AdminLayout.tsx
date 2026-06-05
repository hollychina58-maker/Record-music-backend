import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useEffect } from 'react';
import './AdminLayout.css';

export function AdminLayout() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand" onClick={() => navigate('/')}>
          墨韵 · 管理后台
        </div>
        <nav className="admin-nav">
          <NavLink to="/admin" end className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'}>
            仪表盘
          </NavLink>
          <NavLink to="/admin/stories" className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'}>
            故事管理
          </NavLink>
          <NavLink to="/admin/comments" className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'}>
            评论管理
          </NavLink>
          <NavLink to="/admin/users" className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'}>
            用户管理
          </NavLink>
          <NavLink to="/admin/products" className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'}>
            套餐与优惠
          </NavLink>
          <NavLink to="/admin/orders" className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'}>
            订单管理
          </NavLink>
        </nav>
        <button className="admin-back-btn" onClick={() => navigate('/')}>
          返回前台
        </button>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
