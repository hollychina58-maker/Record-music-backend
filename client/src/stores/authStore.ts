import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  email: string;
  nickname: string;
  avatar: string | null;
  freeMusicCount: number;
  hasActiveSubscription: boolean;
  subscriptionMusicRemaining: number | null;
  role?: string;
  createdAt?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
  logout: () => void;
  fetchCurrentUser: () => Promise<void>;
  fetchUsage: () => Promise<{ freeMusicCount: number; totalUsageCount: number; usageHistory: unknown[] }>;
  updateFreeMusicCount: (count: number) => void;
  updateUser: (partial: Partial<User>) => void;
  clearError: () => void;
}

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Login failed');
          }

          set({
            user: {
              id: data.data.userId,
              email: data.data.email,
              nickname: data.data.nickname,
              avatar: data.data.avatar,
              role: data.data.role,
              freeMusicCount: data.data.freeMusicCount,
              hasActiveSubscription: data.data.hasActiveSubscription || false,
              subscriptionMusicRemaining: data.data.subscriptionMusicRemaining ?? null,
            },
            token: data.data.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      register: async (email: string, password: string, nickname?: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, nickname }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Registration failed');
          }

          set({
            user: {
              id: data.data.userId,
              email: data.data.email,
              nickname: data.data.nickname,
              avatar: null,
              role: data.data.role,
              freeMusicCount: data.data.freeMusicCount,
              hasActiveSubscription: false,
              subscriptionMusicRemaining: null,
            },
            token: data.data.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Registration failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      fetchCurrentUser: async () => {
        const { token } = get();
        if (!token) return;

        set({ isLoading: true });
        try {
          const res = await fetch(`${API_BASE}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          const data = await res.json();

          if (!res.ok) {
            const err: any = new Error(data.error || 'Failed to fetch user');
            err.status = res.status;
            throw err;
          }

          set({
            user: {
              id: data.data.id,
              email: data.data.email,
              nickname: data.data.nickname,
              avatar: data.data.avatar,
              role: data.data.role ?? get().user?.role,
              freeMusicCount: data.data.freeMusicCount,
              hasActiveSubscription: data.data.hasActiveSubscription || false,
              subscriptionMusicRemaining: data.data.subscriptionMusicRemaining ?? null,
              createdAt: data.data.createdAt,
            },
            isLoading: false,
          });

        } catch (error: unknown) {
          set({ isLoading: false });
          // Any 401 response means the token is no longer valid — log out
          const status = (error as any)?.status ?? (error as any)?.response?.status;
          if (status === 401 || status === 403) {
            get().logout();
          }
        }
      },

      fetchUsage: async () => {
        const { token } = get();
        if (!token) throw new Error('Not authenticated');

        try {
          const res = await fetch(`${API_BASE}/users/me/usage`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Failed to fetch usage');
          }

          const user = get().user;
          if (user) {
            set({
              user: {
                ...user,
                freeMusicCount: data.data.freeMusicCount,
              },
            });
          }

          return data.data;
        } catch (error: unknown) {
          throw new Error(error instanceof Error ? error.message : 'Failed to fetch usage');
        }
      },

      updateFreeMusicCount: (count: number) => {
        const user = get().user;
        if (user) {
          set({
            user: {
              ...user,
              freeMusicCount: count,
            },
          });
        }
      },

      updateUser: (partial: Partial<User>) => {
        const user = get().user;
        if (user) {
          set({ user: { ...user, ...partial } });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

export const canGenerateMusic = (): boolean => {
  const { user } = useAuthStore.getState();
  if (!user) return false;
  // Yearly subscription = unlimited (music_remaining is NULL)
  if (user.hasActiveSubscription && user.subscriptionMusicRemaining === null) return true;
  // Monthly subscription with remaining credits
  if (user.hasActiveSubscription && (user.subscriptionMusicRemaining ?? 0) > 0) return true;
  // Per-use free credits (no subscription)
  if (user.freeMusicCount > 0) return true;
  return false;
};

export const getAuthHeader = (): Record<string, string> => {
  const { token } = useAuthStore.getState();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
