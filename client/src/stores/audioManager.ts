import { create } from 'zustand';
import { useAuthStore } from './authStore';

interface AudioState {
  activeMusicId: number | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  play: (musicId: number, streamUrl: string) => Promise<void>;
  pause: () => void;
  setTime: (t: number) => void;
}

let audio: HTMLAudioElement | null = null;
let timeRaf: number = 0;

function stopCurrent() {
  if (audio) {
    audio.pause();
    audio.src = '';
    audio.load();
    audio = null;
  }
  cancelAnimationFrame(timeRaf);
}

function createAudio(url: string): HTMLAudioElement {
  const a = new Audio();
  a.preload = 'metadata';
  a.src = url;
  return a;
}

export const useAudioManager = create<AudioState>((set, get) => ({
  activeMusicId: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,

  play: async (musicId: number, streamUrl: string) => {
    const state = get();
    // Same music already playing → toggle
    if (state.activeMusicId === musicId && audio) {
      if (state.isPlaying) {
        audio.pause();
        set({ isPlaying: false });
      } else {
        audio.play().catch(() => {});
        set({ isPlaying: true });
      }
      return;
    }

    // Different music → stop old, start new
    stopCurrent();

    try {
      const token = useAuthStore.getState().token;
      let url = streamUrl;
      if (token) {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await resp.blob();
        url = URL.createObjectURL(blob);
      }

      audio = createAudio(url);
      audio.addEventListener('loadedmetadata', () => set({ duration: audio?.duration || 0 }));
      audio.addEventListener('ended', () => set({ isPlaying: false, activeMusicId: null }));
      audio.addEventListener('error', () => {
        stopCurrent();
        set({ isPlaying: false, activeMusicId: null });
      });

      // rAF for time tracking
      const tick = () => {
        if (audio && !audio.paused) {
          set({ currentTime: audio.currentTime });
          timeRaf = requestAnimationFrame(tick);
        }
      };

      await audio.play();
      set({ activeMusicId: musicId, isPlaying: true, currentTime: 0, duration: audio?.duration || 0 });
      timeRaf = requestAnimationFrame(tick);
    } catch {
      // autoplay blocked or network error — silently ignore
    }
  },

  pause: () => {
    if (audio) {
      audio.pause();
      cancelAnimationFrame(timeRaf);
    }
    set({ isPlaying: false });
  },

  setTime: (t: number) => {
    if (audio) audio.currentTime = t;
    set({ currentTime: t });
  },
}));
