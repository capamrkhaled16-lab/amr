import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, CircleCheck as CheckCircle2, Clock, Circle as XCircle, Wallet, GraduationCap, BookOpen, Users, Layers, MapPin, Calendar, Award, ClipboardCheck, TrendingUp, TrendingDown, Minus, ArrowLeftRight } from 'lucide-react';
import { formatCurrency, formatArabicDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { monthStart, nextMonthStart, currentMonthKey } from '@/lib/data';
import { fetchStudentMonitoringData, fetchPerformanceTrends, getActivityBadge, type StudentMonitorData, type PerformanceTrend } from '@/lib/studentMonitoring';
import type { Student, AttendanceRecord, CenterGrade, HomeworkStatus, BehaviorEval, CenterExam } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import StudentTimeline from '@/components/ui/StudentTimeline';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/bodyScrollLock';

type EnrichedStudent = Student & {
  group_name?: string;
  grade_name?: string;
  stage_name?: string;
};

type Props = {
  open: boolean;
  student: EnrichedStudent | null;
  onClose: () => void;
};

type TransferRecord = {
  id: string;
  from_group_id: string | null;
  to_group_id: string | null;
  actor_name: string | null;
  created_at: string;
  from_group_name?: string;
  to_group_name?: string;
};

type Student360Data = {
  attendance: AttendanceRecord[];
  grades: (CenterGrade & { exam_title?: string; max_score?: number; category?: string })[];
  homework: HomeworkStatus[];
  behavior: BehaviorEval[];
  transfers: TransferRecord[];
  monitor: StudentMonitorData | null;
  trend: PerformanceTrend | null;
};

export function StudentViewModal360({ open, student, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Student360Data | null>(null);
  const [monthPaid, setMonthPaid] = useState<number | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
    return () => {
      unlockBodyScroll();
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

  const requestIdRef = useRef(0);
  const studentIdRef = useRef<string | undefined>(undefined);

  const loadData = useCallback(async () => {
    if (!student) return;
    const studentId = student.id;
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const mStart = monthStart();
      const mEnd = nextMonthStart();
      const [attRes, gradesRes, hwRes, behaviorRes, transferRes, monitorMap, trendMap] = await Promise.all([
        supabase
          .from('attendance')
          .select('id, student_id, group_id, session_id, status, notes, attendance_date, recorded_at')
          .eq('student_id', studentId)
          .gte('attendance_date', mStart)
          .lt('attendance_date', mEnd)
          .order('attendance_date', { ascending: false })
          .limit(15),
        supabase
          .from('center_grades')
          .select('id, center_exam_id, student_id, score, updated_at, is_locked, locked_at, locked_by')
          .eq('student_id', studentId)
          .eq('is_deleted', false)
          .gte('updated_at', mStart)
          .lt('updated_at', mEnd)
          .order('updated_at', { ascending: false })
          .limit(10),
        supabase
          .from('homework_status')
          .select('id, homework_id, student_id, status, teacher_note, recorded_at')
          .eq('student_id', studentId)
          .gte('recorded_at', mStart)
          .lt('recorded_at', mEnd)
          .order('recorded_at', { ascending: false })
          .limit(10),
        supabase
          .from('behavior_eval')
          .select('id, student_id, group_id, session_id, rating, note, eval_date, scope, created_at')
          .eq('student_id', studentId)
          .gte('eval_date', mStart)
          .lt('eval_date', mEnd)
          .order('eval_date', { ascending: false })
          .limit(5),
        supabase
          .from('group_transfers')
          .select('id, student_id, from_group_id, to_group_id, actor_name, created_at')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(10),
        fetchStudentMonitoringData([studentId]),
        fetchPerformanceTrends([studentId]),
      ]);

      let enrichedGrades = (gradesRes.data ?? []) as (CenterGrade & { exam_title?: string; max_score?: number; category?: string })[];
      if (enrichedGrades.length > 0) {
        const examIds = enrichedGrades.map((g) => g.center_exam_id);
        const { data: exams } = await supabase
          .from('center_exams')
          .select('id, title, max_score, category')
          .in('id', examIds);
        const examMap = new Map((exams ?? []).map((e) => [e.id, e] as [string, typeof e]));
        enrichedGrades = enrichedGrades.map((g) => ({
          ...g,
          exam_title: examMap.get(g.center_exam_id)?.title,
          max_score: examMap.get(g.center_exam_id)?.max_score ?? 100,
          category: examMap.get(g.center_exam_id)?.category,
        }));
      }

      let transfers = (transferRes.data ?? []) as TransferRecord[];
      if (transfers.length > 0) {
        const groupIds = new Set<string>();
        for (const t of transfers) {
          if (t.from_group_id) groupIds.add(t.from_group_id);
          if (t.to_group_id) groupIds.add(t.to_group_id);
        }
        const { data: groups } = await supabase
          .from('groups')
          .select('id, name')
          .in('id', [...groupIds]);
        const groupNameMap = new Map((groups ?? []).map((g) => [g.id, g.name] as [string, string]));
        transfers = transfers.map((t) => ({
          ...t,
          from_group_name: t.from_group_id ? groupNameMap.get(t.from_group_id) : undefined,
          to_group_name: t.to_group_id ? groupNameMap.get(t.to_group_id) : undefined,
        }));
      }

      if (reqId !== requestIdRef.current) return;
      setData({
        attendance: (attRes.data ?? []) as AttendanceRecord[],
        grades: enrichedGrades,
        homework: (hwRes.data ?? []) as HomeworkStatus[],
        behavior: (behaviorRes.data ?? []) as BehaviorEval[],
        transfers,
        monitor: monitorMap.get(studentId) ?? null,
        trend: trendMap.get(studentId) ?? null,
      });
    } catch {
      // Preserve last valid data on transient fetch failure —
      // clearing data here makes the modal appear empty on network blips.
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [student?.id]);

  useEffect(() => {
    if (open && student) {
      // Instant display: use cached student data so modal opens immediately
      // without waiting for the async fetch. Show skeleton only on first load
      // for a student we've never seen before.
      if (studentIdRef.current !== student.id) {
        studentIdRef.current = student.id;
        // Don't clear data immediately — keep showing previous data while loading
        // to avoid blank dark screen flicker. Only show skeleton if no data yet.
      }
      // Load payment status from actual monthly transactions
      setMonthPaid(null);
      const mk = currentMonthKey();
      supabase
        .from('payments')
        .select('amount')
        .eq('student_id', student.id)
        .eq('month_key', mk)
        .eq('is_deleted', false)
        .eq('is_historical_payment', false)
        .gt('amount', 0)
        .then(({ data: payData }) => {
          const total = (payData ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
          setMonthPaid(total);
        })
        .catch(() => { /* silent — keep null, shows fallback */ });
      void loadData();
    }
  }, [open, student?.id, loadData]);

  if (!mounted) return null;

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

  const activityBadge = data?.monitor ? getActivityBadge(data.monitor.activityLevel) : null;

  const trendIcon = data?.trend?.trend === 'improving' ? <TrendingUp size={13} className="text-emerald-400" />
    : data?.trend?.trend === 'declining' ? <TrendingDown size={13} className="text-red-400" />
    : <Minus size={13} className="text-slate-400" />;

  const trendLabel = data?.trend?.trend === 'improving' ? 'في تحسن'
    : data?.trend?.trend === 'declining' ? 'في انخفاض'
    : data?.trend?.trend === 'stable' ? 'مستقر'
    : 'بيانات غير كافية';

  const BEHAVIOR_LABELS: Record<string, string> = {
    excellent: 'ممتاز',
    participatory: 'مشارك',
    quiet: 'هادئ',
    disruptive: 'مزعج',
    needs_attention: 'يحتاج اهتمام',
  };

  const HOMEWORK_LABELS: Record<string, string> = {
    complete: 'تم',
    incomplete: 'لم يتم',
    late: 'غير مكتمل',
  };

  const ATTENDANCE_LABELS: Record<string, string> = {
    present: 'حاضر',
    absent: 'غائب',
    late: 'متأخر',
    excused_absence: 'غائب بعذر',
    excused: 'غائب بعذر',
    makeup: 'تعويضي',
    unrecorded: 'غير مسجل',
  };

  const ATTENDANCE_COLORS: Record<string, string> = {
    present: 'text-emerald-400',
    late: 'text-amber-400',
    absent: 'text-red-400',
    excused_absence: 'text-amber-400',
    excused: 'text-amber-400',
    makeup: 'text-sky-400',
    unrecorded: 'text-slate-500',
  };

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
            className="relative w-full max-w-md glass-card rounded-3xl shadow-glass-lg overflow-hidden max-h-[85vh] flex flex-col pointer-events-auto"
          >
            {/* Header */}
            <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-emerald-600/20 via-teal-600/10 to-transparent flex-shrink-0">
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
                    {activityBadge && (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 ${activityBadge.color} border border-white/10`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${activityBadge.dot}`} />
                        {activityBadge.label}
                      </span>
                    )}
                    {student.status === 'left' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                        <XCircle size={10} /> غادر
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto modal-body flex-1">
              {loading ? (
                <div className="px-5 py-4 space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : data ? (
                <div className="px-5 py-4 space-y-4">
                  {/* Location path */}
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
                  </div>

                  {/* New student banner */}
                  {data.monitor && data.monitor.isNewStudent && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 flex items-center gap-2">
                      <Calendar size={14} className="text-emerald-400 flex-shrink-0" />
                      <span className="text-xs text-emerald-300 font-semibold">طالب حديث — بدأ الحضور من {formatArabicDate(student.enrollment_date || student.created_at)}</span>
                    </div>
                  )}

                  {/* Activity stats */}
                  {data.monitor && (
                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat label="حاضر" value={data.monitor.presentCount} color="text-emerald-400" />
                      <MiniStat label="غائب" value={data.monitor.absentCount} color="text-red-400" />
                      <MiniStat label="غائبات متتالية" value={data.monitor.consecutiveAbsences} color="text-amber-400" />
                    </div>
                  )}

                  {/* Performance trend */}
                  {data.trend && data.trend.evaluationCount >= 3 && (
                    <div className="glass-light rounded-xl p-3 flex items-center gap-2">
                      {trendIcon}
                      <span className="text-xs text-slate-300">
                        المستوى: <span className="font-bold text-white">{trendLabel}</span>
                        <span className="text-slate-500"> — المتوسط {data.trend.recentAvg}%</span>
                      </span>
                    </div>
                  )}

                  {/* Financial summary */}
                  <div>
                    <SectionTitle icon={<Wallet size={13} />} label="الحالة المالية" />
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
                  </div>

                  {/* Recent attendance */}
                  {data.attendance.length > 0 && (
                    <div>
                      <SectionTitle icon={<Calendar size={13} />} label="آخر الحضور" />
                      <div className="space-y-1.5">
                        {data.attendance.slice(0, 5).map((a) => (
                          <div key={a.id} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{formatArabicDate(a.attendance_date)}</span>
                            <span className={`font-bold ${ATTENDANCE_COLORS[a.status] ?? 'text-slate-400'}`}>
                              {ATTENDANCE_LABELS[a.status] ?? a.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent grades */}
                  {data.grades.length > 0 && (
                    <div>
                      <SectionTitle icon={<Award size={13} />} label="آخر الدرجات" />
                      <div className="space-y-1.5">
                        {data.grades.slice(0, 5).map((g) => {
                          const pct = g.max_score && g.max_score > 0 ? Math.round((g.score / g.max_score) * 100) : 0;
                          return (
                            <div key={g.id} className="flex items-center justify-between text-xs">
                              <span className="text-slate-300 truncate">{g.exam_title ?? 'درجة'}</span>
                              <span className={`font-bold ${pct >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {g.score}/{g.max_score ?? 100} ({pct}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recent homework */}
                  {data.homework.length > 0 && (
                    <div>
                      <SectionTitle icon={<BookOpen size={13} />} label="آخر الواجبات" />
                      <div className="space-y-1.5">
                        {data.homework.slice(0, 5).map((h) => (
                          <div key={h.id} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{formatArabicDate(h.recorded_at)}</span>
                            <span className={`font-bold ${h.status === 'complete' ? 'text-emerald-400' : h.status === 'incomplete' ? 'text-red-400' : 'text-amber-400'}`}>
                              {HOMEWORK_LABELS[h.status] ?? h.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent behavior */}
                  {data.behavior.length > 0 && (
                    <div>
                      <SectionTitle icon={<ClipboardCheck size={13} />} label="آخر تقييمات السلوك" />
                      <div className="space-y-1.5">
                        {data.behavior.slice(0, 3).map((b) => (
                          <div key={b.id} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{formatArabicDate(b.eval_date)}</span>
                            <span className="font-bold text-white">{BEHAVIOR_LABELS[b.rating] ?? b.rating}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transfer history */}
                  {data.transfers.length > 0 && (
                    <div>
                      <SectionTitle icon={<ArrowLeftRight size={13} />} label="سجل نقل المجموعات" />
                      <div className="space-y-1.5">
                        {data.transfers.slice(0, 5).map((t) => (
                          <div key={t.id} className="flex items-center justify-between text-xs gap-2">
                            <span className="text-slate-400 flex-shrink-0">{formatArabicDate(t.created_at)}</span>
                            <span className="text-slate-300 truncate text-left">
                              {t.from_group_name ?? '—'} ← {t.to_group_name ?? '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {data.attendance.length === 0 && data.grades.length === 0 && data.homework.length === 0 && data.behavior.length === 0 && data.transfers.length === 0 && (
                    <div className="text-center py-6">
                      <p className="text-xs text-slate-500">لا توجد سجلات لهذا الطالب بعد.</p>
                    </div>
                  )}

                  {/* Student timeline + follow-up indicator */}
                  <StudentTimeline student={student} />
                </div>
              ) : (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-slate-400">تعذّر تحميل بيانات الطالب.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-4 flex-shrink-0 border-t border-white/[0.06] pt-3">
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

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-slate-500">{icon}</span>
      <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">{label}</span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] py-2 px-1 text-center">
      <p className="text-[9px] text-slate-400 mb-0.5">{label}</p>
      <p className={`text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default StudentViewModal360;
