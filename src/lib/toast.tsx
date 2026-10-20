import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEDUP_WINDOW_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recentMessages = useRef<Map<string, number>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type: ToastType, message: string) => {
    const now = Date.now();
    const dedupKey = `${type}:${message}`;

    const lastShown = recentMessages.current.get(dedupKey);
    if (lastShown && now - lastShown < DEDUP_WINDOW_MS) {
      return;
    }
    recentMessages.current.set(dedupKey, now);

    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);

    const timer = setTimeout(() => {
      dismiss(id);
    }, 3500);
    timers.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, ts] of recentMessages.current) {
        if (now - ts > DEDUP_WINDOW_MS * 2) {
          recentMessages.current.delete(key);
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const value: ToastContextValue = {
    showToast,
    showSuccess: (msg: string) => showToast("success", msg),
    showError: (msg: string) => showToast("error", msg),
    showWarning: (msg: string) => showToast("warning", msg),
    showInfo: (msg: string) => showToast("info", msg),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => onDismiss(toast.id)}
          className={`pointer-events-auto cursor-pointer px-5 py-3 rounded-xl shadow-lg text-sm font-semibold animate-toast-in ${getToastStyles(toast.type)}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function getToastStyles(type: ToastType): string {
  switch (type) {
    case "success":
      return "bg-success-600 text-white";
    case "error":
      return "bg-error-600 text-white";
    case "warning":
      return "bg-warning-500 text-white";
    case "info":
      return "bg-gray-800 text-white";
  }
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
