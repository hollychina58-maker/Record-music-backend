import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { VoiceInput } from '../components/VoiceInput';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { canGenerateMusic } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import './CreateStoryPage.css';

export function CreateStoryPage() {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const fetchCurrentUser = useAuthStore(state => state.fetchCurrentUser);
  const updateUser = useAuthStore(state => state.updateUser);
  const { t } = useLanguage();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; content?: string }>({});
  const [withMusic, setWithMusic] = useState(false);
  const [withCover, setWithCover] = useState(false);
  // musicMode encodes both musicType and lyricsMode in one choice:
  //   'instrumental'       → musicType=instrumental
  //   'song_ai'            → musicType=song, lyricsMode=ai_generated
  //   'song_as_lyrics'     → musicType=song, lyricsMode=story_as_lyrics
  const [musicMode, setMusicMode] = useState<'instrumental' | 'song_ai' | 'song_as_lyrics'>('instrumental');
  const [musicGenre, setMusicGenre] = useState('chinese_folk');
  const [searchParams] = useSearchParams();

  // Carry-over from photo inspiration page
  useEffect(() => {
    const inspiration = searchParams.get('inspiration');
    if (inspiration) {
      setContent(inspiration + '\n\n');
      setWithMusic(true);
    }
  }, []); // Only on mount

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Fetch on every mount so credit count is always fresh when entering this page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCurrentUser(); }, []);

  if (!isAuthenticated) {
    return null;
  }

  const validateField = (field: 'title' | 'content', value: string) => {
    if (field === 'title' && value.trim().length > 0 && value.trim().length < 2) {
      return '标题至少需要2个字符';
    }
    if (field === 'content' && value.trim().length > 0 && value.trim().length < 10) {
      return '正文至少需要10个字符';
    }
    return '';
  };

  const handleBlur = (field: 'title' | 'content', value: string) => {
    const msg = validateField(field, value);
    setFieldErrors(prev => {
      const next = { ...prev };
      if (msg) { next[field] = msg; } else { delete next[field]; }
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (title.trim() && content.trim() && !isSubmitting) {
        handleSubmit(e as any);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const story = await apiService.createStory({
        userId: user?.id || 0,
        title: title.trim(),
        content: content.trim(),
      });

      if (withMusic && user) {
        try {
          const musicType = musicMode === 'instrumental' ? 'instrumental' : 'song';
          const lyricsMode = musicMode === 'song_as_lyrics' ? 'story_as_lyrics' : 'ai_generated';
          const result = await apiService.generateMusic(story.id, story.content, {
            musicType,
            musicGenre,
            ...(musicType === 'song' ? { lyricsMode } : {}),
          });
          // Immediately sync the server-returned credit count into the store so both
          // pages show the same value without waiting for the music poller to finish.
          if (result.freeMusicCount !== null) {
            updateUser({ freeMusicCount: result.freeMusicCount });
          } else if (result.subscriptionRemaining !== null) {
            updateUser({ subscriptionMusicRemaining: result.subscriptionRemaining });
          }
          // Register in localStorage so App-level PendingMusicPoller tracks it.
          const pending = JSON.parse(localStorage.getItem('mo_pending_music') || '[]');
          pending.push({ musicId: result.musicId, storyId: story.id, createdAt: Date.now() });
          localStorage.setItem('mo_pending_music', JSON.stringify(pending));
          navigate(`/story/${story.id}`);
        } catch (err: any) {
          if (err?.response?.status === 402) {
            setError(t('create.error.noCredits'));
          } else {
            setError(t('create.error.musicFailed'));
          }
        }
      }
      // Fire-and-forget: trigger cover image generation if enabled
      if (withCover) {
        apiService.generateCover(story.id).catch(() => {});
      }

      if ((withMusic && user) || withCover) {
        navigate(`/story/${story.id}`);
      } else {
        navigate('/');
      }
    } catch {
      setError(t('create.error.submitFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="create-page">
      <header className="page-header">
        <button
          type="button"
          className="back-btn"
          onClick={() => navigate('/')}
          aria-label="返回"
        >
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{t('create.title')}</h1>
      </header>

      <main className="form-container">
        <form onSubmit={handleSubmit} className="story-form">
          <div className="writing-panel">
            <div className="form-group">
              <input
                type="text"
                className={`title-input${fieldErrors.title ? ' title-input--error' : ''}`}
                placeholder={t('create.titlePlaceholder')}
                value={title}
                onChange={(e) => { setTitle(e.target.value); if (fieldErrors.title) handleBlur('title', e.target.value); }}
                onBlur={(e) => handleBlur('title', e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={100}
                required
              />
              {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
            </div>

            <div className="form-group content-group">
              <div className="textarea-wrapper">
                <textarea
                  className={`content-textarea${fieldErrors.content ? ' content-textarea--error' : ''}`}
                  placeholder={t('create.contentPlaceholder')}
                  value={content}
                  onChange={(e) => { setContent(e.target.value); if (fieldErrors.content) handleBlur('content', e.target.value); }}
                  onBlur={(e) => handleBlur('content', e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={12}
                  required
                />
                <div className="voice-input-wrapper">
                  <VoiceInput
                    value={content}
                    onTranscriptChange={setContent}
                  />
                </div>
              </div>
              <span className="char-count">{content.length} 字</span>
              {fieldErrors.content && <span className="field-error">{fieldErrors.content}</span>}
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="form-actions">
              <button
                type="submit"
                className="submit-btn"
                disabled={isSubmitting || !title.trim() || !content.trim()}
              >
                {isSubmitting ? t('create.publishing') : t('create.publishBtn')}
              </button>
            </div>
          </div>

          <div className="music-panel">
            {user && (
              <label className={`music-toggle ${!canGenerateMusic() ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={withMusic}
                  onChange={(e) => setWithMusic(e.target.checked)}
                  disabled={!canGenerateMusic()}
                />
                <span>
                  {(() => {
                    if (!canGenerateMusic()) return t('create.noFreeMusic');
                    if (user.hasActiveSubscription && user.subscriptionMusicRemaining === null) return t('payment.unlimitedMusic');
                    if (user.hasActiveSubscription) return t('create.musicToggle', { count: user.subscriptionMusicRemaining ?? 0 });
                    return t('create.musicToggle', { count: user.freeMusicCount });
                  })()}
                </span>
                {!canGenerateMusic() && (
                  <Link to="/payment" className="inline-purchase-link">{t('create.buyNow')}</Link>
                )}
              </label>
            )}

            {withMusic && (
              <div className="music-options">
                <div className="music-option music-option--mode">
                  <label>{t('create.musicMode')}</label>
                  <div className="lyrics-mode-group">
                    {(
                      [
                        { value: 'instrumental', labelKey: 'create.mode.instrumental', hintKey: 'create.mode.instrumentalHint' },
                        { value: 'song_ai',       labelKey: 'create.mode.songAi',       hintKey: 'create.mode.songAiHint' },
                        { value: 'song_as_lyrics',labelKey: 'create.mode.songLyrics',   hintKey: 'create.mode.songLyricsHint' },
                      ] as const
                    ).map(({ value, labelKey, hintKey }) => (
                      <label
                        key={value}
                        className={`lyrics-mode-choice${musicMode === value ? ' lyrics-mode-choice--active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="musicMode"
                          value={value}
                          checked={musicMode === value}
                          onChange={() => setMusicMode(value)}
                        />
                        <span className="lyrics-mode-label">
                          <strong>{t(labelKey)}</strong>
                          <em>{t(hintKey)}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="music-option">
                  <label>{t('create.musicGenre')}</label>
                  <select value={musicGenre} onChange={(e) => setMusicGenre(e.target.value)}>
                    <option value="chinese_folk">{t('create.genre.chinese_folk')}</option>
                    <option value="classical">{t('create.genre.classical')}</option>
                    <option value="pop">{t('create.genre.pop')}</option>
                    <option value="opera">{t('create.genre.opera')}</option>
                  </select>
                </div>
              </div>
            )}

            {/* AI Cover Image Toggle */}
            {user && (
              <label className="music-toggle">
                <input
                  type="checkbox"
                  checked={withCover}
                  onChange={(e) => setWithCover(e.target.checked)}
                />
                <span>{t('create.coverToggle')}</span>
              </label>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
