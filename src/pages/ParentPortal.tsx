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
} from 'lucide-react';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportParentPortalPDF } from '@/lib/pdfExport';

type LoadState = 'loading' | 'success' | 'error' | 'notfound';

interface ParentData {
  student: Student & { group_name?: string; grade_name?: string; stage_name?: string };
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

      const [attendance, centerGrades, centerExams, onlineGrades, onlineExams, payments, subscriptions, homework, behavior, hofEntries] = await Promise.all([
        fetchAttendanceForStudent(student.id),
        fetchCenterGradesByStudent(student.id),
        fetchCenterExamsByStudent(student.id),
        fetchOnlineGradesByStudent(student.id),
        fetchOnlineExamsByStudent(student.id),
        fetchPayments(student.id, monthKey),
        fetchStudentMonthlySubscriptions(student.id),
        fetchHomework(groupId, true, monthKey),
        fetchBehaviorEvals(student.id),
        fetchHallOfFame(groupId, 100),
      ]);

      const hwStatusArrays = await Promise.all(
        homework.map((hw) => fetchHomeworkStatuses(hw.id).catch(() => []))
      );
      const hwStatuses: HomeworkStatus[] = [];
      for (const statuses of hwStatusArrays) {
        const studentStatus = statuses.find((s) => s.student_id === student.id);
        if (studentStatus) hwStatuses.push(studentStatus);
      }

      let groupData: { name?: string; grade_level?: { name?: string; stage?: { name?: string } } } | null = null;
      try {
        const { data: gd } = await supabase
          .from('groups')
          .select('name, grade_level:grade_levels(name, stage:academic_stages(name))')
          .eq('id', groupId)
          .maybeSingle();
        groupData = gd as { name?: string; grade_level?: { name?: string; stage?: { name?: string } } } | null;
      } catch { /* ignore */ }

      const ranked = canonicalRankEntries(hofEntries ?? []);
      const studentRank = ranked.find((e) => e.id === student.id)?.rank ?? null;

      const enrichedStudent = {
        ...student,
        group_name: groupData?.name,
        grade_name: groupData?.grade_level?.name,
        stage_name: groupData?.grade_level?.stage?.name,
      };

      if (reqId === reqIdRef.current) {
        setData({
          student: enrichedStudent,
          attendance: attendance ?? [],
          centerGrades: centerGrades ?? [],
          centerExams: centerExams ?? [],
          onlineGrades: onlineGrades ?? [],
          onlineExams: onlineExams ?? [],
          payments: payments ?? [],
          subscriptions: subscriptions ?? [],
          homework: homework ?? [],
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

  return <PortalContent data={data} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} loadingMonth={loadingMonth} />;
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
  const phone = student.parent_phone ?? student.phone ?? '';

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
  const excusedCount = monthFilteredAttendance.filter((a) => a.status === 'excused' || a.status === 'excused_absence').length;
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
      if (exam && exam.max_score > 0) allGrades.push({ score: cg.score, max: exam.max_score });
    }
    for (const og of data.onlineGrades) {
      if (og.max_score > 0) allGrades.push({ score: og.score, max: og.max_score });
    }
    if (allGrades.length === 0) return null;
    return Math.round(allGrades.reduce((acc, g) => acc + (g.score / g.max) * 100, 0) / allGrades.length);
  }, [data.centerGrades, data.centerExams, data.onlineGrades]);

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

  // Encouraging message
  const encouragement = useMemo(() => {
    if (attendanceRate >= 90 && (examAvg ?? 0) >= 85) return 'أداء رائع هذا الشهر! استمر في التألق';
    if (attendanceRate >= 80) return 'حضور ملتزم — أنت على الطريق الصحيح';
    if (hwRate >= 80) return 'إنجاز ممتاز في الواجبات! واصل العطاء';
    if (examAvg !== null && examAvg >= 75) return 'نتائج جيدة — مزيد من التركيز يحلق بك للأعلى';
    if (feesRemaining === 0 && feesDue > 0) return 'رسوم الشهر مسددة بالكامل. شكراً لالتزامكم';
    return 'كل خطوة تبني المستقبل — واصلوا المثابرة';
  }, [attendanceRate, examAvg, hwRate, feesRemaining, feesDue]);

  const whatsappUrl = phone
    ? `https://wa.me/${phone.replace(/[^0-9]/g, '')}`
    : '#';

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
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white">منصة الخالد التعليمية</h1>
                <p className="text-[10px] text-slate-400">بوابة ولي الأمر</p>
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
      <main className="relative max-w-2xl mx-auto px-4 py-5 space-y-5 pb-32">
        {/* Profile header */}
        <ProfileHeader student={student} rank={data.rank} totalInGroup={data.totalStudentsInGroup} />

        {/* Encouraging card */}
        <EncouragingCard message={encouragement} attendanceRate={attendanceRate} hwRate={hwRate} examAvg={examAvg} />

        {/* Month selector */}
        <MonthSelector selectedMonth={selectedMonth} onMonthChange={onMonthChange} availableMonths={availableMonths} />

        {/* Progress rings */}
        <div className="pp-glass p-5">
          <div className="pp-section-title">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            نظرة عامة
          </div>
          <div className="flex justify-around items-start gap-2">
            <AnimatedRing value={attendanceRate} label="الحضور" sublabel={`${presentCount} من ${totalAttendance}`} color="#10b981" />
            <AnimatedRing value={hwRate} label="الواجبات" sublabel={`${hwDone} من ${hwTotal}`} color="#0ea5e9" />
            <AnimatedRing value={examAvg ?? 0} label="المستوى" sublabel={examAvg === null ? 'لا توجد درجات' : `${examAvg}%`} color="#f59e0b" dimmed={examAvg === null} />
          </div>
        </div>

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

        {/* Quick stats grid */}
        <div className="grid grid-cols-4 gap-2.5">
          <MiniStat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="حضور" value={presentCount} color="emerald" />
          <MiniStat icon={<X className="w-3.5 h-3.5" />} label="غياب" value={absentCount} color="red" />
          <MiniStat icon={<Clock className="w-3.5 h-3.5" />} label="تأخر" value={lateCount} color="sky" />
          <MiniStat icon={<BookOpen className="w-3.5 h-3.5" />} label="واجبات" value={hwDone} color="amber" />
        </div>

        {/* Financial summary + timeline */}
        <div className="pp-glass p-5">
          <div className="pp-section-title">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            الملخص المالي
          </div>
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

        {/* Attendance section */}
        <AttendanceSection records={monthFilteredAttendance} />

        {/* Homework section */}
        <HomeworkSection homework={monthFilteredHomework} statuses={data.homeworkStatuses} studentId={student.id} />

        {/* Behavior section */}
        <BehaviorSection records={monthFilteredBehavior} />
      </main>

      {/* WhatsApp floating button */}
      {phone && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="pp-float-btn"
          aria-label="تواصل عبر واتساب"
        >
          <MessageCircle className="w-6 h-6 text-white" />
        </a>
      )}
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

function EncouragingCard({ message, attendanceRate, hwRate, examAvg }: { message: string; attendanceRate: number; hwRate: number; examAvg: number | null }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-l from-emerald-600/15 via-teal-600/8 to-transparent border border-emerald-500/15">
      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/8 rounded-full blur-2xl pointer-events-none" />
      <div className="relative flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center shrink-0 border border-emerald-500/15">
          <Heart className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-white leading-snug">{message}</p>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" />حضور {attendanceRate}%</span>
            {examAvg !== null && <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-amber-400" />مستوى {examAvg}%</span>}
            <span className="flex items-center gap-1"><BookOpen className="w-3 h-3 text-sky-400" />واجب {hwRate}%</span>
          </div>
        </div>
      </div>
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

function AnimatedRing({ value, label, sublabel, color, dimmed }: { value: number; label: string; sublabel: string; color: string; dimmed?: boolean }) {
  const pct = Math.min(100, value);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full pp-progress-ring" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          <circle
            cx="40" cy="40" r={radius} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)', filter: dimmed ? 'none' : `drop-shadow(0 0 4px ${color}55)` }}
            opacity={dimmed ? 0.3 : 1}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-black ${dimmed ? 'text-slate-500' : 'text-white'}`}>{dimmed ? '—' : `${pct}%`}</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-bold text-white">{label}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>
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

function MiniStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'emerald' | 'red' | 'amber' | 'sky' }) {
  const colorMap = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    red: 'text-red-400 bg-red-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    sky: 'text-sky-400 bg-sky-500/10',
  };
  return (
    <div className="glass-light rounded-xl p-2.5 text-center">
      <div className={`w-7 h-7 rounded-lg ${colorMap[color]} flex items-center justify-center mx-auto mb-1.5`}>{icon}</div>
      <p className="text-lg font-black text-white leading-none">{value}</p>
      <p className="text-[9px] text-slate-400 mt-1">{label}</p>
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
