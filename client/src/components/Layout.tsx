import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NotificationBell } from './NotificationBell';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { t } = useLanguage();
  const isAdmin = user?.role === 'admin';
  const hideNav = location.pathname.startsWith('/admin');
  const isActive = (path: string) => location.pathname === path ? ' nav-link--active' : '';
  const [showWriteMenu, setShowWriteMenu] = useState(false);
  const writeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (writeMenuRef.current && !writeMenuRef.current.contains(e.target as Node)) {
        setShowWriteMenu(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="app-layout">
      {/* Ambient ink-wash atmosphere — slow drifting blobs */}
      {!hideNav && (
        <div className="ink-ambient" aria-hidden="true">
          <div className="ink-ambient-blob ink-ambient-blob-1" />
          <div className="ink-ambient-blob ink-ambient-blob-2" />
          <div className="ink-ambient-blob ink-ambient-blob-3" />
        </div>
      )}
      {!hideNav && (
        <nav className="global-nav">
          <div className="global-nav-inner">
            <Link to="/" className="nav-brand">
              {t('nav.brand')}
            </Link>

            <div className="nav-links">
              <LanguageSwitcher />
              {isAuthenticated && <NotificationBell />}
              <div className="nav-dropdown" ref={writeMenuRef}>
                <button
                  className={`nav-link nav-dropdown-toggle${location.pathname.startsWith('/create') || location.pathname === '/inspiration' ? ' nav-link--active' : ''}`}
                  onClick={() => setShowWriteMenu(!showWriteMenu)}
                  aria-expanded={showWriteMenu}
                >
                  {t('nav.write')} <span className="nav-dropdown-arrow">▼</span>
                </button>
                {showWriteMenu && (
                  <div className="nav-dropdown-menu">
                    <Link to="/create" className="nav-dropdown-item" onClick={() => setShowWriteMenu(false)}>
                      {t('nav.writeDirect')}
                    </Link>
                    <Link to="/inspiration" className="nav-dropdown-item" onClick={() => setShowWriteMenu(false)}>
                      {t('nav.writeInspiration')}
                    </Link>
                  </div>
                )}
              </div>
              {isAuthenticated ? (
                <>
                  <Link to="/my-space" className={`nav-link${isActive('/my-space')}`}>{t('nav.mySpace')}</Link>
                  <Link to="/payment" className={`nav-link${isActive('/payment')}`}>{t('nav.recharge')}</Link>
                  {isAdmin && (
                    <Link to="/admin" className="nav-link nav-link-admin">{t('nav.admin')}</Link>
                  )}
                  <span className="nav-user">{user?.nickname || user?.email}</span>
                  <button className="nav-logout-btn" onClick={handleLogout}>
                    {t('nav.logout')}
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="nav-link">{t('nav.login')}</Link>
                  <Link to="/register" className="nav-link">{t('nav.register')}</Link>
                </>
              )}
            </div>
          </div>
        </nav>
      )}
      <div className="app-content" key={location.pathname}>
        <div className="page-transition-enter">
          {children}
        </div>
      </div>
    </div>
  );
}
