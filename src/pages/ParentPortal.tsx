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
  Activity,
  Footprints,
  BookCheck,
} from 'lucide-react';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportParentPortalPDF } from '@/lib/pdfExport';
import { computeMonthStats, previousMonthKey } from '@/lib/parentPortalStats';
import { MonthComparison, MonthlyTrendChart, CalcNote } from '@/components/parent-portal/ParentInsights';
import MotivationCard from '@/components/parent-portal/MotivationCard';

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

  const examPoints = useMemo(() => {
    const points: { id: string; label: string; pct: number; when: string }[] = [];
    for (const cg of data.centerGrades) {
      const exam = data.centerExams.find((e) => e.id === cg.center_exam_id);
      if (exam && exam.max_score > 0 && exam.exam_date?.slice(0, 7) === selectedMonth) {
        points.push({ id: `center-${cg.id}`, label: exam.title ?? 'امتحان', pct: (cg.score / exam.max_score) * 100, when: exam.exam_date ?? '' });
      }
    }
    for (const og of data.onlineGrades) {
      const exam = data.onlineExams.find((e) => e.id === og.exam_id);
      const when = exam?.open_at ?? exam?.created_at ?? '';
      if (og.max_score > 0 && when.slice(0, 7) === selectedMonth) {
        points.push({ id: `online-${og.id}`, label: exam?.title ?? 'امتحان أونلاين', pct: (og.score / og.max_score) * 100, when });
      }
    }
    return points.sort((a, b) => a.when.localeCompare(b.when));
  }, [data.centerGrades, data.centerExams, data.onlineGrades, data.onlineExams, selectedMonth]);

  const examAvg = useMemo(() => {
    if (examPoints.length === 0) return null;
    return Math.round(examPoints.reduce((acc, p) => acc + p.pct, 0) / examPoints.length);
  }, [examPoints]);

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
    return Math.round((gradeRate * 0.35 + attendanceRate * 0.25 + hwRate * 0.2 + behaviorRate * 0.2) * 10) / 10;
  }, [attendanceRate, examAvg, hwRate, behaviorRate]);

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

  const radarAxes = totalAttendance > 0 && hwTotal > 0 && examAvg !== null && currentStats.behavior.rated > 0
    ? [
        { label: 'الحضور', value: attendanceRate },
        { label: 'الواجبات', value: hwRate },
        { label: 'الامتحانات', value: examAvg },
        { label: 'السلوك', value: behaviorRate },
      ]
    : null;

  if (data.monthKey !== selectedMonth) return <FullScreenLoader label="جاري تحميل بيانات الشهر..." />;

  return (
    <div className="pp-report min-h-screen text-white" dir="rtl" lang="ar">
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
      <main className="pp-report-main relative max-w-2xl md:max-w-4xl lg:max-w-6xl mx-auto px-3 sm:px-5 py-5 sm:py-8 space-y-4 sm:space-y-6 pb-32">
        {/* Profile header */}
        <ProfileHeader student={student} rank={data.rank} totalInGroup={data.totalStudentsInGroup} monthLabel={getMonthLabel(selectedMonth)} />

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
              <div className="mb-4">
                {feesRemaining === 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> مسدد بالكامل
                  </span>
                ) : feesPaid > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-xs font-bold">
                    <Clock className="w-3.5 h-3.5" /> مسدد جزئياً
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/25 text-rose-400 text-xs font-bold">
                    <AlertCircle className="w-3.5 h-3.5" /> لم يسدد
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <FinanceTile label="إجمالي الرسوم" value={formatCurrency(feesDue)} color="text-white" />
                <FinanceTile label="المبلغ المدفوع" value={formatCurrency(feesPaid)} color="text-emerald-400" />
                <FinanceTile label="المتبقي" value={formatCurrency(feesRemaining)} color={feesRemaining > 0 ? 'text-rose-400' : 'text-emerald-400'} highlight />
              </div>
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

          {monthFilteredPayments.length === 0 && !isExempt && feesDue > 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center mt-3">
              <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center text-slate-500 mb-2">
                <Wallet className="w-5 h-5" />
              </div>
              <p className="text-xs text-slate-400">لم يتم تسجيل مدفوعات لهذا الشهر</p>
            </div>
          )}
        </div>

        <section className="pp-glass p-5 pp-neon-emerald">
          <div className="pp-section-title">
            <Receipt className="w-3.5 h-3.5 text-cyan-300" />
            تفاصيل إيصال الدفع
          </div>
          {monthFilteredPayments.length > 0 ? (
            <div className="space-y-3">
              {monthFilteredPayments.map((p) => (
                <article key={p.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-white">{formatCurrency(p.amount)} <span className="text-xs font-bold text-slate-400">ج.م</span></p>
                      <p className="mt-1 text-[10px] text-slate-400">تاريخ الدفع: {formatArabicDate(p.payment_date)}</p>
                    </div>
                    <span className="pp-badge border-emerald-500/25 bg-emerald-500/10 text-emerald-300">مسجل</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-[10px] text-slate-400 sm:grid-cols-3">
                    <span>رقم الإيصال: {p.receipt_number ?? 'غير مسجل'}</span>
                    <span>استلم: {p.recorded_by ?? 'غير مسجل'}</span>
                    <span>واتساب: غير مسجل</span>
                  </div>
                  {p.note && <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] text-slate-300">{p.note}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-center text-xs text-slate-500">لا يوجد إيصال مسجل لهذا الشهر</p>
          )}
        </section>

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
          trendPoints={trendPoints}
        />

        <MotivationCard overallPercentage={overallPercentage} />

        {/* Month selector */}
        <MonthSelector selectedMonth={selectedMonth} onMonthChange={onMonthChange} availableMonths={availableMonths} />

        {/* Four detailed performance cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PerformanceCard
            icon={<CheckCircle2 className="w-4 h-4" />}
            title="الحضور"
            rate={attendanceRate}
            color="emerald"
            details={
              <div className="space-y-1 text-[10px] text-slate-400">
                <div className="flex justify-between"><span>حاضر</span><span className="text-emerald-400 font-bold">{presentCount}</span></div>
                <div className="flex justify-between"><span>غائب</span><span className="text-red-400 font-bold">{absentCount}</span></div>
                <div className="flex justify-between"><span>بعذر</span><span className="text-sky-400 font-bold">{excusedCount}</span></div>
                <div className="flex justify-between"><span>تأخر</span><span className="text-amber-300 font-bold">{lateCount}</span></div>
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
                <p className="text-[10px] text-slate-500">غير مسجل هذا الشهر</p>
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="pp-glass p-5">
            <div className="pp-section-title">
              <Target className="w-3.5 h-3.5 text-violet-300" />
              بصمة الأداء
            </div>
            {radarAxes ? (
              <PerformanceRadar axes={radarAxes} />
            ) : (
              <p className="text-[11px] text-slate-500 py-6 text-center">تظهر بصمة الأداء عند توفر بيانات الحضور والواجبات والامتحانات والسلوك لهذا الشهر</p>
            )}
          </div>
          <div className="pp-glass p-5">
            <div className="pp-section-title">
              <Calendar className="w-3.5 h-3.5 text-sky-300" />
              خريطة الحضور
            </div>
            <AttendanceStrip records={monthFilteredAttendance} />
            <div className="flex flex-wrap gap-3 mt-4 text-[10px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />حاضر</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400" />غائب</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />بعذر</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-300" />تأخر</span>
            </div>
          </div>
        </div>

        {/* Next step suggestion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HomeworkRing done={hwDone} total={hwTotal} rate={hwRate} />
          <ExamTrendChart points={examPoints} />
        </div>

        {radarAxes && <StrengthsPanel axes={radarAxes} />}

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

        <DigitalAchievementCard
          student={student}
          monthLabel={getMonthLabel(selectedMonth)}
          overallPercentage={overallPercentage}
          rank={data.rank}
          attendanceRate={attendanceRate}
          hwRate={hwRate}
          examAvg={examAvg}
          behaviorRate={behaviorRate}
        />

        <TeacherMessage />
      </main>


    </div>
  );
}

/* ─── Sub-components ─── */

function TeacherMessage() {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[#D6B56D]/30 bg-[linear-gradient(135deg,rgba(214,181,109,0.12),rgba(17,24,39,0.94)_42%,rgba(16,185,129,0.08))] p-5 sm:p-7 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="absolute -top-20 -left-12 h-44 w-44 rounded-full bg-[#D6B56D]/10 blur-3xl" />
      <div className="absolute -bottom-20 -right-10 h-44 w-44 rounded-full bg-[#10B981]/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#D6B56D]/30 bg-[#D6B56D]/10">
            <Heart className="h-5 w-5 text-[#D6B56D]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D6B56D]">رسالة خاصة</p>
            <h3 className="mt-1 text-base font-black text-[#F8FAFC]">رسالة مستر عمرو خالد للطالب</h3>
          </div>
        </div>
        <p className="mt-5 text-sm font-medium leading-[2.05] text-[#F8FAFC]">
          وفي النهاية، افتكر دايمًا إن النجاح مش خطوة واحدة، النجاح مشوار، وكل يوم بتتقدم فيه هو إنجاز جديد. أنا مستني أشوفك دايمًا في أحسن مكان، وواثق إنك تقدر تحقق أكتر وأكتر. ربنا يوفقك ويفرحنا بيك.
        </p>
        <div className="mt-6 border-t border-white/10 pt-5 text-center">
          <p className="text-sm font-bold text-[#D6B56D]">صلّوا على النبي ﷺ</p>
          <p className="mt-3 text-xs font-black tracking-wide text-[#F8FAFC]">طلاب الخالد غير أي حد</p>
          <p className="mt-2 text-base font-black text-[#D6B56D]">مستر عمرو خالد</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">مدرس ومؤسس المنصة وصاحب سلسلة الخالد في العلوم والأحياء</p>
        </div>
      </div>
    </section>
  );
}

function ProfileHeader({ student, rank, totalInGroup, monthLabel }: { student: ParentData['student']; rank: number | null; totalInGroup: number; monthLabel: string }) {
  const initials = student.name?.charAt(0) ?? '؟';
  return (
    <section className="pp-profile pp-glass p-5 sm:p-7">
      <div className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <div className="pp-avatar h-[76px] w-[76px] sm:h-[88px] sm:w-[88px] rounded-[26px] flex items-center justify-center text-3xl font-black text-white">{initials}</div>
          <span className="absolute -bottom-1 -left-1 h-4 w-4 rounded-full border-2 border-[#0b0d10] bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.8)]" />
          {rank !== null && rank <= 3 && <div className="absolute -top-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 shadow-lg ring-2 ring-[#0b0d10]"><Trophy className="h-4 w-4 text-white" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300/80">ملف الطالب</p>
            <span className="h-1 w-1 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-semibold text-emerald-300">تقرير مباشر</span>
          </div>
          <h2 className="mt-1 truncate text-xl sm:text-2xl font-black tracking-tight text-white">{student.name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {student.grade_name && <span className="pp-badge border-emerald-500/25 text-emerald-300 bg-emerald-500/10">{student.grade_name}</span>}
            {student.group_name && <span className="pp-badge border-cyan-500/25 text-cyan-300 bg-cyan-500/10">{student.group_name}</span>}
            <span className="pp-badge border-amber-500/25 text-amber-300 bg-amber-500/10"><Calendar className="h-2.5 w-2.5" />{monthLabel}</span>
            <span className={`pp-badge ${student.status === 'active' ? 'border-emerald-500/25 text-emerald-300 bg-emerald-500/10' : 'border-white/10 text-slate-400 bg-white/[0.04]'}`}>{student.status === 'active' ? 'نشط' : 'غير نشط'}</span>
          </div>
          {rank !== null && totalInGroup > 0 && <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-amber-200"><Target className="h-3 w-3 text-amber-400" />{rankLabel(rank)} من المجموعة</div>}
        </div>
      </div>
    </section>
  );
}

function HeroCard({ overallPercentage, rank, totalInGroup, monthLabel, motivation, attendanceRate, hwRate, examAvg, behaviorRate, trendPoints }: {
  overallPercentage: number;
  rank: number | null;
  totalInGroup: number;
  monthLabel: string;
  motivation: { title: string; subtitle: string };
  attendanceRate: number;
  hwRate: number;
  examAvg: number | null;
  behaviorRate: number;
  trendPoints: { monthKey: string; attendance: number | null; exams: number | null }[];
}) {
  const pct = Math.min(100, Math.round(overallPercentage));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;
  const ringColor = overallPercentage >= 90 ? '#10b981' : overallPercentage >= 75 ? '#34d399' : overallPercentage >= 60 ? '#f59e0b' : '#f43f5e';

  return (
    <section className="pp-hero pp-glass p-5 sm:p-7 pp-neon-gold relative overflow-hidden" aria-label={`المستوى العام لشهر ${monthLabel}`}>
      <div className="absolute -top-24 right-1/3 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
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
                <Trophy className="w-2.5 h-2.5" />{rankLabel(rank)}
              </span>
            )}
          </div>
          <p className="text-sm font-black text-white leading-snug">{motivation.title}</p>
          <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{motivation.subtitle}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniIndicator label="حضور" value={attendanceRate} color="#34d399" />
            <MiniIndicator label="واجب" value={hwRate} color="#22d3ee" />
            <MiniIndicator label="درجات" value={examAvg ?? 0} color="#f5c76b" dimmed={examAvg === null} />
            <MiniIndicator label="سلوك" value={behaviorRate} color="#fb7185" dimmed={behaviorRate === 0} />
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-3">
            <span className="text-[10px] font-bold text-slate-500">مقارنة الشهور</span>
            <Sparkline points={trendPoints.map((point) => point.exams ?? point.attendance ?? 0)} />
            <span className="mr-auto text-[10px] text-slate-400">آخر {trendPoints.length} أشهر</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function rankLabel(rank: number | null): string {
  const labels = ['المركز الأول', 'المركز الثاني', 'المركز الثالث', 'المركز الرابع', 'المركز الخامس', 'المركز السادس', 'المركز السابع', 'المركز الثامن', 'المركز التاسع', 'المركز العاشر'];
  return rank && labels[rank - 1] ? labels[rank - 1] : 'المركز الرسمي غير متاح';
}

function Sparkline({ points }: { points: number[] }) {
  const values = points.length > 1 ? points : [0, 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / range) * 22}`).join(' ');
  return <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 min-w-0 flex-1 overflow-visible" aria-label="منحنى الأداء"><defs><linearGradient id="pp-sparkline" x1="0" x2="1"><stop offset="0" stopColor="#D6B56D" /><stop offset="1" stopColor="#34D399" /></linearGradient></defs><polyline points={coordinates} fill="none" stroke="url(#pp-sparkline)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px rgba(52,211,153,.55))' }} /></svg>;
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

function DigitalAchievementCard({ student, monthLabel, overallPercentage, rank, attendanceRate, hwRate, examAvg, behaviorRate }: {
  student: ParentData['student'];
  monthLabel: string;
  overallPercentage: number;
  rank: number | null;
  attendanceRate: number;
  hwRate: number;
  examAvg: number | null;
  behaviorRate: number;
}) {
  return (
    <section className="pp-glass p-5 border border-amber-400/20 bg-gradient-to-br from-slate-950 via-emerald-950/40 to-black relative overflow-hidden">
      <div className="absolute -top-16 -left-16 w-40 h-40 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-amber-300/80 font-bold">Achievement Card</p>
            <h3 className="text-lg font-black text-white mt-1">بطاقة الإنجاز الشهرية</h3>
            <p className="text-[11px] text-slate-400 mt-1">{monthLabel} · بيانات محفوظة من سجل الطالب</p>
          </div>
          <Award className="w-7 h-7 text-amber-300" />
        </div>
        <div className="flex items-center gap-3 border-b border-white/[0.08] pb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-xl font-black text-white">{student.name?.charAt(0) ?? '؟'}</div>
          <div>
            <p className="text-base font-black text-white">{student.name}</p>
            <p className="text-[11px] text-slate-400">{student.grade_name ?? 'الطالب'} · {student.group_name ?? 'المجموعة غير محددة'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <AchievementMetric label="المستوى العام" value={`${Math.round(overallPercentage)}%`} />
          <AchievementMetric label="الترتيب الرسمي" value={rankLabel(rank)} />
          <AchievementMetric label="الحضور" value={`${Math.round(attendanceRate)}%`} />
          <AchievementMetric label="الواجبات" value={`${Math.round(hwRate)}%`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-300">
          <span className="px-2 py-1 rounded-lg bg-amber-400/10 border border-amber-400/15">الامتحانات: {examAvg === null ? 'غير متاح' : `${Math.round(examAvg)}%`}</span>
          <span className="px-2 py-1 rounded-lg bg-emerald-400/10 border border-emerald-400/15">السلوك: {Math.round(behaviorRate)}%</span>
        </div>
      </div>
    </section>
  );
}

function AchievementMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-2.5">
      <p className="text-[9px] text-slate-500 mb-1">{label}</p>
      <p className="text-xs font-black text-white leading-tight">{value}</p>
    </div>
  );
}

function HomeworkRing({ done, total, rate }: { done: number; total: number; rate: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="pp-glass p-5">
      <div className="pp-section-title">
        <BookCheck className="w-3.5 h-3.5 text-sky-300" />
        إنجاز الواجبات
      </div>
      {total > 0 ? (
        <div className="flex items-center gap-5">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(248,250,252,0.08)" strokeWidth="8" />
              <circle
                cx="50" cy="50" r={radius} fill="none" stroke="#60A5FA" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={circumference - (rate / 100) * circumference}
                style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-[#F8FAFC]">{rate}%</div>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            <span className="font-black text-[#F8FAFC]">{done}</span> من {total} واجب تم إنجازه هذا الشهر
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 py-6 text-center">لا توجد واجبات محفوظة لهذا الشهر</p>
      )}
    </div>
  );
}

function ExamTrendChart({ points }: { points: { id: string; label: string; pct: number }[] }) {
  if (points.length === 0) {
    return (
      <div className="pp-glass p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 text-amber-400">
            <Activity className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold text-white">أداء الامتحانات</span>
        </div>
        <p className="text-[10px] text-slate-500">لا توجد درجات امتحانات محفوظة لهذا الشهر</p>
      </div>
    );
  }
  const avg = Math.round(points.reduce((acc, p) => acc + p.pct, 0) / points.length);
  const best = points.reduce((a, b) => (a.pct >= b.pct ? a : b));
  return (
    <div className="pp-glass p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 text-amber-400">
          <Activity className="w-4 h-4" />
        </div>
        <span className="text-xs font-bold text-white">أداء الامتحانات</span>
        <span className="pp-badge border-amber-500/20 text-amber-400 bg-amber-500/10 shrink-0 mr-auto">{points.length} امتحان</span>
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-2xl font-black text-white">{avg}</span>
        <span className="text-sm text-slate-400">% المتوسط</span>
      </div>
      <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden mb-3">
        <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-700 ease-out" style={{ width: `${Math.min(100, avg)}%` }} />
      </div>
      <div className="space-y-1 text-[10px] text-slate-400">
        <div className="flex justify-between"><span>أعلى نتيجة</span><span className="text-amber-400 font-bold">{best.label} — {Math.round(best.pct)}%</span></div>
      </div>
    </div>
  );
}

function StrengthsPanel({ axes }: { axes: { label: string; value: number }[] }) {
  const sorted = [...axes].sort((a, b) => b.value - a.value);
  const strongest = sorted[0];
  const focus = sorted[sorted.length - 1];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="pp-glass p-5 border border-[#10B981]/25">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#10B981] mb-2">نقطة قوتك</p>
        <p className="text-lg font-black text-[#F8FAFC]">{strongest.label}</p>
        <p className="text-xs text-slate-400 mt-1">{Math.round(strongest.value)}% في هذا الشهر</p>
      </div>
      <div className="pp-glass p-5 border border-[#FB7185]/25">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#FB7185] mb-2">أولوية التحسين</p>
        <p className="text-lg font-black text-[#F8FAFC]">{focus.label}</p>
        <p className="text-xs text-slate-400 mt-1">{Math.round(focus.value)}% في هذا الشهر</p>
      </div>
    </div>
  );
}

function PerformanceRadar({ axes }: { axes: { label: string; value: number }[] }) {
  const size = 240;
  const center = size / 2;
  const radius = 72;
  const angles = [-90, 0, 90, 180];
  const toPoint = (value: number, angle: number) => {
    const rad = (angle * Math.PI) / 180;
    const d = (radius * value) / 100;
    return { x: center + d * Math.cos(rad), y: center + d * Math.sin(rad) };
  };
  const ringPoints = (scale: number) => angles.map((a) => toPoint(scale, a)).map((p) => `${p.x},${p.y}`).join(' ');
  const dataPoints = axes.map((a, i) => toPoint(Math.min(100, Math.max(0, a.value)), angles[i]));
  const dataPath = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block w-full max-w-[260px] mx-auto" role="img" aria-label="بصمة الأداء">
      <defs>
        <linearGradient id="pp-radar-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#10B981" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#60A5FA" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {[25, 50, 75, 100].map((s) => (
        <polygon key={s} points={ringPoints(s)} fill="none" stroke="rgba(248,250,252,0.08)" strokeWidth="1" />
      ))}
      {angles.map((a) => {
        const p = toPoint(100, a);
        return <line key={a} x1={center} y1={center} x2={p.x} y2={p.y} stroke="rgba(248,250,252,0.08)" strokeWidth="1" />;
      })}
      <polygon points={dataPath} fill="url(#pp-radar-fill)" stroke="#2DD4BF" strokeWidth="2" strokeLinejoin="round" style={{ transition: 'all 0.9s cubic-bezier(0.4,0,0.2,1)' }} />
      {dataPoints.map((p, i) => (
        <circle key={axes[i].label} cx={p.x} cy={p.y} r="4" fill="#F8FAFC" stroke="#10B981" strokeWidth="2" />
      ))}
      {axes.map((a, i) => {
        const p = toPoint(112, angles[i]);
        return (
          <text key={a.label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill="#CBD5E1" style={{ fontSize: 11, fontWeight: 700 }}>
            {`${a.label} ${Math.round(a.value)}%`}
          </text>
        );
      })}
    </svg>
  );
}

function AttendanceStrip({ records }: { records: { id: string; status: string; attendance_date: string }[] }) {
  if (records.length === 0) {
    return <p className="text-[11px] text-slate-500 py-6 text-center">لا توجد سجلات حضور محفوظة لهذا الشهر</p>;
  }
  const toneByStatus: Record<string, string> = {
    present: 'bg-emerald-400 shadow-emerald-400/30',
    absent: 'bg-rose-400 shadow-rose-400/30',
    excused: 'bg-sky-400 shadow-sky-400/30',
    excused_absence: 'bg-sky-400 shadow-sky-400/30',
    late: 'bg-amber-300 shadow-amber-300/30',
  };
  const sorted = [...records].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map((r, i) => (
        <span
          key={r.id}
          title={formatArabicDate(r.attendance_date)}
          style={{ animationDelay: `${i * 40}ms` }}
          className={`w-4 h-4 rounded-md shadow-md animate-fade-in ${toneByStatus[r.status] ?? 'bg-slate-600 shadow-slate-600/30'}`}
        />
      ))}
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
    excused: { label: 'بعذر', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    excused_absence: { label: 'بعذر', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    late: { label: 'تأخر', color: 'text-amber-300', bg: 'bg-amber-400/10' },
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
    excused: { label: 'بعذر', color: 'text-sky-400', bg: 'bg-sky-500/10' },
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
