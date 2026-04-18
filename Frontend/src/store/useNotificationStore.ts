import { create } from 'zustand';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export interface NotificationItem {
  id: string;
  tone: NotificationTone;
  message: string;
  title?: string;
  duration?: number;
}

interface NotificationInput {
  tone?: NotificationTone;
  message: string;
  title?: string;
  duration?: number;
}

interface NotificationState {
  notifications: NotificationItem[];
  pushNotification: (input: NotificationInput) => string;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  pushNotification: ({ tone = 'info', message, title, duration = 4200 }) => {
    const id = `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      notifications: [...state.notifications, { id, tone, message, title, duration }],
    }));
    return id;
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((item) => item.id !== id),
    })),
  clearNotifications: () => set({ notifications: [] }),
}));
