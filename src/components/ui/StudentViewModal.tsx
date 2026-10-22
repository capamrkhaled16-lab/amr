import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, CircleCheck as CheckCircle2, Clock, Circle as XCircle, Wallet, GraduationCap, BookOpen, Users, Layers, MapPin, CircleUser as UserCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { currentMonthKey } from '@/lib/data';
import { lockBodyScroll, unlockBodyScroll, resetBodyScrollLock } from '@/lib/bodyScrollLock';
import type { Student } from '@/lib/types';

type EnrichedStudent = Student & {
  group_name?: string;
  grade_name?: string;
  stage_name?: string;
};

type StudentViewModalProps = {
  open: boolean;
  student: EnrichedStudent | null;
  onClose: () => void;
};

export default function StudentViewModal({ open, student, onClose }: StudentViewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [monthPaid, setMonthPaid] = useState<number | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const studentIdRef = useRef<string | undefined>(student?.id);

  useEffect(() => {
    if (!open || !student) return;
    studentIdRef.current = student.id;
    setMonthPaid(null);
    const mk = currentMonthKey();
    let cancelled = false;
    supabase
      .from('payments')
      .select('amount')
      .eq('student_id', student.id)
      .eq('month_key', mk)
      .eq('is_deleted', false)
      .eq('is_historical_payment', false)
      .gt('amount', 0)
      .then(({ data }) => {
        if (cancelled || studentIdRef.current !== student.id) return;
        const total = (data ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
        setMonthPaid(total);
      });
    return () => { cancelled = true; };
  }, [open, student?.id]);

  useEffect(() => {
    setMounted(true);
    return () => {
      resetBodyScrollLock();
      document.body.style.overflow = '';
      if (openRef.current) onCloseRef.current();
    };
  }, []);

  useEffect(() => {
    if (open) {
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
      window.addEventListener('keydown', onKey);
      lockBodyScroll();
      return () => {
        window.removeEventListener('keydown', onKey);
        unlockBodyScroll();
      };
    }
  }, [open]);

  if (!mounted) return null;

  const feeModeLabel = student
    ? student.is_exempt
      ? 'معفي من الرسوم'
      : (student.fee_mode ?? 'full') === 'deferred'
        ? 'مرحّل للشهر التالي'
        : (student.fee_mode ?? 'full') === 'pro_rata'
          ? 'احتساب بالحصص'
          : 'رسوم كاملة'
    : '';

  const displayPaid = monthPaid ?? 0;
  const remaining = student ? Math.max(0, (student.total_fees ?? 0) - displayPaid) : 0;
  const fullyPaid = student
    ? student.is_exempt
      ? true
      : monthPaid !== null && remaining <= 0 && displayPaid > 0
    : false;
  const hasNotPaid = monthPaid !== null && displayPaid === 0 && !student?.is_exempt;
  const statusLabel = student
    ? student.is_exempt
      ? 'معفي من الرسوم'
      : fullyPaid
        ? 'تم الدفع'
        : hasNotPaid
          ? 'لم يدفع'
          : 'مسدد جزئي'
    : '';

  return createPortal(
    <div data-portal-backdrop>
    <AnimatePresence>
      {open && student && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
          style={{ zIndex: 99999 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 16 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm glass-card rounded-3xl shadow-glass-lg overflow-hidden pointer-events-auto"
          >
            {/* Compact header */}
            <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-emerald-600/20 via-teal-600/10 to-transparent">
              <button
                onClick={onClose}
                className="absolute left-4 top-4 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition active:scale-90"
              >
                <X size={16} />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center text-lg font-bold flex-shrink-0 shadow-lg ring-2 ring-slate-900/50">
                  {student.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate leading-tight">{student.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        student.is_exempt
                          ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                          : fullyPaid
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : hasNotPaid
                              ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}
                    >
                      {student.is_exempt ? <CheckCircle2 size={10} /> : fullyPaid ? <CheckCircle2 size={10} /> : hasNotPaid ? <XCircle size={10} /> : <Clock size={10} />}
                      {statusLabel}
                    </span>
                    {student.status === 'left' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                        <XCircle size={10} /> غادر
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Description / fee mode */}
            <div className="px-5 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
              <UserCircle size={13} className="text-sky-400 flex-shrink-0" />
              <span className="text-[11px] text-slate-400">الوصف</span>
              <span className="text-xs text-sky-300 font-semibold truncate mr-auto">{feeModeLabel}</span>
            </div>

            {/* Location path */}
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2">
                <MapPin size={12} className="text-emerald-400 flex-shrink-0" />
                <span className="font-semibold">مسار الطالب</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                {student.stage_name && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 font-semibold">
                    <Layers size={11} /> {student.stage_name}
                  </span>
                )}
                {student.grade_name && (
                  <>
                    <span className="text-slate-600">←</span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300 font-semibold">
                      <GraduationCap size={11} /> {student.grade_name}
                    </span>
                  </>
                )}
                {student.group_name && (
                  <>
                    <span className="text-slate-600">←</span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-500/10 text-teal-300 font-semibold">
                      <Users size={11} /> {student.group_name}
                    </span>
                  </>
                )}
                {!student.stage_name && !student.grade_name && !student.group_name && (
                  <span className="text-slate-500 text-[11px]">غير مصنف</span>
                )}
              </div>
            </div>

            {/* Compact info rows */}
            <div className="px-5 py-3 space-y-2 border-b border-white/[0.06]">
              <InfoRow icon={<BookOpen size={13} />} label="الصف" value={student.grade_name || 'غير محدد'} />
              <InfoRow icon={<Users size={13} />} label="المجموعة" value={student.group_name || 'غير محدد'} />
            </div>

            {/* Financial summary */}
            <div className="px-5 py-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Wallet size={13} className="text-emerald-400" />
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">الحالة المالية</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/[0.04] py-2 px-1">
                  <p className="text-[9px] text-slate-400 mb-0.5">الرسوم</p>
                  <p className="text-sm font-bold text-white">{formatCurrency(student.total_fees ?? 0)}</p>
                </div>
                <div className="rounded-lg bg-emerald-500/[0.08] py-2 px-1">
                  <p className="text-[9px] text-slate-400 mb-0.5">المدفوع</p>
                  <p className="text-sm font-bold text-emerald-400">{formatCurrency(displayPaid)}</p>
                </div>
                <div className={`rounded-lg py-2 px-1 ${remaining > 0 && !student.is_exempt ? 'bg-amber-500/[0.08]' : 'bg-white/[0.04]'}`}>
                  <p className="text-[9px] text-slate-400 mb-0.5">المتبقي</p>
                  <p className={`text-sm font-bold ${remaining > 0 && !student.is_exempt ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {student.is_exempt ? 'معفي' : formatCurrency(remaining)}
                  </p>
                </div>
              </div>
              {(student.discount_amount > 0 || student.discount_percent > 0) && (
                <div className="flex items-center justify-between text-[11px] pt-2 mt-2 border-t border-white/10">
                  <span className="text-slate-400">الخصم</span>
                  <span className="text-sky-400 font-bold">
                    {student.discount_mode === 'percent'
                      ? `${student.discount_percent}%`
                      : `${formatCurrency(student.discount_amount)} ج.م`}
                  </span>
                </div>
              )}
            </div>

            <div className="px-5 pb-4">
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition text-sm font-semibold active:scale-95"
              >
                إغلاق
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    </div>,
    document.body,
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-slate-500 flex-shrink-0">{icon}</span>
      <span className="text-[11px] text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-xs text-white font-semibold truncate mr-auto">{value}</span>
    </div>
  );
}
