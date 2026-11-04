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
import { getMonthLabel, formatCurrency, sanitizeToken } from '@/lib/format';
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
} from '@/lib/types';
import { Award, CalendarCheck, ClipboardCheck, GraduationCap, CircleAlert as AlertCircle, Loader as Loader2, Moon, Sparkles, Sun } from 'lucide-react';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportParentPortalPDF } from '@/lib/pdfExport';
import { computeMonthStats, previousMonthKey } from '@/lib/parentPortalStats';
import { MonthComparison, CalcNote } from '@/components/parent-portal/ParentInsights';
import {
  ProfileCard,
  MonthSelector,
  FinanceCard,
  ReceiptCard,
  CalcNotesCard,
  AchievementsCard,
  GradesList,
  HomeworkList,
  AttendanceList,
  BehaviorList,
  UpcomingExamsCard,
  TeacherMessage,
  SectionNav,
  REPORT_SECTIONS,
  PortalSkeleton,
  type FinanceStatus,
} from '@/components/parent-portal/ReportWidgets';
import { MotivationBox, PerformanceHero, type HeroMetric } from '@/components/parent-portal/PerformanceHero';
import { PerformanceTrendChart } from '@/components/parent-portal/PerformanceTrendChart';
import { PerformanceRadar, AttendanceDonut, AcademicBars } from '@/components/parent-portal/PortalCharts';
import { MonthlyJourney, type JourneyEvent } from '@/components/parent-portal/MonthlyJourney';
import { PORTAL_THEME_CSS, portalBackground } from '@/components/parent-portal/portalTheme';

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

function WelcomeScreen({ studentName, onEnter }: { studentName: string; onEnter: () => void }) {
  const { settings } = useSettings();
  return (
    <div className="min-h-screen bg-[#090d0b] text-[#E6EAE5] flex flex-col items-center justify-center px-6 py-10" dir="rtl" lang="ar">
      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-2xl bg-[#0f1714] border border-[#1f2b25] flex items-center justify-center overflow-hidden shadow-sm">
          {settings.logo_url ? <img src={settings.logo_url} alt="شعار المنصة" className="w-full h-full object-cover" /> : <GraduationCap className="w-9 h-9 text-[#C69B35]" />}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black leading-tight text-white">مرحباً بكم في منصة الخالد التعليمية</h1>
          <p className="text-sm text-[#91A39A] leading-relaxed">نتابع معكم رحلة أبنائنا التعليمية خطوة بخطوة</p>
          <p className="text-sm text-[#C69B35] font-semibold mt-1">صَلِّ على النبي محمد ﷺ</p>
        </div>
        {settings.teacher_photo_url ? (
          <img src={settings.teacher_photo_url} alt={settings.teacher_name} className="w-28 h-28 rounded-full object-cover border border-[#C69B35]/40" />
        ) : null}
        <div className="text-xs text-[#91A39A]">
          <p>تقرير الطالب</p>
          <p className="text-base font-bold text-white mt-1">{studentName}</p>
        </div>
        <button
          type="button"
          onClick={onEnter}
          className="w-full sm:w-auto px-8 py-3 rounded-xl bg-[#087F5B] text-white font-bold hover:bg-[#066747] active:scale-[0.98] transition-all motion-reduce:transition-none"
        >
          عرض تقرير الطالب
        </button>
      </div>
    </div>
  );
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-[#090d0b] flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#0f1714] border border-[#1f2b25] flex items-center justify-center animate-pulse">
          <GraduationCap className="w-8 h-8 text-[#C69B35]" />
        </div>
        <div className="flex items-center gap-2 text-[#91A39A]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{label}</span>
        </div>
      </div>
    </div>
  );
}

function FullScreenError({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="min-h-screen bg-[#090d0b] flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="w-20 h-20 rounded-full border border-[#1f2b25] bg-[#0f1714] flex items-center justify-center">{icon}</div>
        <p className="text-[#91A39A] text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('parent-portal-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('parent-portal-theme', theme);
    } catch {
      // Theme persistence is optional when browser storage is unavailable.
    }
  }, [theme]);

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

  const gradeBreakdown = useMemo(() => {
    const totals = { recitation: { score: 0, max: 0 }, sheet: { score: 0, max: 0 }, exams: { score: 0, max: 0 } };
    for (const grade of data.centerGrades) {
      const exam = data.centerExams.find((item) => item.id === grade.center_exam_id);
      if (!exam || exam.max_score <= 0 || exam.exam_date?.slice(0, 7) !== selectedMonth) continue;
      const category = exam.category === 'recitation' ? 'recitation' : exam.category === 'sheet' ? 'sheet' : 'exams';
      totals[category].score += grade.score;
      totals[category].max += exam.max_score;
    }
    for (const grade of data.onlineGrades) {
      const exam = data.onlineExams.find((item) => item.id === grade.exam_id);
      const when = exam?.open_at ?? exam?.created_at ?? '';
      if (!exam || grade.max_score <= 0 || when.slice(0, 7) !== selectedMonth) continue;
      totals.exams.score += grade.score;
      totals.exams.max += grade.max_score;
    }
    const toRate = (part: { score: number; max: number }): number | null => part.max > 0 ? Math.round((part.score / part.max) * 100) : null;
    const total = Object.values(totals).reduce((sum, part) => ({ score: sum.score + part.score, max: sum.max + part.max }), { score: 0, max: 0 });
    return {
      recitation: { ...totals.recitation, rate: toRate(totals.recitation) },
      sheet: { ...totals.sheet, rate: toRate(totals.sheet) },
      exams: { ...totals.exams, rate: toRate(totals.exams) },
      combined: toRate(total),
    };
  }, [data.centerGrades, data.centerExams, data.onlineGrades, data.onlineExams, selectedMonth]);

  const examAvg = useMemo(() => {
    if (examPoints.length === 0) return null;
    return Math.round(examPoints.reduce((acc, p) => acc + p.pct, 0) / examPoints.length);
  }, [examPoints]);

  const feesDue = monthSubscription?.amount_due ?? 0;
  const feesPaid = monthFilteredPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const feesRemaining = Math.max(0, feesDue - feesPaid);
  const isExempt = monthSubscription?.is_exempt ?? false;
  const financeStatus: FinanceStatus = isExempt
    ? 'exempt'
    : !monthSubscription || feesDue <= 0
      ? 'missing'
      : feesPaid <= 0
        ? 'unpaid'
        : feesRemaining > 0
          ? 'partial'
          : 'paid';

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
        if (!hasGrade) upcoming.push({ title: ex.title ?? 'امتحان إلكتروني', date: openAt, maxScore: ex.total_score, type: 'online' });
      }
    }
    return upcoming.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  }, [data.centerExams, data.onlineExams, data.centerGrades, data.onlineGrades]);

  const badges = useMemo(() => [
    { label: 'حضور مثالي', achieved: attendanceRate >= 90 && totalAttendance > 0 },
    { label: 'واجبات مكتملة', achieved: hwRate >= 80 && hwTotal > 0 },
    { label: 'تفوق دراسي', achieved: examAvg !== null && examAvg >= 85 },
    { label: 'سلوك ممتاز', achieved: monthFilteredBehavior.some((b) => b.rating === 'excellent') },
    { label: 'من المتصدرين', achieved: data.rank !== null && data.rank <= 3 },
    { label: 'رسوم مسددة', achieved: feesRemaining === 0 && feesDue > 0 },
  ], [attendanceRate, totalAttendance, hwRate, hwTotal, examAvg, monthFilteredBehavior, data.rank, feesRemaining, feesDue]);

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
  const trendMonths = useMemo(() => {
    const keys = new Set<string>();
    for (const a of data.attendance) keys.add(a.attendance_date.slice(0, 7));
    for (const h of data.homework) if (h.due_date) keys.add(h.due_date.slice(0, 7));
    for (const e of data.centerExams) if (e.exam_date) keys.add(e.exam_date.slice(0, 7));
    for (const e of data.onlineExams) {
      const when = e.open_at ?? e.created_at;
      if (when) keys.add(when.slice(0, 7));
    }
    return Array.from(keys).filter((key) => key <= selectedMonth).sort().slice(-6);
  }, [data.attendance, data.homework, data.centerExams, data.onlineExams, selectedMonth]);
  const trendData = useMemo(
    () =>
      trendMonths.map((key) => {
        const stats = computeMonthStats(recordsForStats, key);
        return {
          month: getMonthLabel(key),
          attendance: stats.attendance.total > 0 ? stats.attendance.rate : null,
          homework: stats.homework.total > 0 ? stats.homework.rate : null,
          exams: stats.exams.count > 0 ? stats.exams.average : null,
        };
      }),
    [trendMonths, recordsForStats],
  );

  const behaviorRate = currentStats.behavior.rate ?? 0;
  const hasOverallData = examAvg !== null || totalAttendance > 0 || hwTotal > 0 || currentStats.behavior.rated > 0;
  const overallPercentage = useMemo(() => {
    if (!hasOverallData) return null;
    const gradeRate = examAvg ?? 0;
    return Math.round((gradeRate * 0.35 + attendanceRate * 0.25 + hwRate * 0.2 + behaviorRate * 0.2) * 10) / 10;
  }, [attendanceRate, examAvg, hwRate, behaviorRate, hasOverallData]);

  const heroMetrics: HeroMetric[] = [
    { label: 'نسبة الواجبات', value: hwTotal > 0 ? hwRate : null, previous: previousStats.homework.rate ?? null, color: '#2B7BB9', icon: ClipboardCheck },
    { label: 'نسبة الدرجات والامتحانات', value: gradeBreakdown.combined, previous: previousStats.exams.average ?? null, color: '#C69B35', icon: Award },
    { label: 'نسبة الحضور', value: totalAttendance > 0 ? attendanceRate : null, previous: previousStats.attendance.rate ?? null, color: '#087F5B', icon: CalendarCheck },
    { label: 'نسبة السلوك', value: currentStats.behavior.rated > 0 ? behaviorRate : null, previous: previousStats.behavior.rate ?? null, color: '#2B7BB9', icon: Sparkles },
  ];

  const journeyEvents = useMemo((): JourneyEvent[] => {
    const events: JourneyEvent[] = [];
    for (const cg of data.centerGrades) {
      const exam = data.centerExams.find((e) => e.id === cg.center_exam_id);
      if (exam && exam.exam_date?.slice(0, 7) === selectedMonth) {
        const pct = exam.max_score > 0 ? Math.round((cg.score / exam.max_score) * 100) : 0;
        events.push({ date: exam.exam_date, title: exam.title ?? 'امتحان', kind: 'exam', detail: `${pct}% — ${cg.score} من ${exam.max_score} درجة` });
      }
    }
    for (const og of data.onlineGrades) {
      const exam = data.onlineExams.find((e) => e.id === og.exam_id);
      const when = exam?.open_at ?? exam?.created_at ?? '';
      if (when.slice(0, 7) === selectedMonth && og.max_score > 0) {
        const pct = Math.round((og.score / og.max_score) * 100);
        events.push({ date: when.slice(0, 10), title: exam?.title ?? 'امتحان إلكتروني', kind: 'exam', detail: `${pct}% — ${og.score} من ${og.max_score} درجة` });
      }
    }
    for (const rec of monthFilteredAttendance) {
      const isPresent = rec.status === 'present';
      const isLate = rec.status === 'late';
      if (!isPresent && !isLate) {
        events.push({ date: rec.attendance_date, title: rec.status === 'absent' ? 'غياب عن حصة' : 'غيب بعذر', kind: 'attendance', detail: rec.sessions?.title });
      }
    }
    for (const ev of monthFilteredBehavior) {
      if (ev.rating === 'excellent' || ev.rating === 'participatory') {
        events.push({ date: ev.eval_date, title: 'تقييم سلوك إيجابي', kind: 'behavior', detail: ev.note });
      } else if (ev.rating === 'disruptive' || ev.rating === 'needs_attention') {
        events.push({ date: ev.eval_date, title: 'تنبيه سلوك', kind: 'behavior', detail: ev.note });
      }
    }
    if (hasOverallData && overallPercentage !== null) {
      const prevOverall = previousStats.attendance.rate !== null || previousStats.exams.average !== null || previousStats.homework.rate !== null || previousStats.behavior.rate !== null
        ? Math.round((previousStats.exams.average ?? 0) * 0.35 + (previousStats.attendance.rate ?? 0) * 0.25 + (previousStats.homework.rate ?? 0) * 0.2 + (previousStats.behavior.rate ?? 0) * 0.2)
        : null;
      events.push({
        date: `${selectedMonth}-15`,
        title: 'النسبة العامة للشهر',
        kind: 'milestone',
        detail: `${overallPercentage}%`,
        trend: prevOverall !== null ? Math.round((overallPercentage - prevOverall) * 10) / 10 : null,
      });
    }
    return events;
  }, [data.centerGrades, data.centerExams, data.onlineGrades, data.onlineExams, monthFilteredAttendance, monthFilteredBehavior, selectedMonth, hasOverallData, overallPercentage, previousStats]);

  const radarData = [
    { axis: 'التسميع', value: gradeBreakdown.recitation.rate },
    { axis: 'الشيتات', value: gradeBreakdown.sheet.rate },
    { axis: 'الامتحانات', value: gradeBreakdown.exams.rate },
    { axis: 'الحضور', value: totalAttendance > 0 ? attendanceRate : null },
    { axis: 'الواجبات', value: hwTotal > 0 ? hwRate : null },
    { axis: 'السلوك', value: currentStats.behavior.rated > 0 ? behaviorRate : null },
  ];

  const academicBars = [
    { label: 'التسميع', value: gradeBreakdown.recitation.rate, color: '#C69B35' },
    { label: 'الشيتات', value: gradeBreakdown.sheet.rate, color: '#087F5B' },
    { label: 'الامتحانات', value: gradeBreakdown.exams.rate, color: '#2B7BB9' },
  ];

  if (data.monthKey !== selectedMonth) return <PortalSkeleton />;

  return (
    <div className={`pp-portal relative min-h-screen overflow-x-hidden ${theme === 'dark' ? 'pp-dark' : 'pp-light'} text-[#24332D]`} style={portalBackground(theme)} dir="rtl" lang="ar">
      <style>{PORTAL_THEME_CSS}</style>
      <div aria-hidden="true" className="pp-aura pointer-events-none absolute -top-32 left-1/2 h-96 w-96 rounded-full" />
      <header className="sticky top-0 z-30 border-b border-[#E6EAE5] bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 lg:max-w-5xl">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[#E8F5EF]">
              {settings.logo_url ? <img src={settings.logo_url} alt="شعار المنصة" className="h-full w-full object-cover" /> : <GraduationCap className="h-5 w-5 text-[#087F5B]" />}
            </div>
            <div>
              <h1 className="text-sm font-black text-[#24332D]">{settings.platform_name}</h1>
              <p className="text-[10px] text-[#77847D]">بوابة ولي الأمر</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loadingMonth && <Loader2 className="h-4 w-4 animate-spin text-[#087F5B]" />}
            <button
              type="button"
              aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الغامق'}
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              className="pp-dark-control flex h-9 items-center gap-2 rounded-xl border border-[#E6EAE5] bg-white px-3 text-[11px] font-bold text-[#24332D] transition hover:border-[#087F5B]/40 active:scale-95 motion-reduce:transition-none"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-[#C69B35]" /> : <Moon className="h-4 w-4 text-[#087F5B]" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق'}</span>
            </button>
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
                  if (exam) grades.push({ examTitle: exam.title ?? 'امتحان أونلاين', category: 'online', score: og.score, maxScore: og.max_score, passed: og.max_score > 0 && og.score >= og.max_score / 2 });
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
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-28 lg:max-w-5xl">
        <SectionNav items={REPORT_SECTIONS} />
        <ProfileCard student={student} rank={data.rank} totalInGroup={data.totalStudentsInGroup} monthLabel={getMonthLabel(selectedMonth)} />

        <MonthSelector selectedMonth={selectedMonth} onMonthChange={onMonthChange} availableMonths={availableMonths} />

        <div className="space-y-5 lg:grid lg:grid-cols-5 lg:items-start lg:gap-5 lg:space-y-0">
        <div id="payments" className="scroll-mt-32 space-y-5 lg:col-span-2">
          <FinanceCard
            status={financeStatus}
            feesDue={feesDue}
            feesPaid={feesPaid}
            feesRemaining={feesRemaining}
          />
          <ReceiptCard payments={monthFilteredPayments} feesRemaining={monthSubscription ? feesRemaining : null} />
        </div>

        <div className="lg:col-span-3 space-y-5">
          <PerformanceHero
            overall={overallPercentage}
            monthLabel={getMonthLabel(selectedMonth)}
            metrics={heroMetrics}
            gradeBreakdown={gradeBreakdown}
          />
          <MotivationBox overall={overallPercentage} metrics={heroMetrics} />
        </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <CalcNotesCard>
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
          </CalcNotesCard>
        </div>

        <UpcomingExamsCard exams={upcomingExams} />

        <div className="grid gap-5 lg:grid-cols-2">
          <GradesList
            centerGrades={data.centerGrades}
            centerExams={data.centerExams}
            onlineGrades={data.onlineGrades}
            onlineExams={data.onlineExams}
            selectedMonth={selectedMonth}
          />
          <HomeworkList homework={monthFilteredHomework} statuses={data.homeworkStatuses} studentId={student.id} />
        </div>

        <div className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <AttendanceList records={monthFilteredAttendance} />
          </div>
          <div className="lg:col-span-2">
            <BehaviorList records={monthFilteredBehavior} />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <PerformanceRadar data={radarData} theme={theme} />
          <AttendanceDonut counts={{ present: presentCount, absent: absentCount, excused: excusedCount, late: lateCount }} />
        </div>

        <AcademicBars data={academicBars} />

        <PerformanceTrendChart data={trendData} theme={theme} />

        <MonthlyJourney monthKey={selectedMonth} events={journeyEvents} hasOverall={hasOverallData} overall={overallPercentage} />

        <MonthComparison current={currentStats} previous={previousStats} currentKey={selectedMonth} previousKey={prevKey} />

        <AchievementsCard badges={badges.map((badge) => ({ ...badge, criteria: badge.label === 'حضور مثالي' ? 'حضور 90% أو أكثر' : badge.label === 'واجبات مكتملة' ? 'إكمال 80% من الواجبات' : badge.label === 'تفوق دراسي' ? 'متوسط درجات 85% أو أكثر' : badge.label === 'سلوك ممتاز' ? 'وجود تقييم سلوك ممتاز' : badge.label === 'من المتصدرين' ? 'المركز الثالث أو أفضل' : 'سداد الرسوم بالكامل' }))} />

        <TeacherMessage />
      </main>
    </div>
  );
}
