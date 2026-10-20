import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CalendarCheck, Lock, RefreshCw, Unlock, History, Archive, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { fetchMonthClosures, closeMonth, reopenMonth, currentMonthKey, triggerAutoArchive, fetchArchiveRuns } from '@/lib/data';
import type { MonthClosure } from '@/lib/types';
import { ARABIC_MONTHS } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';

type ArchiveRun = {
  id: string;
  archive_month: string;
  status: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

export default function MonthClosureManager() {
  const { showToast } = useToast();
  const [closures, setClosures] = useState<MonthClosure[]>([]);
  const [archiveRuns, setArchiveRuns] = useState<ArchiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [closureData, runData] = await Promise.all([fetchMonthClosures(), fetchArchiveRuns()]);
      setClosures(closureData);
      setArchiveRuns(runData as ArchiveRun[]);
    } catch {
      showToast('تعذّر تحميل إغلاقات الشهر', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const currentMK = currentMonthKey();
  const currentMonthLabel = (() => {
    const [, m] = currentMK.split('-').map(Number);
    return ARABIC_MONTHS[m - 1] ?? currentMK;
  })();

  const isCurrentClosed = closures.some((c) => c.month_key === currentMK && !c.is_reopened);

  // Check if there's a completed archive for the previous month
  const prevMK = (() => {
    const [y, m] = currentMK.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const prevArchiveRun = archiveRuns.find((r) => r.archive_month === prevMK);
  const prevArchiveStatus = prevArchiveRun?.status ?? 'none';

  async function handleCloseCurrent() {
    setClosing(true);
    try {
      const result = await closeMonth(currentMK, currentMonthLabel, 'المدرس');
      if (result) {
        showToast(`تم إغلاق شهر ${currentMonthLabel} — تم حفظ لقطة تاريخية`, 'success');
        await load();
      } else {
        showToast('تعذّر إغلاق الشهر', 'error');
      }
    } catch {
      showToast('تعذّر إغلاق الشهر', 'error');
    } finally {
      setClosing(false);
    }
  }

  async function handleReopen(monthKey: string) {
    try {
      const success = await reopenMonth(monthKey);
      if (success) {
        showToast('تم إعادة فتح الشهر', 'success');
        await load();
      } else {
        showToast('تعذّر إعادة الفتح', 'error');
      }
    } catch {
      showToast('تعذّر إعادة الفتح', 'error');
    }
  }

  async function handleTriggerArchive() {
    setTriggering(true);
    try {
      const result = await triggerAutoArchive();
      if (result.success) {
        if (result.skipped) {
          showToast(`الشهر ${result.month} مؤرشف بالفعل`, 'info');
        } else {
          const recordCount = result.records
            ? Object.entries(result.records).map(([k, v]) => `${k}: ${v}`).join('، ')
            : '';
          showToast(`تمت أرشفة شهر ${result.month} بنجاح${recordCount ? ` — ${recordCount}` : ''}`, 'success');
        }
        await load();
      } else {
        showToast(`تعذّر الأرشفة: ${result.error ?? 'خطأ غير معروف'}`, 'error');
      }
    } catch {
      showToast('تعذّر تشغيل الأرشفة', 'error');
    } finally {
      setTriggering(false);
    }
  }

  function formatMonthLabel(mk: string): string {
    const [y, m] = mk.split('-').map(Number);
    return `${ARABIC_MONTHS[m - 1] ?? mk} ${y}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CalendarCheck size={20} className="text-emerald-400" />
          <h3 className="text-base font-bold text-white">إغلاق الشهر</h3>
        </div>
        <button onClick={load} disabled={loading} className="p-2 glass-light rounded-lg text-slate-400 hover:text-white transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Previous month archive status */}
      <div className={`glass-card rounded-xl p-4 border ${
        prevArchiveStatus === 'completed' ? 'border-emerald-500/30' :
        prevArchiveStatus === 'failed' ? 'border-red-500/30' :
        prevArchiveStatus === 'in_progress' ? 'border-sky-500/30' :
        'border-amber-500/30'
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Archive size={18} className={
              prevArchiveStatus === 'completed' ? 'text-emerald-400' :
              prevArchiveStatus === 'failed' ? 'text-red-400' :
              prevArchiveStatus === 'in_progress' ? 'text-sky-400' :
              'text-amber-400'
            } />
            <div>
              <p className="text-sm font-bold text-white">أرشفة شهر {formatMonthLabel(prevMK)}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {prevArchiveStatus === 'completed' && 'تمت الأرشفة بنجاح — اللقطة محفوظة ومقفلة'}
                {prevArchiveStatus === 'failed' && `فشلت الأرشفة${prevArchiveRun?.error_message ? `: ${prevArchiveRun.error_message.slice(0, 80)}` : ''}`}
                {prevArchiveStatus === 'in_progress' && 'الأرشفة قيد التشغيل...'}
                {prevArchiveStatus === 'none' && 'لم يتم أرشفة هذا الشهر بعد'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {prevArchiveStatus === 'completed' && (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
                <CheckCircle2 size={14} /> مؤرشف
              </span>
            )}
            {prevArchiveStatus === 'failed' && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-400">
                <AlertCircle size={14} /> فشل
              </span>
            )}
            {prevArchiveStatus === 'in_progress' && (
              <span className="flex items-center gap-1 text-xs font-bold text-sky-400">
                <Loader2 size={14} className="animate-spin" /> جاري
              </span>
            )}
            {prevArchiveStatus !== 'completed' && prevArchiveStatus !== 'in_progress' && (
              <Button size="sm" onClick={handleTriggerArchive} disabled={triggering}>
                <Archive size={14} /> {triggering ? 'جاري الأرشفة...' : 'تشغيل الأرشفة'}
              </Button>
            )}
            {prevArchiveStatus === 'failed' && (
              <Button size="sm" onClick={handleTriggerArchive} disabled={triggering}>
                <RefreshCw size={14} /> {triggering ? 'جاري...' : 'إعادة المحاولة'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Current month status */}
      <div className={`glass-card rounded-xl p-4 border ${isCurrentClosed ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">الشهر الحالي: {currentMonthLabel}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {isCurrentClosed
                ? 'تم إغلاق هذا الشهر — اللقطة التاريخية محفوظة'
                : 'هذا الشهر مفتوح — يمكن إغلاقه لحفظ لقطة تاريخية'}
            </p>
          </div>
          {!isCurrentClosed && (
            <Button size="sm" onClick={handleCloseCurrent} disabled={closing}>
              <Lock size={14} /> {closing ? 'جاري الإغلاق...' : 'إغلاق الشهر'}
            </Button>
          )}
        </div>
      </div>

      {/* Closures history */}
      {closures.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <History size={16} className="text-slate-400" />
            <span className="text-xs text-slate-400">سجل الإغلاقات</span>
          </div>
          <div className="space-y-2">
            {closures.map((c, i) => {
              const snapshot = c.snapshot_data as { total_collected?: number; student_count?: number; payment_count?: number; absent_count?: number };
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card rounded-xl p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Lock size={14} className={c.is_reopened ? 'text-amber-400' : 'text-emerald-400'} />
                      <span className="text-sm font-bold text-white">{c.month_label}</span>
                      {c.is_reopened && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">أُعيد فتحه</span>
                      )}
                    </div>
                    {!c.is_reopened && (
                      <button
                        onClick={() => handleReopen(c.month_key)}
                        className="p-1.5 rounded-lg glass-light text-slate-400 hover:text-amber-400 transition"
                        title="إعادة فتح"
                      >
                        <Unlock size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <div className="glass-light rounded-lg p-1.5 text-center">
                      <p className="text-[9px] text-slate-400">طلاب</p>
                      <p className="text-xs font-bold text-white">{snapshot.student_count ?? 0}</p>
                    </div>
                    <div className="glass-light rounded-lg p-1.5 text-center">
                      <p className="text-[9px] text-slate-400">محصل</p>
                      <p className="text-xs font-bold text-emerald-400">{snapshot.total_collected ?? 0}</p>
                    </div>
                    <div className="glass-light rounded-lg p-1.5 text-center">
                      <p className="text-[9px] text-slate-400">دفعات</p>
                      <p className="text-xs font-bold text-sky-400">{snapshot.payment_count ?? 0}</p>
                    </div>
                    <div className="glass-light rounded-lg p-1.5 text-center">
                      <p className="text-[9px] text-slate-400">غياب</p>
                      <p className="text-xs font-bold text-red-400">{snapshot.absent_count ?? 0}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
