import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';
export type NotificationCategory =
  | 'recitation'
  | 'homework'
  | 'sheet'
  | 'attendance'
  | 'absence'
  | 'departure'
  | 'grades'
  | 'evaluation'
  | 'exam'
  | 'payment'
  | 'report'
  | 'general';

export type NotificationActionTarget = {
  tab: 'attendance' | 'tracking' | 'grades';
  groupId: string;
  groupName: string;
  studentId?: string;
  sessionId?: string;
  sessionDate?: string;
  examId?: string;
  homeworkId?: string;
  category?: NotificationCategory;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  studentId?: string;
  studentName?: string;
  groupId?: string;
  groupName?: string;
  sessionDate?: string;
  createdAt: number;
  read: boolean;
  actionLabel?: string;
  actionTarget?: NotificationActionTarget;
  dismissKey?: string;
};

export const NOTIFICATION_NAVIGATE_EVENT = 'app:notification-navigate';

type NotificationContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  push: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void;
  pushSuccess: (category: NotificationCategory, title: string, message: string, extra?: Partial<AppNotification>) => void;
  pushWarning: (title: string, message: string, extra?: Partial<AppNotification>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  deleteNotification: (id: string) => void;
  dismissByDismissKey: (key: string) => void;
  clearAll: () => void;
  isDismissed: (key: string) => boolean;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

const STORAGE_KEY = 'app_notifications';
const DISMISS_KEY = 'app_dismissed_warnings';
const MAX_NOTIFICATIONS = 50;

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function loadStored(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadStored);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(loadDismissed);

  useEffect(() => {
    try {
      const trimmed = notifications.slice(0, MAX_NOTIFICATIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      /* storage full or unavailable */
    }
  }, [notifications]);

  useEffect(() => {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissedKeys]));
    } catch {
      /* ignore */
    }
  }, [dismissedKeys]);

  const push = useCallback((n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification: AppNotification = {
      ...n,
      id,
      createdAt: Date.now(),
      read: false,
    };
    setNotifications((prev) => {
      if (n.dismissKey && prev.some((item) => item.dismissKey === n.dismissKey)) return prev;
      return [notification, ...prev].slice(0, MAX_NOTIFICATIONS);
    });
  }, []);

  const pushSuccess = useCallback(
    (category: NotificationCategory, title: string, message: string, extra?: Partial<AppNotification>) => {
      push({ type: 'success', category, title, message, ...extra });
    },
    [push]
  );

  const pushWarning = useCallback(
    (title: string, message: string, extra?: Partial<AppNotification>) => {
      if (extra?.dismissKey && dismissedKeys.has(extra.dismissKey)) return;
      push({ type: 'warning', category: extra?.category ?? 'general', title, message, ...extra });
    },
    [push, dismissedKeys]
  );

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target?.dismissKey) {
        const dk = target.dismissKey;
        setDismissedKeys((prevDk) => new Set([...prevDk, dk]));
      }
      return prev.filter((n) => n.id !== id);
    });
  }, []);

  const deleteNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const dismissByDismissKey = useCallback((key: string) => {
    setDismissedKeys((dk) => new Set([...dk, key]));
    setNotifications((prev) => prev.filter((n) => n.dismissKey !== key));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications((prev) => {
      const keys = prev.map((n) => n.dismissKey).filter(Boolean) as string[];
      if (keys.length > 0) {
        setDismissedKeys((dk) => new Set([...dk, ...keys]));
      }
      return [];
    });
  }, []);

  const isDismissed = useCallback((key: string) => dismissedKeys.has(key), [dismissedKeys]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        push,
        pushSuccess,
        pushWarning,
        markRead,
        markAllRead,
        dismiss,
        deleteNotification,
        dismissByDismissKey,
        clearAll,
        isDismissed,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
