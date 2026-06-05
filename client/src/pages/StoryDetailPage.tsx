import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiService, Story } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { CommentSection } from '../components/CommentSection';
import { ShareButton } from '../components/ShareButton';
import { BurnConfirmModal } from '../components/BurnConfirmModal';
import { MusicPlayer } from '../components/MusicPlayer';
import { LikeButton } from '../components/LikeButton';
import './StoryDetailPage.css';

interface MusicInfo {
  id: number;
  status: string;
  file_path: string | null;
  style: string | null;
}

export function StoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const { t } = useLanguage();
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [music, setMusic] = useState<MusicInfo | null>(null);
  const [storyLiked, setStoryLiked] = useState(false);
  const [commentLikes, setCommentLikes] = useState<Record<number, boolean>>({});
  const prevAuthRef = useRef(isAuthenticated);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollUntilReady = (musicId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const result = await apiService.pollMusicStatus(musicId);
        if (result.status === 'completed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setMusic({ id: musicId, status: 'completed', file_path: result.filePath, style: null });
          useAuthStore.getState().fetchCurrentUser();
        } else if (result.status === 'failed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setMusic(null);
        }
      } catch {
        // Keep polling on network errors
      }
    }, 4000);

    // Cleanup polling on unmount
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
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
              // Show pending state and start polling
              setMusic(track);
              pollUntilReady(track.id);
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
          <ShareButton storyId={story.id} disabled={story.isBurned} />
          {!story.isBurned && user?.id === story.user_id && (
            <button
              type="button"
              className="burn-btn"
              onClick={() => setShowBurnConfirm(true)}
              aria-label={t('burn.confirm')}
            >
              <svg viewBox="0 0 24 24" className="burn-icon">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 3c1.38 0 2.5 1.12 2.5 2.5S13.38 10 12 10s-2.5-1.12-2.5-2.5S10.62 5 12 5z" fill="currentColor" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <main className="story-content">
        <div className="reading-progress-line" />

        <div className="ink-decoration">
          <div className="ink-line"></div>
        </div>

        <article>
          <h1 className="story-title">{story.title}</h1>
          <time className="story-date">
            {new Date(story.created_at).toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
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
              <p key={idx}>{paragraph || ' '}</p>
            ))}
          </div>
        </article>
        {music && music.status !== 'pending' && (
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