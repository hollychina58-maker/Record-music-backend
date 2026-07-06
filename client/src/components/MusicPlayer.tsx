import { useState, useRef, useEffect } from 'react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useAudioManager } from '../stores/audioManager';
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
  const visRafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const barRefs = useRef<HTMLDivElement[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState<'expired' | 'network' | false>(false);
  const BARS = 24;
  const barArray = Array.from({ length: BARS }, (_, i) => i);

  // Sync with audioManager state when using shared audio
  useEffect(() => {
    if (musicId == null) return;
    const unsub = useAudioManager.subscribe((s) => {
      if (s.activeMusicId === musicId) {
        setIsPlaying(s.isPlaying);
        setCurrentTime(s.currentTime);
        setDuration(s.duration);
      }
    });
    return unsub;
  }, [musicId]);

  useEffect(() => {
    const globalAudio = useAudioManager.getState().getAudio();
    const globalMusicId = useAudioManager.getState().activeMusicId;
    const isShared = musicId != null && globalMusicId === musicId && globalAudio;

    // Use shared audio from audioManager if this music is already playing
    const audio = isShared ? globalAudio : new Audio();
    const controller = isShared ? null : new AbortController();
    audioRef.current = audio;

    if (isShared) {
      // Sync state from existing playing audio
      if (audio.duration && !isNaN(audio.duration)) setDuration(audio.duration);
      setCurrentTime(audio.currentTime);
      setIsPlaying(!audio.paused);
      setPlayError(false);
    } else {
      const token = useAuthStore.getState().token;
      const isMobile = window.innerWidth < 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
      audio.preload = isMobile ? 'metadata' : 'auto';

      if (token) {
        fetch(audioUrl, { headers: { Authorization: `Bearer ${token}` }, signal: controller!.signal })
          .then(r => r.blob())
          .then(blob => { if (controller && !controller.signal.aborted) { audio.src = URL.createObjectURL(blob); audio.load(); } })
          .catch(() => { if (controller && !controller.signal.aborted) setPlayError('network'); });
      } else {
        audio.src = audioUrl;
        audio.load();
      }
    }

    const onLoaded = () => setDuration(audio.duration || 0);
    const onDurationChange = () => { if (audio.duration && !isNaN(audio.duration)) setDuration(audio.duration); };
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
      setPlayError(err?.code === 4 ? 'expired' : 'network');
      setIsPlaying(false);
    };
    const onCanPlay = () => { setPlayError(false as const); };
    const onStalled = () => {};

    if (!isShared) audio.load();

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('stalled', onStalled);

    return () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(visRafRef.current);
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      controller?.abort();
      // Don't stop shared audio — it's managed by audioManager
      if (!isShared) {
        audio.pause();
        if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      }
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('stalled', onStalled);
    };
  }, [audioUrl]);

  const initVisualizer = (audio: HTMLAudioElement) => {
    if (audioCtxRef.current) return; // already connected
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128; // 64 frequency bins — enough for 24 visible bars
      analyser.smoothingTimeConstant = 0.7;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        barRefs.current.forEach((bar, i) => {
          // Spread 64 bins into 24 bars with exponential scaling for better visual
          const binIdx = Math.floor(i * analyser.frequencyBinCount / BARS);
          const h = Math.pow(data[binIdx] / 255, 0.7) * 100;
          if (bar) bar.style.setProperty('--bar-height', `${h}%`);
        });
        // Also set overall intensity for background ink blob
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        document.documentElement.style.setProperty('--music-intensity', `${avg / 255}`);
        visRafRef.current = requestAnimationFrame(tick);
      };
      visRafRef.current = requestAnimationFrame(tick);
    } catch { /* AudioContext not supported — silently skip */ }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      // Use audioManager for shared audio
      if (musicId != null) {
        useAudioManager.getState().pause();
      } else {
        audio.pause();
        cancelAnimationFrame(visRafRef.current);
      }
      setIsPlaying(false);
    } else {
      setPlayError(false);
      // Route through audioManager for shared state (stops any other card's audio)
      if (musicId != null) {
        useAudioManager.getState().play(musicId, audioUrl).catch(() => {});
      } else {
        if (audio.readyState === 0) audio.load();
        audioCtxRef.current?.resume();
        audio.play().then(() => { setIsPlaying(true); initVisualizer(audio); }).catch(() => {});
      }
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

      {/* Visualizer bars — only visible when playing */}
      <div className={`ink-player__viz${isPlaying ? ' ink-player__viz--active' : ''}`} aria-hidden="true">
        {barArray.map(i => (
          <div key={i} className="ink-player__bar" ref={el => { barRefs.current[i] = el!; }} />
        ))}
      </div>

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
