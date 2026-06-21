import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiService, Story } from '../services/api';
import { useAuthStore } from '../stores/authStore';
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

function MusicBadge({ status, type }: { status: string | null; type: string | null }) {
  const { t } = useLanguage();
  if (!status || status === 'failed') return null;
  if (status === 'pending') {
    return <span className="music-badge music-badge--pending">♪ {t('home.music.pending')}</span>;
  }
  if (type === 'song') return <span className="music-badge music-badge--song">♫ {t('home.music.song')}</span>;
  return <span className="music-badge music-badge--music">♪ {t('home.music.music')}</span>;
}

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const { t } = useLanguage();
  const geo = useGeo();

  const fetchStories = (mine: boolean) => {
    setLoading(true);
    setLoadError(false);
    const opts = mine ? { onlyMine: true } : { countryCode: geo.countryCode };
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
    if (geo.loading && !onlyMine) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    // Safety timeout: force loading off after 8s to prevent blank-page lock
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);
    const opts = onlyMine ? { onlyMine: true } : { countryCode: geo.countryCode };
    apiService
      .getStories(opts)
      .then((data) => { if (!cancelled) { clearTimeout(safetyTimer); setStories(data); } })
      .catch(() => { if (!cancelled) { clearTimeout(safetyTimer); setLoadError(true); } })
      .finally(() => { if (!cancelled) { clearTimeout(safetyTimer); setLoading(false); } });
    return () => { cancelled = true; clearTimeout(safetyTimer); };
  }, [geo.loading, geo.countryCode, onlyMine]);

  const handleOnlyMineToggle = () => {
    if (!isAuthenticated) return;
    setOnlyMine((v) => !v);
  };

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-ink-splash" />
        <div className="hero-text">
          <h1 className="hero-heading">
            <span className="hero-line1">{t('home.hero.line1')}</span>
            <span className="hero-line2">{t('home.hero.line2')}</span>
          </h1>
        </div>
        <div className="hero-aside">
          <span className="hero-seal">墨</span>
        </div>
      </section>

      {isAuthenticated && (
        <div className="feed-filter">
          <button
            type="button"
            className={`filter-btn${onlyMine ? ' filter-btn--active' : ''}`}
            onClick={handleOnlyMineToggle}
          >
            {onlyMine ? t('home.filter.myStories') : t('home.filter.mine')}
          </button>
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
                      <MusicBadge status={story.music_status ?? null} type={story.music_type ?? null} />
                    </div>
                    {story.author_nickname && (
                      <span className="card-author">— {story.author_nickname}</span>
                    )}
                    {story.tags && story.tags.length > 0 && (
                      <div className="card-tags">
                        {story.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="ink-card__tag">{tag}</span>
                        ))}
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
