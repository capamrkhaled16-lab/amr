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
import { Award, CalendarCheck, ClipboardCheck, GraduationCap, CircleAlert as AlertCircle, Loader as Loader2, Sparkles } from 'lucide-react';
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
} from '@/components/parent-portal/ReportWidgets';
import { PerformanceHero, type HeroMetric } from '@/components/parent-portal/PerformanceHero';

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
    <div className="min-h-screen bg-[#F7F8F5] text-[#24332D] flex flex-col items-center justify-center px-6 py-10" dir="rtl" lang="ar">
      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-2xl bg-white border border-[#C69B35]/40 flex items-center justify-center overflow-hidden shadow-sm">
          {settings.logo_url ? <img src={settings.logo_url} alt="شعار المنصة" className="w-full h-full object-cover" /> : <GraduationCap className="w-9 h-9 text-[#087F5B]" />} 
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black leading-tight">مرحباً بكم في منصة الخالد التعليمية</h1>
          <p className="text-sm text-[#77847D] leading-relaxed">نتابع معكم رحلة أبنائنا التعليمية خطوة بخطوة</p>
          <p className="text-sm text-[#087F5B] font-semibold mt-1">صَلِّ على النبي محمد ﷺ</p>
        </div>
        {settings.teacher_photo_url ? (
          <img src={settings.teacher_photo_url} alt={settings.teacher_name} className="w-28 h-28 rounded-full object-cover border border-[#C69B35]/40" />
        ) : null}
        <div className="text-xs text-[#77847D]">
          <p>تقرير الطالب</p>
          <p className="text-base font-bold text-[#24332D] mt-1">{studentName}</p>
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
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#E8F5EF] border border-[#E6EAE5] flex items-center justify-center animate-pulse">
          <GraduationCap className="w-8 h-8 text-[#087F5B]" />
        </div>
        <div className="flex items-center gap-2 text-[#77847D]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{label}</span>
        </div>
      </div>
    </div>
  );
}

function FullScreenError({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="w-20 h-20 rounded-full border border-[#E6EAE5] bg-white flex items-center justify-center">{icon}</div>
        <p className="text-[#5F6B65] text-sm leading-relaxed">{message}</p>
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

  const categoryRates = useMemo(() => {
    const categories = { recitation: [] as number[], sheet: [] as number[] };
    for (const grade of data.centerGrades) {
      const exam = data.centerExams.find((item) => item.id === grade.center_exam_id);
      if (!exam || exam.max_score <= 0 || exam.exam_date?.slice(0, 7) !== selectedMonth) continue;
      const category = exam.category === 'recitation' ? 'recitation' : exam.category === 'sheet' ? 'sheet' : null;
      if (category) categories[category].push((grade.score / exam.max_score) * 100);
    }
    return {
      recitation: categories.recitation.length > 0 ? Math.round(categories.recitation.reduce((sum, value) => sum + value, 0) / categories.recitation.length) : null,
      sheet: categories.sheet.length > 0 ? Math.round(categories.sheet.reduce((sum, value) => sum + value, 0) / categories.sheet.length) : null,
    };
  }, [data.centerGrades, data.centerExams, selectedMonth]);

  const examAvg = useMemo(() => {
    if (examPoints.length === 0) return null;
    return Math.round(examPoints.reduce((acc, p) => acc + p.pct, 0) / examPoints.length);
  }, [examPoints]);

  const feesDue = monthSubscription?.amount_due ?? 0;
  const feesPaid = monthFilteredPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const feesRemaining = Math.max(0, feesDue - feesPaid);
  const isExempt = monthSubscription?.is_exempt ?? false;
  const collectionRate = feesDue > 0 ? Math.min(100, Math.round((feesPaid / feesDue) * 100)) : 0;

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

  const behaviorRate = currentStats.behavior.rate ?? 0;
  const hasOverallData = examAvg !== null || totalAttendance > 0 || hwTotal > 0 || currentStats.behavior.rated > 0;
  const overallPercentage = useMemo(() => {
    if (!hasOverallData) return null;
    const gradeRate = examAvg ?? 0;
    return Math.round((gradeRate * 0.35 + attendanceRate * 0.25 + hwRate * 0.2 + behaviorRate * 0.2) * 10) / 10;
  }, [attendanceRate, examAvg, hwRate, behaviorRate, hasOverallData]);

  const heroMetrics: HeroMetric[] = [
    { label: 'نسبة الواجبات', value: hwTotal > 0 ? hwRate : null, previous: previousStats.homework.rate ?? null, color: '#2B7BB9', icon: ClipboardCheck },
    { label: 'نسبة التلاوة', value: categoryRates.recitation, previous: null, color: '#C69B35', icon: Award },
    { label: 'نسبة الأوراق', value: categoryRates.sheet, previous: null, color: '#087F5B', icon: ClipboardCheck },
    { label: 'نسبة الدرجات والامتحانات', value: examAvg, previous: previousStats.exams.average ?? null, color: '#C69B35', icon: Award },
    { label: 'نسبة الحضور', value: totalAttendance > 0 ? attendanceRate : null, previous: previousStats.attendance.rate ?? null, color: '#087F5B', icon: CalendarCheck },
    { label: 'نسبة السلوك', value: currentStats.behavior.rated > 0 ? behaviorRate : null, previous: previousStats.behavior.rate ?? null, color: '#2B7BB9', icon: Sparkles },
  ];

  if (data.monthKey !== selectedMonth) return <FullScreenLoader label="جاري تحميل بيانات الشهر..." />;

  return (
    <div className="min-h-screen bg-[#F7F8F5] text-[#24332D]" dir="rtl" lang="ar">
      <header className="sticky top-0 z-30 border-b border-[#E6EAE5] bg-white/95 backdrop-blur-md">
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

        <div id="payments" className="scroll-mt-32 space-y-5">
          <FinanceCard
            status={isExempt ? 'exempt' : !monthSubscription ? 'missing' : feesDue > 0 && feesPaid === 0 ? 'unpaid' : feesRemaining > 0 ? 'partial' : 'paid'}
            feesDue={feesDue}
            feesPaid={feesPaid}
            feesRemaining={feesRemaining}
            collectionRate={collectionRate}
          />
          <ReceiptCard payments={monthFilteredPayments} feesRemaining={monthSubscription ? feesRemaining : null} />
        </div>

        <PerformanceHero
          overall={overallPercentage}
          monthLabel={getMonthLabel(selectedMonth)}
          metrics={heroMetrics}
        />

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

        <div className="grid gap-5 lg:grid-cols-2">
          <AttendanceList records={monthFilteredAttendance} />
          <BehaviorList records={monthFilteredBehavior} />
        </div>

        <MonthComparison current={currentStats} previous={previousStats} currentKey={selectedMonth} previousKey={prevKey} />

        <AchievementsCard badges={badges.map((badge) => ({ ...badge, criteria: badge.label === 'حضور مثالي' ? 'حضور 90% أو أكثر' : badge.label === 'واجبات مكتملة' ? 'إكمال 80% من الواجبات' : badge.label === 'تفوق دراسي' ? 'متوسط درجات 85% أو أكثر' : badge.label === 'سلوك ممتاز' ? 'وجود تقييم سلوك ممتاز' : badge.label === 'من المتصدرين' ? 'المركز الثالث أو أفضل' : 'سداد الرسوم بالكامل' }))} />

        <TeacherMessage />
      </main>
    </div>
  );
}
