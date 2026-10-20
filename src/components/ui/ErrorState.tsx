import { AlertTriangle, RefreshCw } from 'lucide-react';

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
};

export default function ErrorState({ message, onRetry, compact }: ErrorStateProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
        <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
        <span className="text-sm text-red-300 flex-1 truncate">{message ?? 'تعذّر التحميل'}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs font-bold text-red-400 hover:text-red-300 transition flex items-center gap-1 active:scale-95"
          >
            <RefreshCw size={12} /> إعادة
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-8 text-center max-w-md mx-auto">
      <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="text-red-400" size={28} />
      </div>
      <p className="text-sm font-bold text-white mb-1">{message ?? 'تعذّر تحميل البيانات'}</p>
      <p className="text-xs text-slate-400 mb-4">برجاء التحقق من الاتصال والمحاولة مرة أخرى.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition active:scale-95"
        >
          <RefreshCw size={16} /> إعادة المحاولة
        </button>
      )}
    </div>
  );
}
