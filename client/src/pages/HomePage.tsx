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

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { t } = useLanguage();
  const geo = useGeo();

  useEffect(() => {
    // Wait until geo is resolved; while loading show skeleton
    if (geo.loading) {
      setLoading(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    apiService
      .getStories({ language: geo.language, countryCode: geo.countryCode })
      .then((data) => { if (!cancelled) setStories(data); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [geo.loading, geo.language, geo.countryCode]);

  const loadStories = () => {
    setLoading(true);
    setLoadError(false);
    apiService
      .getStories({ language: geo.language, countryCode: geo.countryCode })
      .then((data) => setStories(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  return (
    <div className="home-page">
      <div className="bg-ink">
        <div className="bg-line" />
      </div>

      <section className="hero">
        <div className="hero-text">
          <h1 className="hero-heading">
            <span className="hero-line1">{t('home.hero.line1')}</span>
            <span className="hero-line2">{t('home.hero.line2')}</span>
          </h1>
          <div className="hero-rule" />
        </div>
        <div className="hero-aside">
          <span className="hero-seal">墨</span>
        </div>
      </section>

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
            <button className="empty-link" onClick={loadStories}>{t('home.error.retry')}</button>
          </div>
        ) : stories.length === 0 ? (
          <div className="empty">
            <div className="empty-circle">墨</div>
            <p className="empty-title">{t('home.empty.title')}</p>
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
                  <StoryPoster title={story.title} content={story.content} index={i} />
                  <div className="card-info">
                    <h2 className="card-title">{story.title}</h2>
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
