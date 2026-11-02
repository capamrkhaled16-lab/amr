import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchStudentByParentToken,
  fetchAttendanceForStudent,
  fetchCenterGradesByStudent,
  fetchCenterExamsByStudent,
  fetchOnlineGradesByStudent,
  fetchOnlineExamsByStudent,
  fetchPayments,
  fetchStudentMonthlySubscriptions,
  fetchHomework,
  fetchHomeworkStatuses,
  fetchBehaviorEvals,
  fetchHallOfFame,
  currentMonthKey,
} from '@/lib/data';
import { canonicalRankEntries } from '@/lib/leaderboardRank';
import { useSettings } from '@/context/SettingsContext';
import { getMonthLabel, formatArabicDate, formatCurrency, getGradeRating, sanitizeToken } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type {
  Student,
  AttendanceRecord,
  CenterGrade,
  CenterExam,
  OnlineGrade,
  OnlineExam,
  Payment,
  MonthlySubscription,
  Homework,
  HomeworkStatus,
  BehaviorEval,
  HallOfFameEntry,
} from '@/lib/types';
import {
  GraduationCap,
  Calendar,
  BookOpen,
  Award,
  TrendingUp,
  Wallet,
  Receipt,
  ChevronLeft,
  ChevronRight,
  CircleAlert as AlertCircle,
  Loader as Loader2,
  Phone,
  Sparkles,
  Target,
  Flame,
  Trophy,
  CheckCircle2,
  Clock,
  MessageCircle,
  Star,
  Zap,
  Heart,
  Eye,
  X,
  Compass,
  PenLine,
  Activity,
  Footprints,
  BookCheck,
} from 'lucide-react';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportParentPortalPDF } from '@/lib/pdfExport';
import { computeMonthStats, previousMonthKey } from '@/lib/parentPortalStats';
import { MonthComparison, MonthlyTrendChart, CalcNote } from '@/components/parent-portal/ParentInsights';

type LoadState = 'loading' | 'success' | 'error' | 'notfound';

interface ParentData {
  student: Student & { group_name?: string; group_schedule?: string | null; grade_name?: string; stage_name?: string };
  monthKey: string;
  attendance: (AttendanceRecord & { sessions?: { id: string; title: string } | null })[];
  centerGrades: CenterGrade[];
  centerExams: CenterExam[];
  onlineGrades: OnlineGrade[];
  onlineExams: OnlineExam[];
  payments: Payment[];
  subscriptions: MonthlySubscription[];
  homework: Homework[];
  homeworkStatuses: HomeworkStatus[];
  behavior: BehaviorEval[];
  rank: number | null;
  totalStudentsInGroup: number;
}

export default function ParentPortal() {
  const [searchParams] = useSearchParams();
  const rawToken = searchParams.get('token');
  const token = sanitizeToken(rawToken);
  const initialMonth = searchParams.get('month');

  const [state, setState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [data, setData] = useState<ParentData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth || currentMonthKey());
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [entered, setEntered] = useState(false);
  const reqIdRef = useRef(0);

  const loadData = useCallback(async (token: string, monthKey: string) => {
    const reqId = ++reqIdRef.current;
    setLoadingMonth(true);
    try {
      const student = await fetchStudentByParentToken(token);
      if (!student) {
        if (reqId === reqIdRef.current) {
          setState('notfound');
          setErrorMsg('لم يتم العثور على طالب بهذا الرابط. تأكد من صحة الرابط أو تواصل مع المعلم.');
        }
        return;
      }

      const groupId = student.group_id;
      if (!groupId) {
        if (reqId === reqIdRef.current) {
          setState('error');
          setErrorMsg('لا توجد مجموعة مرتبطة بهذا الطالب.');
        }
        return;
      }

      const [attendance, centerGrades, centerExams, onlineGrades, onlineExams, payments, subscriptions, homework, prevHomework, behavior, hofEntries] = await Promise.all([
        fetchAttendanceForStudent(student.id),
        fetchCenterGradesByStudent(student.id),
        fetchCenterExamsByStudent(student.id),
        fetchOnlineGradesByStudent(student.id),
        fetchOnlineExamsByStudent(student.id),
        fetchPayments(student.id, monthKey),
        fetchStudentMonthlySubscriptions(student.id),
        fetchHomework(groupId, true, monthKey),
        fetchHomework(groupId, true, previousMonthKey(monthKey)),
        fetchBehaviorEvals(student.id),
        fetchHallOfFame(groupId, 100),
      ]);

      const hwStatusArrays = await Promise.all(
        [...homework, ...prevHomework].map((hw) => fetchHomeworkStatuses(hw.id).catch(() => []))
      );
      const hwStatuses: HomeworkStatus[] = [];
      for (const statuses of hwStatusArrays) {
        const studentStatus = statuses.find((s) => s.student_id === student.id);
        if (studentStatus) hwStatuses.push(studentStatus);
      }

      let groupData: { name?: string; schedule?: string | null; grade_level?: { name?: string; stage?: { name?: string } } } | null = null;
      try {
        const { data: gd } = await supabase
          .from('groups')
          .select('name, schedule, grade_level:grade_levels(name, stage:academic_stages(name))')
          .eq('id', groupId)
          .maybeSingle();
        groupData = gd as { name?: string; schedule?: string | null; grade_level?: { name?: string; stage?: { name?: string } } } | null;
      } catch { /* ignore */ }

      const ranked = canonicalRankEntries(hofEntries ?? []);
      const studentRank = ranked.find((e) => e.id === student.id)?.rank ?? null;

      const enrichedStudent = {
        ...student,
        group_name: groupData?.name,
        group_schedule: groupData?.schedule ?? null,
        grade_name: groupData?.grade_level?.name,
        stage_name: groupData?.grade_level?.stage?.name,
      };

      if (reqId === reqIdRef.current) {
        setData({
          student: enrichedStudent,
          monthKey,
          attendance: attendance ?? [],
          centerGrades: centerGrades ?? [],
          centerExams: centerExams ?? [],
          onlineGrades: onlineGrades ?? [],
          onlineExams: onlineExams ?? [],
          payments: payments ?? [],
          subscriptions: subscriptions ?? [],
          homework: [...(homework ?? []), ...(prevHomework ?? [])],
          homeworkStatuses: hwStatuses ?? [],
          behavior: behavior ?? [],
          rank: studentRank,
          totalStudentsInGroup: ranked.length,
        });
        setState('success');
      }
    } catch (err) {
      if (reqId === reqIdRef.current) {
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ غير متوقع. حاول مرة أخرى لاحقاً.');
      }
    } finally {
      if (reqId === reqIdRef.current) setLoadingMonth(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setState('notfound');
      setErrorMsg('لم يتم العثور على رمز ولي الأمر في الرابط. تأكد من فتح الرابط الصحيح.');
      return;
    }
    loadData(token, selectedMonth);
  }, [token, selectedMonth, loadData]);

  if (state === 'loading') return <FullScreenLoader label="جاري تحميل بيانات الطالب..." />;
  if (state === 'notfound') return <FullScreenError icon={<AlertCircle className="w-12 h-12 text-amber-400" />} message={errorMsg} />;
  if (state === 'error') return <FullScreenError icon={<AlertCircle className="w-12 h-12 text-red-400" />} message={errorMsg} />;
  if (!data) return null;

  if (!entered) return <WelcomeScreen studentName={data.student.name} onEnter={() => setEntered(true)} />;
  return <PortalContent data={data} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} loadingMonth={loadingMonth} />;
}

/* ─── Welcome screen ─── */

function WelcomeScreen({ studentName, onEnter }: { studentName: string; onEnter: () => void }) {
  const { settings } = useSettings();
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 py-10" dir="rtl" lang="ar">
      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center overflow-hidden">
          {settings.logo_url ? <img src={settings.logo_url} alt="شعار المنصة" className="w-full h-full object-cover" /> : <GraduationCap className="w-9 h-9 text-amber-400" />}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black leading-tight">مرحباً بكم في منصة الخالد التعليمية</h1>
          <p className="text-sm text-slate-400 leading-relaxed">نتابع معكم رحلة أبنائنا التعليمية خطوة بخطوة</p>
          <p className="text-sm text-emerald-400/80 font-semibold mt-1">صَلِّ على النبي محمد ﷺ</p>
        </div>
        {settings.teacher_photo_url ? (
          <img src={settings.teacher_photo_url} alt={settings.teacher_name} className="w-28 h-28 rounded-full object-cover border border-amber-400/40" />
        ) : null}
        <div className="text-xs text-slate-400">
          <p>تقرير الطالب</p>
          <p className="text-base font-bold text-white mt-1">{studentName}</p>
        </div>
        <button
          type="button"
          onClick={onEnter}
          className="w-full sm:w-auto px-8 py-3 rounded-xl bg-emerald-500 text-black font-bold hover:bg-emerald-400 active:scale-[0.98] transition-all"
        >
          عرض تقرير الطالب
        </button>
      </div>
    </div>
  );
}

/* ─── Full-screen states ─── */

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 animate-pulse-glow">
          <GraduationCap className="w-8 h-8 text-white" />
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{label}</span>
        </div>
      </div>
    </div>
  );
}

function FullScreenError({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center">{icon}</div>
        <p className="text-slate-300 text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

/* ─── Main vertical-scroll content ─── */

function PortalContent({
  data,
  selectedMonth,
  onMonthChange,
  loadingMonth,
}: {
  data: ParentData;
  selectedMonth: string;
  onMonthChange: (m: string) => void;
  loadingMonth: boolean;
}) {
  const { student } = data;
  const { settings } = useSettings();

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthKey());
    for (const sub of data.subscriptions) if (sub.month_key) months.add(sub.month_key);
    for (const p of data.payments) if (p.month_key) months.add(p.month_key);
    return Array.from(months).sort().reverse();
  }, [data.subscriptions, data.payments]);

  const monthFilteredPayments = data.payments.filter((p) => p.month_key === selectedMonth);
  const monthSubscription = data.subscriptions.find((s) => s.month_key === selectedMonth);
  const monthFilteredAttendance = data.attendance.filter((a) => a.attendance_date.slice(0, 7) === selectedMonth);
  const monthFilteredBehavior = data.behavior.filter((b) => b.eval_date && b.eval_date.slice(0, 7) === selectedMonth);
  const monthFilteredHomework = data.homework.filter((h) => h.due_date && h.due_date.slice(0, 7) === selectedMonth);
  const monthFilteredHwStatuses = data.homeworkStatuses.filter((hs) => {
    const hw = data.homework.find((h) => h.id === hs.homework_id);
    return hw?.due_date && hw.due_date.slice(0, 7) === selectedMonth;
  });

  const presentCount = monthFilteredAttendance.filter((a) => a.status === 'present').length;
  const absentCount = monthFilteredAttendance.filter((a) => a.status === 'absent').length;
  const excusedCount = monthFilteredAttendance.filter((a) => ['excused', 'excused_absence'].includes(a.status)).length;
  const lateCount = monthFilteredAttendance.filter((a) => a.status === 'late').length;
  const totalAttendance = monthFilteredAttendance.length;
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0;

  const hwDone = monthFilteredHwStatuses.filter((hs) => ['done', 'complete', 'completed'].includes(hs.status)).length;
  const hwTotal = monthFilteredHwStatuses.length;
  const hwRate = hwTotal > 0 ? Math.round((hwDone / hwTotal) * 100) : 0;

  const examAvg = useMemo(() => {
    const allGrades: { score: number; max: number }[] = [];
    for (const cg of data.centerGrades) {
      const exam = data.centerExams.find((e) => e.id === cg.center_exam_id);
      if (exam && exam.max_score > 0 && exam.exam_date?.slice(0, 7) === selectedMonth) allGrades.push({ score: cg.score, max: exam.max_score });
    }
    for (const og of data.onlineGrades) {
      const exam = data.onlineExams.find((e) => e.id === og.exam_id);
      const when = exam?.open_at ?? exam?.created_at;
      if (og.max_score > 0 && when?.slice(0, 7) === selectedMonth) allGrades.push({ score: og.score, max: og.max_score });
    }
    if (allGrades.length === 0) return null;
    return Math.round(allGrades.reduce((acc, g) => acc + (g.score / g.max) * 100, 0) / allGrades.length);
  }, [data.centerGrades, data.centerExams, data.onlineGrades, data.onlineExams, selectedMonth]);

  const feesDue = monthSubscription?.amount_due ?? 0;
  const feesPaid = monthFilteredPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const feesRemaining = Math.max(0, feesDue - feesPaid);
  const isExempt = monthSubscription?.is_exempt ?? false;
  const collectionRate = feesDue > 0 ? Math.min(100, Math.round((feesPaid / feesDue) * 100)) : 0;

  // Upcoming exams (dates in the future)
  const upcomingExams = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    const upcoming: { title: string; date: string; maxScore: number; type: string }[] = [];
    for (const ex of data.centerExams) {
      if (ex.exam_date && ex.exam_date.slice(0, 10) >= now) {
        const hasGrade = data.centerGrades.some((g) => g.center_exam_id === ex.id);
        if (!hasGrade) upcoming.push({ title: ex.title ?? 'امتحان', date: ex.exam_date, maxScore: ex.max_score, type: 'center' });
      }
    }
    for (const ex of data.onlineExams) {
      const openAt = ex.open_at?.slice(0, 10);
      if (openAt && openAt >= now) {
        const hasGrade = data.onlineGrades.some((g) => g.exam_id === ex.id);
        if (!hasGrade) upcoming.push({ title: ex.title ?? 'امتحان إلكتروني', date: openAt, maxScore: ex.max_score, type: 'online' });
      }
    }
    return upcoming.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  }, [data.centerExams, data.onlineExams, data.centerGrades, data.onlineGrades]);

  // Achievement badges
  const badges = useMemo(() => {
    const list: { icon: React.ReactNode; label: string; color: string; achieved: boolean }[] = [
      { icon: <Flame className="w-3.5 h-3.5" />, label: 'حضور مثالي', color: 'emerald', achieved: attendanceRate >= 90 && totalAttendance > 0 },
      { icon: <BookOpen className="w-3.5 h-3.5" />, label: 'واجبات مكتملة', color: 'sky', achieved: hwRate >= 80 && hwTotal > 0 },
      { icon: <TrendingUp className="w-3.5 h-3.5" />, label: 'تفوق دراسي', color: 'amber', achieved: examAvg !== null && examAvg >= 85 },
      { icon: <Heart className="w-3.5 h-3.5" />, label: 'سلوك ممتاز', color: 'rose', achieved: monthFilteredBehavior.some((b) => b.rating === 'excellent') },
      { icon: <Trophy className="w-3.5 h-3.5" />, label: 'متصدرون', color: 'gold', achieved: data.rank !== null && data.rank <= 3 },
      { icon: <Wallet className="w-3.5 h-3.5" />, label: 'رسوم مسددة', color: 'teal', achieved: feesRemaining === 0 && feesDue > 0 },
    ];
    return list;
  }, [attendanceRate, totalAttendance, hwRate, hwTotal, examAvg, monthFilteredBehavior, data.rank, feesRemaining, feesDue]);

  const recordsForStats = useMemo(() => ({
    attendance: data.attendance,
    centerGrades: data.centerGrades,
    centerExams: data.centerExams,
    onlineGrades: data.onlineGrades,
    onlineExams: data.onlineExams,
    behavior: data.behavior,
    homework: data.homework,
    homeworkStatuses: data.homeworkStatuses,
  }), [data]);
  const prevKey = previousMonthKey(selectedMonth);
  const currentStats = useMemo(() => computeMonthStats(recordsForStats, selectedMonth), [recordsForStats, selectedMonth]);
  const previousStats = useMemo(() => computeMonthStats(recordsForStats, prevKey), [recordsForStats, prevKey]);

  const behaviorRate = currentStats.behavior.rate ?? 0;
  const overallPercentage = useMemo(() => {
    const gradeRate = examAvg ?? 0;
    const hasHw = hwTotal > 0;
    if (hasHw) return Math.round((attendanceRate * 0.3 + gradeRate * 0.5 + hwRate * 0.2) * 10) / 10;
    return Math.round((attendanceRate * 0.375 + gradeRate * 0.625) * 10) / 10;
  }, [attendanceRate, examAvg, hwRate, hwTotal]);

  const motivation = useMemo(() => {
    if (overallPercentage >= 90) return { title: 'أداء استثنائي هذا الشهر!', subtitle: 'أنت في قمة مستواك — حافظ على هذا التألق وحلّق نحو أهداف أعلى' };
    if (overallPercentage >= 75) return { title: 'أداء ممتاز ومتميز', subtitle: 'أنت على الطريق الصحيح — مزيد من التركيز يوصلك للقمة' };
    if (overallPercentage >= 60) return { title: 'أداء جيد يحتاج تطوير', subtitle: 'كل خطوة تبني المستقبل — ركّز على نقاط الضعف لتحلق أعلى' };
    return { title: 'بداية جديدة واعدة', subtitle: 'لا تستسلم! كل قمة تبدأ بخطوة — نحن نؤمن بقدرتك على التفوق' };
  }, [overallPercentage]);

  const nextStep = useMemo(() => {
    const areas = [
      { rate: attendanceRate, label: 'الحضور', suggestion: 'حاول عدم غياب أي حصة هذا الشهر — الحضور المنتظم أساس التفوق' },
      { rate: hwRate, label: 'الواجبات', suggestion: 'اجتهد في تسليم جميع الواجبات في موعدها — الواجبات تقوّي الفهم وتثبّت المعلومة' },
      { rate: examAvg ?? 0, label: 'الامتحانات', suggestion: 'راجع دروسك بانتظام واستعد جيداً للامتحانات القادمة — المراجعة المبكرة سرّ التفوق' },
      { rate: behaviorRate, label: 'السلوك', suggestion: 'حافظ على السلوك الإيجابي والمشاركة الفعالة في الحصص — السلوك الحسن يفتح أبواب النجاح' },
    ];
    return areas.sort((a, b) => a.rate - b.rate)[0];
  }, [attendanceRate, hwRate, examAvg, behaviorRate]);

  const trendPoints = useMemo(() => {
    const keys = Array.from(new Set([...availableMonths, selectedMonth, prevKey])).sort().slice(-6);
    return keys.map((k) => {
      const s = computeMonthStats(recordsForStats, k);
      return { monthKey: k, attendance: s.attendance.rate, exams: s.exams.average };
    });
  }, [recordsForStats, availableMonths, selectedMonth, prevKey]);

  if (data.monthKey !== selectedMonth) return <FullScreenLoader label="جاري تحميل بيانات الشهر..." />;

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl" lang="ar">
      {/* Ambient glow background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-40 w-80 h-80 bg-cyan-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-amber-600/5 rounded-full blur-3xl" />
      </div>

      {/* Sticky header */}
      <header className="sticky top-0 z-30 glass border-b border-white/[0.06]">
        <div className="max-w-2xl md:max-w-4xl lg:max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 overflow-hidden">
                {settings.logo_url ? <img src={settings.logo_url} alt="شعار المنصة" className="w-full h-full object-cover" /> : <GraduationCap className="w-5 h-5 text-white" />}
              </div>
              <div>
                <h1 className="text-sm font-bold text-white">{settings.platform_name}</h1>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] text-slate-400">بوابة ولي الأمر</p>
                  <span className="text-[10px] text-slate-600">·</span>
                  <p className="text-[10px] text-emerald-400/80 font-semibold">صَلِّ على النبي محمد ﷺ</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loadingMonth && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />}
              <PDFButton
                label="تصدير PDF"
                size="sm"
                variant="primary"
                onClick={async () => {
                  const grades: { examTitle: string; category: string; score: number; maxScore: number; passed: boolean }[] = [];
                  for (const cg of data.centerGrades) {
                    const exam = data.centerExams.find((e) => e.id === cg.center_exam_id);
                    if (exam) grades.push({ examTitle: exam.title ?? 'امتحان', category: exam.category ?? 'exam', score: cg.score, maxScore: exam.max_score, passed: cg.score >= (exam.pass_score ?? 0) });
                  }
                  for (const og of data.onlineGrades) {
                    const exam = data.onlineExams.find((e) => e.id === og.exam_id);
                    if (exam) grades.push({ examTitle: exam.title ?? 'امتحان أونلاين', category: 'online', score: og.score, maxScore: og.max_score, passed: og.score >= (exam.pass_score ?? 0) });
                  }
                  return exportParentPortalPDF(
                    student.name, student.stage_name, student.grade_name, student.group_name,
                    getMonthLabel(selectedMonth),
                    { attendanceRate, present: presentCount, absent: absentCount, excused: excusedCount, late: lateCount, hwRate, hwDone, hwTotal, examAvg, feesDue, feesPaid, feesRemaining, isExempt },
                    grades,
                    monthFilteredPayments.map((p) => ({ date: p.payment_date, amount: p.amount ?? 0, note: p.note ?? null })),
                  );
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Vertical scroll content */}
      <main className="relative max-w-2xl md:max-w-4xl lg:max-w-5xl mx-auto px-4 py-5 space-y-5 pb-32">
        {/* Profile header */}
        <ProfileHeader student={student} rank={data.rank} totalInGroup={data.totalStudentsInGroup} />

        {/* Hero card with overall percentage and animated ring */}
        <HeroCard
          overallPercentage={overallPercentage}
          rank={data.rank}
          totalInGroup={data.totalStudentsInGroup}
          monthLabel={getMonthLabel(selectedMonth)}
          motivation={motivation}
          attendanceRate={attendanceRate}
          hwRate={hwRate}
          examAvg={examAvg}
          behaviorRate={behaviorRate}
        />

        {/* Month selector */}
        <MonthSelector selectedMonth={selectedMonth} onMonthChange={onMonthChange} availableMonths={availableMonths} />

        {/* Four detailed performance cards */}
        <div className="grid grid-cols-2 gap-3">
          <PerformanceCard
            icon={<CheckCircle2 className="w-4 h-4" />}
            title="الحضور"
            rate={attendanceRate}
            color="emerald"
            details={
              <div className="space-y-1 text-[10px] text-slate-400">
                <div className="flex justify-between"><span>حاضر</span><span className="text-emerald-400 font-bold">{presentCount}</span></div>
                <div className="flex justify-between"><span>غائب</span><span className="text-red-400 font-bold">{absentCount}</span></div>
                <div className="flex justify-between"><span>بعذر</span><span className="text-amber-400 font-bold">{excusedCount}</span></div>
                <div className="flex justify-between"><span>تأخر</span><span className="text-sky-400 font-bold">{lateCount}</span></div>
              </div>
            }
          />
          <PerformanceCard
            icon={<BookCheck className="w-4 h-4" />}
            title="الواجبات"
            rate={hwRate}
            color="sky"
            dimmed={hwTotal === 0}
            details={
              hwTotal === 0 ? (
                <p className="text-[10px] text-slate-500">لا توجد واجبات هذا الشهر</p>
              ) : (
                <div className="space-y-1 text-[10px] text-slate-400">
                  <div className="flex justify-between"><span>مكتمل</span><span className="text-emerald-400 font-bold">{hwDone}</span></div>
                  <div className="flex justify-between"><span>غير مكتمل</span><span className="text-red-400 font-bold">{hwTotal - hwDone}</span></div>
                  <div className="flex justify-between"><span>الإجمالي</span><span className="text-white font-bold">{hwTotal}</span></div>
                </div>
              )
            }
          />
          <PerformanceCard
            icon={<TrendingUp className="w-4 h-4" />}
            title="الامتحانات"
            rate={examAvg ?? 0}
            color="amber"
            dimmed={examAvg === null}
            details={
              examAvg === null ? (
                <p className="text-[10px] text-slate-500">لا توجد درجات هذا الشهر</p>
              ) : (
                <div className="space-y-1 text-[10px] text-slate-400">
                  <div className="flex justify-between"><span>المتوسط</span><span className="text-amber-400 font-bold">{examAvg}%</span></div>
                  <div className="flex justify-between"><span>عدد الامتحانات</span><span className="text-white font-bold">{currentStats.exams.count}</span></div>
                </div>
              )
            }
          />
          <PerformanceCard
            icon={<Activity className="w-4 h-4" />}
            title="السلوك"
            rate={behaviorRate}
            color="rose"
            dimmed={currentStats.behavior.rated === 0}
            details={
              currentStats.behavior.rated === 0 ? (
                <p className="text-[10px] text-slate-500">لا توجد تقييمات هذا الشهر</p>
              ) : (
                <div className="space-y-1 text-[10px] text-slate-400">
                  <div className="flex justify-between"><span>إيجابي</span><span className="text-emerald-400 font-bold">{currentStats.behavior.positive}</span></div>
                  <div className="flex justify-between"><span>تنبيه</span><span className="text-amber-400 font-bold">{currentStats.behavior.warnings}</span></div>
                  <div className="flex justify-between"><span>الإجمالي</span><span className="text-white font-bold">{currentStats.behavior.rated}</span></div>
                </div>
              )
            }
          />
        </div>

        {/* Next step suggestion */}
        <NextStepCard suggestion={nextStep.suggestion} label={nextStep.label} rate={nextStep.rate} />

        <MonthComparison current={currentStats} previous={previousStats} currentKey={selectedMonth} previousKey={prevKey} />

        <MonthlyTrendChart points={trendPoints} />

        {/* Achievement badges */}
        <div className="pp-glass p-5">
          <div className="pp-section-title">
            <Award className="w-3.5 h-3.5 text-amber-400" />
            الأوسمة والإنجازات
          </div>
          <div className="flex flex-wrap gap-2.5">
            {badges.map((b, i) => (
              <Badge key={i} {...b} />
            ))}
          </div>
        </div>

        {/* Exam countdown */}
        {upcomingExams.length > 0 && (
          <div className="pp-glass p-5 pp-neon-amber">
            <div className="pp-section-title">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              امتحانات قادمة
            </div>
            <div className="space-y-3">
              {upcomingExams.map((ex, i) => {
                const daysLeft = Math.ceil((new Date(ex.date).getTime() - Date.now()) / 86400000);
                return (
                  <div key={i} className="flex items-center gap-3 bg-white/[0.03] rounded-xl p-3 border border-white/[0.05]">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${daysLeft <= 3 ? 'bg-red-500/15 text-red-400' : daysLeft <= 7 ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                      <span className="text-sm font-black">{daysLeft <= 0 ? '!' : daysLeft}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{ex.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{formatArabicDate(ex.date)}</p>
                    </div>
                    <span className="pp-badge border-white/10 text-slate-400 bg-white/[0.03]">
                      {ex.type === 'online' ? 'إلكتروني' : 'مركز'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Financial summary + timeline */}
        <div className="pp-glass p-5">
          <div className="pp-section-title">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            الملخص المالي
          </div>
          <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
            نسبة التحصيل = المبلغ المدفوع ÷ المستحق لهذا الشهر × 100، وتحسب من سجل المدفوعات المسجل لهذا الشهر فقط.
          </p>
          {isExempt ? (
            <div className="bg-emerald-500/10 rounded-xl p-4 text-center border border-emerald-500/15">
              <p className="text-sm font-bold text-emerald-400">معفى من الرسوم</p>
            </div>
          ) : feesDue === 0 ? (
            <div className="bg-white/[0.03] rounded-xl p-4 text-center">
              <p className="text-sm text-slate-400">لا توجد رسوم مسجلة لهذا الشهر</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <FinanceTile label="المستحقة" value={formatCurrency(feesDue)} color="text-white" />
                <FinanceTile label="المدفوع" value={formatCurrency(feesPaid)} color="text-emerald-400" />
                <FinanceTile label="المتبقي" value={formatCurrency(feesRemaining)} color={feesRemaining > 0 ? 'text-red-400' : 'text-emerald-400'} highlight />
              </div>
              {/* Collection progress bar */}
              <div className="mb-2">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                  <span>نسبة التحصيل</span>
                  <span className="font-bold text-emerald-400">{collectionRate}%</span>
                </div>
                <div className="h-2.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${collectionRate}%` }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Payment timeline */}
          {monthFilteredPayments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <div className="flex items-center gap-1.5 mb-3">
                <Receipt className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px] font-bold text-slate-300">سجل المدفوعات</span>
              </div>
              <div className="space-y-0">
                {monthFilteredPayments.map((p, i) => (
                  <div key={p.id} className="flex gap-3">
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center shrink-0">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-emerald-500/20 mt-1.5" />
                      {i < monthFilteredPayments.length - 1 && <div className="w-px flex-1 bg-white/[0.08] min-h-[28px]" />}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">{formatCurrency(p.amount)} ج.م</span>
                        <span className="text-[10px] text-slate-400">{formatArabicDate(p.payment_date)}</span>
                      </div>
                      {p.receipt_number && <p className="text-[10px] text-slate-500 mt-0.5" dir="ltr">رقم الإيصال: {p.receipt_number}</p>}
                      {p.note && <p className="text-[10px] text-slate-400 mt-0.5">{p.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {monthFilteredPayments.length === 0 && !isExempt && feesDue > 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center mt-3">
              <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center text-slate-500 mb-2">
                <Wallet className="w-5 h-5" />
              </div>
              <p className="text-xs text-slate-400">لم يتم تسجيل مدفوعات لهذا الشهر</p>
            </div>
          )}
        </div>

        {/* Grades section */}
        <GradesSection
          centerGrades={data.centerGrades}
          centerExams={data.centerExams}
          onlineGrades={data.onlineGrades}
          onlineExams={data.onlineExams}
          selectedMonth={selectedMonth}
        />

        <div className="pp-glass p-5">
          <div className="pp-section-title">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            كيف حُسبت النسب
          </div>
          <CalcNote
            label="نسبة الحضور"
            value={currentStats.attendance.rate}
            formula="عدد الحصص التي حضرها الطالب ÷ إجمالي الحصص المسجلة في هذا الشهر × 100"
            detail={`${currentStats.attendance.present} حضور من ${currentStats.attendance.total} حصة`}
          />
          <CalcNote
            label="إنجاز الواجبات"
            value={currentStats.homework.rate}
            formula="الواجبات المكتملة ÷ إجمالي الواجبات المسجلة لهذا الشهر × 100"
            detail={`${currentStats.homework.done} مكتمل، ${currentStats.homework.incomplete} غير مكتمل من ${currentStats.homework.total}`}
          />
          <CalcNote
            label="متوسط الامتحانات"
            value={currentStats.exams.average}
            formula="متوسط نسب الدرجات في جميع امتحانات هذا الشهر (المركز والإلكترونية)"
            detail={`${currentStats.exams.count} امتحان في هذا الشهر`}
          />
          <CalcNote
            label="السلوك الإيجابي"
            value={currentStats.behavior.rate}
            formula="التقييمات الإيجابية (ممتاز أو مشارك) ÷ إجمالي التقييمات المصنفة في هذا الشهر × 100"
            detail={`${currentStats.behavior.positive} إيجابي، ${currentStats.behavior.warnings} تنبيه من ${currentStats.behavior.rated} تقييم`}
          />
        </div>

        {/* Attendance section */}
        <AttendanceSection records={monthFilteredAttendance} />

        {/* Homework section */}
        <HomeworkSection homework={monthFilteredHomework} statuses={data.homeworkStatuses} studentId={student.id} />

        {/* Behavior section */}
        <BehaviorSection records={monthFilteredBehavior} />

        {/* Monthly journey timeline */}
        <JourneyTimeline
          attendance={monthFilteredAttendance}
          homework={monthFilteredHomework}
          behavior={monthFilteredBehavior}
          centerGrades={data.centerGrades}
          centerExams={data.centerExams}
          onlineGrades={data.onlineGrades}
          onlineExams={data.onlineExams}
          selectedMonth={selectedMonth}
        />

        {/* Signature card */}
        <SignatureCard />
      </main>

      {/* Teacher contact: only uses a real saved number. None is stored in settings yet. */}
      <div className="fixed bottom-5 left-4 right-4 max-w-2xl mx-auto z-30 pointer-events-none">
        <div className="pointer-events-auto flex items-center justify-center gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-3 text-xs text-slate-400">
          <MessageCircle className="w-4 h-4" />
          <span>رقم المعلم غير مسجل بعد للتواصل عبر واتساب</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function ProfileHeader({ student, rank, totalInGroup }: { student: ParentData['student']; rank: number | null; totalInGroup: number }) {
  const initials = student.name?.charAt(0) ?? '؟';
  return (
    <div className="pp-glass p-5 pp-neon-emerald">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-2xl font-black text-white shadow-lg shadow-emerald-500/20">
            {initials}
          </div>
          {rank !== null && rank <= 3 && (
            <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center shadow-lg ring-2 ring-black">
              <Trophy className="w-3.5 h-3.5 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white truncate">{student.name}</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {student.stage_name && <span className="pp-badge border-white/10 text-slate-300 bg-white/[0.04]">{student.stage_name}</span>}
            {student.grade_name && <span className="pp-badge border-emerald-500/20 text-emerald-400 bg-emerald-500/10">{student.grade_name}</span>}
            {student.group_name && <span className="pp-badge border-sky-500/20 text-sky-400 bg-sky-500/10">{student.group_name}</span>}
            {student.group_schedule && <span className="pp-badge border-white/10 text-slate-300 bg-white/[0.04]">{student.group_schedule}</span>}
            <span className={`pp-badge ${student.status === 'active' ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-slate-400 bg-white/[0.04]'}`}>{student.status === 'active' ? 'نشط' : 'غير نشط'}</span>
          </div>
          {rank !== null && totalInGroup > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              <Target className="w-3 h-3 text-amber-400" />
              <span className="text-[11px] text-slate-300 font-semibold">الترتيب: <span className="text-amber-400 font-black">{rank}</span> من {totalInGroup}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroCard({ overallPercentage, rank, totalInGroup, monthLabel, motivation, attendanceRate, hwRate, examAvg, behaviorRate }: {
  overallPercentage: number;
  rank: number | null;
  totalInGroup: number;
  monthLabel: string;
  motivation: { title: string; subtitle: string };
  attendanceRate: number;
  hwRate: number;
  examAvg: number | null;
  behaviorRate: number;
}) {
  const pct = Math.min(100, Math.round(overallPercentage));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;
  const ringColor = overallPercentage >= 90 ? '#10b981' : overallPercentage >= 75 ? '#34d399' : overallPercentage >= 60 ? '#f59e0b' : '#f43f5e';

  return (
    <div className="pp-glass p-6 pp-neon-emerald relative overflow-hidden">
      <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-cyan-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-5">
        <div className="relative w-28 h-28 shrink-0">
          <svg className="w-full h-full pp-progress-ring" viewBox="0 0 112 112">
            <defs>
              <linearGradient id="hero-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={ringColor} stopOpacity="0.9" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            <circle cx="56" cy="56" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <circle
              cx="56" cy="56" r={radius} fill="none" stroke="url(#hero-ring-grad)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 6px ${ringColor}55)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black text-white leading-none">{pct}<span className="text-sm text-slate-400">%</span></span>
            <span className="text-[9px] text-slate-400 mt-1">المستوى العام</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-bold text-emerald-400/80">{monthLabel}</span>
            {rank !== null && totalInGroup > 0 && (
              <span className="pp-badge border-amber-500/20 text-amber-400 bg-amber-500/10">
                <Trophy className="w-2.5 h-2.5" />الترتيب {rank} من {totalInGroup}
              </span>
            )}
          </div>
          <p className="text-sm font-black text-white leading-snug">{motivation.title}</p>
          <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{motivation.subtitle}</p>
          <div className="grid grid-cols-4 gap-2 mt-3">
            <MiniIndicator label="حضور" value={attendanceRate} color="#10b981" />
            <MiniIndicator label="واجب" value={hwRate} color="#0ea5e9" />
            <MiniIndicator label="امتحان" value={examAvg ?? 0} color="#f59e0b" dimmed={examAvg === null} />
            <MiniIndicator label="سلوك" value={behaviorRate} color="#f43f5e" dimmed={behaviorRate === 0} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniIndicator({ label, value, color, dimmed }: { label: string; value: number; color: string; dimmed?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
      <span className="text-sm font-black" style={{ color: dimmed ? '#64748b' : color }}>{dimmed ? '—' : `${value}%`}</span>
      <span className="text-[9px] text-slate-400">{label}</span>
    </div>
  );
}

function MonthSelector({ selectedMonth, onMonthChange, availableMonths }: { selectedMonth: string; onMonthChange: (m: string) => void; availableMonths: string[] }) {
  const currentIndex = availableMonths.indexOf(selectedMonth);
  const canGoBack = currentIndex < availableMonths.length - 1;
  const canGoForward = currentIndex > 0;
  return (
    <div className="flex items-center justify-between glass-light rounded-2xl px-4 py-3">
      <button disabled={!canGoBack} onClick={() => canGoBack && onMonthChange(availableMonths[currentIndex + 1])} className="p-1.5 rounded-lg text-slate-400 disabled:opacity-30 hover:bg-white/5 hover:text-white transition-colors">
        <ChevronRight className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-white">{getMonthLabel(selectedMonth)}</span>
      </div>
      <button disabled={!canGoForward} onClick={() => canGoForward && onMonthChange(availableMonths[currentIndex - 1])} className="p-1.5 rounded-lg text-slate-400 disabled:opacity-30 hover:bg-white/5 hover:text-white transition-colors">
        <ChevronLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

function PerformanceCard({ icon, title, rate, color, details, dimmed }: {
  icon: React.ReactNode;
  title: string;
  rate: number;
  color: 'emerald' | 'sky' | 'amber' | 'rose';
  details: React.ReactNode;
  dimmed?: boolean;
}) {
  const colorMap = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', bar: 'bg-gradient-to-r from-emerald-500 to-teal-400' },
    sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', bar: 'bg-gradient-to-r from-sky-500 to-cyan-400' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', bar: 'bg-gradient-to-r from-amber-500 to-yellow-400' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', bar: 'bg-gradient-to-r from-rose-500 to-pink-400' },
  };
  const c = colorMap[color];
  return (
    <div className="pp-glass p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center shrink-0 ${c.text}`}>{icon}</div>
        <span className="text-xs font-bold text-white">{title}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className={`text-2xl font-black ${dimmed ? 'text-slate-600' : 'text-white'}`}>{dimmed ? '—' : rate}</span>
        {!dimmed && <span className="text-sm text-slate-400">%</span>}
      </div>
      <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden mb-3">
        <div className={`h-full ${c.bar} rounded-full transition-all duration-700 ease-out`} style={{ width: dimmed ? '0%' : `${Math.min(100, rate)}%` }} />
      </div>
      {details}
    </div>
  );
}

function NextStepCard({ suggestion, label, rate }: { suggestion: string; label: string; rate: number }) {
  return (
    <div className="pp-glass p-4 pp-neon-amber relative overflow-hidden">
      <div className="absolute top-0 left-0 w-24 h-24 bg-amber-500/8 rounded-full blur-2xl pointer-events-none" />
      <div className="relative flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-500/10 flex items-center justify-center shrink-0 border border-amber-500/15">
          <Compass className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-black text-white">خطوتك القادمة</span>
            <span className="pp-badge border-amber-500/20 text-amber-400 bg-amber-500/10">{label} {rate}%</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{suggestion}</p>
        </div>
      </div>
    </div>
  );
}

function Badge({ icon, label, color, achieved }: { icon: React.ReactNode; label: string; color: string; achieved: boolean }) {
  const colorMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', text: 'text-emerald-400', glow: 'pp-neon-emerald' },
    sky: { bg: 'bg-sky-500/15', border: 'border-sky-500/25', text: 'text-sky-400', glow: 'pp-neon-cyan' },
    amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/25', text: 'text-amber-400', glow: 'pp-neon-gold' },
    rose: { bg: 'bg-rose-500/15', border: 'border-rose-500/25', text: 'text-rose-400', glow: '' },
    gold: { bg: 'bg-yellow-500/15', border: 'border-yellow-500/25', text: 'text-yellow-400', glow: 'pp-neon-gold' },
    teal: { bg: 'bg-teal-500/15', border: 'border-teal-500/25', text: 'text-teal-400', glow: '' },
  };
  const c = colorMap[color] ?? colorMap.emerald;
  if (!achieved) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.02] border border-white/[0.05] text-slate-600 opacity-50">
        {icon}
        <span className="text-[10px] font-bold">{label}</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${c.bg} border ${c.border} ${c.text} ${c.glow} transition-all`}>
      {icon}
      <span className="text-[10px] font-bold">{label}</span>
    </div>
  );
}

function JourneyTimeline({ attendance, homework, behavior, centerGrades, centerExams, onlineGrades, onlineExams, selectedMonth }: {
  attendance: (AttendanceRecord & { sessions?: { id: string; title: string } | null })[];
  homework: Homework[];
  behavior: BehaviorEval[];
  centerGrades: CenterGrade[];
  centerExams: CenterExam[];
  onlineGrades: OnlineGrade[];
  onlineExams: OnlineExam[];
  selectedMonth: string;
}) {
  const statusLabel: Record<string, string> = { present: 'حاضر', absent: 'غائب', late: 'تأخر', excused: 'بعذر', excused_absence: 'بعذر', unrecorded: 'لم يسجل' };
  const ratingLabel: Record<string, string> = { excellent: 'سلوك ممتاز', participatory: 'مشارك إيجابي', quiet: 'هادئ', needs_attention: 'يحتاج اهتمام', disruptive: 'مزعج' };
  const events: { date: string; title: string; subtitle?: string; color: string; icon: React.ReactNode }[] = [];

  for (const rec of attendance) {
    events.push({ date: rec.attendance_date, title: statusLabel[rec.status] ?? rec.status, subtitle: rec.sessions?.title, color: 'emerald', icon: <Calendar className="w-3.5 h-3.5" /> });
  }
  for (const hw of homework) {
    events.push({ date: hw.due_date ?? `${selectedMonth}-15`, title: hw.title, subtitle: 'موعد تسليم الواجب', color: 'sky', icon: <BookOpen className="w-3.5 h-3.5" /> });
  }
  for (const cg of centerGrades) {
    const exam = centerExams.find((e) => e.id === cg.center_exam_id);
    if (exam?.exam_date?.slice(0, 7) === selectedMonth) {
      events.push({ date: exam.exam_date, title: exam.title ?? 'امتحان', subtitle: `الدرجة: ${cg.score}/${exam.max_score}`, color: 'amber', icon: <TrendingUp className="w-3.5 h-3.5" /> });
    }
  }
  for (const og of onlineGrades) {
    const exam = onlineExams.find((e) => e.id === og.exam_id);
    const when = exam?.open_at ?? exam?.created_at;
    if (when?.slice(0, 7) === selectedMonth) {
      events.push({ date: when.slice(0, 10), title: exam?.title ?? 'امتحان إلكتروني', subtitle: `الدرجة: ${og.score}/${og.max_score}`, color: 'amber', icon: <TrendingUp className="w-3.5 h-3.5" /> });
    }
  }
  for (const b of behavior) {
    if (b.eval_date?.slice(0, 7) === selectedMonth) {
      events.push({ date: b.eval_date, title: ratingLabel[b.rating ?? ''] ?? 'تقييم سلوك', subtitle: b.note ?? undefined, color: 'rose', icon: <Award className="w-3.5 h-3.5" /> });
    }
  }

  events.sort((a, b) => b.date.localeCompare(a.date));
  if (events.length === 0) return null;

  const colorMap: Record<string, { dot: string; text: string }> = {
    emerald: { dot: 'bg-emerald-400 ring-emerald-500/20', text: 'text-emerald-400' },
    sky: { dot: 'bg-sky-400 ring-sky-500/20', text: 'text-sky-400' },
    amber: { dot: 'bg-amber-400 ring-amber-500/20', text: 'text-amber-400' },
    rose: { dot: 'bg-rose-400 ring-rose-500/20', text: 'text-rose-400' },
  };
  const shown = events.slice(0, 12);

  return (
    <div className="pp-glass p-5">
      <div className="pp-section-title">
        <Footprints className="w-3.5 h-3.5 text-emerald-400" />
        رحلة إنجازك هذا الشهر
      </div>
      <div className="space-y-0">
        {shown.map((ev, i) => {
          const c = colorMap[ev.color] ?? colorMap.emerald;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full ${c.dot} ring-2 mt-1.5`} />
                {i < shown.length - 1 && <div className="w-px flex-1 bg-white/[0.08] min-h-[24px]" />}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={c.text}>{ev.icon}</span>
                    <span className="text-xs font-bold text-white truncate">{ev.title}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0">{formatArabicDate(ev.date)}</span>
                </div>
                {ev.subtitle && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{ev.subtitle}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {events.length > 12 && (
        <p className="text-[10px] text-slate-500 mt-2 text-center">+ {events.length - 12} حدث آخر هذا الشهر</p>
      )}
    </div>
  );
}

function SignatureCard() {
  return (
    <div className="pp-glass p-5 pp-neon-gold relative overflow-hidden">
      <div className="absolute top-0 left-0 w-32 h-32 bg-amber-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-24 h-24 bg-emerald-500/6 rounded-full blur-2xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <PenLine className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs font-black text-amber-400">رسالة مستر عمرو خالد للطالب</span>
        </div>
        <p className="text-sm text-slate-200 leading-relaxed">
          «بني الحبيب، كل درجة تحققها هي لبنة في صرح مستقبلك. لا تستهن بجهدك ولا تيأس من نتيجة، فالنجاح رحلة وليس محطة. وثق في قدرتك على التفوق، وأعلم أنني أؤمن بك وبما يمكنك تحقيقه. اجعل من كل شهر فرصة لتكون أفضل من الأمس.»
        </p>
        <p className="text-xs text-emerald-400/80 font-semibold mt-3 text-center">صَلِّ على النبي محمد ﷺ</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <div className="text-left">
            <p className="text-sm font-black gradient-text">مستر عمرو خالد</p>
            <p className="text-[10px] text-slate-400">مدرس ومؤسس المنصة</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinanceTile({ label, value, color, highlight }: { label: string; value: string; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 text-center ${highlight ? 'bg-white/[0.05] border border-white/[0.08]' : 'bg-white/[0.03]'}`}>
      <p className="text-[9px] text-slate-400 mb-1">{label}</p>
      <p className={`text-sm font-black ${color}`}>{value}</p>
    </div>
  );
}

function GradesSection({ centerGrades, centerExams, onlineGrades, onlineExams, selectedMonth }: { centerGrades: CenterGrade[]; centerExams: CenterExam[]; onlineGrades: OnlineGrade[]; onlineExams: OnlineExam[]; selectedMonth: string }) {
  const monthCenter = centerGrades.filter((g) => {
    const ex = centerExams.find((e) => e.id === g.center_exam_id);
    return ex?.exam_date && ex.exam_date.slice(0, 7) === selectedMonth;
  });
  const monthOnline = onlineGrades.filter((og) => {
    const ex = onlineExams.find((e) => e.id === og.exam_id);
    return ex && (ex.open_at ?? ex.created_at)?.slice(0, 7) === selectedMonth;
  });

  if (monthCenter.length === 0 && monthOnline.length === 0) return null;

  return (
    <div className="pp-glass p-5">
      <div className="pp-section-title">
        <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
        الدرجات
      </div>
      <div className="space-y-3">
        {monthCenter.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-300 mb-2">امتحانات المركز</p>
            <div className="space-y-2">
              {monthCenter.map((g) => {
                const exam = centerExams.find((e) => e.id === g.center_exam_id);
                if (!exam) return null;
                const rating = getGradeRating(g.score, exam.max_score);
                const pct = exam.max_score > 0 ? Math.round((g.score / exam.max_score) * 100) : 0;
                return (
                  <div key={g.id} className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{exam.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{exam.exam_date ? formatArabicDate(exam.exam_date) : '—'}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-bold ${rating.color}`}>{rating.label}</span>
                      <div className="text-left">
                        <span className="text-sm font-black text-white">{g.score}</span>
                        <span className="text-[10px] text-slate-400"> / {exam.max_score}</span>
                        <div className="text-[10px] text-slate-500">{pct}%</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {monthOnline.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-300 mb-2">الامتحانات الإلكترونية</p>
            <div className="space-y-2">
              {monthOnline.map((og) => {
                const exam = onlineExams.find((e) => e.id === og.exam_id);
                if (!exam) return null;
                const rating = getGradeRating(og.score, og.max_score);
                const pct = og.max_score > 0 ? Math.round((og.score / og.max_score) * 100) : 0;
                return (
                  <div key={og.id} className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{exam.title}</p>
                      {exam.subject && <p className="text-[10px] text-slate-400 mt-0.5">{exam.subject}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-bold ${rating.color}`}>{rating.label}</span>
                      <div className="text-left">
                        <span className="text-sm font-black text-white">{og.score}</span>
                        <span className="text-[10px] text-slate-400"> / {og.max_score}</span>
                        <div className="text-[10px] text-slate-500">{pct}%</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AttendanceSection({ records }: { records: (AttendanceRecord & { sessions?: { id: string; title: string } | null })[] }) {
  if (records.length === 0) return null;
  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    present: { label: 'حاضر', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    absent: { label: 'غائب', color: 'text-red-400', bg: 'bg-red-500/10' },
    excused: { label: 'بعذر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    excused_absence: { label: 'بعذر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    late: { label: 'تأخر', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    unrecorded: { label: 'لم يسجل', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  };
  return (
    <div className="pp-glass p-5">
      <div className="pp-section-title">
        <Calendar className="w-3.5 h-3.5 text-emerald-400" />
        سجل الحضور
      </div>
      <div className="space-y-1.5">
        {records.map((rec) => {
          const cfg = statusConfig[rec.status] ?? statusConfig.unrecorded;
          return (
            <div key={rec.id} className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{formatArabicDate(rec.attendance_date)}</p>
                {rec.sessions?.title && <p className="text-[10px] text-slate-400 mt-0.5">{rec.sessions.title}</p>}
                {rec.notes && <p className="text-[10px] text-slate-500 mt-0.5">{rec.notes}</p>}
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.color} shrink-0`}>{cfg.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HomeworkSection({ homework, statuses, studentId }: { homework: Homework[]; statuses: HomeworkStatus[]; studentId: string }) {
  if (homework.length === 0) return null;
  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    done: { label: 'تم', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    complete: { label: 'تم', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    completed: { label: 'تم', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    late: { label: 'متأخر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    incomplete: { label: 'غير مكتمل', color: 'text-red-400', bg: 'bg-red-500/10' },
    not_done: { label: 'لم يتم', color: 'text-red-400', bg: 'bg-red-500/10' },
    absent: { label: 'غائب', color: 'text-slate-400', bg: 'bg-slate-500/10' },
    excused: { label: 'بعذر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    unrecorded: { label: 'لم يسجل', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  };
  return (
    <div className="pp-glass p-5">
      <div className="pp-section-title">
        <BookOpen className="w-3.5 h-3.5 text-sky-400" />
        الواجبات
      </div>
      <div className="space-y-2.5">
        {homework.map((hw) => {
          const status = statuses.find((s) => s.homework_id === hw.id && s.student_id === studentId);
          const cfg = status ? (statusConfig[status.status] ?? statusConfig.unrecorded) : null;
          return (
            <div key={hw.id} className="bg-white/[0.03] rounded-xl p-3.5 border border-white/[0.04]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{hw.title}</p>
                  {hw.description && <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">{hw.description}</p>}
                  <p className="text-[10px] text-slate-500 mt-1.5">التسليم: {formatArabicDate(hw.due_date)}</p>
                  {status?.teacher_note && <p className="text-[10px] text-slate-400 mt-1.5 bg-white/[0.04] rounded-lg px-2 py-1">ملاحظة المعلم: {status.teacher_note}</p>}
                </div>
                {cfg ? (
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.color} shrink-0`}>{cfg.label}</span>
                ) : (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white/[0.03] text-slate-500 shrink-0">لم يسجل</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BehaviorSection({ records }: { records: BehaviorEval[] }) {
  if (records.length === 0) return null;
  const ratingConfig: Record<string, { label: string; color: string; bg: string }> = {
    excellent: { label: 'ممتاز', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    participatory: { label: 'مشارك', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    quiet: { label: 'هادئ', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    needs_attention: { label: 'يحتاج اهتمام', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    disruptive: { label: 'مزعج', color: 'text-red-400', bg: 'bg-red-500/10' },
  };
  return (
    <div className="pp-glass p-5">
      <div className="pp-section-title">
        <Award className="w-3.5 h-3.5 text-rose-400" />
        السلوك
      </div>
      <div className="space-y-2.5">
        {records.map((rec) => {
          const cfg = rec.rating ? (ratingConfig[rec.rating] ?? { label: rec.rating, color: 'text-slate-400', bg: 'bg-slate-500/10' }) : null;
          return (
            <div key={rec.id} className="bg-white/[0.03] rounded-xl p-3.5 border border-white/[0.04]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{formatArabicDate(rec.eval_date)}</p>
                  {rec.note && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{rec.note}</p>}
                  <p className="text-[10px] text-slate-500 mt-1.5">{rec.scope === 'session' ? 'تقييم حصة' : rec.scope === 'monthly' ? 'تقييم شهري' : 'تقييم يومي'}</p>
                </div>
                {cfg && <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.color} shrink-0`}>{cfg.label}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
