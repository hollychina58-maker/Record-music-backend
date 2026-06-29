import { create } from 'zustand';

interface Notification {
  id: number;
  type: string;
  source_id: number;
  actor_id: number | null;
  actor_nickname: string | null;
  is_read: number;
  created_at: string;
}

interface NotificationState {
  unreadCount: number;
  notifications: Notification[];
  setUnreadCount: (n: number) => void;
  setNotifications: (list: Notification[]) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  addCount: (n: number) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  notifications: [],

  setUnreadCount: (n: number) => set({ unreadCount: n }),

  setNotifications: (list: Notification[]) => set({ notifications: list }),

  markRead: (id: number) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)),
      unreadCount: Math.max(0, s.unreadCount - 1),
    })),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, is_read: 1 })),
      unreadCount: 0,
    })),

  addCount: (n: number) => set((s) => ({ unreadCount: s.unreadCount + n })),
}));
