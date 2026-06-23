import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiService, Story } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { useToast } from '../components/Toast';
import { useSeo } from '../hooks/useSeo';
import { CommentSection } from '../components/CommentSection';
import { ShareButton } from '../components/ShareButton';
import { BurnConfirmModal } from '../components/BurnConfirmModal';
import { MusicPlayer } from '../components/MusicPlayer';
import { LikeButton } from '../components/LikeButton';
import './StoryDetailPage.css';

interface MusicInfo {
  id: number;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  file_path: string | null;
  style: string | null;
}

export function StoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const { t } = useLanguage();
  const { addToast } = useToast();

  /** Map story tone to a subtle gradient for the page atmosphere */
  const toneGradient = (tone: string | null): string => {
    const map: Record<string, string> = {
      sorrow:    'linear-gradient(180deg, #d5cfc8 0%, #e2ded8 50%, #f5f0e8 100%)',
      joy:       'linear-gradient(180deg, #ead9bc 0%, #ede2cd 50%, #f5f0e8 100%)',
      peace:     'linear-gradient(180deg, #d2e0cc 0%, #e2e8dc 50%, #f5f0e8 100%)',
      nostalgia: 'linear-gradient(180deg, #e8d8c0 0%, #ebe0cc 50%, #f5f0e8 100%)',
      warmth:    'linear-gradient(180deg, #e8d4c0 0%, #eddfcf 50%, #f5f0e8 100%)',
      loneliness:'linear-gradient(180deg, #d4d8e0 0%, #e2e4e8 50%, #f5f0e8 100%)',
      passion:   'linear-gradient(180deg, #e4c8c4 0%, #ead8d4 50%, #f5f0e8 100%)',
      mystery:   'linear-gradient(180deg, #d2d6dc 0%, #e0e2e4 50%, #f5f0e8 100%)',
    };
    return tone && map[tone] ? map[tone] : map.peace;
  };

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [music, setMusic] = useState<MusicInfo | null>(null);
  const [storyLiked, setStoryLiked] = useState(false);
  const [commentLikes, setCommentLikes] = useState<Record<number, boolean>>({});
  const prevAuthRef = useRef(isAuthenticated);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // SEO + JSON-LD structured data
  useSeo(
    story
      ? {
          title: story.title,
          description: story.content.slice(0, 160) + (story.content.length > 160 ? '…' : ''),
          ogTitle: story.title,
          ogDescription: story.content.slice(0, 160),
          ogImage: 'https://ustory-umusic.com/icon-512.png',
          canonical: `https://ustory-umusic.com/story/${story.id}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: story.title,
            author: {
              '@type': 'Person',
              name: story.author_nickname || '匿名作者',
            },
            datePublished: story.created_at,
            description: story.content.slice(0, 160),
            ...(story.tags && story.tags.length > 0
              ? { keywords: story.tags.join(', ') }
              : {}),
            ...(story.music_status === 'completed'
              ? { about: { '@type': 'MusicComposition', name: `${story.title} — 配乐` } }
              : {}),
            publisher: {
              '@type': 'Organization',
              name: '墨韵',
              url: 'https://ustory-umusic.com',
              logo: {
                '@type': 'ImageObject',
                url: 'https://ustory-umusic.com/icon-512.png',
              },
            },
            mainEntityOfPage: {
              '@type': 'WebPage',
              '@id': `https://ustory-umusic.com/story/${story.id}`,
            },
          },
        }
      : {},
  );

  // Header action menu toggle
  const [showActionMenu, setShowActionMenu] = useState(false);

  const removePendingFromStorage = (musicId: number) => {
    try {
      const raw = localStorage.getItem('mo_pending_music');
      if (!raw) return;
      const arr = JSON.parse(raw) as Array<{ musicId: number; storyId: number; createdAt: number }>;
      const filtered = arr.filter((x) => x.musicId !== musicId);
      if (filtered.length === 0) localStorage.removeItem('mo_pending_music');
      else localStorage.setItem('mo_pending_music', JSON.stringify(filtered));
    } catch { /* ignore */ }
  };

  const POLL_TIMEOUT = 300000; // 5 min — Render deploy restarts kill fire-and-forget processMusicAsync
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollUntilReady = (musicId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    removePendingFromStorage(musicId);
    const startTime = Date.now();

    pollRef.current = setInterval(async () => {
      try {
        const result = await apiService.pollMusicStatus(musicId);
        if (result.status === 'completed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
          setMusic({ id: musicId, status: 'completed', file_path: result.filePath, style: null });
          useAuthStore.getState().fetchCurrentUser();
          addToast('success', '🎵 专属配乐已生成，向下滚动即可收听！', { duration: 6000 });
        } else if (result.status === 'failed' || result.status === 'expired') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
          setMusic({ id: musicId, status: 'failed', file_path: null, style: null });
          addToast('error', '配乐生成失败，请重新尝试', { duration: 4000 });
        } else if (Date.now() - startTime > POLL_TIMEOUT) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
          setMusic({ id: musicId, status: 'failed', file_path: null, style: null });
          addToast('error', '配乐生成超时，请重新尝试', { duration: 4000 });
        }
      } catch {
        // Keep polling on network errors, but respect timeout
        if (Date.now() - startTime > POLL_TIMEOUT) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setMusic({ id: musicId, status: 'failed', file_path: null, style: null });
          addToast('error', '配乐生成超时，请重新尝试', { duration: 4000 });
        }
      }
    }, 4000);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (prevAuthRef.current && !isAuthenticated) {
      navigate('/', { replace: true });
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (id) {
      loadStory(parseInt(id, 10));
    }
  }, [id]);

  const loadStory = async (storyId: number) => {
    try {
      const data = await apiService.getStoryById(storyId);
      setStory(data);
      apiService
        .getMusicByStory(storyId)
        .then((tracks) => {
          if (tracks.length > 0) {
            const track = tracks[0] as unknown as MusicInfo;
            if (track.status === 'completed') {
              setMusic(track);
            } else if (track.status === 'pending') {
              // If pending for > 5 min, the async task was lost (e.g. server restart).
              // Treat as failed so user can retry instead of seeing "Composing..." forever.
              const pendingMs = Date.now() - new Date((track as any).created_at).getTime();
              if (pendingMs > POLL_TIMEOUT) {
                setMusic({ ...track, status: 'failed' as const });
              } else {
                setMusic(track);
                pollUntilReady(track.id);
              }
            } else if (track.status === 'expired' || track.status === 'failed') {
              // Show regenerate prompt — don't poll
              setMusic(track);
            }
          }
        })
        .catch(() => {});
      apiService
        .getLikeInfo(storyId)
        .then((info) => {
          setStoryLiked(info.storyLiked);
          setCommentLikes(info.commentLikes);
        })
        .catch(() => {});
    } catch {
      setStory(null);
    } finally {
      setLoading(false);
    }
  };

  const handleBurn = async () => {
    if (!id) return;
    setShowBurnConfirm(false);
    try {
      await apiService.burnStory(parseInt(id, 10));
      navigate('/');
    } catch {
      // Stay on page — burn failed (e.g. not owner, network error)
    }
  };

  if (loading) {
    return (
      <div className="detail-page">
        <div className="loading">{t('detail.loading')}</div>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="detail-page">
        <div className="not-found">{t('detail.notFound')}</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      {/* Page atmosphere: cover image blurred or tone-based gradient */}
      <div
        className="detail-atmosphere"
        style={
          story.cover_image
            ? { backgroundImage: `url(${story.cover_image})` }
            : { background: toneGradient(story.tone) }
        }
      />
      <header className="page-header">
        <button
          type="button"
          className="back-btn"
          onClick={() => navigate('/')}
          aria-label={t('common.back')}
        >
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <div className="header-actions">
          <button
            type="button"
            className="action-toggle"
            onClick={() => setShowActionMenu(!showActionMenu)}
            aria-label="更多操作"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {showActionMenu && (
            <div className="action-menu" onClick={() => setShowActionMenu(false)}>
              <div className="action-menu-inner" onClick={e => e.stopPropagation()}>
                <ShareButton
                  storyId={story.id}
                  storyTitle={story.title}
                  storyTags={story.tags}
                  disabled={story.isBurned}
                />
                {!story.isBurned && !story.cover_image && user?.id === story.user_id && (
                  <button className="action-menu-item" onClick={async () => {
                    setShowActionMenu(false);
                    try {
                      await apiService.generateCover(story.id);
                      addToast('info', '🎨 封面图生成中，请稍后刷新页面查看', { duration: 4000 });
                    } catch { /* ignore */ }
                  }}>
                    🎨 生成封面
                  </button>
                )}
                {!story.isBurned && user?.id === story.user_id && (
                  <button className="action-menu-item action-menu-item--danger" onClick={() => {
                    setShowActionMenu(false);
                    setShowBurnConfirm(true);
                  }}>
                    🔥 {t('burn.confirm')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {story.cover_image ? (
        <div className="cover-hero">
          <img src={story.cover_image} alt="" className="cover-hero-img" aria-hidden="true" />
          <div className="cover-hero-gradient" />
          <div className="cover-hero-content">
            <h1 className="cover-hero-title">{story.title}</h1>
            <time className="cover-hero-date">
              {new Date(story.created_at).toLocaleDateString('zh-CN', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </time>
            {user?.id === story.user_id && (
              <button
                type="button"
                className="cover-hero-delete"
                onClick={async () => {
                  try {
                    await apiService.deleteCover(story.id);
                    setStory({ ...story, cover_image: null, cover_prompt: null });
                  } catch { /* ignore */ }
                }}
                aria-label="删除封面"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="cover-hero-placeholder" />
      )}

      <main className={`story-content${story.cover_image ? ' story-content--has-cover' : ''}`}>
        <div className="reading-progress-line" />

        <div className="ink-decoration">
          <div className="ink-line"></div>
        </div>

        <article>
          {!story.cover_image && (
            <>
              <h1 className="story-title">{story.title}</h1>
              <time className="story-date">
                {new Date(story.created_at).toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
            </>
          )}
          {story.tags && story.tags.length > 0 && (
            <div className="story-tags">
              {story.tags.map(tag => (
                <span key={tag} className="story-tag">{t('tag.' + tag) || tag}</span>
              ))}
            </div>
          )}
          <div className="story-actions-row">
            <LikeButton
              targetType="story"
              targetId={story.id}
              initialLiked={storyLiked}
              initialCount={story.like_count || 0}
            />
          </div>
          <div className="story-body">
            {story.content.split('\n').map((paragraph, idx) => (
              <p key={idx} style={{ '--p-index': idx } as React.CSSProperties}>{paragraph || ' '}</p>
            ))}
          </div>
        </article>
        {music && music.status !== 'pending' && music.status !== 'expired' && (
          <div className="music-section">
            <MusicPlayer
              audioUrl={`${import.meta.env.VITE_API_URL || ''}/api/music/${music.id}/stream`}
              title={t('detail.musicTitle')}
              style={music.style || undefined}
              musicId={music.id}
              canDownload={!!(user && story && user.id === story.user_id)}
            />
          </div>
        )}
        {music && music.status === 'pending' && (
          <div className="music-section" style={{ padding: '12px var(--space-6)', textAlign: 'center' }}>
            <p className="music-empty-hint">{t('create.generating')}</p>
          </div>
        )}
        {music && (music.status === 'expired' || music.status === 'failed') && (
          <div className="music-empty">
            <p className="music-empty-hint">{music.status === 'failed' ? t('detail.failedMusic') : t('detail.expiredMusic')}</p>
            {user && story && user.id === story.user_id && (
              <button
                className="gen-cover-btn"
                style={{ marginTop: 'var(--space-3)', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', border: '1px solid var(--seal-red-light)', borderRadius: '20px', background: 'transparent', color: 'var(--seal-red)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ink)' }}
                onClick={async () => {
                  try {
                    const result = await apiService.generateMusic(story.id, story.content, { musicType: 'instrumental' });
                    addToast('info', '🎵 配乐生成中，请稍后...', { duration: 4000 });
                    setMusic({ id: result.musicId, status: 'pending', file_path: null, style: null });
                    pollUntilReady(result.musicId);
                  } catch (err: any) {
                    const status = err?.response?.status;
                    if (status === 402) {
                      addToast('error', t('detail.noCredits'), { duration: 5000 });
                    } else {
                      addToast('error', t('detail.failedMusic'), { duration: 4000 });
                    }
                  }
                }}
              >
                🎵 {t('detail.regenerateMusic')}
              </button>
            )}
          </div>
        )}
        {!music && !loading && user && user.id === story.user_id && (
          <div className="music-empty">
            <p className="music-empty-hint">{t('detail.noMusic')}</p>
          </div>
        )}

      </main>

      <CommentSection storyId={story.id} isBurned={story.isBurned} commentLikes={commentLikes} />

      {showBurnConfirm && (
        <BurnConfirmModal
          storyTitle={story.title}
          onConfirm={handleBurn}
          onCancel={() => setShowBurnConfirm(false)}
        />
      )}

    </div>
  );
}