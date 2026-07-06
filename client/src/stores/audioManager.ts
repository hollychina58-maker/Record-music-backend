import { create } from 'zustand';
import { useAuthStore } from './authStore';

interface AudioState {
  activeMusicId: number | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  play: (musicId: number, streamUrl: string) => Promise<void>;
  pause: () => void;
  stop: () => void;
  setTime: (t: number) => void;
  getAudio: () => HTMLAudioElement | null;
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
      // Stream directly — browser buffers and plays immediately (no blob download-first)
      const url = token
        ? `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
        : streamUrl;

      audio = createAudio(url);
      audio.load(); // Force browser to start fetching before play()
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

      // Wait for audio to be ready before playing (prevents silent first-click)
      if (audio && audio.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          audio!.addEventListener('canplay', () => resolve(), { once: true });
          audio!.addEventListener('error', () => reject(), { once: true });
        });
      }
      await audio?.play();
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

  stop: () => {
    stopCurrent();
    set({ activeMusicId: null, isPlaying: false, currentTime: 0, duration: 0 });
  },

  getAudio: () => audio,
}));
