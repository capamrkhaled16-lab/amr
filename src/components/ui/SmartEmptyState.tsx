import { motion } from 'framer-motion';
import { Loader2, AlertCircle, WifiOff, ShieldX, Inbox, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';

type SmartEmptyStateProps = {
  status: 'loading' | 'empty' | 'error' | 'permission' | 'network' | 'missing-relationship';
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: React.ReactNode;
};

const DEFAULT_MESSAGES: Record<SmartEmptyStateProps['status'], { title: string; message: string; icon: React.ReactNode }> = {
  loading: { title: 'جارٍ التحميل...', message: 'يتم جلب البيانات من الخادم', icon: <Loader2 className="animate-spin" size={32} /> },
  empty: { title: 'لا توجد بيانات', message: 'لم يتم العثور على سجلات مطابقة', icon: <Inbox size={32} /> },
  error: { title: 'حدث خطأ', message: 'تعذّر تحميل البيانات من الخادم', icon: <AlertCircle size={32} /> },
  permission: { title: 'لا تملك صلاحية', message: 'لا يمكنك الوصول إلى هذه البيانات', icon: <ShieldX size={32} /> },
  network: { title: 'لا يوجد اتصال', message: 'تحقق من اتصال الإنترنت وحاول مرة أخرى', icon: <WifiOff size={32} /> },
  'missing-relationship': { title: 'بيانات غير مكتملة', message: 'يجب اختيار المجموعة أولاً للوصول إلى هذه البيانات', icon: <AlertCircle size={32} /> },
};

export default function SmartEmptyState({
  status,
  title,
  message,
  onRetry,
  retryLabel = 'إعادة المحاولة',
  icon,
}: SmartEmptyStateProps) {
  const defaults = DEFAULT_MESSAGES[status];
  const isLoading = status === 'loading';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-8 sm:p-12 text-center"
    >
      <div className={`mx-auto mb-4 flex items-center justify-center w-14 h-14 rounded-2xl ${
        status === 'error' || status === 'network' ? 'bg-red-500/8 text-red-400 border border-red-400/10' :
        status === 'permission' ? 'bg-amber-500/8 text-amber-400 border border-amber-400/10' :
        isLoading ? 'bg-sky-500/8 text-sky-400 border border-sky-400/10' :
        'bg-slate-500/8 text-slate-500 border border-slate-400/10'
      }`}>
        {icon ?? defaults.icon}
      </div>
      <h3 className="text-sm font-bold text-white mb-1.5 tracking-tight">{title ?? defaults.title}</h3>
      <p className="text-xs text-slate-400 mb-4 max-w-sm mx-auto leading-relaxed">{message ?? defaults.message}</p>
      {onRetry && !isLoading && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw size={14} />
          {retryLabel}
        </Button>
      )}
    </motion.div>
  );
}
