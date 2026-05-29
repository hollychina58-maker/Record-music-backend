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
  const [withMusic, setWithMusic] = useState(false);
  const [musicType, setMusicType] = useState<'instrumental' | 'song'>('instrumental');
  const [musicMood, setMusicMood] = useState('sorrow');
  const [musicGenre, setMusicGenre] = useState('chinese_folk');
  const [musicStatus, setMusicStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

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
        setMusicStatus('generating');
        try {
          const result = await apiService.generateMusic(story.id, story.content, { musicType, musicMood, musicGenre });
          if (result.remainingFreeCount !== undefined) {
            const { fetchCurrentUser, updateFreeMusicCount } = useAuthStore.getState();
            if (user.hasActiveSubscription) {
              await fetchCurrentUser();
            } else {
              updateFreeMusicCount(result.remainingFreeCount);
            }
          }
          navigate('/');
        } catch (err: any) {
          if (err?.response?.status === 402) {
            setError(t('create.error.noCredits'));
          } else {
            setError(t('create.error.musicFailed'));
          }
          navigate('/');
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
          <div className="form-group">
            <input
              type="text"
              className="title-input"
              placeholder={t('create.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="form-group content-group">
            <div className="textarea-wrapper">
              <textarea
                className="content-textarea"
                placeholder={t('create.contentPlaceholder')}
                value={content}
                onChange={(e) => setContent(e.target.value)}
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
          </div>

          {error && <p className="form-error">{error}</p>}

          {musicStatus && (
            <p className="music-status">
              {musicStatus === 'generating' ? t('create.musicGenerating') : musicStatus}
            </p>
          )}

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

          <div className="form-actions">
            <button
              type="submit"
              className="submit-btn"
              disabled={isSubmitting || !title.trim() || !content.trim()}
            >
              {isSubmitting ? t('create.publishing') : t('create.publishBtn')}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
