import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, RefreshCw, AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react';
import { runDataCheck } from '@/lib/data';
import type { DataCheckIssue } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import StudentViewModal from '@/components/ui/StudentViewModal';
import type { Student } from '@/lib/types';

type Props = {
  onNavigate?: (tab: string) => void;
};

export default function PlatformDataCheck({ onNavigate }: Props) {
  const { showToast } = useToast();
  const [issues, setIssues] = useState<DataCheckIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const result = await runDataCheck();
      setIssues(result);
      setHasRun(true);
      showToast(`اكتمل الفحص: ${result.length} مشكلة`, 'success');
    } catch {
      showToast('تعذّر تشغيل الفحص', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const severityConfig = {
    critical: { icon: AlertCircle, color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/10' },
    warning: { icon: AlertTriangle, color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
    info: { icon: Info, color: 'text-sky-400', border: 'border-sky-500/30', bg: 'bg-sky-500/10' },
  };

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-emerald-400" />
          <h2 className="text-lg font-bold text-white">فحص المنصة</h2>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'جاري الفحص...' : 'فحص الآن'}
        </button>
      </div>

      {!hasRun ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <ShieldCheck className="mx-auto text-emerald-400 mb-3" size={40} />
          <p className="text-sm text-slate-400 mb-2">اضغط "فحص الآن" لمسح جميع بيانات المنصة</p>
          <p className="text-xs text-slate-500">سيتم البحث عن: الدفعات المكررة، الطلاب المكررين، الدرجات بدون حصة، الحضور بدون حصة، الطلاب الغائبون لديهم درجات، الدفعات غير المحاسب عليها، والبيانات الناقصة</p>
        </div>
      ) : issues.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center border border-emerald-500/30">
          <CheckCircle className="mx-auto text-emerald-400 mb-3" size={40} />
          <p className="text-sm text-emerald-400 font-bold">لا توجد مشاكل في البيانات</p>
          <p className="text-xs text-slate-400 mt-1">جميع الفحوصات مرت بنجاح</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="glass-card rounded-xl p-2 text-center">
              <p className="text-[10px] text-slate-400">حرج</p>
              <p className="text-lg font-bold text-red-400">{criticalCount}</p>
            </div>
            <div className="glass-card rounded-xl p-2 text-center">
              <p className="text-[10px] text-slate-400">تحذير</p>
              <p className="text-lg font-bold text-amber-400">{warningCount}</p>
            </div>
            <div className="glass-card rounded-xl p-2 text-center">
              <p className="text-[10px] text-slate-400">معلومة</p>
              <p className="text-lg font-bold text-sky-400">{infoCount}</p>
            </div>
          </div>

          {/* Issues list */}
          <div className="space-y-2">
            {issues.map((issue, i) => {
              const cfg = severityConfig[issue.severity];
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={issue.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`glass-card rounded-xl p-3 border ${cfg.border} flex items-start gap-3 cursor-pointer hover:bg-white/5 transition`}
                  onClick={() => {
                    if (issue.student_id) {
                      const st = { id: issue.student_id, name: issue.student_name ?? '', group_id: null, phone: null, parent_phone: null, parent_token: '', enrollment_date: '', total_fees: 0, paid_fees: 0, is_deleted: false, status: 'active' as const, gender: 'male' as const, discount_type: null, discount_amount: 0, is_exempt: false, discount_mode: null, discount_percent: 0, fee_mode: 'full' as const, pro_rata_sessions: 0, join_month_key: null, created_at: '' };
                      setViewTarget(st as Student);
                    } else if (issue.type === 'unaccounted_payments' && onNavigate) {
                      onNavigate('archive');
                    }
                  }}
                >
                  <div className={`flex-shrink-0 mt-0.5 p-1 rounded-lg ${cfg.bg}`}>
                    <Icon size={14} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">{issue.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{issue.description}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
