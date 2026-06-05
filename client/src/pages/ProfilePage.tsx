import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { apiService } from '../services/api';
import './ProfilePage.css';

interface Story {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, isAuthenticated, logout, fetchUsage } = useAuthStore();
  const [stories, setStories] = useState<Story[]>([]);
  const [usage, setUsage] = useState<{ freeMusicCount: number; totalUsageCount: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadData();
  }, [isAuthenticated, navigate]);

  const loadData = async () => {
    try {
      const usageData = await fetchUsage();
      setUsage(usageData);
      const userStories = await apiService.getMyStories();
      setStories(userStories.slice(0, 5));
    } catch (error) {
      console.error('Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (!user) {
    return null;
  }

  return (
    <div className="profile-page">
      <div className="ink-wash-bg">
        <div className="ink-blob blob-1"></div>
        <div className="ink-blob blob-2"></div>
        <div className="ink-blob blob-3"></div>
      </div>

      <header className="profile-header">
        <h1 className="profile-title">{t('profile.title')}</h1>
        <button className="logout-btn" onClick={handleLogout}>{t('nav.logout')}</button>
      </header>

      <main className="profile-content">
        <section className="user-info-section">
          <div className="user-avatar">
            {user.nickname?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="user-details">
            <h2 className="user-nickname">{user.nickname || t('profile.anonymous')}</h2>
            <p className="user-email">{user.email}</p>
          </div>
        </section>

        <section className="usage-section">
          <h3 className="section-title">{t('profile.musicQuota')}</h3>
          <div className="usage-card">
            <div className="usage-count">
              <span className="count-number">{user.freeMusicCount}</span>
              <span className="count-label">{t('profile.remaining')}</span>
            </div>
            {user.freeMusicCount === 0 && (
              <Link to="/payment" className="buy-btn">{t('profile.buyPlan')}</Link>
            )}
          </div>
          {usage && (
            <p className="usage-hint">{t('profile.usageHistory', { count: usage.totalUsageCount })}</p>
          )}
        </section>

        <section className="stories-section">
          <h3 className="section-title">{t('profile.stories')}</h3>
          {loading ? (
            <p className="loading-text">{t('common.loading')}</p>
          ) : stories.length === 0 ? (
            <div className="empty-stories">
              <svg className="empty-ink-illustration" viewBox="0 0 120 120" width="120" height="120">
                <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(15,15,15,0.06)" strokeWidth="1" />
                <circle cx="60" cy="60" r="34" fill="none" stroke="rgba(15,15,15,0.04)" strokeWidth="0.5" strokeDasharray="4 6" />
                <path d="M52 72 Q60 52 70 68 Q76 58 68 50" fill="none" stroke="rgba(15,15,15,0.10)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M46 64 Q54 48 62 62" fill="none" stroke="rgba(15,15,15,0.12)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="8 2" />
                <circle cx="68" cy="46" r="2" fill="rgba(15,15,15,0.15)" />
              </svg>
              <p className="empty-stories-text">{t('profile.noStories')}</p>
              <Link to="/create" className="create-link">{t('profile.createFirst')}</Link>
            </div>
          ) : (
            <ul className="stories-list">
              {stories.map((story) => (
                <li key={story.id} className="story-item">
                  <Link to={`/story/${story.id}`} className="story-link">
                    <span className="story-title">{story.title}</span>
                    <span className="story-date">
                      {new Date(story.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="quick-actions">
          <Link to="/payment" className="action-btn">{t('profile.buyMore')}</Link>
          <Link to="/" className="action-btn secondary">{t('profile.backHome')}</Link>
        </section>
      </main>
    </div>
  );
}
