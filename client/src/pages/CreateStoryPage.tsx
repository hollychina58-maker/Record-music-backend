import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
  const { t } = useLanguage();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; content?: string }>({});
  const [withMusic, setWithMusic] = useState(false);
  const [musicType, setMusicType] = useState<'instrumental' | 'song'>('instrumental');
  const [musicMood, setMusicMood] = useState('sorrow');
  const [musicGenre, setMusicGenre] = useState('chinese_folk');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

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
          const { musicId } = await apiService.generateMusic(story.id, story.content, { musicType, musicMood, musicGenre });
          // Register in localStorage so App-level PendingMusicPoller tracks it.
          // The banner will appear automatically when generation completes.
          const pending = JSON.parse(localStorage.getItem('mo_pending_music') || '[]');
          pending.push({ musicId, storyId: story.id, createdAt: Date.now() });
          localStorage.setItem('mo_pending_music', JSON.stringify(pending));
          navigate(`/story/${story.id}`);
        } catch (err: any) {
          if (err?.response?.status === 402) {
            setError(t('create.error.noCredits'));
          } else {
            setError(t('create.error.musicFailed'));
          }
        }
      } else if (withMusic && !user) {
        setError(t('create.error.loginRequired'));
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
                <div className="music-option">
                  <label>{t('create.musicType')}</label>
                  <select value={musicType} onChange={(e) => setMusicType(e.target.value as 'instrumental' | 'song')}>
                    <option value="instrumental">{t('create.instrumental')}</option>
                    <option value="song">{t('create.song')}</option>
                  </select>
                </div>
                <div className="music-option">
                  <label>{t('create.musicMood')}</label>
                  <select value={musicMood} onChange={(e) => setMusicMood(e.target.value)}>
                    <option value="sorrow">{t('create.mood.sorrow')}</option>
                    <option value="joy">{t('create.mood.joy')}</option>
                    <option value="passion">{t('create.mood.passion')}</option>
                    <option value="peace">{t('create.mood.peace')}</option>
                    <option value="mystery">{t('create.mood.mystery')}</option>
                    <option value="nostalgia">{t('create.mood.nostalgia')}</option>
                    <option value="warmth">{t('create.mood.warmth')}</option>
                    <option value="loneliness">{t('create.mood.loneliness')}</option>
                  </select>
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
          </div>
        </form>
      </main>
    </div>
  );
}
