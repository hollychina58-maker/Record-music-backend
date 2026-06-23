import { useState, useRef, useEffect } from 'react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import './MusicPlayer.css';

interface MusicPlayerProps {
  audioUrl: string;
  title?: string;
  style?: string;
  musicId?: number;
  canDownload?: boolean;
}

export function MusicPlayer({ audioUrl, title, style: musicStyle, musicId, canDownload }: MusicPlayerProps) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState<'expired' | 'network' | false>(false);

  useEffect(() => {
    const token = useAuthStore.getState().token;
    const urlWithToken = token
      ? `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
      : audioUrl;
    const audio = new Audio(urlWithToken);
    // Mobile: preload metadata only to save bandwidth; desktop: full preload
    const isMobile = window.innerWidth < 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    audio.preload = isMobile ? 'metadata' : 'auto';
    audioRef.current = audio;

    const onLoaded = () => setDuration(audio.duration || 0);
    const onDurationChange = () => { if (audio.duration && !isNaN(audio.duration)) setDuration(audio.duration); };
    // Throttle timeupdate via rAF — avoid excessive re-renders on mobile
    let ticking = false;
    const onTime = () => {
      if (!ticking) {
        rafRef.current = requestAnimationFrame(() => {
          setCurrentTime(audio.currentTime);
          ticking = false;
        });
        ticking = true;
      }
    };
    const onEnd = () => setIsPlaying(false);
    const onError = () => {
      const err = audio.error;
      // code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED，通常是 CDN 链接过期（404/403）
      setPlayError(err?.code === 4 ? 'expired' : 'network');
      setIsPlaying(false);
    };
    const onCanPlay = () => { setPlayError(false as const); };
    const onStalled = () => {};

    // iOS Safari: load() required before play() for dynamically-set src
    audio.load();

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('stalled', onStalled);

    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('stalled', onStalled);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      setPlayError(false);
      // iOS Safari: reload audio before playing dynamically-created sources
      if (audio.readyState === 0) audio.load();
      audio.play().then(() => setIsPlaying(true)).catch(() => {
        setPlayError('network');
      });
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleDownload = async () => {
    if (!musicId) return;
    try {
      await apiService.downloadMusic(musicId, title ? `${title}.mp3` : undefined);
    } catch { /* stream endpoint, should not fail */ }
  };

  return (
    <div className={`ink-player${isPlaying ? ' ink-player--playing' : ''}`}>
      <div className="ink-player__info">
        <span className="ink-player__title">{title || t('detail.musicTitle')}</span>
        {musicStyle && <span className="ink-player__artist">{musicStyle}</span>}
      </div>

      <div className="ink-player__controls">
        {musicId && canDownload && (
          <button
            className="ink-player__btn ink-player__btn--download"
            onClick={handleDownload}
            aria-label={t('music.download')}
            title={t('music.download')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 4v12M8 12l4 4 4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button
          className="ink-player__btn ink-player__btn--play"
          onClick={togglePlay}
          aria-label={isPlaying ? t('music.pause') : t('music.play')}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
      </div>

      {playError === 'expired' && (
        <p className="ink-player__error">专属配乐已过期，请重新生成</p>
      )}
      {playError === 'network' && (
        <p className="ink-player__error">播放失败，请检查网络后重试</p>
      )}

      <div className="ink-player__progress">
        <span className="ink-player__time">{formatTime(currentTime)}</span>
        <div className="ink-player__track">
          <div
            className="ink-player__fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="ink-player__time">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
