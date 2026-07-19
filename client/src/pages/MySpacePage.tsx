import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiService, Story } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { StoryPoster } from '../components/StoryPoster';
import './MySpacePage.css';
import '../components/Skeleton.css';

interface Profile {
  id: number;
  email: string;
  nickname: string;
  avatar: string | null;
  bio: string | null;
  role: string;
  freeMusicCount: number;
  createdAt: string;
  subscription: {
    planName: string;
    planType: string;
    expiresAt: string;
    musicRemaining: number | null;
  } | null;
  stats: {
    storyCount: number;
    totalLikes: number;
    musicCount: number;
  };
}

interface Stats {
  storyCount: number;
  totalLikes: number;
  musicCount: number;
  commentCount: number;
  recentMusicCount: number;
}

type Tab = 'stories' | 'liked' | 'stats';

function StoryCardSkeleton({ index }: { index: number }) {
  return (
    <div className="story-card story-card--skeleton" style={{ animationDelay: `${0.1 + index * 0.08}s` }}>
      <div className="skeleton-poster" />
      <div className="card-info">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--excerpt" />
        <div className="skeleton-line skeleton-line--meta" />
      </div>
    </div>
  );
}

function StoryCard({ story, index, t }: { story: Story; index: number; t: (key: string) => string }) {
  const date = new Date(story.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Link
      to={`/story/${story.id}`}
      className="story-card"
      style={{ animationDelay: `${0.1 + index * 0.08}s` }}
    >
      <StoryPoster title={story.title} content={story.content} index={index} />
      <div className="card-info">
        <h2 className="card-title">{story.title}</h2>
        <p className="card-excerpt">
          {story.content.length > 80 ? story.content.slice(0, 80) + '…' : story.content}
        </p>
        <div className="card-meta">
          <time className="card-date">{date}</time>
          <div className="card-stats">
            {story.like_count !== undefined && story.like_count > 0 && (
              <span className="card-likes">{story.like_count} {t('home.card.likes')}</span>
            )}
            {story.comment_count !== undefined && story.comment_count > 0 && (
              <span className="card-comments">{story.comment_count} {t('home.card.comments')}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function MySpacePage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [likedStories, setLikedStories] = useState<Story[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('stories');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editBio, setEditBio] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    loadData();
  }, [isAuthenticated, navigate]);

  const loadData = async () => {
    setLoadError(false);
    try {
      const [profileData, storiesData] = await Promise.all([
        apiService.getMyProfile(),
        apiService.getMyStories(),
      ]);
      setProfile(profileData);
      setStories(storiesData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const loadLikedStories = async () => {
    try {
      const data = await apiService.getLikedStories();
      setLikedStories(data);
    } catch { /* */ }
  };

  const loadStats = async () => {
    try {
      const data = await apiService.getMyStats();
      setStats(data);
    } catch { /* */ }
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'liked' && likedStories.length === 0) loadLikedStories();
    if (tab === 'stats' && !stats) loadStats();
  };

  const handleEdit = () => {
    if (profile) {
      setEditNickname(profile.nickname);
      setEditBio(profile.bio || '');
      setEditing(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiService.updateProfile({ nickname: editNickname, bio: editBio });
      setProfile((prev) => prev ? { ...prev, nickname: editNickname, bio: editBio } : prev);
      setEditing(false);
    } catch { /* */ }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="myspace-page">
        <header className="page-header">
          <button type="button" className="back-btn" onClick={() => navigate('/')} aria-label="返回">
            <svg viewBox="0 0 24 24" className="back-icon">
              <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <h1 className="page-title">{t('nav.mySpace')}</h1>
        </header>
        <section className="profile-card profile-card--skeleton">
          <div className="skeleton-line skeleton-line--name" />
          <div className="skeleton-line skeleton-line--bio" />
          <div className="skeleton-stats-row">
            {[1,2,3,4].map(i => <div key={i} className="skeleton-stat" />)}
          </div>
        </section>
        <div className="feed-grid myspace-grid">
          {[0, 1, 2].map(i => <StoryCardSkeleton key={i} index={i} />)}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="myspace-page">
        <header className="page-header">
          <button type="button" className="back-btn" onClick={() => navigate('/')} aria-label="返回">
            <svg viewBox="0 0 24 24" className="back-icon">
              <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <h1 className="page-title">{t('nav.mySpace')}</h1>
        </header>
        <div className="error-state">
          <p className="error-state-text">{t('home.error.loadFailed')}</p>
          <button type="button" className="error-retry-btn" onClick={() => { setLoading(true); loadData(); }}>
            {t('home.error.retry')}
          </button>
        </div>
      </div>
    );
  }

  const subLabel = profile?.subscription
    ? profile.subscription.planType === 'yearly'
      ? t('profile.yearly')
      : t('profile.monthly')
    : null;

  // Show subscription-based remaining when user has active sub, otherwise freeMusicCount
  const remainingDisplay = profile?.subscription
    ? (profile.subscription.musicRemaining !== null ? String(profile.subscription.musicRemaining) : '∞')
    : String(profile?.freeMusicCount ?? 0);
  const remainingLabel = profile?.subscription && profile.subscription.musicRemaining === null
    ? t('payment.unlimited')
    : t('profile.remaining');

  return (
    <div className="myspace-page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => navigate('/')} aria-label="返回">
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{t('nav.mySpace')}</h1>
      </header>

      <section className="profile-card">
        <div className="profile-main">
          <div className="profile-info">
            <h2 className="profile-name">
              {profile?.nickname}
              {subLabel && <span className={`profile-badge badge--${profile!.subscription!.planType}`}>{subLabel}</span>}
            </h2>
            {profile?.bio && !editing && <p className="profile-bio">{profile.bio}</p>}
            {editing && (
              <div className="profile-edit-form">
                <input
                  className="profile-edit-input"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  placeholder={t('auth.nickname')}
                  maxLength={30}
                />
                <textarea
                  className="profile-edit-textarea"
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                />
                <div className="profile-edit-actions">
                  <button type="button" className="profile-save-btn" onClick={handleSave} disabled={saving}>
                    {saving ? t('profile.saving') : t('profile.save')}
                  </button>
                  <button type="button" className="profile-cancel-btn" onClick={() => setEditing(false)}>
                    {t('profile.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button type="button" className="profile-edit-btn" onClick={handleEdit} aria-label={t('profile.edit')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
        <div className="profile-stats-row">
          <div className="profile-stat">
            <span className="profile-stat-num">{profile?.stats.storyCount || 0}</span>
            <span className="profile-stat-label">{t('profile.statStories')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{profile?.stats.totalLikes || 0}</span>
            <span className="profile-stat-label">{t('profile.statLikes')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{profile?.stats.musicCount || 0}</span>
            <span className="profile-stat-label">{t('profile.statMusic')}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">{remainingDisplay}</span>
            <span className="profile-stat-label">{remainingLabel}</span>
          </div>
        </div>
        {profile?.subscription && (
          <div className="profile-subscription">
            <span className="sub-badge">{profile.subscription.planName}</span>
            <span className="sub-expiry">
              {profile.subscription.musicRemaining !== null
                ? t('payment.remaining', { count: profile.subscription.musicRemaining })
                : t('payment.unlimited')}
              &nbsp;&middot;&nbsp;
              {t('profile.validUntil')} {new Date(profile.subscription.expiresAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        )}
      </section>

      <nav className="myspace-tabs">
        {(['stories', 'liked', 'stats'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`myspace-tab ${activeTab === tab ? 'myspace-tab--active' : ''}`}
            onClick={() => handleTabChange(tab)}
          >
            {tab === 'stories' ? t('profile.stories') : tab === 'liked' ? t('profile.likedStoriesShort') : t('profile.stats')}
          </button>
        ))}
      </nav>

      <main className="myspace-content">
        <div className="tab-content-enter" key={activeTab}>
        {activeTab === 'stories' && (
          stories.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('profile.emptyStories')}</p>
              <Link to="/create" className="empty-link">{t('nav.write')}</Link>
            </div>
          ) : (
            <div className="timeline">
              {stories.map((s, i) => (
                <div key={s.id} className="timeline-item" style={{ animationDelay: `${0.2 + i * 0.1}s` }}>
                  <div className="timeline-dot" />
                  <time className="timeline-date">
                    {new Date(s.created_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
                  </time>
                  <div className="timeline-card">
                    <Link to={`/story/${s.id}`} className="timeline-card-link">
                      <div className="timeline-card-visual">
                        {s.cover_image ? (
                          <img src={s.cover_image} alt="" className="timeline-card-cover" />
                        ) : (
                          <StoryPoster title={s.title} content={s.content} index={i} />
                        )}
                      </div>
                      <div className="timeline-card-body">
                        <h3 className="timeline-card-title">{s.title}</h3>
                        <p className="timeline-card-excerpt">
                          {s.content.length > 60 ? s.content.slice(0, 60) + '…' : s.content}
                        </p>
                        <div className="timeline-card-meta">
                          {s.like_count !== undefined && s.like_count > 0 && <span>♥ {s.like_count}</span>}
                          {s.music_status === 'completed' && <span>♪</span>}
                        </div>
                      </div>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'liked' && (
          likedStories.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('profile.emptyLiked')}</p>
              <Link to="/" className="empty-link">{t('profile.goHome')}</Link>
            </div>
          ) : (
            <div className="feed-grid myspace-grid">
              {likedStories.map((s, i) => <StoryCard key={s.id} story={s} index={i} t={t} />)}
            </div>
          )
        )}

        {activeTab === 'stats' && stats && (
          <div className="stats-panel">
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-card-num">{stats.storyCount}</span>
                <span className="stat-card-label">{t('profile.statTotalStories')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-num">{stats.totalLikes}</span>
                <span className="stat-card-label">{t('profile.statTotalLikes')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-num">{stats.musicCount}</span>
                <span className="stat-card-label">{t('profile.statTotalMusic')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-num">{stats.commentCount}</span>
                <span className="stat-card-label">{t('profile.statTotalComments')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-num">{stats.recentMusicCount}</span>
                <span className="stat-card-label">{t('profile.statRecentMusic')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-num">{remainingDisplay}</span>
                <span className="stat-card-label">{remainingLabel}</span>
              </div>
            </div>
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
