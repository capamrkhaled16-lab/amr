import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNotifications } from '@/context/NotificationContext';
import { CheckCircle2, AlertTriangle, Info, X, Undo2, Save } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType; actionLabel?: string; onAction?: () => void };

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
  showToastWithAction: (message: string, actionLabel: string, onAction: () => void) => void;
  showStickyToast: (message: string, type?: ToastType, durationMs?: number) => void;
  showSaved: (message?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { pushSuccess } = useNotifications();

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    if (type === 'success') {
      pushSuccess(inferCategory(message), 'تمت العملية بنجاح', message);
    }
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss, pushSuccess]);

  const showStickyToast = useCallback((message: string, type: ToastType = 'info', durationMs = 12000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => {
      const filtered = prev.filter((t) => t.message !== message);
      return [...filtered, { id, message, type }];
    });
    setTimeout(() => dismiss(id), durationMs);
  }, [dismiss]);

  const showToastWithAction = useCallback((message: string, actionLabel: string, onAction: () => void) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, message, type: 'info', actionLabel, onAction }]);
    setTimeout(() => dismiss(id), 3000);
  }, [dismiss]);

  const showSaved = useCallback((message: string = 'تم الحفظ') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type: 'success' }]);
    pushSuccess(inferCategory(message), 'تم الحفظ بنجاح', message);
    setTimeout(() => dismiss(id), 2000);
  }, [dismiss, pushSuccess]);

  return (
    <ToastContext.Provider value={{ showToast, showToastWithAction, showStickyToast, showSaved }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110000] flex flex-col gap-2 items-center pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const icon =
              t.type === 'success' ? <CheckCircle2 size={18} className="text-emerald-400" /> :
              t.type === 'error' ? <AlertTriangle size={18} className="text-red-400" /> :
              <Info size={18} className="text-blue-400" />;
            const border =
              t.type === 'success' ? 'border-emerald-500/30' :
              t.type === 'error' ? 'border-red-500/30' :
              'border-blue-500/30';
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                className={`glass-card rounded-xl px-4 py-3 shadow-2xl border ${border} flex items-center gap-2.5 max-w-sm pointer-events-auto`}
              >
                {icon}
                <span className="text-sm text-white flex items-center gap-1.5">{t.type === 'success' && <Save size={13} className="text-emerald-400" />}{t.message}</span>
                {t.actionLabel && t.onAction && (
                  <button
                    onClick={() => { t.onAction!(); dismiss(t.id); }}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-emerald-500/10 active:scale-95"
                  >
                    <Undo2 size={14} />
                    {t.actionLabel}
                  </button>
                )}
                <button onClick={() => dismiss(t.id)} className="text-slate-500 hover:text-white transition">
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function inferCategory(message: string): import('@/context/NotificationContext').NotificationCategory {
  if (/تسميع/.test(message)) return 'recitation';
  if (/واجب/.test(message)) return 'homework';
  if (/شيت/.test(message)) return 'sheet';
  if (/حضور/.test(message)) return 'attendance';
  if (/غياب/.test(message)) return 'absence';
  if (/انصراف/.test(message)) return 'departure';
  if (/درج/.test(message)) return 'grades';
  if (/تقييم/.test(message)) return 'evaluation';
  if (/امتحان|اختبار/.test(message)) return 'exam';
  if (/دفع|اشتراك|مال/.test(message)) return 'payment';
  if (/تقرير/.test(message)) return 'report';
  return 'general';
}
