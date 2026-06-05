import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import './MusicBanner.css';

interface BannerState {
  visible: boolean;
  storyId: number | null;
  exiting: boolean;
}

interface MusicBannerContextValue {
  showMusicBanner: (storyId: number) => void;
}

const MusicBannerContext = createContext<MusicBannerContextValue>({
  showMusicBanner: () => {},
});

export function useMusicBanner() {
  return useContext(MusicBannerContext);
}

export function MusicBannerProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<BannerState>({ visible: false, storyId: null, exiting: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setBanner((b) => ({ ...b, exiting: true }));
    setTimeout(() => setBanner({ visible: false, storyId: null, exiting: false }), 450);
  }, []);

  const showMusicBanner = useCallback(
    (storyId: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setBanner({ visible: true, storyId, exiting: false });
      timerRef.current = setTimeout(dismiss, 9000);
    },
    [dismiss],
  );

  return (
    <MusicBannerContext.Provider value={{ showMusicBanner }}>
      {children}
      {banner.visible && banner.storyId !== null && (
        <MusicBannerUI storyId={banner.storyId} exiting={banner.exiting} onDismiss={dismiss} />
      )}
    </MusicBannerContext.Provider>
  );
}

function MusicBannerUI({
  storyId,
  exiting,
  onDismiss,
}: {
  storyId: number;
  exiting: boolean;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();

  const handleListen = () => {
    onDismiss();
    navigate(`/story/${storyId}`);
  };

  return (
    <div
      className={`music-banner${exiting ? ' music-banner--exit' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="music-banner-inner">
        {/* Animated vinyl icon */}
        <div className="music-banner-vinyl" aria-hidden="true">
          <div className="vinyl-disc">
            <div className="vinyl-label" />
          </div>
        </div>

        <div className="music-banner-text">
          <p className="music-banner-title">专属配乐已生成</p>
          <p className="music-banner-sub">你的故事已配上了独一无二的旋律</p>
        </div>

        <button className="music-banner-action" onClick={handleListen}>
          去听听
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
            <path d="M5 10h10M12 7l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button className="music-banner-close" onClick={onDismiss} aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="music-banner-progress" style={{ animationDuration: '9000ms' }} />
    </div>
  );
}
