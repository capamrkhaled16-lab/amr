import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchStudentByParentToken,
  fetchStudentById,
  fetchStudentByParentPhone,
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
  currentMonthKey,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { getMonthLabel, formatArabicDate, formatCurrency, getGradeRating } from '@/lib/format';
import { getMonthKey } from '@/lib/dates';
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
import { GraduationCap, Calendar, BookOpen, Award, TrendingUp, Wallet, Receipt, Users, ChevronLeft, ChevronRight, CircleAlert as AlertCircle, Loader as Loader2, Phone, Sparkles, FileText } from 'lucide-react';
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
}

export default function ParentPortal() {
  const [searchParams] = useSearchParams();
  // Support both current link format (?token=...) and legacy formats
  // (?student_id=... or ?phone=...) for 100% backward compatibility.
  const token = searchParams.get('token') ?? searchParams.get('parent_token');
  const studentIdParam = searchParams.get('student_id');
  const phoneParam = searchParams.get('phone') ?? searchParams.get('parent_phone');
  const initialMonth = searchParams.get('month');

  const [state, setState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [data, setData] = useState<ParentData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth || currentMonthKey());
  const [loadingMonth, setLoadingMonth] = useState(false);
  const reqIdRef = useRef(0);

  const loadData = useCallback(async (rawValue: string, monthKey: string, mode: 'token' | 'student_id' | 'phone' = 'token') => {
    const reqId = ++reqIdRef.current;
    setLoadingMonth(true);
    try {
      let student: Student | null = null;
      if (mode === 'student_id') {
        student = await fetchStudentById(rawValue);
      } else if (mode === 'phone') {
        student = await fetchStudentByParentPhone(rawValue);
      } else {
        student = await fetchStudentByParentToken(rawValue);
      }
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

      const [attendance, centerGrades, centerExams, onlineGrades, onlineExams, payments, subscriptions, homework, behavior] = await Promise.all([
        fetchAttendanceForStudent(student.id).catch(() => [] as AttendanceRecord[]),
        fetchCenterGradesByStudent(student.id).catch(() => [] as CenterGrade[]),
        fetchCenterExamsByStudent(student.id).catch(() => [] as CenterExam[]),
        fetchOnlineGradesByStudent(student.id).catch(() => [] as OnlineGrade[]),
        fetchOnlineExamsByStudent(student.id).catch(() => [] as OnlineExam[]),
        fetchPayments(student.id, monthKey).catch(() => [] as Payment[]),
        fetchStudentMonthlySubscriptions(student.id).catch(() => [] as MonthlySubscription[]),
        groupId ? fetchHomework(groupId, true, monthKey).catch(() => [] as Homework[]) : Promise.resolve([] as Homework[]),
        fetchBehaviorEvals(student.id).catch(() => [] as BehaviorEval[]),
      ]);

      const hwStatuses: HomeworkStatus[] = [];
      for (const hw of homework) {
        try {
          const statuses = await fetchHomeworkStatuses(hw.id);
          const studentStatus = (statuses ?? []).find((s) => s.student_id === student.id);
          if (studentStatus) hwStatuses.push(studentStatus);
        } catch {
          // Skip this homework's statuses if the query fails
        }
      }

      let groupData: { name?: string; grade_level?: { name?: string; stage?: { name?: string } } } | null = null;
      if (supabase && typeof supabase.from === 'function') {
        const { data: gData } = await supabase
          .from('groups')
          .select('name, grade_level:grade_levels(name, stage:academic_stages(name))')
          .eq('id', groupId)
          .maybeSingle();
        groupData = (gData as { name?: string; grade_level?: { name?: string; stage?: { name?: string } } } | null) ?? null;
      }

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
          homeworkStatuses,
          behavior: behavior ?? [],
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
    // Resolve the student using whichever param is present. The `token` param
    // is the current format; `student_id` and `phone` are legacy formats that
    // were sent in earlier links and must continue to work.
    if (token) {
      loadData(token, selectedMonth, 'token');
    } else if (studentIdParam) {
      loadData(studentIdParam, selectedMonth, 'student_id');
    } else if (phoneParam) {
      loadData(phoneParam, selectedMonth, 'phone');
    } else {
      setState('notfound');
      setErrorMsg('لم يتم العثور على رمز ولي الأمر في الرابط. تأكد من فتح الرابط الصحيح أو تواصل مع المعلم للحصول على رابط جديد.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, studentIdParam, phoneParam, selectedMonth, loadData]);

  if (state === 'loading') {
    return <FullScreenLoader label="جاري تحميل بيانات الطالب..." />;
  }

  if (state === 'notfound') {
    return <FullScreenError icon={<AlertCircle className="w-12 h-12 text-amber-400" />} message={errorMsg} />;
  }

  if (state === 'error') {
    return <FullScreenError icon={<AlertCircle className="w-12 h-12 text-red-400" />} message={errorMsg} />;
  }

  if (!data) return null;

  return <PortalContent data={data} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} loadingMonth={loadingMonth} />;
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
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
    <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6" dir="rtl">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center">
          {icon}
        </div>
        <p className="text-slate-300 text-sm leading-relaxed">{message}</p>
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
  const [activeTab, setActiveTab] = useState<'overview' | 'grades' | 'attendance' | 'homework' | 'finance' | 'behavior'>('overview');

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthKey());
    for (const sub of data.subscriptions) {
      if (sub.month_key) months.add(sub.month_key);
    }
    for (const p of data.payments) {
      if (p.month_key) months.add(p.month_key);
    }
    return Array.from(months).sort().reverse();
  }, [data.subscriptions, data.payments]);

  const monthFilteredPayments = data.payments.filter((p) => p.month_key === selectedMonth);
  const monthSubscription = data.subscriptions.find((s) => s.month_key === selectedMonth);

  const monthFilteredAttendance = data.attendance.filter((a) => {
    if (!a.attendance_date) return false;
    return a.attendance_date.slice(0, 7) === selectedMonth;
  });

  const monthFilteredBehavior = data.behavior.filter((b) => {
    if (!b.eval_date) return false;
    return b.eval_date.slice(0, 7) === selectedMonth;
  });

  const monthFilteredHomework = data.homework.filter((h) => {
    if (!h.due_date) return false;
    return h.due_date.slice(0, 7) === selectedMonth;
  });

  const monthFilteredHwStatuses = data.homeworkStatuses.filter((hs) => {
    const hw = data.homework.find((h) => h.id === hs.homework_id);
    if (!hw || !hw.due_date) return false;
    return hw.due_date.slice(0, 7) === selectedMonth;
  });

  const recordedAttendance = monthFilteredAttendance.filter((a) => a.status !== 'unrecorded');
  const presentCount = recordedAttendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const absentCount = recordedAttendance.filter((a) => a.status === 'absent').length;
  const excusedCount = recordedAttendance.filter((a) => a.status === 'excused' || a.status === 'excused_absence').length;
  const lateCount = recordedAttendance.filter((a) => a.status === 'late').length;
  const totalAttendance = recordedAttendance.length;
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : null;

  const hwDone = monthFilteredHwStatuses.filter((hs) => ['done', 'complete', 'completed'].includes(hs.status)).length;
  const hwLate = monthFilteredHwStatuses.filter((hs) => hs.status === 'late').length;
  const hwNotDone = monthFilteredHwStatuses.filter((hs) => ['not_done', 'incomplete', 'absent'].includes(hs.status)).length;
  const recordedHomeworkStatuses = monthFilteredHwStatuses.filter((hs) => hs.status !== 'unrecorded');
  const hwTotal = recordedHomeworkStatuses.length;
  const hwRate = hwTotal > 0 ? Math.round((hwDone / hwTotal) * 100) : null;

  const examAvg = useMemo(() => {
    const allGrades: { score: number; max: number }[] = [];
    for (const cg of data.centerGrades) {
      const exam = data.centerExams.find((e) => e.id === cg.center_exam_id);
      if (exam && exam.max_score > 0) {
        allGrades.push({ score: cg.score, max: exam.max_score });
      }
    }
    for (const og of data.onlineGrades) {
      if (og.max_score > 0) {
        allGrades.push({ score: og.score, max: og.max_score });
      }
    }
    if (allGrades.length === 0) return null;
    const sum = allGrades.reduce((acc, g) => acc + (g.score / g.max) * 100, 0);
    return Math.round(sum / allGrades.length);
  }, [data.centerGrades, data.centerExams, data.onlineGrades]);

  const feesDue = monthSubscription?.amount_due ?? 0;
  const feesPaid = monthFilteredPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const feesRemaining = Math.max(0, feesDue - feesPaid);
  const isExempt = monthSubscription?.is_exempt ?? false;
  const collectionRate = feesDue > 0 ? Math.min(100, Math.round((feesPaid / feesDue) * 100)) : 0;

  return (
    <div className="min-h-screen bg-[#080808] text-white" dir="rtl" lang="ar">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#080808]/90 backdrop-blur-xl border-b border-amber-400/15">
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
            {loadingMonth && <Loader2 className="w-4 h-4 animate-spin text-amber-300" />}
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
                  student.name,
                  student.stage_name,
                  student.grade_name,
                  student.group_name,
                  getMonthLabel(selectedMonth),
                  {
                    attendanceRate,
                    present: presentCount,
                    absent: absentCount,
                    excused: excusedCount,
                    late: lateCount,
                    hwRate,
                    hwDone,
                    hwTotal,
                    examAvg,
                    feesDue,
                    feesPaid,
                    feesRemaining,
                    isExempt,
                  },
                  grades,
                  monthFilteredPayments.map((p) => ({ date: p.payment_date, amount: p.amount ?? 0, note: p.note ?? null })),
                );
              }}
            />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24">
        {/* Student Profile Header */}
        <ProfileHeader student={student} />

        {/* Month Selector */}
        <MonthSelector
          selectedMonth={selectedMonth}
          onMonthChange={onMonthChange}
          availableMonths={availableMonths}
        />

        {/* Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
          {([
            { id: 'overview', label: 'نظرة عامة', icon: Sparkles },
            { id: 'grades', label: 'الدرجات', icon: TrendingUp },
            { id: 'attendance', label: 'الحضور', icon: Calendar },
            { id: 'homework', label: 'الواجبات', icon: BookOpen },
            { id: 'finance', label: 'الرسوم', icon: Wallet },
            { id: 'behavior', label: 'السلوك', icon: Award },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-emerald-500/15 text-amber-300 border border-emerald-500/20'
                  : 'bg-[#111111] text-slate-300 border border-white/10 hover:text-amber-200'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'overview' && (
          <OverviewTab
            attendanceRate={attendanceRate}
            presentCount={presentCount}
            absentCount={absentCount}
            excusedCount={excusedCount}
            lateCount={lateCount}
            hwRate={hwRate}
            hwDone={hwDone}
            hwTotal={hwTotal}
            examAvg={examAvg}
            feesDue={feesDue}
            feesPaid={feesPaid}
            feesRemaining={feesRemaining}
            isExempt={isExempt}
            collectionRate={collectionRate}
          />
        )}

        {activeTab === 'grades' && (
          <GradesTab
            centerGrades={data.centerGrades}
            centerExams={data.centerExams}
            onlineGrades={data.onlineGrades}
            onlineExams={data.onlineExams}
            selectedMonth={selectedMonth}
          />
        )}

        {activeTab === 'attendance' && (
          <AttendanceTab records={monthFilteredAttendance} />
        )}

        {activeTab === 'homework' && (
          <HomeworkTab
            homework={monthFilteredHomework}
            statuses={data.homeworkStatuses}
            studentId={student.id}
          />
        )}

        {activeTab === 'finance' && (
          <FinanceTab
            payments={monthFilteredPayments}
            subscription={monthSubscription}
            feesDue={feesDue}
            feesPaid={feesPaid}
            feesRemaining={feesRemaining}
            isExempt={isExempt}
          />
        )}

        {activeTab === 'behavior' && (
          <BehaviorTab records={monthFilteredBehavior} />
        )}
      </main>
    </div>
  );
}

function ProfileHeader({ student }: { student: ParentData['student'] }) {
  const initials = student.name?.charAt(0) ?? '؟';
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1b1b1b] via-[#151515] to-[#0c0c0c] border border-amber-400/15 p-5">
      <div className="absolute -top-12 -left-12 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl" />
      <div className="relative flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-2xl font-black text-white shadow-lg shadow-emerald-500/20 shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white truncate">{student.name}</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {student.stage_name && (
              <span className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-800/60 text-slate-300 font-medium">
                {student.stage_name}
              </span>
            )}
            {student.grade_name && (
              <span className="text-[10px] px-2 py-0.5 rounded-lg bg-emerald-500/10 text-amber-300 font-medium">
                {student.grade_name}
              </span>
            )}
            {student.group_name && (
              <span className="text-[10px] px-2 py-0.5 rounded-lg bg-amber-400/10 text-amber-300 font-medium">
                {student.group_name}
              </span>
            )}
          </div>
          {student.parent_phone && (
            <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-500">
              <Phone className="w-3 h-3" />
              <span dir="ltr">{student.parent_phone}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthSelector({
  selectedMonth,
  onMonthChange,
  availableMonths,
}: {
  selectedMonth: string;
  onMonthChange: (m: string) => void;
  availableMonths: string[];
}) {
  const currentIndex = availableMonths.indexOf(selectedMonth);
  const canGoBack = currentIndex < availableMonths.length - 1;
  const canGoForward = currentIndex > 0;

  return (
    <div className="flex items-center justify-between bg-[#151515] rounded-2xl border border-white/10 px-3 py-2.5">
      <button
        disabled={!canGoBack}
        onClick={() => canGoBack && onMonthChange(availableMonths[currentIndex + 1])}
        className="p-1.5 rounded-lg text-slate-400 disabled:opacity-30 hover:bg-slate-800 hover:text-white transition-colors"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-amber-300" />
        <span className="text-sm font-bold text-white">{getMonthLabel(selectedMonth)}</span>
      </div>
      <button
        disabled={!canGoForward}
        onClick={() => canGoForward && onMonthChange(availableMonths[currentIndex - 1])}
        className="p-1.5 rounded-lg text-slate-400 disabled:opacity-30 hover:bg-slate-800 hover:text-white transition-colors"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

function CircleIndicator({
  value,
  max,
  label,
  sublabel,
  color,
}: {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
  color: string;
}) {
  const hasValue = max > 0;
  const pct = hasValue ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" className="text-slate-800" strokeWidth="6" />
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke="currentColor"
            className={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-black text-white">{hasValue ? `${pct}%` : '—'}</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-bold text-white">{label}</p>
        {sublabel && <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

function OverviewTab({
  attendanceRate,
  presentCount,
  absentCount,
  excusedCount,
  lateCount,
  hwRate,
  hwDone,
  hwTotal,
  examAvg,
  feesDue,
  feesPaid,
  feesRemaining,
  isExempt,
  collectionRate,
}: {
  attendanceRate: number | null;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  hwRate: number;
  hwDone: number;
  hwTotal: number;
  examAvg: number | null;
  feesDue: number;
  feesPaid: number;
  feesRemaining: number;
  isExempt: boolean;
  collectionRate: number;
}) {
  return (
    <div className="space-y-4">
      {/* Circle indicators */}
      <div className="bg-[#151515] rounded-3xl border border-white/10 p-5">
        <div className="flex justify-around items-start">
          <CircleIndicator
            value={attendanceRate ?? 0}
            max={attendanceRate === null ? 0 : 100}
            label="الحضور"
            sublabel={attendanceRate === null ? 'لا توجد سجلات مكتملة' : `${presentCount} من ${presentCount + absentCount + excusedCount}`}
            color="text-amber-300"
          />
          <CircleIndicator
            value={hwRate ?? 0}
            max={hwRate === null ? 0 : 100}
            label="الواجبات"
            sublabel={hwRate === null ? 'لا توجد حالات مسجلة' : `${hwDone} من ${hwTotal}`}
            color="text-amber-400"
          />
          <CircleIndicator
            value={examAvg ?? 0}
            max={100}
            label="المستوى"
            sublabel={examAvg === null ? 'لا توجد درجات' : `${examAvg}%`}
            color="text-amber-400"
          />
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<Calendar className="w-4 h-4" />}
          label="أيام الحضور"
          value={`${presentCount}`}
          color="emerald"
        />
        <StatCard
          icon={<Calendar className="w-4 h-4" />}
          label="أيام الغياب"
          value={`${absentCount}`}
          color="red"
        />
        <StatCard
          icon={<Calendar className="w-4 h-4" />}
          label="غياب بعذر"
          value={`${excusedCount}`}
          color="amber"
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="تأخر"
          value={`${lateCount}`}
          color="sky"
        />
      </div>

      {/* Financial summary */}
      <div className="bg-[#151515] rounded-3xl border border-white/10 p-5 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="w-4 h-4 text-amber-300" />
          <h3 className="text-sm font-bold text-white">الملخص المالي</h3>
        </div>
        {isExempt ? (
          <div className="bg-emerald-500/10 rounded-xl p-3 text-center">
            <p className="text-sm font-bold text-amber-300">معفى من الرسوم</p>
          </div>
        ) : feesDue === 0 ? (
          <div className="bg-slate-800/50 rounded-xl p-3 text-center">
            <p className="text-sm text-slate-400">لا توجد رسوم مسجلة لهذا الشهر</p>
          </div>
        ) : (
          <>
            <FinanceRow label="الرسوم المستحقة" value={formatCurrency(feesDue)} color="text-white" />
            <FinanceRow label="المبلغ المدفوع" value={formatCurrency(feesPaid)} color="text-amber-300" />
            <div className="h-px bg-slate-800" />
            <FinanceRow
              label="المبلغ المتبقي"
              value={formatCurrency(feesRemaining)}
              color={feesRemaining > 0 ? 'text-red-400' : 'text-amber-300'}
              bold
            />
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>نسبة التحصيل</span>
                <span>{collectionRate}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-300 to-amber-600 rounded-full transition-all duration-500"
                  style={{ width: `${collectionRate}%` }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: 'emerald' | 'red' | 'amber' | 'sky';
}) {
  const colorMap = {
    emerald: 'text-amber-300 bg-emerald-500/10',
    red: 'text-red-400 bg-red-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    sky: 'text-sky-400 bg-sky-500/10',
  };
  return (
    <div className="bg-[#151515] rounded-2xl border border-white/10 p-3.5">
      <div className={`w-8 h-8 rounded-lg ${colorMap[color]} flex items-center justify-center mb-2`}>
        {icon}
      </div>
      <p className="text-xl font-black text-white">{value}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function FinanceRow({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`${bold ? 'text-base font-black' : 'text-sm font-bold'} ${color}`}>{value}</span>
    </div>
  );
}

function GradesTab({
  centerGrades,
  centerExams,
  onlineGrades,
  onlineExams,
  selectedMonth,
}: {
  centerGrades: CenterGrade[];
  centerExams: CenterExam[];
  onlineGrades: OnlineGrade[];
  onlineExams: OnlineExam[];
  selectedMonth: string;
}) {
  const monthCenterGrades = centerGrades.filter((g) => {
    const exam = centerExams.find((e) => e.id === g.center_exam_id);
    if (!exam || !exam.exam_date) return false;
    return exam.exam_date.slice(0, 7) === selectedMonth;
  });

  const monthOnlineGrades = onlineGrades.filter((og) => {
    const exam = onlineExams.find((e) => e.id === og.exam_id);
    if (!exam) return false;
    const dateKey = (exam.open_at ?? exam.created_at)?.slice(0, 7);
    return dateKey === selectedMonth;
  });

  if (monthCenterGrades.length === 0 && monthOnlineGrades.length === 0) {
    return <EmptyState icon={<TrendingUp className="w-8 h-8" />} message="لا توجد درجات مسجلة لهذا الشهر" />;
  }

  return (
    <div className="space-y-3">
      {monthCenterGrades.length > 0 && (
        <div className="bg-[#151515] rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-bold text-white">امتحانات المركز</h3>
          </div>
          <div className="divide-y divide-slate-800/50">
            {monthCenterGrades.map((g) => {
              const exam = centerExams.find((e) => e.id === g.center_exam_id);
              if (!exam) return null;
              const rating = getGradeRating(g.score, exam.max_score);
              const pct = exam.max_score > 0 ? Math.round((g.score / exam.max_score) * 100) : 0;
              return (
                <div key={g.id} className="px-4 py-3 flex items-center justify-between">
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

      {monthOnlineGrades.length > 0 && (
        <div className="bg-[#151515] rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-bold text-white">الامتحانات الإلكترونية</h3>
          </div>
          <div className="divide-y divide-slate-800/50">
            {monthOnlineGrades.map((og) => {
              const exam = onlineExams.find((e) => e.id === og.exam_id);
              if (!exam) return null;
              const rating = getGradeRating(og.score, og.max_score);
              const pct = og.max_score > 0 ? Math.round((og.score / og.max_score) * 100) : 0;
              return (
                <div key={og.id} className="px-4 py-3 flex items-center justify-between">
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
  );
}

function AttendanceTab({ records }: { records: (AttendanceRecord & { sessions?: { id: string; title: string } | null })[] }) {
  if (records.length === 0) {
    return <EmptyState icon={<Calendar className="w-8 h-8" />} message="لا توجد سجلات حضور لهذا الشهر" />;
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    present: { label: 'حاضر', color: 'text-amber-300', bg: 'bg-emerald-500/10' },
    absent: { label: 'غائب', color: 'text-red-400', bg: 'bg-red-500/10' },
    excused: { label: 'غائب بعذر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    excused_absence: { label: 'غائب بعذر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    late: { label: 'تأخر', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    unrecorded: { label: 'لم يسجل', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  };

  return (
    <div className="bg-[#151515] rounded-2xl border border-white/10 overflow-hidden">
      <div className="divide-y divide-slate-800/50">
        {records.map((rec) => {
          const cfg = statusConfig[rec.status] ?? statusConfig.unrecorded;
          return (
            <div key={rec.id} className="px-4 py-3 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{formatArabicDate(rec.attendance_date)}</p>
                {rec.sessions?.title && (
                  <p className="text-[10px] text-slate-400 mt-0.5">{rec.sessions.title}</p>
                )}
                {rec.notes && <p className="text-[10px] text-slate-500 mt-0.5">{rec.notes}</p>}
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.color} shrink-0`}>
                {cfg.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HomeworkTab({
  homework,
  statuses,
  studentId,
}: {
  homework: Homework[];
  statuses: HomeworkStatus[];
  studentId: string;
}) {
  if (homework.length === 0) {
    return <EmptyState icon={<BookOpen className="w-8 h-8" />} message="لا توجد واجبات لهذا الشهر" />;
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    done: { label: 'تم', color: 'text-amber-300', bg: 'bg-emerald-500/10' },
    complete: { label: 'تم', color: 'text-amber-300', bg: 'bg-emerald-500/10' },
    completed: { label: 'تم', color: 'text-amber-300', bg: 'bg-emerald-500/10' },
    late: { label: 'متأخر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    incomplete: { label: 'غير مكتمل', color: 'text-red-400', bg: 'bg-red-500/10' },
    not_done: { label: 'لم يتم', color: 'text-red-400', bg: 'bg-red-500/10' },
    absent: { label: 'غائب', color: 'text-slate-400', bg: 'bg-slate-500/10' },
    excused: { label: 'بعذر', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    unrecorded: { label: 'لم يسجل', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  };

  return (
    <div className="space-y-2.5">
      {homework.map((hw) => {
        const status = statuses.find((s) => s.homework_id === hw.id && s.student_id === studentId);
        const cfg = status ? (statusConfig[status.status] ?? statusConfig.unrecorded) : null;
        return (
          <div key={hw.id} className="bg-[#151515] rounded-2xl border border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{hw.title}</p>
                {hw.description && (
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">{hw.description}</p>
                )}
                <p className="text-[10px] text-slate-500 mt-1.5">التسليم: {formatArabicDate(hw.due_date)}</p>
                {status?.teacher_note && (
                  <p className="text-[10px] text-slate-400 mt-1.5 bg-slate-800/40 rounded-lg px-2 py-1">
                    ملاحظة المعلم: {status.teacher_note}
                  </p>
                )}
              </div>
              {cfg ? (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.color} shrink-0`}>
                  {cfg.label}
                </span>
              ) : (
                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-400 shrink-0">
                  لم يسجل
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FinanceTab({
  payments,
  subscription,
  feesDue,
  feesPaid,
  feesRemaining,
  isExempt,
}: {
  payments: Payment[];
  subscription: MonthlySubscription | undefined;
  feesDue: number;
  feesPaid: number;
  feesRemaining: number;
  isExempt: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* Summary card */}
      <div className="bg-[#151515] rounded-3xl border border-white/10 p-5 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="w-4 h-4 text-amber-300" />
          <h3 className="text-sm font-bold text-white">الملخص المالي</h3>
        </div>
        {isExempt ? (
          <div className="bg-emerald-500/10 rounded-xl p-4 text-center">
            <p className="text-sm font-bold text-amber-300">معفى من الرسوم</p>
            {subscription?.exemption_note && (
              <p className="text-[10px] text-slate-400 mt-1">{subscription.exemption_note}</p>
            )}
          </div>
        ) : feesDue === 0 && payments.length === 0 ? (
          <div className="bg-slate-800/50 rounded-xl p-4 text-center">
            <p className="text-sm text-slate-400">لا توجد بيانات مالية لهذا الشهر</p>
          </div>
        ) : (
          <>
            <FinanceRow label="الرسوم المستحقة" value={formatCurrency(feesDue)} color="text-white" />
            <FinanceRow label="المبلغ المدفوع" value={formatCurrency(feesPaid)} color="text-amber-300" />
            <div className="h-px bg-slate-800" />
            <FinanceRow
              label="المبلغ المتبقي"
              value={formatCurrency(feesRemaining)}
              color={feesRemaining > 0 ? 'text-red-400' : 'text-amber-300'}
              bold
            />
          </>
        )}
      </div>

      {/* Payment receipts */}
      {payments.length > 0 && (
        <div className="bg-[#151515] rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-amber-300" />
              <h3 className="text-sm font-bold text-white">إيصالات الدفع</h3>
            </div>
          </div>
          <div className="divide-y divide-slate-800/50">
            {payments.map((p) => (
              <div key={p.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">{formatCurrency(p.amount)} ج.م</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatArabicDate(p.payment_date)}</p>
                    {p.receipt_number && (
                      <p className="text-[10px] text-slate-500 mt-0.5" dir="ltr">رقم الإيصال: {p.receipt_number}</p>
                    )}
                    {p.note && <p className="text-[10px] text-slate-400 mt-1">{p.note}</p>}
                  </div>
                  <div className="shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Receipt className="w-4 h-4 text-amber-300" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {payments.length === 0 && !isExempt && feesDue > 0 && (
        <EmptyState icon={<Wallet className="w-8 h-8" />} message="لم يتم تسجيل أي مدفوعات لهذا الشهر" />
      )}
    </div>
  );
}

function BehaviorTab({ records }: { records: BehaviorEval[] }) {
  if (records.length === 0) {
    return <EmptyState icon={<Award className="w-8 h-8" />} message="لا توجد تقيمات سلوك لهذا الشهر" />;
  }

  const ratingConfig: Record<string, { label: string; color: string; bg: string }> = {
    excellent: { label: 'ممتاز', color: 'text-amber-300', bg: 'bg-emerald-500/10' },
    participatory: { label: 'مشارك', color: 'text-amber-300', bg: 'bg-emerald-500/10' },
    quiet: { label: 'هادئ', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    needs_attention: { label: 'يحتاج اهتمام', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    disruptive: { label: 'مزعج', color: 'text-red-400', bg: 'bg-red-500/10' },
  };

  return (
    <div className="space-y-2.5">
      {records.map((rec) => {
        const cfg = rec.rating ? (ratingConfig[rec.rating] ?? { label: rec.rating, color: 'text-slate-400', bg: 'bg-slate-500/10' }) : null;
        return (
          <div key={rec.id} className="bg-[#151515] rounded-2xl border border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{formatArabicDate(rec.eval_date)}</p>
                {rec.note && (
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{rec.note}</p>
                )}
                <p className="text-[10px] text-slate-500 mt-1.5">{rec.scope === 'session' ? 'تقييم حصة' : rec.scope === 'monthly' ? 'تقييم شهري' : 'تقييم يومي'}</p>
              </div>
              {cfg && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.color} shrink-0`}>
                  {cfg.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center text-slate-500 mb-3">
        {icon}
      </div>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
