import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  TrendingUp,
  Award,
  CheckCircle2,
  Clock,
  FileText,
  Calendar,
  History,
  ClipboardCheck,
  BookOpen,
  Heart,
  ChevronDown,
  Eye,
  XCircle,
} from 'lucide-react';
import { formatCurrency, formatArabicDate, todayDateString } from '@/lib/format';
import { ARABIC_MONTHS } from '@/lib/constants';
import HallOfFame from '@/components/dashboard/HallOfFame';
import DrillDownModal from '@/components/dashboard/DrillDownModal';
import EndOfDayAudit from '@/components/dashboard/EndOfDayAudit';
import PostSessionAlert from '@/components/dashboard/PostSessionAlert';
import NeedsReview from '@/components/dashboard/NeedsReview';
import AttentionWidget from '@/components/dashboard/AttentionWidget';
import TodaySection from '@/components/dashboard/TodaySection';
import { AlertCircle, Sun } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import {
  fetchHomework,
  fetchHomeworkStatuses,
  upsertHomeworkStatus,
  deleteHomeworkStatus,
  fetchBehaviorEvals,
  fetchBehaviorEvalsBatch,
  upsertBehaviorEval,
  deleteBehaviorEval,
} from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import StudentViewModal360 from '@/components/ui/StudentViewModal360';
import StudentBreakdownModal from '@/components/dashboard/StudentBreakdownModal';
import type { Student, Homework, HomeworkStatus, HomeworkStatusType, BehaviorRating, BehaviorEval, BehaviorScope, Group } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMonth } from '@/context/MonthContext';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportDashboardSummaryPDF, exportStudentListPDF, exportMonthlyPaymentSummaryPDF } from '@/lib/pdfExport';
import AnalyticsCharts from '@/components/dashboard/AnalyticsCharts';

function getCurrentMonthLabel(): string {
  const d = new Date();
  return `${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
// Returns the label for the month that the data actually reflects,
// so the banner never disagrees with the financial figures shown.

type EnrichedStudent = Student & { group_name?: string; grade_name?: string; stage_name?: string };

type HomeDashboardProps = {
  totalStudents: number;
  totalCollected: number;
  totalRemaining: number;
  fullyPaid: number;
  partialPaid: number;
  unpaidCount: number;
  isMaster: boolean;
  allStudents: EnrichedStudent[];
  monthlyPaidMap: Map<string, number>;
  monthExemptMap: Map<string, true>;
  groupsCount: number;
  groupId?: string;
  groupName?: string;
  students: Student[];
  allGroups: Group[];
  onOpenActivityLog: () => void;
  onNavigate: (tab: string) => void;
};

const HOMEWORK_META: Record<HomeworkStatusType, { label: string; activeClass: string }> = {
  complete: { label: 'تم', activeClass: 'bg-emerald-600 text-white shadow-lg' },
  incomplete: { label: 'لم يتم', activeClass: 'bg-red-600 text-white shadow-lg' },
  late: { label: 'غير مكتمل', activeClass: 'bg-amber-600 text-white shadow-lg' },
};

const BEHAVIOR_OPTIONS: { rating: BehaviorRating; label: string; activeClass: string }[] = [
  { rating: 'excellent', label: 'ممتاز', activeClass: 'bg-emerald-600 text-white shadow-lg' },
  { rating: 'participatory', label: 'مشارك', activeClass: 'bg-blue-600 text-white shadow-lg' },
  { rating: 'quiet', label: 'هادئ', activeClass: 'bg-slate-600 text-white shadow-lg' },
  { rating: 'needs_attention', label: 'يحتاج اهتمام', activeClass: 'bg-amber-600 text-white shadow-lg' },
  { rating: 'disruptive', label: 'مزعج', activeClass: 'bg-red-600 text-white shadow-lg' },
];

export default function HomeDashboard({
  totalStudents,
  totalCollected,
  totalRemaining,
  fullyPaid,
  partialPaid,
  unpaidCount,
  isMaster,
  allStudents,
  monthlyPaidMap,
  monthExemptMap,
  groupsCount,
  groupId,
  groupName,
  students,
  allGroups,
  onOpenActivityLog,
  onNavigate,
}: HomeDashboardProps) {
  const [drillCategory, setDrillCategory] = useState<'fullyPaid' | 'partial' | 'unpaid' | 'collected' | 'all' | null>(null);
  const [quickPanel, setQuickPanel] = useState<'homework' | 'behavior' | null>(null);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { monthLabel: activeMonthLabel } = useMonth();

  return (
    <div className="space-y-6">
      {/* End-of-day audit alert */}
      <EndOfDayAudit allGroups={allGroups} />

      {/* Post-session data completeness alert */}
      <PostSessionAlert allGroups={allGroups} onNavigate={onNavigate} />

      {/* Hero banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card premium-card rounded-2xl p-5 sm:p-7 relative overflow-hidden text-center"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent" />

        <div className="relative">
          {/* Current month banner */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/25 mb-3">
            <Calendar size={13} className="text-[#d4af37]" />
            <span className="text-xs font-bold text-[#e5c65a]">الشهر الحالي: {activeMonthLabel}</span>
          </div>
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              أهلاً بك في منصة الخالد التعليمية
            </h2>
            <button
              onClick={onOpenActivityLog}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-light hover:bg-[#d4af37]/10 text-slate-300 hover:text-[#d4af37] transition text-[11px] font-bold flex-shrink-0 premium-interactive"
              title="سجل النشاطات"
            >
              <History size={13} />
              سجل النشاطات
            </button>
            {isMaster && (
              <PDFButton
                label="تصدير PDF"
                size="sm"
                variant="secondary"
                onClick={async () => exportDashboardSummaryPDF({
                  monthLabel: activeMonthLabel,
                  groupName,
                  totalStudents, totalCollected, totalRemaining,
                  fullyPaid, partialPaid, unpaidCount, groupsCount,
                })}
                className="flex-shrink-0"
              />
            )}
            {isMaster && (
              <PDFButton
                label="ملخص المدفوعات PDF"
                size="sm"
                variant="secondary"
                onClick={async () => exportMonthlyPaymentSummaryPDF(allStudents, monthlyPaidMap, monthExemptMap, {
                  monthLabel: activeMonthLabel,
                  groupName,
                })}
                className="flex-shrink-0"
              />
            )}
          </div>

          {/* Smart Action Center access buttons */}
          <div className="flex items-center justify-center gap-2 mb-5 flex-wrap">
            <button
              onClick={() => setAttentionOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-amber-500/12 border border-amber-500/25 hover:bg-amber-500/18 text-amber-400 text-xs font-bold transition premium-interactive"
            >
              <AlertCircle size={14} />
              ماذا يحتاج مني الآن؟
            </button>
            <button
              onClick={() => setTodayOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-sky-500/12 border border-sky-500/25 hover:bg-sky-500/18 text-sky-400 text-xs font-bold transition premium-interactive"
            >
              <Sun size={14} />
              اليوم
            </button>
          </div>
          <p className="text-xs text-[#d4af37]/80 mb-5 font-medium">
            تحت إدارة ومتابعة مستر عمرو خالد • لوحة التحكم الشاملة
          </p>

          {isMaster && (
            <div className="flex justify-center mb-5">
              <PaymentCompletionRing fullyPaid={fullyPaid} totalStudents={totalStudents} exemptCount={monthExemptMap.size} />
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-2.5 max-w-3xl mx-auto items-start">
            {isMaster ? (
              <>
                <button onClick={() => setBreakdownOpen(true)} className="w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="إجمالي الطلاب" value={`${totalStudents} طالب`} icon={<Users size={18} />} color="text-white" clickable />
                </button>
                <button onClick={() => setDrillCategory('fullyPaid')} className="w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="دفع كامل" value={`${fullyPaid} طالب`} icon={<CheckCircle2 size={18} />} color="text-[#d4af37]" clickable />
                </button>
                <button onClick={() => setDrillCategory('partial')} className="w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="دفع جزئي" value={`${partialPaid} طالب`} icon={<Clock size={18} />} color="text-[#d4af37]" clickable />
                </button>
                <button onClick={() => setDrillCategory('unpaid')} className="w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="لم يدفع (متبقي)" value={`${unpaidCount} طالب`} icon={<XCircle size={18} />} color="text-red-400" clickable />
                </button>
                <button onClick={() => setDrillCategory('collected')} className="col-span-2 sm:col-span-1 w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="المبلغ المحصل" value={`${formatCurrency(totalCollected)} ج.م`} icon={<TrendingUp size={18} />} color="text-[#d4af37]" clickable />
                </button>
              </>
            ) : (
              <>
                <button onClick={() => onNavigate('attendance')} className="w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="الحضور والغياب" value="تسجيل يومي" icon={<Calendar size={18} />} color="text-[#d4af37]" clickable />
                </button>
                <button onClick={() => onNavigate('grades')} className="w-full text-right hover:scale-[1.03] transition-transform">
                  <HomeStat label="الدرجات" value="سنتر وإلكتروني" icon={<Award size={18} />} color="text-[#d4af37]" clickable />
                </button>
                <button
                  onClick={() => setQuickPanel(quickPanel === 'homework' ? null : 'homework')}
                  className="w-full text-right hover:scale-[1.03] transition-transform"
                >
                  <HomeStat label="الواجبات" value={quickPanel === 'homework' ? 'إغلاق' : 'تسجيل فوري'} icon={<CheckCircle2 size={18} />} color="text-[#d4af37]" clickable />
                </button>
                <button
                  onClick={() => setQuickPanel(quickPanel === 'behavior' ? null : 'behavior')}
                  className="w-full text-right hover:scale-[1.03] transition-transform"
                >
                  <HomeStat label="السلوك" value={quickPanel === 'behavior' ? 'إغلاق' : 'تقييم فوري'} icon={<Heart size={18} />} color="text-[#d4af37]" clickable />
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Inline quick-logging panel */}
      <AnimatePresence>
        {quickPanel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {groupId ? (
              <QuickLoggingPanel
                type={quickPanel}
                groupId={groupId}
                groupName={groupName ?? ''}
                students={students}
                onClose={() => setQuickPanel(null)}
                onViewStudent={setViewTarget}
              />
            ) : (
              <div className="glass-card rounded-2xl p-6 text-center">
                <p className="text-sm text-slate-400 mb-3">اختر مجموعة أولاً لتسجيل {quickPanel === 'homework' ? 'الواجبات' : 'السلوك'} بسرعة.</p>
                <button onClick={() => onNavigate('stepper')} className="text-sm font-bold text-[#d4af37] hover:text-[#e5c65a] transition">
                  اختيار مجموعة ←
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analytics charts — only for master view with financial data */}
      {isMaster && (
        <AnalyticsCharts
          allStudents={allStudents}
          monthlyPaidMap={monthlyPaidMap}
          fullyPaid={fullyPaid}
          partialPaid={partialPaid}
          unpaidCount={unpaidCount}
          totalCollected={totalCollected}
          totalRemaining={totalRemaining}
          totalStudents={totalStudents}
        />
      )}

      {/* Quick access cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <QuickCard
          icon={<Calendar size={24} />}
          title="الحضور والغياب"
          subtitle="تسجيل حضور المركز اليومي"
          color="emerald"
          onClick={() => onNavigate('attendance')}
        />
        <QuickCard
          icon={<Award size={24} />}
          title="الدرجات والشهادات"
          subtitle="درجات السنتر والإلكترونية"
          color="amber"
          onClick={() => onNavigate('grades')}
        />
        <QuickCard
          icon={<FileText size={24} />}
          title="الامتحانات الإلكترونية"
          subtitle="بناء ونشر الامتحانات"
          color="blue"
          onClick={() => onNavigate('exams')}
        />
      </div>

      {/* Needs Review */}
      <NeedsReview allStudents={allStudents} />

      {/* Today's date */}
      <div className="glass-light p-3.5 text-center text-xs text-slate-200 font-medium">
        {formatArabicDate(new Date())}
      </div>

      {/* Hall of Fame */}
      <HallOfFame groupId={groupId} onViewStudent={setViewTarget} onNavigate={onNavigate} />

      {/* Drill-down modal */}
      <DrillDownModal
        open={!!drillCategory}
        category={drillCategory}
        students={allStudents}
        monthlyPaidMap={monthlyPaidMap}
        monthExemptMap={monthExemptMap}
        onClose={() => setDrillCategory(null)}
      />

      <StudentViewModal360 open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />

      <StudentBreakdownModal open={breakdownOpen} onClose={() => setBreakdownOpen(false)} allStudents={allStudents} />

      {/* Smart Action Center drawers */}
      <AttentionWidget open={attentionOpen} onClose={() => setAttentionOpen(false)} allGroups={allGroups} onNavigate={(t) => { setAttentionOpen(false); onNavigate(t); }} />
      <TodaySection open={todayOpen} onClose={() => setTodayOpen(false)} allGroups={allGroups} onNavigate={(t) => { setTodayOpen(false); onNavigate(t); }} />
    </div>
  );
}

function QuickLoggingPanel({
  type,
  groupId,
  groupName,
  students,
  onClose,
  onViewStudent,
}: {
  type: 'homework' | 'behavior';
  groupId: string;
  groupName: string;
  students: Student[];
  onClose: () => void;
  onViewStudent: (s: Student) => void;
}) {
  const { showToast, showSaved } = useToast();
  const { monthKey } = useMonth();
  const [loading, setLoading] = useState(true);
  const [homeworkList, setHomeworkList] = useState<Homework[]>([]);
  const [selectedHw, setSelectedHw] = useState('');
  const [statuses, setStatuses] = useState<Record<string, HomeworkStatus>>({});
  const [behavior, setBehavior] = useState<Record<string, BehaviorEval[]>>({});
  const [behaviorDate] = useState(todayDateString());

  const loadHomework = useCallback(async () => {
    try {
      const data = await fetchHomework(groupId, false, monthKey);
      setHomeworkList(data);
      if (data.length > 0) setSelectedHw(data[0].id);
    } catch {
      showToast('تعذّر تحميل الواجبات', 'error');
    }
  }, [groupId, monthKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStatuses = useCallback(async () => {
    if (!selectedHw) {
      setStatuses({});
      return;
    }
    try {
      const data = await fetchHomeworkStatuses(selectedHw);
      const map: Record<string, HomeworkStatus> = {};
      for (const s of data ?? []) map[s.student_id] = s;
      setStatuses(map);
    } catch {
      setStatuses({});
    }
  }, [selectedHw]);

  const loadBehavior = useCallback(async () => {
    try {
      const studentIds = students.map((s) => s.id);
      const batchMap = await fetchBehaviorEvalsBatch(studentIds);
      setBehavior(Object.fromEntries(batchMap));
    } catch {
      showToast('تعذّر تحميل تقييمات السلوك', 'error');
    }
  }, [students]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setLoading(true);
    const tasks = type === 'homework' ? [loadHomework()] : [loadBehavior()];
    Promise.all(tasks)
      .then(() => { if (active) setLoading(false); })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [type, loadHomework, loadBehavior]);

  useEffect(() => {
    if (type === 'homework') loadStatuses();
  }, [type, loadStatuses]);

  async function handleSetStatus(student: Student, status: HomeworkStatusType) {
    if (!selectedHw) return;
    const existing = statuses[student.id];
    if (existing && existing.status === status) {
      setStatuses((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      try {
        await deleteHomeworkStatus(selectedHw, student.id);
      } catch {
        showToast('تعذّر تحديث الحالة', 'error');
      }
      return;
    }
    const newStatus: HomeworkStatus = {
      id: existing?.id ?? '',
      homework_id: selectedHw,
      student_id: student.id,
      status,
      teacher_note: existing?.teacher_note ?? null,
      recorded_at: new Date().toISOString(),
    };
    setStatuses((prev) => ({ ...prev, [student.id]: newStatus }));
    try {
      await upsertHomeworkStatus(selectedHw, student.id, status, existing?.teacher_note ?? null);
      showSaved('تم حفظ حالة الواجب');
    } catch {
      setStatuses((prev) => {
        const next = { ...prev };
        if (existing) {
          next[student.id] = existing;
        } else {
          delete next[student.id];
        }
        return next;
      });
      showToast('تعذّر حفظ الحالة', 'error');
    }
  }

  async function handleSetBehavior(student: Student, rating: BehaviorRating) {
    const studentEvals = behavior[student.id] ?? [];
    const latest = studentEvals[0];
    if (latest && latest.rating === rating && latest.eval_date === behaviorDate) {
      setBehavior((prev) => ({
        ...prev,
        [student.id]: studentEvals.filter((e) => e.id !== latest.id),
      }));
      try {
        await deleteBehaviorEval(latest.id);
      } catch {
        showToast('تعذّر حذف التقييم', 'error');
      }
      return;
    }
    try {
      await upsertBehaviorEval(student.id, groupId, rating, null, behaviorDate, 'monthly' as BehaviorScope);
      const refreshed = await fetchBehaviorEvals(student.id);
      setBehavior((prev) => ({ ...prev, [student.id]: refreshed ?? [] }));
      showSaved('تم حفظ تقييم السلوك');
    } catch {
      showToast('تعذّر حفظ التقييم', 'error');
    }
  }

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-48" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-light rounded-xl p-2.5 flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <p className="text-sm text-slate-400">لا يوجد طلاب في مجموعة {groupName}.</p>
      </div>
    );
  }

  const loggedStudents = type === 'homework'
    ? students.filter((s) => statuses[s.id])
    : students.filter((s) => (behavior[s.id] ?? []).length > 0);
  const unloggedStudents = type === 'homework'
    ? students.filter((s) => !statuses[s.id])
    : students.filter((s) => (behavior[s.id] ?? []).length === 0);

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {type === 'homework' ? <CheckCircle2 size={18} className="text-blue-400" /> : <Heart size={18} className="text-pink-400" />}
          <h3 className="text-sm font-bold text-white">
            {type === 'homework' ? 'تسجيل الواجبات' : 'تقييم السلوك'} — {groupName}
          </h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition">
          <ChevronDown size={16} />
        </button>
      </div>

      {type === 'homework' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">اختر واجب:</span>
          {homeworkList.map((hw) => (
            <button
              key={hw.id}
              onClick={() => setSelectedHw(hw.id)}
              className={'px-2.5 py-1 rounded-lg text-[11px] font-bold transition ' + (selectedHw === hw.id ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400 hover:bg-white/10')}
            >
              {hw.title}
            </button>
          ))}
        </div>
      )}

      {loggedStudents.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-[#d4af37]">تم التسجيل ({loggedStudents.length})</p>
          <div className="space-y-1.5">
            {loggedStudents.map((s) => (
              <div key={s.id} className="glass-light rounded-xl p-2.5 flex items-center justify-between gap-2">
                <button onClick={() => onViewStudent(s)} className="flex items-center gap-1.5 text-sm text-slate-300 font-medium truncate hover:text-sky-400 transition" title="عرض">
                  <Eye size={13} className="text-slate-500 flex-shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
                {type === 'homework' ? (
                  <div className="flex gap-1 flex-shrink-0">
                    {(Object.keys(HOMEWORK_META) as HomeworkStatusType[]).map((st) => {
                      const meta = HOMEWORK_META[st];
                      const isActive = statuses[s.id]?.status === st;
                      return (
                        <button
                          key={st}
                          onClick={() => handleSetStatus(s, st)}
                          className={'px-2.5 py-1 rounded-lg text-[11px] font-bold transition ' + (isActive ? meta.activeClass : 'bg-white/5 text-slate-400 hover:bg-white/10')}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                    {BEHAVIOR_OPTIONS.map((opt) => {
                      const latest = behavior[s.id]?.[0];
                      const isActive = latest?.rating === opt.rating;
                      return (
                        <button
                          key={opt.rating}
                          onClick={() => handleSetBehavior(s, opt.rating)}
                          className={'px-2 py-1 rounded-lg text-[11px] font-bold transition ' + (isActive ? opt.activeClass : 'bg-white/5 text-slate-400 hover:bg-white/10')}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unlogged students */}
      {unloggedStudents.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-amber-400">لم يُسجّل بعد ({unloggedStudents.length})</p>
          <div className="space-y-1.5">
            {unloggedStudents.map((s) => (
              <div key={s.id} className="glass-light rounded-xl p-2.5 flex items-center justify-between gap-2">
                <button onClick={() => onViewStudent(s)} className="flex items-center gap-1.5 text-sm text-slate-300 font-medium truncate hover:text-sky-400 transition" title="عرض">
                  <Eye size={13} className="text-slate-500 flex-shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
                {type === 'homework' ? (
                  <div className="flex gap-1 flex-shrink-0">
                    {(Object.keys(HOMEWORK_META) as HomeworkStatusType[]).map((st) => {
                      const meta = HOMEWORK_META[st];
                      const isActive = statuses[s.id]?.status === st;
                      return (
                        <button
                          key={st}
                          onClick={() => handleSetStatus(s, st)}
                          className={'px-2.5 py-1 rounded-lg text-[11px] font-bold transition ' + (isActive ? meta.activeClass : 'bg-white/5 text-slate-400 hover:bg-white/10')}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                    {BEHAVIOR_OPTIONS.map((opt) => {
                      const latest = behavior[s.id]?.[0];
                      const isActive = latest?.rating === opt.rating;
                      return (
                        <button
                          key={opt.rating}
                          onClick={() => handleSetBehavior(s, opt.rating)}
                          className={'px-2 py-1 rounded-lg text-[11px] font-bold transition ' + (isActive ? opt.activeClass : 'bg-white/5 text-slate-400 hover:bg-white/10')}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'homework' && homeworkList.length === 0 && (
        <div className="text-center py-4">
          <BookOpen className="mx-auto text-slate-600 mb-2" size={32} />
          <p className="text-sm text-slate-400">لا توجد واجبات بعد. يمكنك إضافة واجب من صفحة الواجبات والسلوك.</p>
        </div>
      )}
    </div>
  );
}

function HomeStat({ label, value, icon, color, clickable }: { label: string; value: string; icon: React.ReactNode; color: string; clickable?: boolean }) {
  const base = 'glass-light p-3 sm:p-3.5 text-right transition-all duration-300 flex flex-col justify-between w-full premium-interactive';
  const hover = clickable ? 'hover:bg-white/[0.07] cursor-pointer hover:shadow-xl hover:shadow-black/20' : 'hover:bg-white/[0.05]';
  return (
    <div className={`${base} rounded-2xl ${hover}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] sm:text-[11px] text-slate-200 font-semibold leading-tight">{label}</span>
        <span className={`premium-stat-orb w-8 h-8 flex items-center justify-center ${color}`} style={{ opacity: 0.9 }}>{icon}</span>
      </div>
      <span className={`text-sm sm:text-base font-extrabold ${color} block tracking-tight leading-tight premium-stat`}>{value}</span>
    </div>
  );
}

function PaymentCompletionRing({ fullyPaid, totalStudents, exemptCount }: { fullyPaid: number; totalStudents: number; exemptCount: number }) {
  const payableStudents = Math.max(0, totalStudents - exemptCount);
  const percentage = payableStudents > 0 ? Math.round((fullyPaid / payableStudents) * 100) : 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = (percentage / 100) * circumference;

  return (
    <div className="premium-dashboard-ring" aria-label={`نسبة السداد الكامل ${percentage}%`}>
      <svg viewBox="0 0 104 104" className="w-28 h-28 -rotate-90" aria-hidden="true">
        <circle cx="52" cy="52" r={radius} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="7" />
        <circle
          cx="52"
          cy="52"
          r={radius}
          fill="none"
          stroke="#d4af37"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="premium-dashboard-ring-label">
        <strong>{percentage}%</strong>
        <span>سداد كامل</span>
      </div>
    </div>
  );
}

function QuickCard({ icon, title, subtitle, color, onClick }: { icon: React.ReactNode; title: string; subtitle: string; color: string; onClick?: () => void }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-[#e5c65a] bg-[#d4af37]/10 border border-[#d4af37]/20 shadow-lg shadow-black/30',
    amber: 'text-[#e5c65a] bg-[#d4af37]/10 border border-[#d4af37]/20 shadow-lg shadow-black/30',
    blue: 'text-[#e5c65a] bg-[#d4af37]/10 border border-[#d4af37]/20 shadow-lg shadow-black/30',
  };
  const iconClass = 'premium-floating-icon w-14 h-14 flex items-center justify-center mb-3.5 ' + colorMap[color];
  return (
    <div onClick={onClick} className="glass-card premium-card premium-hover-lift p-5 group cursor-pointer">
      <div className={iconClass}>
        {icon}
      </div>
      <h3 className="font-bold text-white text-sm mb-1">{title}</h3>
      <p className="text-xs text-slate-200 font-medium">{subtitle}</p>
    </div>
  );
}
