import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiService, Story } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useAudioManager } from '../stores/audioManager';
import { useLanguage } from '../i18n/LanguageContext';
import { StoryPoster } from '../components/StoryPoster';
import { useGeo } from '../hooks/useGeo';
import './HomePage.css';

function StoryCardSkeleton({ index }: { index: number }) {
  return (
    <div className="story-card story-card--skeleton" style={{ animationDelay: `${0.1 + index * 0.08}s` }}>
      <div className="skeleton-poster" />
      <div className="card-info">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--text" />
        <div className="skeleton-line skeleton-line--text skeleton-line--short" />
        <div className="card-meta">
          <div className="skeleton-line skeleton-line--meta" />
          <div className="skeleton-line skeleton-line--meta" />
        </div>
      </div>
    </div>
  );
}

function MusicBadge({ status, type, isBurned }: { status: string | null; type: string | null; isBurned?: boolean }) {
  const { t } = useLanguage();
  if (!status || status === 'failed' || status === 'expired' || isBurned) return null;
  if (status === 'pending') {
    return <span className="music-badge music-badge--pending">♪ {t('home.music.pending')}</span>;
  }
  if (type === 'song') return <span className="music-badge music-badge--song">♫ {t('home.music.song')}</span>;
  return <span className="music-badge music-badge--music">♪ {t('home.music.music')}</span>;
}

function CardPlayer({ storyId }: { storyId: number }) {
  const { activeMusicId, isPlaying, currentTime, duration, play } = useAudioManager();
  const isThisActive = activeMusicId === storyId;
  const streamUrl = `${import.meta.env.VITE_API_URL || ''}/api/music/${storyId}/stream`;
  const progress = isThisActive && duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="card-player" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
      <button className="card-play-btn" onClick={() => play(storyId, streamUrl)} aria-label={isThisActive && isPlaying ? '暂停' : '播放'}>
        {isThisActive && isPlaying ? '❚❚' : '▶'}
      </button>
      {isThisActive && (
        <div className="card-progress-bar">
          <div className="card-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [activeTab, setActiveTab] = useState<'discover' | 'following'>('discover');
  const [activeTag, setActiveTag] = useState('');
  const [popularTags, setPopularTags] = useState<{ tag: string; count: number }[]>([]);
  const { t } = useLanguage();
  const geo = useGeo();
  const [heroImage, setHeroImage] = useState<string | null>(null);

  useEffect(() => {
    apiService.clientGet('/admin/hero-image').then((d: any) => setHeroImage(d.data?.url || null)).catch(() => {});
    apiService.clientGet('/story/tags').then((d: any) => setPopularTags(d.data || [])).catch(() => {});
  }, []);

  const fetchStories = (mine: boolean, tab?: 'discover' | 'following') => {
    setLoading(true);
    setLoadError(false);
    const opts = mine ? { onlyMine: true } : { countryCode: geo.countryCode, tab: tab || activeTab };
    apiService
      .getStories(opts)
      .then((data) => setStories(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  // Reset filter when user logs out
  useEffect(() => {
    if (!isAuthenticated) setOnlyMine(false);
  }, [isAuthenticated]);

  useEffect(() => {
    // 不等 geo 加载完成，geo 拿到后再重新请求一次即可（带 countryCode 参数）
    if (onlyMine) {
      // "只看我的" 不依赖 geo，直接请求
    } else if (geo.loading) {
      // geo 还在加载中：先用无 countryCode 参数请求一次，拿到内容先展示
      // geo 加载完后 countryCode 变化会再触发一次带参数的请求
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);
    const opts = onlyMine ? { onlyMine: true } : { countryCode: geo.countryCode, tab: activeTab, tag: activeTag || undefined };
    apiService
      .getStories(opts)
      .then((data) => { if (!cancelled) { clearTimeout(safetyTimer); setStories(data); } })
      .catch(() => { if (!cancelled) { clearTimeout(safetyTimer); setLoadError(true); } })
      .finally(() => { if (!cancelled) { clearTimeout(safetyTimer); setLoading(false); } });
    return () => { cancelled = true; clearTimeout(safetyTimer); };
  }, [geo.countryCode, onlyMine, activeTab, activeTag]);

  return (
    <div className="home-page">
      <section className={`hero${heroImage ? ' hero--with-image' : ''}`} style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}>
        <div className="hero-ink-splash" />
        {heroImage && <div className="hero-image-overlay" />}
        <div className="hero-text">
          <h1 className={`hero-heading${heroImage ? ' hero-heading--overlay' : ''}`}>
            <span className="hero-line1">{t('home.hero.line1')}</span>
            <span className="hero-line2">{t('home.hero.line2')}</span>
          </h1>
        </div>
        <div className="hero-aside">
          <span className="hero-seal">墨</span>
        </div>
        {user?.role === 'admin' && (
          <div className="hero-admin">
            {heroImage ? (
              <>
                <button className="filter-btn" onClick={async () => {
                  try { await apiService.clientDelete('/admin/hero-image'); setHeroImage(null); } catch {}
                }}>删除背景</button>
                <button className="filter-btn" onClick={async () => {
                  try { const d: any = await apiService.clientPost('/admin/hero-image/generate'); setHeroImage(d.data?.url || null); } catch {}
                }}>重新生成</button>
              </>
            ) : (
              <button className="filter-btn" onClick={async () => {
                try { const d: any = await apiService.clientPost('/admin/hero-image/generate'); setHeroImage(d.data?.url || null); } catch {}
              }}>生成水墨背景</button>
            )}
          </div>
        )}
      </section>

      <div className="feed-tabs">
        <div className="feed-tabs-bar">
          <button
            className={`feed-tab${activeTab === 'discover' ? ' feed-tab--active' : ''}`}
            onClick={() => { setActiveTab('discover'); setOnlyMine(false); }}
          >
            {t('home.tab.discover')}
          </button>
          <button
            className={`feed-tab${activeTab === 'following' ? ' feed-tab--active' : ''}`}
            onClick={() => {
              if (!isAuthenticated) { navigate('/login'); return; }
              setActiveTab('following'); setOnlyMine(false);
            }}
          >
            {t('home.tab.following')}
          </button>
        </div>
        {isAuthenticated && (
          <button
            className={`filter-btn${onlyMine ? ' filter-btn--active' : ''}`}
            onClick={() => { setOnlyMine(!onlyMine); if (!onlyMine) setActiveTab('discover'); }}
          >
            {onlyMine ? t('home.filter.myStories') : t('home.filter.mine')}
          </button>
        )}
      </div>

      {activeTab === 'discover' && popularTags.length > 0 && (
        <div className="tag-bar">
          <button className={`tag-chip${activeTag === '' ? ' tag-chip--active' : ''}`} onClick={() => setActiveTag('')}>
            {t('home.tag.all')}
          </button>
          {popularTags.map(t => (
            <button key={t.tag} className={`tag-chip${activeTag === t.tag ? ' tag-chip--active' : ''}`} onClick={() => setActiveTag(t.tag)}>
              {t.tag}
            </button>
          ))}
        </div>
      )}

      <main className="feed">
        {loading ? (
          <div className="feed-grid feed-grid--bento">
            {[0, 1, 2].map((i) => (
              <StoryCardSkeleton key={i} index={i} />
            ))}
          </div>
        ) : loadError ? (
          <div className="empty">
            <div className="empty-circle">!</div>
            <p className="empty-title">{t('home.error.loadFailed')}</p>
            <button className="empty-link" onClick={() => fetchStories(onlyMine)}>{t('home.error.retry')}</button>
          </div>
        ) : stories.length === 0 ? (
          <div className="empty">
            <div className="empty-circle">墨</div>
            <p className="empty-title">
              {onlyMine
                ? t('home.empty.myTitle')
                : geo.countryCode
                  ? t('home.empty.countryTitle')
                  : t('home.empty.title')}
            </p>
            <p className="empty-hint">{t('home.empty.hint')}</p>
            <Link to="/create" className="empty-link">{t('home.empty.link')}</Link>
          </div>
        ) : (
          <div className="feed-grid feed-grid--bento">
            {stories.map((story, i) => {
              const cardClass = `story-card${i === 0 ? ' story-card--hero' : ''}`;
              return (
                <Link
                  key={story.id}
                  to={`/story/${story.id}`}
                  className={cardClass}
                  style={{ animationDelay: `${0.1 + i * 0.06}s` }}
                >
                  {story.cover_image ? (
                    <div className="card-cover">
                      <img src={story.cover_image} alt={story.title} loading={i < 3 ? 'eager' : 'lazy'} />
                    </div>
                  ) : (
                    <StoryPoster title={story.title} content={story.content} index={i} />
                  )}
                  <div className="card-info">
                    <div className="card-title-row">
                      <h2 className="card-title">{story.title}</h2>
                      <MusicBadge status={story.music_status ?? null} type={story.music_type ?? null} isBurned={story.isBurned} />
                    </div>
                    {story.author_nickname && (
                      <span className="card-author">— {story.author_nickname}</span>
                    )}
                    {story.tags && story.tags.length > 0 && (
                      <div className="card-tags">
                        {story.tags.slice(0, 3).map(tag => {
                        const displayTag = t('tag.' + tag);
                        return <span key={tag} className="ink-card__tag">{displayTag.startsWith('tag.') ? tag : displayTag}</span>;
                      })}
                      </div>
                    )}
                    <p className="card-excerpt">
                      {story.content.length > 80 ? story.content.slice(0, 80) + '…' : story.content}
                    </p>
                    <div className="card-meta">
                      <time className="card-date">
                        {new Date(story.created_at).toLocaleDateString('zh-CN', {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                      </time>
                      <div className="card-stats">
                        {story.like_count !== undefined && story.like_count > 0 && (
                          <span className="card-likes">{story.like_count} {t('home.card.likes')}</span>
                        )}
                        {story.comment_count !== undefined && story.comment_count > 0 && (
                          <span className="card-comments">{story.comment_count} {t('home.card.comments')}</span>
                        )}
                        <span className="card-read">&rarr; {t('home.card.read')}</span>
                      </div>
                    </div>
                    {story.music_status === 'completed' && (
                      <CardPlayer storyId={story.id} />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <nav className="fab">
        <Link to={user ? '/create' : '/login'} className="fab-btn" aria-label="创建故事">
          <svg viewBox="0 0 24 24" className="fab-icon">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>
      </nav>
    </div>
  );
}
