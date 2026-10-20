import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ClipboardCheck, BookOpen, Smile } from 'lucide-react';
import type { Student } from '@/lib/types';
import { checkDailyCompletion, type IncompleteStudent, type CompletionCheckResult } from '@/lib/dailyCompletion';
import { todayDateString } from '@/lib/format';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type TransitionGuardProps = {
  open: boolean;
  groupId: string;
  students: Student[];
  stageName?: string;
  gradeName?: string;
  groupName?: string;
  onProceed: () => void;
  onNavigateToAttendance: () => void;
  onNavigateToTracking: () => void;
};

export default function TransitionGuard({
  open,
  groupId,
  students,
  stageName,
  gradeName,
  groupName,
  onProceed,
  onNavigateToAttendance,
  onNavigateToTracking,
}: TransitionGuardProps) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CompletionCheckResult | null>(null);
  const [view, setView] = useState<'warning' | 'details'>('warning');

  const runCheck = useCallback(async () => {
    if (!groupId || students.length === 0) {
      onProceed();
      return;
    }
    setChecking(true);
    setView('warning');
    const today = todayDateString();
    try {
      const res = await checkDailyCompletion(groupId, students, today);
      setResult(res);
      setChecking(false);
      if (res.incomplete.length === 0) {
        onProceed();
      }
    } catch {
      setChecking(false);
      onProceed();
    }
  }, [groupId, students, onProceed]);

  useEffect(() => {
    if (open) {
      runCheck();
    } else {
      setResult(null);
      setView('warning');
    }
  }, [open, runCheck]);

  function handleProceed() {
    onProceed();
  }

  function handleViewDetails() {
    setView('details');
  }

  function handleGoToModule(student: IncompleteStudent) {
    const hasAttendance = student.missing.some((m) => m.type === 'attendance');
    if (hasAttendance) {
      onNavigateToAttendance();
    } else {
      onNavigateToTracking();
    }
  }

  if (!open) return null;

  if (checking) {
    return (
      <Modal open={open} onClose={handleProceed} title="فحص التسجيلات" size="sm">
        <div className="text-center py-8">
          <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-400">جارٍ فحص تسجيلات اليوم...</p>
        </div>
      </Modal>
    );
  }

  if (!result || result.incomplete.length === 0) return null;

  return (
    <Modal
      open={open}
      onClose={handleProceed}
      title={view === 'warning' ? 'تنبيه: تسجيلات ناقصة' : 'الطلاب ذوو التسجيلات الناقصة'}
      size="md"
    >
      <div className="space-y-4">
        {view === 'warning' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <AlertTriangle className="text-amber-400" size={24} />
              </div>
              <div>
                <p className="text-white font-bold text-base mb-1">
                  يوجد {result.incomplete.length} طالب لم يتم استكمال تسجيلهم اليوم
                </p>
                <p className="text-xs text-slate-400">
                  المجموعة: {groupName ?? '—'}
                  {gradeName ? ` • المرحلة: ${gradeName}` : ''}
                  {stageName ? ` • ${stageName}` : ''}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  وقت الفحص: {new Date(result.checkedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <div className="glass-light rounded-xl p-3 max-h-32 overflow-y-auto space-y-1.5">
              {result.incomplete.slice(0, 5).map((item) => (
                <div key={item.student.id} className="flex items-center justify-between text-sm">
                  <span className="text-white font-medium">{item.student.name}</span>
                  <span className="text-xs text-amber-400">
                    {item.missing.map((m) => m.label).join('، ')}
                  </span>
                </div>
              ))}
              {result.incomplete.length > 5 && (
                <p className="text-xs text-slate-500 text-center pt-1">
                  و {result.incomplete.length - 5} طالب آخر...
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={handleProceed}>
                تجاوز الرسالة والمتابعة
              </Button>
              <Button onClick={handleViewDetails} className="bg-amber-600 hover:bg-amber-500">
                عرض البيانات ({result.incomplete.length})
              </Button>
            </div>
          </motion.div>
        )}

        {view === 'details' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <button
                onClick={() => setView('warning')}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition"
              >
                <ArrowLeft size={14} /> رجوع للتنبيه
              </button>
              <span className="text-xs text-amber-400 font-bold">
                {result.incomplete.length} طالب ناقص
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 modal-body">
              <AnimatePresence>
                {result.incomplete.map((item) => (
                  <motion.div
                    key={item.student.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="glass-light rounded-xl p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-bold text-sm">{item.student.name}</p>
                        <p className="text-[10px] text-slate-500">
                          {stageName ?? '—'} {gradeName ? `• ${gradeName}` : ''} • {groupName ?? '—'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {item.missing.map((m) => (
                          <MissingBadge key={m.type} type={m.type} label={m.label} />
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleGoToModule(item)}
                      className="w-full bg-emerald-600/80 hover:bg-emerald-500"
                    >
                      <ClipboardCheck size={14} /> استكمال التسجيل
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-white/10">
              <Button variant="secondary" onClick={() => setView('warning')}>
                رجوع
              </Button>
              <Button onClick={onProceed}>
                تجاوز والمتابعة
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </Modal>
  );
}

function MissingBadge({ type, label }: { type: string; label: string }) {
  const icon = type === 'attendance'
    ? <ClipboardCheck size={10} />
    : type === 'homework'
      ? <BookOpen size={10} />
      : <Smile size={10} />;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
      {icon}
      {label}
    </span>
  );
}
